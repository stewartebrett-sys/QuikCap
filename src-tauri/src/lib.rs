use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Note {
    id: String,
    text: String,
    created_at: u64,
    #[serde(default)]
    updated_at: u64,
}

fn data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .expect("could not resolve app data dir")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
fn load_draft(app: tauri::AppHandle) -> String {
    let text = fs::read_to_string(data_dir(&app).join("draft.txt")).unwrap_or_default();
    println!("[QuikCap] Draft loaded ({} chars)", text.len());
    text
}

#[tauri::command]
fn save_draft(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let dir = data_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("draft.txt"), &text).map_err(|e| e.to_string())?;
    println!("[QuikCap] Draft saved ({} chars)", text.len());
    Ok(())
}

#[tauri::command]
fn finish_note(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }

    let dir = data_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let millis = now_millis();
    let note = Note {
        id: millis.to_string(),
        text,
        created_at: millis,
        updated_at: millis,
    };

    let notes_path = dir.join("notes.json");
    let mut notes: Vec<Note> = if notes_path.exists() {
        let raw = fs::read_to_string(&notes_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Vec::new()
    };

    notes.push(note.clone());

    let json = serde_json::to_string(&notes).map_err(|e| e.to_string())?;
    fs::write(&notes_path, json).map_err(|e| e.to_string())?;

    fs::write(dir.join("draft.txt"), "").map_err(|e| e.to_string())?;

    println!("[QuikCap] Note finished (id: {}, total: {})", note.id, notes.len());
    Ok(())
}

#[tauri::command]
fn list_notes(app: tauri::AppHandle) -> Vec<Note> {
    let notes_path = data_dir(&app).join("notes.json");
    if !notes_path.exists() {
        return Vec::new();
    }
    let raw = fs::read_to_string(&notes_path).unwrap_or_default();
    let mut notes: Vec<Note> = serde_json::from_str(&raw).unwrap_or_default();
    for note in &mut notes {
        if note.updated_at == 0 {
            note.updated_at = note.created_at;
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes
}

#[tauri::command]
fn hide_capture(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
        println!("[QuikCap] Capture window hidden via command");
    }
}

#[tauri::command]
fn update_note(app: tauri::AppHandle, id: String, text: String) -> Result<(), String> {
    let notes_path = data_dir(&app).join("notes.json");
    let raw = fs::read_to_string(&notes_path).map_err(|e| e.to_string())?;
    let mut notes: Vec<Note> = serde_json::from_str(&raw).unwrap_or_default();
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.text = text;
        note.updated_at = now_millis();
    }
    let json = serde_json::to_string(&notes).map_err(|e| e.to_string())?;
    fs::write(&notes_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let capture = app
                .get_webview_window("capture")
                .expect("capture window must exist");
            let database = app
                .get_webview_window("database")
                .expect("database window must exist");

            println!("[QuikCap] Windows created");

            #[cfg(target_os = "macos")]
            {
                if let Ok(ns_window_ptr) = capture.ns_window() {
                    unsafe {
                        let ns_window = &*ns_window_ptr.cast::<objc2_app_kit::NSWindow>();
                        ns_window.setAnimationBehavior(
                            objc2_app_kit::NSWindowAnimationBehavior::None,
                        );
                    }
                    println!("[QuikCap] NSWindow animation behavior set to None");
                }
            }

            // X button hides both windows instead of quitting
            for window in [capture.clone(), database] {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                        println!("[QuikCap] Close requested — hiding window instead of quitting");
                    }
                });
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

                match app.global_shortcut().on_shortcut(
                    "Ctrl+Shift+Space",
                    |app_handle, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(window) = app_handle.get_webview_window("capture") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                let is_focused = window.is_focused().unwrap_or(false);

                                if is_visible && is_focused {
                                    let _ = window.hide();
                                    println!("[QuikCap] Shortcut fired — capture hidden");
                                } else {
                                    if window.is_minimized().unwrap_or(false) {
                                        let _ = window.unminimize();
                                    }
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let _ = window.emit("focus-editor", ());
                                    println!("[QuikCap] Shortcut fired — capture shown");
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
        .invoke_handler(tauri::generate_handler![
            load_draft,
            save_draft,
            finish_note,
            list_notes,
            update_note,
            hide_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
