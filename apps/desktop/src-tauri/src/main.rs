// CHROMASHIFT desktop: the live game in its own window, tuned for play. It is a thin Tauri shell
// (the system's WebView2, not a bundled browser), so it is a few MB, starts fast and uses far less
// memory than a full browser engine. The game itself loads from the published site.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Marks the page as the desktop app (the game turns on its automatic resolution scaling) and adds F11 fullscreen.
const INIT: &str = r#"
window.__CHROMASHIFT_DESKTOP__ = true;
addEventListener('keydown', function (e) {
  if (e.key !== 'F11') return;
  e.preventDefault();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(function () {});
}, true);
"#;

/// Chromium switches for WebView2: let the GPU do the drawing even on drivers Chromium distrusts,
/// and keep full speed when the window is covered (voice chat and online play keep running).
const GPU_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --disable-renderer-backgrounding \
--disable-background-timer-throttling --disable-backgrounding-occluded-windows";

fn main() {
    bridge::start();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let mut win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("CHROMASHIFT")
                .inner_size(1440.0, 900.0)
                .min_inner_size(360.0, 360.0)
                .initialization_script(INIT);
            #[cfg(target_os = "windows")]
            {
                win = win.additional_browser_args(GPU_ARGS);
            }
            win.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CHROMASHIFT could not start");
}
