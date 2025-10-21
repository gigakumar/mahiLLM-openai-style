use std::{net::SocketAddr, pin::Pin, time::Duration};

use tokio::sync::mpsc;
use tokio_stream::{wrappers::ReceiverStream, Stream};
use tonic::{transport::Server, Request, Response, Status};
use tracing::{error, info};

pub mod pb {
    pub mod assistant {
        pub mod v1 {
            include!("pb/assistant.v1.rs");
        }
    }
}

use pb::assistant::v1::assistant_server::{Assistant, AssistantServer};
use pb::assistant::v1::{ChatRequest, ChatResponse, PlanRequest, PlanResponse};

#[derive(Default, Clone)]
struct AssistantSvc;

type ChatStream = Pin<Box<dyn Stream<Item = Result<ChatResponse, Status>> + Send + Sync + 'static>>;

#[tonic::async_trait]
impl Assistant for AssistantSvc {
    type ChatStream = ChatStream;

    async fn chat(&self, request: Request<ChatRequest>) -> Result<Response<Self::ChatStream>, Status> {
        let req = request.into_inner();
        let mut last_user: String = String::new();
        for m in req.messages.into_iter().rev() {
            if m.role == "user" {
                last_user = m.content;
                break;
            }
        }
        if last_user.is_empty() {
            last_user = "Hello! Ask me anything.".to_string();
        }

        // Simple mock reply text
        let reply = format!(
            "You said: {}. Here's a thoughtful, friendly response.\n\n- Clean UI\n- Smooth streaming\n- Markdown support\n\nAsk another question!",
            last_user
        );

        let (tx, rx) = mpsc::channel(32);
        tokio::spawn(async move {
            // stream token-by-token (split by whitespace and keep spaces)
            let parts = split_preserve_whitespace(&reply);
            for p in parts {
                let msg = ChatResponse {
                    event: Some(pb::assistant::v1::chat_response::Event::Delta(
                        pb::assistant::v1::ChatDelta { token: p, done: false },
                    )),
                };
                if tx.send(Ok(msg)).await.is_err() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            let done = ChatResponse {
                event: Some(pb::assistant::v1::chat_response::Event::Delta(
                    pb::assistant::v1::ChatDelta { token: String::new(), done: true },
                )),
            };
            let _ = tx.send(Ok(done)).await;
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(rx)) as Self::ChatStream))
    }

    async fn plan(&self, request: Request<PlanRequest>) -> Result<Response<PlanResponse>, Status> {
        let req = request.into_inner();
        let enabled: Vec<String> = req
            .sources
            .into_iter()
            .filter_map(|(k, v)| if v { Some(k) } else { None })
            .collect();
        let mut steps = Vec::new();
        if !req.goal.is_empty() {
            steps.push(pb::assistant::v1::PlanStep { step: "Understand goal".into(), action: format!("Parse: {}", truncate(&req.goal, 120)) });
        }
        if enabled.iter().any(|s| s == "email") {
            steps.push(pb::assistant::v1::PlanStep { step: "Email".into(), action: "Summarize inbox and draft replies".into() });
        }
        if enabled.iter().any(|s| s == "calendar") {
            steps.push(pb::assistant::v1::PlanStep { step: "Calendar".into(), action: "Check availability and propose slots".into() });
        }
        if enabled.iter().any(|s| s == "messages") {
            steps.push(pb::assistant::v1::PlanStep { step: "Messages".into(), action: "Extract intents from latest threads".into() });
        }
        if enabled.iter().any(|s| s == "browser") {
            steps.push(pb::assistant::v1::PlanStep { step: "Browser".into(), action: "Fetch relevant pages from history".into() });
        }
        if steps.is_empty() {
            steps.push(pb::assistant::v1::PlanStep { step: "Idle".into(), action: "Await user goal".into() });
        }

        let plan = pb::assistant::v1::Plan {
            mode: "on-device".into(),
            outputs: vec!["drafts".into(), "events".into(), "reminders".into()],
            sources: enabled,
            steps,
        };
        Ok(Response::new(PlanResponse { plan: Some(plan) }))
    }
}

fn split_preserve_whitespace(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    for c in s.chars() {
        if c.is_whitespace() {
            if !buf.is_empty() {
                out.push(std::mem::take(&mut buf));
            }
            out.push(c.to_string());
        } else {
            buf.push(c);
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}…", &s[..max]) }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let addr: SocketAddr = std::env::var("ASSISTANT_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:50051".into())
        .parse()?;

    let svc = AssistantSvc::default();
    info!("assistant", %addr, "Starting Assistant gRPC server");

    Server::builder()
        .add_service(AssistantServer::new(svc))
        .serve(addr)
        .await
        .map_err(|e| {
            error!(error = %e, "server error");
            e
        })?;

    Ok(())
}
