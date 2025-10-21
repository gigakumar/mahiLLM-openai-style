use assistant::pb::assistant::v1::assistant_client::AssistantClient;
use assistant::pb::assistant::v1::{ChatRequest, Message, PlanRequest};
use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = std::env::var("ASSISTANT_ADDR").unwrap_or_else(|_| "http://127.0.0.1:50051".into());
    let mut client = AssistantClient::connect(addr.clone()).await?;
    println!("Connected to {}", addr);

    // Plan
    let mut sources = std::collections::HashMap::new();
    sources.insert("email".to_string(), true);
    sources.insert("calendar".to_string(), true);
    let plan_res = client
        .plan(PlanRequest { goal: "Plan a weekly team sync".into(), sources })
        .await?
        .into_inner();
    println!("Plan: {:?}", plan_res.plan);

    // Chat (server streaming)
    let req = ChatRequest {
        messages: vec![Message { role: "user".into(), content: "Hello from client example".into() }],
    };
    let mut stream = client.chat(req).await?.into_inner();
    println!("Chat stream:");
    while let Some(item) = stream.next().await {
        let msg = item?;
        if let Some(evt) = msg.event {
            if let assistant::pb::assistant::v1::chat_response::Event::Delta(delta) = evt {
                if delta.done { break; }
                print!("{}", delta.token);
            }
        }
    }
    println!();
    Ok(())
}
