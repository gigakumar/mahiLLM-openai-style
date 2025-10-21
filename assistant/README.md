# MahiLLM Assistant Core

A minimal gRPC service (tonic) for the MahiLLM Assistant product.

## Endpoints

- Assistant.Chat (server-streaming)
  - Input: ChatRequest { messages: [{role, content}] }
  - Output stream: ChatResponse { delta: { token, done } }
- Assistant.Plan (unary)
  - Input: PlanRequest { goal, sources: map<string,bool> }
  - Output: PlanResponse { plan: { mode, outputs[], sources[], steps[] } }

## Local development

Prereqs: Rust (stable), Cargo.

Build and run the server on localhost:50051:

```bash
cargo run
```

Override bind address/port:

```bash
ASSISTANT_ADDR=127.0.0.1:50052 cargo run
```

Generated code from `proto/assistant.proto` is written to `src/pb/` at build time via `build.rs`.

### Smoke test with example client

In a separate terminal, run the example client:

```bash
cargo run --example client
```

It will call Plan once and stream a Chat response.

## Next steps

- Add a small Rust/Node client to smoke test endpoints.
- Optional: Wire Node `server.js` to call Plan via gRPC with a fallback to the current mock.
- Implement real planning/LLM logic behind the service.