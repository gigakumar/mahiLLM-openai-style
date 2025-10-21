use std::{sync::Arc, path::PathBuf, fs};
use tonic::{transport::Server, Request, Response, Status};
use tokio::sync::RwLock;

mod assistant {
  tonic::include_proto!("assistant");
}

use assistant::assistant_server::{Assistant, AssistantServer};
use assistant::indexer_server::{Indexer, IndexerServer};
use assistant::embeddings_server::{Embeddings, EmbeddingsServer};
use assistant::{Request as ARequest, Response as AResponse};
use assistant::{IndexRequest, IndexResponse, QueryRequest, QueryResponse, Document};
use assistant::{EmbedRequest, EmbedResponse, BatchEmbedRequest, BatchEmbedResponse};

#[derive(Default)]
pub struct CoreService;

#[derive(Default)]
pub struct VectorIndex {
  // (id, text, embedding)
  docs: Vec<(String, String, Vec<f32>)>,
  path: Option<PathBuf>,
}

impl VectorIndex {
  fn embed(text: &str) -> Vec<f32> {
    // Very simple hash-based embedding to fixed 256 dim
    const D: usize = 256;
    let mut v = vec![0f32; D];
    for tok in text.split_whitespace() {
      let mut h: u64 = 1469598103934665603; // FNV-1a offset
      for b in tok.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
      }
      let idx = (h as usize) & (D - 1);
      v[idx] += 1.0;
    }
    // L2 normalize
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
    for x in &mut v { *x /= norm; }
    v
  }

  fn upsert(&mut self, id: String, text: String) {
    let emb = Self::embed(&text);
    if let Some(slot) = self.docs.iter_mut().find(|(i,_,_)| i == &id) {
      *slot = (id, text, emb);
    } else {
      self.docs.push((id, text, emb));
    }
    let _ = self.save_to_disk();
  }

  fn query(&self, q: &str, k: usize) -> Vec<(String, String, f32)> {
    let qe = Self::embed(q);
    let mut scored: Vec<_> = self.docs.iter()
      .map(|(id, text, e)| {
        let score = dot(&qe, e);
        (id.clone(), text.clone(), score)
      })
      .collect();
    scored.sort_by(|a,b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    scored
  }

  fn load_from_disk(path: PathBuf) -> Self {
    if let Ok(bytes) = fs::read(&path) {
      if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if let Some(arr) = json.as_array() {
          let mut docs = Vec::new();
          for item in arr {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let text = item.get("text").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let emb = item.get("emb").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_f64()).map(|f| f as f32).collect()).unwrap_or_else(Vec::new);
            if !id.is_empty() { docs.push((id, text, emb)); }
          }
          return Self { docs, path: Some(path) };
        }
      }
    }
    Self { docs: Vec::new(), path: Some(path) }
  }

  fn save_to_disk(&self) -> std::io::Result<()> {
    if let Some(p) = &self.path {
      if let Some(dir) = p.parent() { let _ = fs::create_dir_all(dir); }
      let data: Vec<serde_json::Value> = self.docs.iter().map(|(id, text, emb)| {
        serde_json::json!({"id": id, "text": text, "emb": emb})
      }).collect();
      let bytes = serde_json::to_vec_pretty(&data)?;
      fs::write(p, bytes)?;
    }
    Ok(())
  }
}

fn dot(a: &[f32], b: &[f32]) -> f32 { a.iter().zip(b).map(|(x,y)| x*y).sum() }

#[tonic::async_trait]
impl Assistant for CoreService {
  async fn send(&self, req: Request<ARequest>) -> Result<Response<AResponse>, Status> {
    let r = req.into_inner();
    let payload = format!("received type={} payload={}", r.r#type, r.payload);
    let resp = AResponse { id: r.id, status: 0, payload };
    Ok(Response::new(resp))
  }

  type StreamResponsesStream = tokio_stream::wrappers::ReceiverStream<Result<AResponse, Status>>;
  async fn stream_responses(&self, req: Request<tonic::Streaming<ARequest>>)
    -> Result<Response<Self::StreamResponsesStream>, Status> {
    let mut inbound = req.into_inner();
    // Drain inbound in background (ignore content for demo)
    tokio::spawn(async move {
      while let Ok(Some(_m)) = inbound.message().await { /* ignore */ }
    });

    let (tx, rx) = tokio::sync::mpsc::channel(16);
    tokio::spawn(async move {
      let chunks = [
        "Streaming demo: hello ",
        "from the server ",
        "with timed ",
        "chunks. ",
        "Goodbye!",
      ];
      for (i, part) in chunks.iter().enumerate() {
        let resp = AResponse { id: format!("chunk-{}", i+1), status: 0, payload: part.to_string() };
        if tx.send(Ok(resp)).await.is_err() { return; }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
      }
    });
    Ok(Response::new(tokio_stream::wrappers::ReceiverStream::new(rx)))
  }
}

pub struct IndexerService {
  store: Arc<RwLock<VectorIndex>>,
}

#[tonic::async_trait]
impl Indexer for IndexerService {
  async fn index(&self, req: Request<IndexRequest>) -> Result<Response<IndexResponse>, Status> {
    let IndexRequest { id, text } = req.into_inner();
    if id.is_empty() || text.is_empty() {
      return Ok(Response::new(IndexResponse { status: 1, message: "id and text are required".into() }));
    }
    let mut guard = self.store.write().await;
    guard.upsert(id, text);
    Ok(Response::new(IndexResponse { status: 0, message: "ok".into() }))
  }

  async fn query(&self, req: Request<QueryRequest>) -> Result<Response<QueryResponse>, Status> {
    let QueryRequest { query, k } = req.into_inner();
    let kk = if k <= 0 { 5 } else { k as usize };
    let guard = self.store.read().await;
    let hits = guard.query(&query, kk)
      .into_iter()
      .map(|(id, text, score)| Document { id, text, score })
      .collect();
    Ok(Response::new(QueryResponse { hits }))
  }
}

pub struct EmbeddingsService;

#[tonic::async_trait]
impl Embeddings for EmbeddingsService {
  async fn embed(&self, request: Request<EmbedRequest>) -> Result<Response<EmbedResponse>, Status> {
    let text = request.into_inner().text;
    let vec = VectorIndex::embed(&text);
    Ok(Response::new(EmbedResponse { vector: vec }))
  }

  async fn batch_embed(&self, request: Request<BatchEmbedRequest>) -> Result<Response<BatchEmbedResponse>, Status> {
    let texts = request.into_inner().texts;
    let items = texts.into_iter().map(|t| EmbedResponse { vector: VectorIndex::embed(&t) }).collect();
    Ok(Response::new(BatchEmbedResponse { items }))
  }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  let addr = "127.0.0.1:50051".parse()?;
  let svc = CoreService::default();
  let index_path = std::env::var("ONDEVICE_INDEX_PATH").unwrap_or_else(|_| "./data/index.json".into());
  let vi = VectorIndex::load_from_disk(PathBuf::from(index_path));
  let index = IndexerService { store: Arc::new(RwLock::new(vi)) };

  // Reflection
  let reflection = tonic_reflection::server::Builder::configure()
    .register_encoded_file_descriptor_set(include_bytes!(concat!(env!("OUT_DIR"), "/assistant_descriptor.bin")))
    .build()
    .ok();

  let mut builder = Server::builder()
    .add_service(AssistantServer::new(svc))
    .add_service(IndexerServer::new(index))
    .add_service(EmbeddingsServer::new(EmbeddingsService));
  if let Some(r) = reflection { builder = builder.add_service(r); }

  builder.serve(addr).await?;
  Ok(())
}
