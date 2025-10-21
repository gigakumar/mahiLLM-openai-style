use clap::{Parser, Subcommand, Args};
use anyhow::Result;
use futures_util::StreamExt;
use std::io::{self, Read};

mod assistant {
  tonic::include_proto!("assistant");
}

use assistant::assistant_client::AssistantClient;
use assistant::indexer_client::IndexerClient;
use assistant::embeddings_client::EmbeddingsClient;
use assistant::{Request as ARequest, IndexRequest, QueryRequest, EmbedRequest};

#[derive(Parser, Debug)]
#[command(name = "ondevice")] 
#[command(about = "OnDevice AI CLI for Assistant and Indexer", long_about = None)]
struct Cli {
  /// Server address, e.g., http://127.0.0.1:50051
  #[arg(short, long, env = "ASSISTANT_ADDR", default_value = "http://127.0.0.1:50051")]
  addr: String,

  /// Output JSON instead of text
  #[arg(long, action = clap::ArgAction::SetTrue)]
  json: bool,

  #[command(subcommand)]
  command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
  /// Send a single request to Assistant.Send
  Send {
    #[arg(short, long, default_value = "1")] id: String,
    #[arg(short, long, default_value = "u1")] user_id: String,
    #[arg(short='k', long, default_value = "query")] kind: String,
    #[arg(short, long, default_value = "hello")] payload: String,
  },
  /// Start a streaming demo via Assistant.StreamResponses
  Stream(StreamOpts),
  /// Index a document via Indexer.Index
  Index(IndexOpts),
  /// Query top-k via Indexer.Query
  Query { query: String, #[arg(short, long, default_value_t = 5)] k: i32 },
  /// Get embeddings for a text
  Embed { text: String },
}

#[derive(Args, Debug)]
struct StreamOpts {
  /// Read stdin and send each line as a streaming request (demo). If false, sends a single demo request.
  #[arg(long, action = clap::ArgAction::SetTrue)]
  stdin: bool,
}

#[derive(Args, Debug)]
struct IndexOpts {
  /// Document id
  id: String,
  /// Document text (if omitted, provide --file or pipe via stdin)
  #[arg(default_value = "")]
  text: String,
  /// Read text from file
  #[arg(long)]
  file: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
  let cli = Cli::parse();
  match cli.command {
    Commands::Send { id, user_id, kind, payload } => {
      let mut client = AssistantClient::connect(cli.addr).await?;
      let req = ARequest { id, user_id, r#type: kind, payload };
      let resp = client.send(req).await?.into_inner();
      if cli.json {
        println!("{}", serde_json::json!({"status": resp.status, "id": resp.id, "payload": resp.payload}));
      } else {
        println!("status={} id={} payload={}", resp.status, resp.id, resp.payload);
      }
    }
    Commands::Stream(opts) => {
      let mut client = AssistantClient::connect(cli.addr).await?;
      let (mut tx, rx) = tokio::sync::mpsc::channel(32);
      if opts.stdin {
        // read stdin lines and send them as requests
        tokio::spawn(async move {
          let mut input = String::new();
          // blocking read is fine for demo; could use async streams
          let _ = io::stdin().read_to_string(&mut input);
          for (i, line) in input.lines().enumerate() {
            let _ = tx.send(ARequest { id: format!("line-{}", i+1), user_id: "u1".into(), r#type: "demo".into(), payload: line.to_string() }).await;
          }
        });
      } else {
        // single demo request
        tokio::spawn(async move {
          let _ = tx.send(ARequest { id: "stream-1".into(), user_id: "u1".into(), r#type: "demo".into(), payload: "start".into() }).await;
        });
      }
      let outbound = tokio_stream::wrappers::ReceiverStream::new(rx).map(Ok);
      let mut stream = client.stream_responses(outbound).await?.into_inner();
      if cli.json {
        while let Some(item) = stream.next().await {
          let msg = item?;
          println!("{}", serde_json::json!({"id": msg.id, "status": msg.status, "payload": msg.payload}));
        }
      } else {
        while let Some(item) = stream.next().await {
          let msg = item?;
          print!("{}", msg.payload);
        }
        println!();
      }
    }
    Commands::Index(opts) => {
      let mut client = IndexerClient::connect(cli.addr).await?;
      let text = resolve_text(opts.text, opts.file.as_deref())?;
      let res = client.index(IndexRequest { id: opts.id, text }).await?.into_inner();
      if cli.json {
        println!("{}", serde_json::json!({"status": res.status, "message": res.message}));
      } else {
        println!("status={} message={}", res.status, res.message);
      }
    }
    Commands::Query { query, k } => {
      let mut client = IndexerClient::connect(cli.addr).await?;
      let res = client.query(QueryRequest { query, k }).await?.into_inner();
      if cli.json {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({"hits": res.hits.iter().map(|d| serde_json::json!({"id": d.id, "score": d.score, "text": d.text})).collect::<Vec<_>>()}))?);
      } else {
        for (i, d) in res.hits.iter().enumerate() {
          println!("{}: id={} score={:.3}\n{}\n", i+1, d.id, d.score, d.text);
        }
      }
    }
    Commands::Embed { text } => {
      let mut client = EmbeddingsClient::connect(cli.addr).await?;
      let res = client.embed(EmbedRequest { text }).await?.into_inner();
      if cli.json {
        println!("{}", serde_json::json!({"vector": res.vector}));
      } else {
        println!("dim={} [{:.3} ...]", res.vector.len(), res.vector.get(0).cloned().unwrap_or(0.0));
      }
    }
  }
  Ok(())
}

fn resolve_text(arg_text: String, file: Option<&str>) -> Result<String> {
  if !arg_text.is_empty() { return Ok(arg_text); }
  if let Some(path) = file { return Ok(std::fs::read_to_string(path)?); }
  // read stdin
  let mut buf = String::new();
  io::stdin().read_to_string(&mut buf)?;
  if buf.trim().is_empty() {
    anyhow::bail!("Provide text, --file PATH, or pipe stdin");
  }
  Ok(buf)
}
