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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    follow_up_date: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default = "finished_status")]
    status: String,
}

fn finished_status() -> String {
    "finished".to_string()
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

fn load_notes(app: &tauri::AppHandle) -> Vec<Note> {
    let notes_path = data_dir(app).join("notes.json");
    if !notes_path.exists() {
        return Vec::new();
    }
    let raw = fs::read_to_string(&notes_path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_notes(app: &tauri::AppHandle, notes: &[Note]) -> Result<(), String> {
    let dir = data_dir(app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(notes).map_err(|e| e.to_string())?;
    // Atomic write: write to temp file then rename so a crash mid-write
    // never produces a corrupt notes.json.
    let tmp = dir.join("notes.json.tmp");
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("notes.json")).map_err(|e| e.to_string())?;
    Ok(())
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
fn finish_note(app: tauri::AppHandle, text: String, follow_up_date: Option<String>, pinned: bool) -> Result<(), String> {
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
        follow_up_date,
        pinned,
        status: "finished".to_string(),
    };

    let mut notes = load_notes(&app);
    notes.push(note.clone());
    save_notes(&app, &notes)?;

    fs::write(dir.join("draft.txt"), "").map_err(|e| e.to_string())?;

    println!("[QuikCap] Note finished (id: {}, total: {})", note.id, notes.len());
    Ok(())
}

#[tauri::command]
fn list_notes(app: tauri::AppHandle) -> Vec<Note> {
    let mut notes = load_notes(&app);
    for note in &mut notes {
        if note.updated_at == 0 {
            note.updated_at = note.created_at;
        }
    }
    // Exclude archived (soft-deleted) notes
    notes.retain(|n| n.status != "archived");
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes
}

#[tauri::command]
fn create_note(app: tauri::AppHandle) -> Result<Note, String> {
    let millis = now_millis();
    let note = Note {
        id: millis.to_string(),
        text: String::new(),
        created_at: millis,
        updated_at: millis,
        follow_up_date: None,
        pinned: false,
        status: "active".to_string(),
    };

    let mut notes = load_notes(&app);
    notes.push(note.clone());
    save_notes(&app, &notes)?;

    println!("[QuikCap] Note created (id: {})", note.id);
    Ok(note)
}

#[tauri::command]
fn archive_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut notes = load_notes(&app);
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.status = "archived".to_string();
        println!("[QuikCap] Note archived (id: {})", id);
    }
    save_notes(&app, &notes)
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
    let mut notes = load_notes(&app);
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.text = text;
        note.updated_at = now_millis();
    }
    save_notes(&app, &notes)
}

#[tauri::command]
fn pin_note(app: tauri::AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let mut notes = load_notes(&app);
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.pinned = pinned;
    }
    save_notes(&app, &notes)
}

#[tauri::command]
fn set_follow_up(app: tauri::AppHandle, id: String, date: Option<String>) -> Result<(), String> {
    let mut notes = load_notes(&app);
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.follow_up_date = date;
    }
    save_notes(&app, &notes)
}

#[tauri::command]
fn duplicate_note(app: tauri::AppHandle, id: String) -> Result<Note, String> {
    let notes = load_notes(&app);
    let original = notes.iter().find(|n| n.id == id)
        .ok_or_else(|| format!("Note {} not found", id))?
        .clone();

    let millis = now_millis();
    let dup = Note {
        id: millis.to_string(),
        text: original.text,
        created_at: millis,
        updated_at: millis,
        follow_up_date: original.follow_up_date,
        pinned: false,
        status: "active".to_string(),
    };

    let mut notes = load_notes(&app);
    notes.push(dup.clone());
    save_notes(&app, &notes)?;
    println!("[QuikCap] Note duplicated (original: {}, new: {})", id, dup.id);
    Ok(dup)
}

#[tauri::command]
fn delete_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut notes = load_notes(&app);
    notes.retain(|n| n.id != id);
    save_notes(&app, &notes)?;
    println!("[QuikCap] Note permanently deleted (id: {})", id);
    Ok(())
}

#[tauri::command]
fn restore_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut notes = load_notes(&app);
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.status = "active".to_string();
        note.updated_at = now_millis();
        println!("[QuikCap] Note restored (id: {})", id);
    }
    save_notes(&app, &notes)
}

#[tauri::command]
fn list_archived_notes(app: tauri::AppHandle) -> Vec<Note> {
    let mut notes = load_notes(&app);
    notes.retain(|n| n.status == "archived");
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes
}

#[tauri::command]
fn save_session(app: tauri::AppHandle, note_id: Option<String>) -> Result<(), String> {
    let dir = data_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = note_id.unwrap_or_default();
    fs::write(dir.join("session.txt"), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Option<String> {
    let content = fs::read_to_string(data_dir(&app).join("session.txt")).ok()?;
    if content.is_empty() { None } else { Some(content) }
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
            create_note,
            archive_note,
            update_note,
            hide_capture,
            pin_note,
            set_follow_up,
            duplicate_note,
            delete_note,
            restore_note,
            list_archived_notes,
            save_session,
            load_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                if !has_visible_windows {
                    if let Some(db) = app_handle.get_webview_window("database") {
                        let _ = db.show();
                        let _ = db.set_focus();
                        println!("[QuikCap] App reopened — showing database window");
                    }
                }
            }
            _ => {}
        });
}
