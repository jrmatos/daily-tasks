// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK flickers / shows artifacts on many Linux GPU setups (notably
    // NVIDIA + hybrid graphics). Disable the DMABUF renderer and GPU compositing
    // unless the user explicitly set these themselves.
    #[cfg(target_os = "linux")]
    for key in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE"] {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, "1");
        }
    }

    daily_tasks_lib::run()
}
