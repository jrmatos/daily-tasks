//! SQLite-backed storage for tasks and attachments.
//!
//! Hybrid schema: each row keeps a JSONB `doc` with the full record plus a few
//! real, indexed columns (`date`, `done`, `created_at`, `task_id`) that are kept
//! in sync on write. New fields can be added to the structs without a migration
//! (`#[serde(default)]` lets older docs load). Attachment files live on disk
//! under `attachments/<taskId>/`, never as blobs in the DB.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, String>;

const DB_FILE: &str = "tasks.db";
const ATTACHMENTS_DIR: &str = "attachments";
const SCHEMA_VERSION: i32 = 1;
const MAX_NAME_BYTES: usize = 120;
const MAX_PASTE_BYTES: usize = 100 * 1024 * 1024;

fn default_priority() -> String {
    "normal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub done: bool,
    /// YYYY-MM-DD (local)
    pub date: String,
    /// ms epoch
    pub created_at: i64,
    pub completed_at: Option<i64>,
    /// "low" | "normal" | "high"
    pub priority: String,
    pub notes: String,
    /// Computed on read, ignored on write.
    pub attachment_count: i64,
}

impl Default for Task {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            done: false,
            date: String::new(),
            created_at: 0,
            completed_at: None,
            priority: default_priority(),
            notes: String::new(),
            attachment_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    /// "file" | "link"
    pub kind: String,
    pub name: String,
    /// Absolute path on disk (kind=file). Stored relative to the attachments
    /// root in the DB so the data dir can move.
    pub path: Option<String>,
    pub url: Option<String>,
    pub mime: Option<String>,
    pub size: Option<i64>,
    pub created_at: i64,
}

pub struct Store {
    root: PathBuf,
    conn: Mutex<Connection>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn err<E: std::fmt::Display>(ctx: &str) -> impl FnOnce(E) -> String + '_ {
    move |e| format!("{ctx}: {e}")
}

/// Ids are used as folder names, so only allow a safe charset.
fn check_id(id: &str) -> Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid id: {id:?}"))
    }
}

/// Reduce an arbitrary (possibly path-like) name to a safe single filename.
pub fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    let mut out = if trimmed.is_empty() { "file".to_string() } else { trimmed.to_string() };
    if out.len() > MAX_NAME_BYTES {
        let (stem, ext) = split_ext(&out);
        let ext = if ext.len() < 20 { ext } else { String::new() };
        let mut stem_cut = String::new();
        for c in stem.chars() {
            if stem_cut.len() + c.len_utf8() + ext.len() > MAX_NAME_BYTES {
                break;
            }
            stem_cut.push(c);
        }
        out = format!("{stem_cut}{ext}");
    }
    out
}

