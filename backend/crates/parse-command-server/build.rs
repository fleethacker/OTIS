use std::{path::PathBuf, process::Command};
fn main() {
    let files = [
        "app.proto",
        "models.proto",
        "source_data.proto",
        "drafts.proto",
    ];
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let descriptor = out.join("application.fds");
    let proto = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest"))
        .join("../../../apps/watch-desk/proto");
    let mut command = Command::new(protoc_bin_vendored::protoc_bin_path().expect("bundled protoc"));
    command
        .arg(format!("-I{}", proto.display()))
        .arg(format!(
            "-I{}",
            protoc_bin_vendored::include_path()
                .expect("includes")
                .display()
        ))
        .arg("--include_imports")
        .arg("--include_source_info")
        .arg(format!("--descriptor_set_out={}", descriptor.display()));
    for file in files {
        let path = proto.join(format!("app/v1/{file}"));
        println!("cargo:rerun-if-changed={}", path.display());
        command.arg(path);
    }
    assert!(
        command.status().expect("run bundled protoc").success(),
        "compile protocol descriptors"
    );
    connectrpc_build::Config::new()
        .files(&[
            "app/v1/app.proto",
            "app/v1/models.proto",
            "app/v1/source_data.proto",
            "app/v1/drafts.proto",
        ])
        .descriptor_set(descriptor)
        .include_file("_connectrpc.rs")
        .compile()
        .expect("generate RPC bindings");
}
