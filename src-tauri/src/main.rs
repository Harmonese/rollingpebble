use std::{
    env,
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct BackendState(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let port = pick_port()?;
            let mut child = start_backend(port)?;
            wait_for_backend(port).map_err(|err| {
                let _ = child.kill();
                err
            })?;

            app.manage(BackendState(Mutex::new(Some(child))));

            let url = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Rolling Pebble")
                .inner_size(1280.0, 820.0)
                .min_inner_size(980.0, 640.0)
                .build()?;

            Ok(())
        })
        .on_window_event(|window, event| {
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

fn start_backend(port: u16) -> Result<Child, Box<dyn std::error::Error>> {
    let repo_root = repo_root_guess();
    let frontend_dist = repo_root.join("frontend").join("dist");

    let mut command = backend_command();
    command
        .arg("serve")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--skip-port-check")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if frontend_dist.join("index.html").exists() {
        command.env("LRC_ROLLER_FRONTEND_DIST", frontend_dist);
    }

    Ok(command.spawn()?)
}

fn backend_command() -> Command {
    if let Ok(path) = env::var("ROLLINGPEBBLE_BACKEND") {
        if !path.trim().is_empty() {
            return Command::new(path);
        }
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
    let _ = child.kill();
    let _ = child.wait();
}