/// ("photo", ".png"); ext includes the dot, empty if none.
fn split_ext(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

/// "a.png" -> "a (2).png" if taken, etc.
fn dedupe_name(name: &str, taken: &mut HashSet<String>) -> String {
    let mut candidate = name.to_string();
    let (stem, ext) = split_ext(name);
    let mut n = 2;
    while taken.contains(&candidate.to_lowercase()) {
        candidate = format!("{stem} ({n}){ext}");
        n += 1;
    }
    taken.insert(candidate.to_lowercase());
    candidate
}

fn guess_mime(name: &str) -> Option<String> {
    mime_guess::from_path(name).first().map(|m| m.essence_str().to_string())
}

fn normalize_priority(p: &str) -> String {
    match p {
        "low" | "normal" | "high" => p.to_string(),
        _ => default_priority(),
    }
}

impl Store {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(root.join(ATTACHMENTS_DIR))
            .map_err(err("cannot create data dir"))?;
        let conn = Connection::open(root.join(DB_FILE)).map_err(err("cannot open database"))?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(err("pragma"))?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(err("pragma"))?;
        conn.pragma_update(None, "synchronous", "NORMAL").map_err(err("pragma"))?;
        migrate(&conn)?;
        Ok(Self { root, conn: Mutex::new(conn) })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn attachments_root(&self) -> PathBuf {
        self.root.join(ATTACHMENTS_DIR)
    }

    fn task_dir(&self, task_id: &str) -> PathBuf {
        self.attachments_root().join(task_id)
    }

    fn db(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| "database lock poisoned".to_string())
    }

    // ---- tasks -------------------------------------------------------------

    pub fn load_tasks(&self) -> Result<Vec<Task>> {
        let conn = self.db()?;
        let mut stmt = conn
            .prepare(
                "SELECT json(t.doc),
                        (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id)
                 FROM tasks t ORDER BY t.date, t.created_at",
            )
            .map_err(err("query tasks"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err("query tasks"))?;
        let mut out = Vec::new();
        for row in rows {
            let (doc, count) = row.map_err(err("read task"))?;
            let mut task: Task = serde_json::from_str(&doc).map_err(err("decode task"))?;
            task.attachment_count = count;
            out.push(task);
        }
        Ok(out)
    }

    pub fn upsert_task(&self, mut task: Task) -> Result<Task> {
        if task.id.is_empty() {
            task.id = new_id();
        }
        check_id(&task.id)?;
        if task.created_at == 0 {
            task.created_at = now_ms();
        }
        task.priority = normalize_priority(&task.priority);
        if !task.done {
            task.completed_at = None;
        } else if task.completed_at.is_none() {
            task.completed_at = Some(now_ms());
        }

        let mut doc = serde_json::to_value(&task).map_err(err("encode task"))?;
        if let Some(obj) = doc.as_object_mut() {
            obj.remove("attachmentCount");
        }
        let conn = self.db()?;
        conn.execute(
            "INSERT INTO tasks (id, date, done, created_at, doc)
             VALUES (?1, ?2, ?3, ?4, jsonb(?5))
             ON CONFLICT(id) DO UPDATE SET
               date = excluded.date, done = excluded.done,
               created_at = excluded.created_at, doc = excluded.doc",
            params![task.id, task.date, task.done, task.created_at, doc.to_string()],
        )
        .map_err(err("save task"))?;
        task.attachment_count = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE task_id = ?1",
                [&task.id],
                |r| r.get(0),
            )
            .map_err(err("count attachments"))?;
        Ok(task)
    }

    pub fn delete_tasks(&self, ids: &[String]) -> Result<()> {
        for id in ids {
            check_id(id)?;
        }
        {
            let mut conn = self.db()?;
            let tx = conn.transaction().map_err(err("begin"))?;
            for id in ids {
                tx.execute("DELETE FROM tasks WHERE id = ?1", [id])
                    .map_err(err("delete task"))?;
            }
            tx.commit().map_err(err("commit"))?;
        }
        for id in ids {
            let dir = self.task_dir(id);
            if dir.exists() {
                fs::remove_dir_all(&dir).map_err(err("remove attachments folder"))?;
            }
        }
        Ok(())
    }

    fn ensure_task(conn: &Connection, task_id: &str) -> Result<()> {
        check_id(task_id)?;
        let exists: Option<i64> = conn
            .query_row("SELECT 1 FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
            .optional()
            .map_err(err("lookup task"))?;
        exists.map(|_| ()).ok_or_else(|| format!("task not found: {task_id}"))
    }

    // ---- attachments -------------------------------------------------------

    fn decode_attachment(&self, doc: &str) -> Result<Attachment> {
        let mut a: Attachment = serde_json::from_str(doc).map_err(err("decode attachment"))?;
        if let Some(rel) = &a.path {
            a.path = Some(self.attachments_root().join(rel).to_string_lossy().into_owned());
        }
        Ok(a)
    }

    /// `rel_path` is relative to the attachments root.
    fn insert_attachment(conn: &Connection, a: &Attachment, rel_path: Option<&str>) -> Result<()> {
        let mut doc = serde_json::to_value(a).map_err(err("encode attachment"))?;
        doc["path"] = rel_path.map_or(serde_json::Value::Null, |p| p.into());
        conn.execute(
            "INSERT INTO attachments (id, task_id, created_at, doc) VALUES (?1, ?2, ?3, jsonb(?4))",
            params![a.id, a.task_id, a.created_at, doc.to_string()],
        )
        .map_err(err("save attachment"))?;
        Ok(())
    }

    fn get_attachment(&self, id: &str) -> Result<Attachment> {
        check_id(id)?;
        let conn = self.db()?;
        let doc: Option<String> = conn
            .query_row("SELECT json(doc) FROM attachments WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(err("lookup attachment"))?;
        drop(conn);
        self.decode_attachment(&doc.ok_or_else(|| format!("attachment not found: {id}"))?)
    }

    pub fn attachment(&self, id: &str) -> Result<Attachment> {
        self.get_attachment(id)
    }

    pub fn list_attachments(&self, task_id: &str) -> Result<Vec<Attachment>> {
        check_id(task_id)?;
        let conn = self.db()?;
        let mut stmt = conn
            .prepare(
                "SELECT json(doc) FROM attachments WHERE task_id = ?1
                 ORDER BY created_at DESC, rowid DESC",
            )
            .map_err(err("query attachments"))?;
        let docs: Vec<String> = stmt
            .query_map([task_id], |r| r.get(0))
            .map_err(err("query attachments"))?
            .collect::<std::result::Result<_, _>>()
            .map_err(err("read attachment"))?;
        docs.iter().map(|d| self.decode_attachment(d)).collect()
    }

    fn taken_names(conn: &Connection, task_id: &str) -> Result<HashSet<String>> {
        let mut stmt = conn
            .prepare("SELECT doc ->> '$.name' FROM attachments WHERE task_id = ?1")
            .map_err(err("query names"))?;
        let names = stmt
            .query_map([task_id], |r| r.get::<_, Option<String>>(0))
            .map_err(err("query names"))?
            .filter_map(|r| r.ok().flatten())
            .map(|n| n.to_lowercase())
            .collect();
        Ok(names)
    }

    /// Writes content via `write` into the task folder and records it.
    fn add_file_with<F>(
        &self,
        conn: &Connection,
        task_id: &str,
        display_name: String,
        write: F,
    ) -> Result<Attachment>
    where
        F: FnOnce(&Path) -> std::io::Result<u64>,
    {
        let id = new_id();
        let file_name = format!("{id}-{}", sanitize_filename(&display_name));
        let dir = self.task_dir(task_id);
        fs::create_dir_all(&dir).map_err(err("create attachments folder"))?;
        let dest = dir.join(&file_name);
        let size = write(&dest).map_err(err("copy file"))?;
        let a = Attachment {
            id,
            task_id: task_id.to_string(),
            kind: "file".into(),
            mime: guess_mime(&display_name),
            name: display_name,
            path: Some(dest.to_string_lossy().into_owned()),
            url: None,
            size: Some(size as i64),
            created_at: now_ms(),
        };
        let rel = format!("{task_id}/{file_name}");
        if let Err(e) = Self::insert_attachment(conn, &a, Some(&rel)) {
            let _ = fs::remove_file(&dest);
            return Err(e);
        }
        Ok(a)
    }

    pub fn add_attachment_files(&self, task_id: &str, paths: &[String]) -> Result<Vec<Attachment>> {
        let conn = self.db()?;
        Self::ensure_task(&conn, task_id)?;
        let mut taken = Self::taken_names(&conn, task_id)?;
        let mut seen_paths = HashSet::new();
        let mut out = Vec::new();
        for p in paths {
            let src = PathBuf::from(p);
            let canon = fs::canonicalize(&src).map_err(err(&format!("cannot access {p}")))?;
            if !seen_paths.insert(canon.clone()) {
                continue; // same file passed twice in one call
            }
            if !canon.is_file() {
                return Err(format!("not a regular file: {p}"));
            }
            let raw_name = canon.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let name = dedupe_name(&sanitize_filename(&raw_name), &mut taken);
            out.push(self.add_file_with(&conn, task_id, name, |dest| fs::copy(&canon, dest))?);
        }
        out.reverse(); // newest first, like list_attachments
        Ok(out)
    }

    pub fn add_attachment_bytes(&self, task_id: &str, name: &str, bytes: &[u8]) -> Result<Attachment> {
        if bytes.len() > MAX_PASTE_BYTES {
            return Err("attachment too large".into());
        }
        let conn = self.db()?;
        Self::ensure_task(&conn, task_id)?;
        let mut taken = Self::taken_names(&conn, task_id)?;
        let base = if name.trim().is_empty() { "pasted-image.png" } else { name };
        let name = dedupe_name(&sanitize_filename(base), &mut taken);
        self.add_file_with(&conn, task_id, name, |dest| {
            fs::write(dest, bytes).map(|_| bytes.len() as u64)
        })
    }

    pub fn add_attachment_link(&self, task_id: &str, url: &str, name: Option<&str>) -> Result<Attachment> {
        let url = url.trim();
        let lower = url.to_ascii_lowercase();
        if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
            return Err("only http(s) and mailto links are supported".into());
        }
        let conn = self.db()?;
        Self::ensure_task(&conn, task_id)?;
        let name = name.map(str::trim).filter(|n| !n.is_empty()).unwrap_or(url);
        let a = Attachment {
            id: new_id(),
            task_id: task_id.to_string(),
            kind: "link".into(),
            name: name.to_string(),
            path: None,
            url: Some(url.to_string()),
            mime: None,
            size: None,
            created_at: now_ms(),
        };
        Self::insert_attachment(&conn, &a, None)?;
        Ok(a)
    }

    pub fn delete_attachment(&self, id: &str) -> Result<()> {
        let a = self.get_attachment(id)?;
        self.db()?
            .execute("DELETE FROM attachments WHERE id = ?1", [id])
            .map_err(err("delete attachment"))?;
        if let Some(p) = a.path {
            let p = PathBuf::from(p);
            if p.starts_with(self.attachments_root()) && p.exists() {
                fs::remove_file(&p).map_err(err("remove file"))?;
            }
        }
        Ok(())
    }

    /// Drops everything and recreates an empty DB + attachments folder.
    pub fn wipe_all(&self) -> Result<()> {
        let conn = self.db()?;
        conn.execute_batch(
            "DROP TABLE IF EXISTS attachments; DROP TABLE IF EXISTS tasks; PRAGMA user_version = 0;",
        )
        .map_err(err("wipe database"))?;
        migrate(&conn)?;
        let _ = conn.execute_batch("VACUUM;");
        let dir = self.attachments_root();
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(err("remove attachments"))?;
        }
        fs::create_dir_all(&dir).map_err(err("create attachments folder"))?;
        Ok(())
    }
}

