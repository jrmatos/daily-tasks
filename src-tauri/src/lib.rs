mod store;

use std::path::Path;

use store::{Attachment, Store, Task};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

// Commands are async so file copies / DB work run off the main (UI) thread.

#[tauri::command]
async fn load_tasks(store: State<'_, Store>) -> CmdResult<Vec<Task>> {
    store.load_tasks()
}

#[tauri::command]
async fn upsert_task(store: State<'_, Store>, task: Task) -> CmdResult<Task> {
    store.upsert_task(task)
}

#[tauri::command]
async fn delete_task(store: State<'_, Store>, id: String) -> CmdResult<()> {
    store.delete_tasks(&[id])
}

#[tauri::command]
async fn delete_tasks(store: State<'_, Store>, ids: Vec<String>) -> CmdResult<()> {
    store.delete_tasks(&ids)
}

#[tauri::command]
async fn list_attachments(store: State<'_, Store>, task_id: String) -> CmdResult<Vec<Attachment>> {
    store.list_attachments(&task_id)
}

#[tauri::command]
async fn add_attachment_files(
    store: State<'_, Store>,
    task_id: String,
    paths: Vec<String>,
) -> CmdResult<Vec<Attachment>> {
    store.add_attachment_files(&task_id, &paths)
}

#[tauri::command]
async fn add_attachment_bytes(
    store: State<'_, Store>,
    task_id: String,
    name: String,
    bytes: Vec<u8>,
) -> CmdResult<Attachment> {
    store.add_attachment_bytes(&task_id, &name, &bytes)
}

#[tauri::command]
async fn add_attachment_link(
    store: State<'_, Store>,
    task_id: String,
    url: String,
    name: Option<String>,
) -> CmdResult<Attachment> {
    store.add_attachment_link(&task_id, &url, name.as_deref())
}

#[tauri::command]
async fn delete_attachment(store: State<'_, Store>, id: String) -> CmdResult<()> {
    store.delete_attachment(&id)
}

#[tauri::command]
async fn open_attachment(app: tauri::AppHandle, store: State<'_, Store>, id: String) -> CmdResult<()> {
    let a = store.attachment(&id)?;
    let opener = app.opener();
    match (a.path, a.url) {
        (Some(path), _) => opener.open_path(path, None::<&str>),
        (None, Some(url)) => opener.open_url(url, None::<&str>),
        _ => return Err("attachment has nothing to open".into()),
    }
    .map_err(|e| format!("cannot open attachment: {e}"))
}

#[tauri::command]
async fn reveal_attachment(app: tauri::AppHandle, store: State<'_, Store>, id: String) -> CmdResult<()> {
    let a = store.attachment(&id)?;
    let path = a.path.ok_or("links have no file to reveal")?;
    app.opener()
        .reveal_item_in_dir(Path::new(&path))
        .map_err(|e| format!("cannot reveal attachment: {e}"))
}

#[tauri::command]
async fn get_data_dir(store: State<'_, Store>) -> CmdResult<String> {
    Ok(store.root().to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_data_dir(app: tauri::AppHandle, store: State<'_, Store>) -> CmdResult<()> {
    app.opener()
        .open_path(store.root().to_string_lossy(), None::<&str>)
        .map_err(|e| format!("cannot open data folder: {e}"))
}

#[tauri::command]
async fn wipe_all_data(store: State<'_, Store>) -> CmdResult<()> {
    store.wipe_all()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            app.manage(Store::open(root)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_tasks,
            upsert_task,
            delete_task,
            delete_tasks,
            list_attachments,
            add_attachment_files,
            add_attachment_bytes,
            add_attachment_link,
            delete_attachment,
            open_attachment,
            reveal_attachment,
            get_data_dir,
            open_data_dir,
            wipe_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
