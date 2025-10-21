fn main() -> Result<(), Box<dyn std::error::Error>> {
  // Use vendored protoc to avoid requiring a system installation
  let protoc_path = protoc_bin_vendored::protoc_bin_path()?;
  std::env::set_var("PROTOC", protoc_path);
  let out_dir = std::env::var("OUT_DIR")?;
  let descriptor_path = std::path::Path::new(&out_dir).join("assistant_descriptor.bin");
  tonic_build::configure()
    .file_descriptor_set_path(&descriptor_path)
    .build_server(true)
    .compile(&["../proto/assistant.proto"], &["../proto"])?;
  println!("cargo:rerun-if-changed=../proto/assistant.proto");
  Ok(())
}
