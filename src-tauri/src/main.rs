#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod documents;
use documents::{Documents, OpenBatch};
use std::{fs, path::PathBuf, sync::Mutex, time::Instant};
struct AppState {
    documents: Mutex<Documents>,
    started: Instant,
}

#[tauri::command]
async fn open_documents(
    paths: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<OpenBatch, String> {
    let paths = if let Some(paths) = paths {
        paths.into_iter().map(PathBuf::from).collect()
    } else {
        let Some(files) = rfd::AsyncFileDialog::new()
            .add_filter("Markdown", &["md", "markdown", "txt"])
            .pick_files()
            .await
        else {
            return Ok(OpenBatch::default());
        };
        files.into_iter().map(|f| f.path().to_path_buf()).collect()
    };
    Ok(state
        .documents
        .lock()
        .map_err(|e| e.to_string())?
        .open_many(paths))
}
#[tauri::command]
async fn save_document(
    id: String,
    content: String,
    save_as: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let existing = state.documents.lock().map_err(|e| e.to_string())?.path(&id);
    let path = if save_as || existing.is_none() {
        let name = existing
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("未命名.md");
        let Some(file) = rfd::AsyncFileDialog::new()
            .add_filter("Markdown", &["md"])
            .set_file_name(name)
            .save_file()
            .await
        else {
            return Ok(None);
        };
        file.path().to_path_buf()
    } else {
        existing.unwrap()
    };
    state
        .documents
        .lock()
        .map_err(|e| e.to_string())?
        .save(&id, &path, &content)
        .map(Some)
}
#[tauri::command]
fn close_document(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .documents
        .lock()
        .map_err(|e| e.to_string())?
        .close(&id);
    Ok(())
}
#[tauri::command]
fn editor_ready(state: tauri::State<'_, AppState>) -> u128 {
    let elapsed = state.started.elapsed().as_millis();
    if let Some(path) = std::env::var_os("QINGMO_STARTUP_LOG") {
        let _ = fs::write(path, elapsed.to_string());
    }
    elapsed
}
fn main() {
    tauri::Builder::default()
        .manage(AppState {
            documents: Mutex::new(Documents::default()),
            started: Instant::now(),
        })
        .invoke_handler(tauri::generate_handler![
            open_documents,
            save_document,
            close_document,
            editor_ready
        ])
        .run(tauri::generate_context!())
        .expect("无法启动轻墨");
}
