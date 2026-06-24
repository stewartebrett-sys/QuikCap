use tauri::{Emitter, Manager};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            println!("[QuikCap] Window 'main' created at startup (id: {})", window.label());

            #[cfg(target_os = "macos")]
            {
                if let Ok(ns_window_ptr) = window.ns_window() {
                    unsafe {
                        let ns_window = &*ns_window_ptr.cast::<objc2_app_kit::NSWindow>();
                        ns_window.setAnimationBehavior(
                            objc2_app_kit::NSWindowAnimationBehavior::None,
                        );
                    }
                    println!("[QuikCap] NSWindow animation behavior set to None");
                }
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

                match app.global_shortcut().on_shortcut(
                    "Ctrl+Shift+Space",
                    |app_handle, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                let is_focused = window.is_focused().unwrap_or(false);

                                if is_visible && is_focused {
                                    let _ = window.hide();
                                    println!("[QuikCap] Shortcut fired — window hidden (was focused)");
                                } else {
                                    if window.is_minimized().unwrap_or(false) {
                                        let _ = window.unminimize();
                                    }
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let _ = window.emit("focus-editor", ());
                                    println!("[QuikCap] Shortcut fired — window shown and focused (reusing existing window)");
                                }
                            }
                        }
                    },
                ) {
                    Ok(_) => println!(
                        "[QuikCap] Global shortcut Ctrl+Shift+Space registered successfully"
                    ),
                    Err(e) => eprintln!("[QuikCap] Failed to register shortcut: {e}"),
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
