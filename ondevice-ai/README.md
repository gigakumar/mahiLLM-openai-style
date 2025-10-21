# OnDevice AI — Core gRPC Runtime (Milestone 1)

This milestone establishes a minimal gRPC runtime and protocol surface for the Assistant service.

## Layout

```
ondevice-ai/
  proto/
    assistant.proto
  core/
    Cargo.toml
    build.rs
    src/
      main.rs
  connectors/
  models/
  cli/
```

## Build and run

Prereqs: Rust toolchain (cargo), protoc.

```bash
cd ondevice-ai/core
cargo build
cargo run
```

Server binds on 127.0.0.1:50051 by default.

## Proto contract

See `ondevice-ai/proto/assistant.proto`:

```proto
syntax = "proto3";
package assistant;

message Request {
  string id = 1;
  string user_id = 2;
  string type = 3;
  string payload = 4;
}
message Response {
  string id = 1;
  int32 status = 2;
  string payload = 3;
}
service Assistant {
  rpc Send(Request) returns (Response);
  rpc StreamResponses(stream Request) returns (stream Response);
}
```

## Smoke test (grpcurl)

Requires `grpcurl` installed.

```bash
grpcurl -plaintext \
  -d '{"id":"1","user_id":"u1","type":"query","payload":"hello"}' \
  127.0.0.1:50051 assistant.Assistant/Send
```

Expected: JSON response with `payload` containing the echo.

With server reflection enabled, you can omit `-import-path`/`-proto` and list services:

```bash
grpcurl -plaintext 127.0.0.1:50051 list
grpcurl -plaintext 127.0.0.1:50051 list assistant.Assistant
```

### Milestone 2: Index/Query

Index a document:

```bash
grpcurl -plaintext \
  -d '{"id":"doc1","text":"Rust is a systems programming language"}' \
  127.0.0.1:50051 assistant.Indexer/Index
```

Query top matches (default k=5):

```bash
grpcurl -plaintext \
  -d '{"query":"systems programming"}' \
  127.0.0.1:50051 assistant.Indexer/Query
```

Response returns hits with id/text/score.

### Embeddings

```bash
grpcurl -plaintext \
  -d '{"text":"test sentence"}' \
  127.0.0.1:50051 assistant.Embeddings/Embed
```

## CLI

Build the CLI:

```bash
cd ondevice-ai/cli
cargo build
```

Send a single request:

```bash
cargo run -- send --id 1 --user-id u1 --kind query --payload "hello"
```

Streaming demo (prints chunks):

```bash
cargo run -- stream
```

Index and query via CLI:

```bash
cargo run -- index doc1 "Rust is a systems programming language"
cargo run -- query "systems programming" -k 3
```

Embeddings via CLI:

```bash
cargo run -- embed "test sentence"
```

Override server address:

```bash
ASSISTANT_ADDR=http://127.0.0.1:50052 cargo run -- stream
```

JSON output and file/stdin:

```bash
# JSON for send
cargo run -- send --id 1 --user-id u1 --kind query --payload "hello" --json

# Index from a file
cargo run -- index doc2 --file ./README.md

# Index from stdin
cat ./README.md | cargo run -- index doc3 --json

# Stream by piping stdin lines
printf "hello\nworld\n" | cargo run -- stream --json --stdin
```

## Acceptance criteria

- `cargo run` starts a server without errors.
- `grpcurl` to `Assistant/Send` returns a payload echo.
- Generated Rust stubs are produced by `tonic-build` during `cargo build`.

## Next steps

- Add a simple indexing endpoint (`/embed` HTTP or `POST /index` gRPC).
- Implement a local vector store (SQLite + brute-force kNN) and a CLI to index text.
- Wire a model adapter (local llama.cpp server) for `/embed` and `/predict`.
