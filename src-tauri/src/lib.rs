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
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

                match app.global_shortcut().on_shortcut(
                    "Ctrl+Shift+Space",
                    |app_handle, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.emit("focus-editor", ());
                                println!("[QuikCap] Shortcut fired — window activated");
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
