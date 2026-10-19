fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["workspace_ready", "workspace_exit_reply"]),
    ))
    .expect("desktop build failed");
}
