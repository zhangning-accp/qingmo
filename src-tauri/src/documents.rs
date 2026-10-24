use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct Documents {
    entries: HashMap<String, Document>,
    next: u64,
}
struct Document {
    path: PathBuf,
    original: String,
}
#[derive(Clone, Serialize)]
pub struct Opened {
    pub id: String,
    pub path: String,
    pub content: String,
}
#[derive(Default, Serialize)]
pub struct OpenBatch {
    pub documents: Vec<Opened>,
    pub errors: Vec<String>,
}

fn read_utf8(path: &Path) -> Result<String, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 10 * 1024 * 1024 {
        return Err("暂支持 10 MB 以内的文档".into());
    }
    fs::read_to_string(path).map_err(|e| format!("无法读取 UTF-8 文档：{e}"))
}
fn canonical(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        fs::canonicalize(path).map_err(|e| e.to_string())
    } else {
        Ok(fs::canonicalize(path.parent().ok_or("无效的保存路径")?)
            .map_err(|e| e.to_string())?
            .join(path.file_name().ok_or("无效文件名")?))
    }
}
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}
impl Documents {
    pub fn path(&self, id: &str) -> Option<PathBuf> {
        self.entries.get(id).map(|d| d.path.clone())
    }
    pub fn close(&mut self, id: &str) {
        self.entries.remove(id);
    }
    fn open(&mut self, path: &Path) -> Result<Opened, String> {
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["md", "markdown", "txt"].contains(&extension.as_str()) {
            return Err("仅支持 .md、.markdown、.txt 文件".into());
        }
        let path = canonical(path)?;
        if !path.is_file() {
            return Err("请拖入文件，暂不支持文件夹".into());
        }
        if let Some((id, doc)) = self.entries.iter().find(|(_, d)| same_path(&d.path, &path)) {
            return Ok(Opened {
                id: id.clone(),
                path: path.to_string_lossy().into(),
                content: doc.original.clone(),
            });
        }
        let content = read_utf8(&path)?;
        self.next += 1;
        let id = format!("file-{}", self.next);
        self.entries.insert(
            id.clone(),
            Document {
                path: path.clone(),
                original: content.clone(),
            },
        );
        Ok(Opened {
            id,
            path: path.to_string_lossy().into(),
            content,
        })
    }
    pub fn open_many(&mut self, paths: Vec<PathBuf>) -> OpenBatch {
        let mut batch = OpenBatch::default();
        for path in paths {
            match self.open(&path) {
                Ok(doc) => {
                    if !batch.documents.iter().any(|d| d.id == doc.id) {
                        batch.documents.push(doc);
                    }
                }
                Err(error) => batch.errors.push(format!(
                    "{}：{error}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                )),
            }
        }
        batch
    }
    pub fn save(&mut self, id: &str, path: &Path, content: &str) -> Result<String, String> {
        let path = canonical(path)?;
        if self
            .entries
            .iter()
            .any(|(other_id, doc)| other_id != id && same_path(&doc.path, &path))
        {
            return Err("该文件已在另一个标签中打开，请切换到那个标签或选择其他文件名。".into());
        }
        if let Some(doc) = self.entries.get(id).filter(|d| same_path(&d.path, &path)) {
            if read_utf8(&path)? != doc.original {
                return Err("文件已被其他程序修改，请另存为，避免覆盖外部修改。".into());
            }
        }
        let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("无效保存路径")?)
            .map_err(|e| e.to_string())?;
        temporary
            .write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist(&path)
            .map_err(|e| format!("保存失败，原文件仍保留：{e}"))?;
        self.entries.insert(
            id.into(),
            Document {
                path: path.clone(),
                original: content.into(),
            },
        );
        Ok(path.to_string_lossy().into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multiple_documents_save_independently_and_detect_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("甲.md");
        let b = dir.path().join("乙.md");
        fs::write(&a, "甲").unwrap();
        fs::write(&b, "乙").unwrap();
        let mut store = Documents::default();
        let batch = store.open_many(vec![a.clone(), b.clone(), a.clone()]);
        assert_eq!(batch.documents.len(), 2);
        let aid = &batch.documents[0].id;
        let bid = &batch.documents[1].id;
        store.save(aid, &a, "甲修改").unwrap();
        store.save(bid, &b, "乙修改").unwrap();
        assert_eq!(fs::read_to_string(&a).unwrap(), "甲修改");
        assert_eq!(fs::read_to_string(&b).unwrap(), "乙修改");
        assert!(store.save(aid, &b, "不应覆盖").is_err());
        fs::write(&a, "外部修改").unwrap();
        assert!(store.save(aid, &a, "覆盖").is_err());
        assert_eq!(fs::read_to_string(&a).unwrap(), "外部修改");
        let c = dir.path().join("另存.md");
        store.save(aid, &c, "另存内容").unwrap();
        assert_eq!(store.open_many(vec![c]).documents[0].id, *aid);
        store.close(bid);
        assert!(store.path(bid).is_none());
    }
    #[test]
    fn batch_keeps_good_files_and_reports_invalid_inputs() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("good.MD");
        let bad = dir.path().join("bad.md");
        fs::write(&good, "中文").unwrap();
        fs::write(&bad, [0xff]).unwrap();
        let batch = Documents::default().open_many(vec![
            good,
            bad,
            dir.path().join("missing.md"),
            dir.path().join("bad.png"),
        ]);
        assert_eq!(batch.documents.len(), 1);
        assert_eq!(batch.errors.len(), 3);
    }
}
