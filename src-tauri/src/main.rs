#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod documents;
use documents::{Documents, OpenBatch};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
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
async fn export_word(
    window: tauri::Window,
    content: String,
    title: String,
    source_path: Option<String>,
    destination: Option<String>,
) -> Result<Option<String>, String> {
    if content.trim().is_empty() {
        return Err("当前标签没有可导出的内容。".into());
    }
    let output = if let Some(destination) = destination.as_ref() {
        PathBuf::from(destination)
    } else {
        let stem = Path::new(&title)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名文档");
        let suggested = format!("{stem}.docx");
        let Some(file) = rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .add_filter("Word 文档", &["docx"])
            .set_file_name(&suggested)
            .save_file()
            .await
        else {
            return Ok(None);
        };
        file.path().to_path_buf()
    };
    let overwrite = if output.exists() && destination.is_none() {
        matches!(
            rfd::AsyncMessageDialog::new()
                .set_parent(&window)
                .set_title("覆盖已有 Word 文档？")
                .set_description(format!("文件已存在：{}\n确定替换它吗？", output.display()))
                .set_level(rfd::MessageLevel::Warning)
                .set_buttons(rfd::MessageButtons::YesNo)
                .show()
                .await,
            rfd::MessageDialogResult::Yes
        )
    } else {
        false
    };
    if output.exists() && !overwrite {
        return Err("文件已存在，已取消导出。".into());
    }
    let base = source_path
        .as_deref()
        .and_then(|path| Path::new(path).parent())
        .unwrap_or_else(|| output.parent().unwrap_or(Path::new(".")));
    let report = md_to_word::convert::convert_text_with_base(&content, base, &output, overwrite)?;
    Ok(Some(format!(
        "已导出 {}\n{}",
        output.display(),
        report.summary()
    )))
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
            export_word,
            editor_ready
        ])
        .run(tauri::generate_context!())
        .expect("无法启动轻墨");
}

#[cfg(test)]
mod tests {
    use std::{fs::File, io::Read};
    #[test]
    fn exports_editable_word_with_chinese_table_and_formula() {
        let folder = tempfile::tempdir().unwrap();
        let output = folder.path().join("课堂计划.docx");
        let source = "# 七年级计划\n\n| 学科 | 目标 |\n| --- | --- |\n| 数学 | 掌握概念 |\n\n$x^2$";
        let report =
            md_to_word::convert::convert_text_with_base(source, folder.path(), &output, false)
                .unwrap();
        assert_eq!(report.tables, 1);
        assert_eq!(report.equations, 1);
        let mut archive = zip::ZipArchive::new(File::open(output).unwrap()).unwrap();
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("七年级计划"));
        assert!(xml.contains("<w:tbl>"));
        assert!(xml.contains("<m:oMath>"));
    }
    #[test]
    fn exports_normalized_chinese_label_as_bold() {
        let folder = tempfile::tempdir().unwrap();
        let output = folder.path().join("标签.docx");
        md_to_word::convert::convert_text_with_base(
            "**【双通道】**&#8203;本话题",
            folder.path(),
            &output,
            false,
        )
        .unwrap();
        let mut archive = zip::ZipArchive::new(File::open(output).unwrap()).unwrap();
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("<w:b/>"));
        assert!(xml.contains("【双通道】"));
        assert!(!xml.contains(">*</w:t>"));
    }
}
