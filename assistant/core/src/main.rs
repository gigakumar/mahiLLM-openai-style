use futures_util::Stream;
use std::{pin::Pin};
use tonic::{transport::Server, Request as TRequest, Response as TResponse, Status};

pub mod assistant {
    tonic::include_proto!("assistant");
}

use assistant::assistant_server::{Assistant, AssistantServer};
use assistant::{Request, Response};

#[derive(Default)]
struct AssistantSvc;

#[tonic::async_trait]
impl Assistant for AssistantSvc {
    async fn send(&self, req: TRequest<Request>) -> Result<TResponse<Response>, Status> {
        let inner = req.into_inner();
        let reply = Response {
            id: inner.id,
            status: 200,
            payload: format!("{{\"echo\":{},\"type\":\"{}\"}}", serde_json::to_string(&inner.payload).unwrap_or("\"\"".into()), inner.r#type),
        };
        Ok(TResponse::new(reply))
    }

    type StreamResponsesStream = Pin<Box<dyn Stream<Item = Result<Response, Status>> + Send + 'static>>;

    async fn stream_responses(
        &self,
        req: TRequest<tonic::Streaming<Request>>,
    ) -> Result<TResponse<Self::StreamResponsesStream>, Status> {
        let mut inbound = req.into_inner();
        let output = async_stream::try_stream! {
            while let Some(next) = inbound.message().await? {
                let resp = Response { id: next.id, status: 200, payload: next.payload };
                yield resp;
            }
        };
        Ok(TResponse::new(Box::pin(output)))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Simple TCP address (UDS can be added later)
    let addr = std::env::var("ASSISTANT_ADDR").unwrap_or_else(|_| "127.0.0.1:50051".to_string());
    let addr = addr.parse()?;

    println!("assistant-core listening on {}", addr);
    Server::builder()
        .add_service(AssistantServer::new(AssistantSvc::default()))
        .serve(addr)
        .await?;

    Ok(())
}
