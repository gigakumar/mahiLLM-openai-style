fn main() -> Result<(), Box<dyn std::error::Error>> {
  let protoc_path = protoc_bin_vendored::protoc_bin_path()?;
  std::env::set_var("PROTOC", protoc_path);
  tonic_build::configure()
    .build_client(true)
    .build_server(false)
    .compile(&["../proto/assistant.proto"], &["../proto"])?;
  println!("cargo:rerun-if-changed=../proto/assistant.proto");
  Ok(())
}
