use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

static LAST_OPEN: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn claim(last: &mut Option<(String, Instant)>, url: &str, now: Instant) -> bool {
    if last.as_ref().is_some_and(|(previous, at)| {
        previous == url && now.duration_since(*at) < Duration::from_millis(500)
    }) {
        return false;
    }
    *last = Some((url.to_string(), now));
    true
}
use url::Url;

#[derive(Debug, PartialEq)]
pub enum Route {
    Internal,
    Browser,
    Block,
}

pub fn route(url: &Url, port: u16) -> Route {
    match url.scheme() {
        "http" | "https" => {
            if url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port_or_known_default() == Some(port)
            {
                Route::Internal
            } else {
                Route::Browser
            }
        }
        "blob" => Route::Internal,
        _ => Route::Block,
    }
}

pub fn open_browser(app: &AppHandle, url: &Url) {
    if !claim(&mut LAST_OPEN.lock().unwrap(), url.as_str(), Instant::now()) {
        return;
    }
    let app = app.clone();
    let url = url.to_string();
    std::thread::spawn(move || {
        if let Err(error) = open::that(&url) {
            eprintln!("External link failed: {error}");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window
                    .eval("window.dispatchEvent(new Event('rollingpebble:external-link-failed'))");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_callbacks_open_once() {
        let now = Instant::now();
        let mut last = None;
        assert!(claim(&mut last, "https://example.com", now));
        assert!(!claim(
            &mut last,
            "https://example.com",
            now + Duration::from_millis(10)
        ));
        assert!(claim(
            &mut last,
            "https://example.com",
            now + Duration::from_secs(1)
        ));
    }

    #[test]
    fn routes_only_web_links_to_browser() {
        for (url, expected) in [
            ("https://music.163.com/#/song?id=1", Route::Browser),
            ("http://example.com", Route::Browser),
            ("http://127.0.0.1:6789/path", Route::Internal),
            ("http://127.0.0.1:6790/path", Route::Browser),
            ("https://127.0.0.1:6789", Route::Browser),
            ("blob:http://127.0.0.1:6789/id", Route::Internal),
            ("file:///tmp/example", Route::Block),
            ("javascript:alert(1)", Route::Block),
        ] {
            assert_eq!(route(&Url::parse(url).unwrap(), 6789), expected);
        }
    }
}
