fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_files = &["proto/assistant.proto"];
    let include_dirs = &["proto"];
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir("src/pb")
        .compile(proto_files, include_dirs)?;
    println!("cargo:rerun-if-changed=proto/assistant.proto");
    Ok(())
}
