#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod external_links;

use std::{
    env,
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct BackendState(Mutex<Option<Child>>);
#[derive(Default)]
struct ExitState {
    ready: AtomicBool,
    pending: AtomicBool,
    approved: AtomicBool,
}

#[derive(Debug, PartialEq)]
enum ExitDecision {
    Allow,
    Notify,
    Wait,
}
impl ExitState {
    fn request(&self) -> ExitDecision {
        if self.approved.load(Ordering::SeqCst) || !self.ready.load(Ordering::SeqCst) {
            ExitDecision::Allow
        } else if self.pending.swap(true, Ordering::SeqCst) {
            ExitDecision::Wait
        } else {
            ExitDecision::Notify
        }
    }
    fn reply(&self, approved: bool) -> bool {
        if !self.pending.swap(false, Ordering::SeqCst) {
            return false;
        }
        self.approved.store(approved, Ordering::SeqCst);
        approved
    }
}

#[tauri::command]
fn workspace_ready(window: tauri::WebviewWindow, state: tauri::State<ExitState>) {
    if window.label() == "main" {
        state.ready.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
fn workspace_exit_reply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<ExitState>,
    approved: bool,
) {
    if window.label() == "main" && state.reply(approved) {
        app.exit(0);
    }
}

fn request_exit(app: &tauri::AppHandle) -> bool {
    let state = app.state::<ExitState>();
    let decision = state.request();
    if decision == ExitDecision::Allow {
        return false;
    }
    if decision == ExitDecision::Notify {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval("window.dispatchEvent(new Event('rollingpebble:exit-requested'))");
        }
    }
    true
}

#[cfg(test)]
mod exit_tests {
    use super::*;
    #[test]
    fn close_and_quit_wait_for_one_decision() {
        let state = ExitState::default();
        assert_eq!(state.request(), ExitDecision::Allow);
        assert!(!state.reply(true));
        state.ready.store(true, Ordering::SeqCst);
        assert_eq!(state.request(), ExitDecision::Notify);
        assert_eq!(state.request(), ExitDecision::Wait);
        assert!(!state.reply(false));
        assert_eq!(state.request(), ExitDecision::Notify);
        assert!(state.reply(true));
        assert_eq!(state.request(), ExitDecision::Allow);
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ExitState::default())
        .invoke_handler(tauri::generate_handler![workspace_ready, workspace_exit_reply])
        .setup(|app| {
            let port = pick_port()?;
            let mut child = start_backend(port, app.handle())?;
            wait_for_backend(port).map_err(|err| {
                let _ = child.kill();
                err
            })?;

            app.manage(BackendState(Mutex::new(Some(child))));

            let url = format!("http://127.0.0.1:{port}");
            app.add_capability(format!(r#"{{"identifier":"workspace-exit","windows":["main"],"remote":{{"urls":["{url}"]}},"permissions":["allow-workspace-ready","allow-workspace-exit-reply"]}}"#))?;
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .on_navigation(move |url| match external_links::route(url, port) {
                    external_links::Route::Internal => true,
                    external_links::Route::Browser => {
                        external_links::open_browser(&navigation_app, url);
                        false
                    }
                    external_links::Route::Block => false,
                })
                .on_new_window(move |url, _| match external_links::route(&url, port) {
                    external_links::Route::Browser => {
                        external_links::open_browser(&popup_app, &url);
                        tauri::webview::NewWindowResponse::Deny
                    }
                    external_links::Route::Internal => tauri::webview::NewWindowResponse::Allow,
                    external_links::Route::Block => tauri::webview::NewWindowResponse::Deny,
                })
                .title("Rolling Pebble")
                .inner_size(1280.0, 820.0)
                .min_inner_size(980.0, 640.0)
                .build()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if request_exit(window.app_handle()) {
                    api.prevent_close();
                    return;
                }
            }
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                if let Some(state) = window.app_handle().try_state::<BackendState>() {
                    stop_backend(&state);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Rolling Pebble desktop app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                if request_exit(app_handle) {
                    api.prevent_exit();
                    return;
                }
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    stop_backend(&state);
                }
            }
        });
}

fn pick_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let addr = listener.local_addr()?;
    Ok(addr.port())
}

fn start_backend(port: u16, app: &tauri::AppHandle) -> Result<Child, Box<dyn std::error::Error>> {
    let repo_root = repo_root_guess();
    let frontend_dist = repo_root.join("frontend").join("dist");

    let resources = app_resources_dir(app);
    if !cfg!(debug_assertions) && resources.is_none() {
        return Err("Bundled desktop resources are missing; reinstall Rolling Pebble".into());
    }
    let mut command = backend_command(resources.as_deref());
    command
        .arg("serve")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--skip-port-check")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if cfg!(debug_assertions) && frontend_dist.join("index.html").exists() {
        command.env("LRC_ROLLER_FRONTEND_DIST", frontend_dist);
    }
    if let Some(resources) = resources {
        command.env("ROLLINGPEBBLE_APP_RESOURCES", resources);
    }

    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    Ok(command.spawn()?)
}

fn app_resources_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?;
    if root.join("python-runtime").is_dir() && root.join("engine/manifest.json").is_file() {
        Some(root)
    } else {
        None
    }
}

fn backend_command(resources: Option<&Path>) -> Command {
    if let Ok(path) = env::var("ROLLINGPEBBLE_BACKEND") {
        if !path.trim().is_empty() {
            return Command::new(path);
        }
    }

    if let Some(root) = resources {
        let name = if cfg!(windows) {
            "rollingpebble-backend.exe"
        } else {
            "rollingpebble-backend"
        };
        return Command::new(root.join("bin").join(name));
    }
    if let Some(sidecar) = sidecar_candidate() {
        return Command::new(sidecar);
    }

    let mut command = Command::new(python_executable());
    command.arg("-m").arg("rollingpebble.cli");
    command
}

fn sidecar_candidate() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let names = if cfg!(windows) {
        ["rollingpebble-backend.exe", "rollingpebble-backend"]
    } else {
        ["rollingpebble-backend", "rollingpebble-backend.exe"]
    };
    for dir in candidate_sidecar_dirs(exe_dir) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn candidate_sidecar_dirs(exe_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![exe_dir.to_path_buf(), exe_dir.join("bin")];
    if cfg!(target_os = "macos") {
        if let Some(contents) = exe_dir.parent() {
            dirs.push(contents.join("Resources"));
            dirs.push(contents.join("Resources").join("bin"));
        }
    }
    dirs
}

fn python_executable() -> String {
    env::var("PYTHON")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                "python".to_string()
            } else {
                "python3".to_string()
            }
        })
}

fn repo_root_guess() -> PathBuf {
    let current = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for candidate in current.ancestors() {
        if candidate.join("pyproject.toml").exists()
            && candidate.join("frontend").join("package.json").exists()
        {
            return candidate.to_path_buf();
        }
    }
    current
}

fn wait_for_backend(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(90) {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(format!("Rolling Pebble backend did not start on {addr}").into())
}

fn stop_backend(state: &BackendState) {
    let Ok(mut backend) = state.0.lock() else {
        return;
    };
    let Some(mut child) = backend.take() else {
        return;
    };

    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }

    // Let the backend stop its independently grouped preparation/inference workers.
    #[cfg(unix)]
    {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(windows)]
    {
        // PyInstaller onefile has a parent bootloader and a backend child.
        // Reap the whole application-owned tree, including runtime workers.
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}