fn migrate(conn: &Connection) -> Result<()> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err("read schema version"))?;
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS tasks (
               id TEXT PRIMARY KEY,
               date TEXT NOT NULL,
               done INTEGER NOT NULL,
               created_at INTEGER NOT NULL,
               doc BLOB NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
             CREATE TABLE IF NOT EXISTS attachments (
               id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
               created_at INTEGER NOT NULL,
               doc BLOB NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
             COMMIT;",
        )
        .map_err(err("migrate v1"))?;
    }
    // Future migrations: `if version < 2 { ... }`
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(err("write schema version"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(dir.path()).unwrap();
        (dir, s)
    }

    fn task(id: &str) -> Task {
        Task { id: id.into(), title: "Buy milk".into(), date: "2026-09-25".into(), ..Default::default() }
    }

    #[test]
    fn sqlite_supports_jsonb() {
        let (_d, s) = store();
        let v: String = s.db().unwrap().query_row("select sqlite_version()", [], |r| r.get(0)).unwrap();
        let parts: Vec<u32> = v.split('.').map(|p| p.parse().unwrap()).collect();
        assert!((parts[0], parts[1]) >= (3, 45), "sqlite {v} < 3.45");
    }

    #[test]
    fn upsert_inserts_then_updates() {
        let (_d, s) = store();
        let t = s.upsert_task(task("t1")).unwrap();
        assert_eq!(t.priority, "normal");
        assert!(t.created_at > 0);

        let mut t2 = t.clone();
        t2.title = "Buy oat milk".into();
        t2.done = true;
        t2.notes = "2 cartons".into();
        s.upsert_task(t2).unwrap();

        let all = s.load_tasks().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Buy oat milk");
        assert!(all[0].done && all[0].completed_at.is_some());
        assert_eq!(all[0].notes, "2 cartons");
        let done: bool = s.db().unwrap().query_row("select done from tasks", [], |r| r.get(0)).unwrap();
        assert!(done, "indexed column kept in sync with doc");
    }

    #[test]
    fn old_docs_missing_fields_still_load() {
        let (_d, s) = store();
        s.db().unwrap().execute(
            "insert into tasks values ('old', '2026-01-01', 0, 1, jsonb('{\"id\":\"old\",\"title\":\"x\",\"date\":\"2026-01-01\"}'))",
            [],
        ).unwrap();
        let t = &s.load_tasks().unwrap()[0];
        assert_eq!((t.priority.as_str(), t.notes.as_str()), ("normal", ""));
    }

    #[test]
    fn delete_cascades_rows_and_removes_folder() {
        let (d, s) = store();
        s.upsert_task(task("t1")).unwrap();
        s.upsert_task(task("t2")).unwrap();
        let src = d.path().join("report.pdf");
        fs::write(&src, b"%PDF").unwrap();
        let src = src.to_string_lossy().into_owned();

        let added = s.add_attachment_files("t1", &[src.clone(), src.clone()]).unwrap();
        assert_eq!(added.len(), 1, "duplicate path in one call is skipped");
        let again = s.add_attachment_files("t1", &[src.clone()]).unwrap();
        assert_eq!(again[0].name, "report (2).pdf");
        assert_eq!(again[0].mime.as_deref(), Some("application/pdf"));
        assert!(Path::new(&src).exists(), "source is copied, not moved");
        s.add_attachment_link("t1", "https://example.com", None).unwrap();
        s.add_attachment_bytes("t2", "", b"png").unwrap();

        assert_eq!(s.load_tasks().unwrap().iter().find(|t| t.id == "t1").unwrap().attachment_count, 3);
        let folder = s.task_dir("t1");
        assert!(folder.is_dir());

        s.delete_tasks(&["t1".into()]).unwrap();
        assert!(!folder.exists(), "attachments folder removed");
        let left: i64 = s.db().unwrap()
            .query_row("select count(*) from attachments where task_id='t1'", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0, "attachment rows cascaded");
        assert_eq!(s.list_attachments("t2").unwrap().len(), 1, "other task untouched");
    }

    #[test]
    fn delete_attachment_removes_file() {
        let (_d, s) = store();
        s.upsert_task(task("t1")).unwrap();
        let a = s.add_attachment_bytes("t1", "../../etc/passwd", b"hi").unwrap();
        assert_eq!(a.name, "passwd");
        let path = PathBuf::from(a.path.clone().unwrap());
        assert!(path.starts_with(s.task_dir("t1")) && path.exists());
        s.delete_attachment(&a.id).unwrap();
        assert!(!path.exists());
        assert!(s.list_attachments("t1").unwrap().is_empty());
    }

    #[test]
    fn sanitizes_names_and_rejects_bad_ids() {
        assert_eq!(sanitize_filename("..\\..\\a:b?.txt"), "a_b_.txt");
        assert_eq!(sanitize_filename("   "), "file");
        assert_eq!(sanitize_filename(".hidden"), "hidden");
        assert!(sanitize_filename(&"x".repeat(500)).len() <= MAX_NAME_BYTES);
        assert!(check_id("../x").is_err());
        let (_d, s) = store();
        assert!(s.upsert_task(task("a/b")).is_err());
    }

    #[test]
    fn wipe_all_resets_everything() {
        let (_d, s) = store();
        s.upsert_task(task("t1")).unwrap();
        s.add_attachment_bytes("t1", "a.png", b"x").unwrap();
        s.wipe_all().unwrap();
        assert!(s.load_tasks().unwrap().is_empty());
        assert!(!s.task_dir("t1").exists());
        s.upsert_task(task("t2")).unwrap();
    }
}
