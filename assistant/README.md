# MahiLLM On-Device Assistant (Alpha)

This folder contains the product code for the privacy-first on-device assistant.

## Structure

- `core/` — Rust gRPC runtime (tonic), echo skeleton
- `proto/` — gRPC protobufs

## Build

```bash
cd assistant/core
cargo build --release
ASSISTANT_ADDR=127.0.0.1:50051 ./target/release/core
```

