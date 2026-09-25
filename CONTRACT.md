# Backend ⇄ Frontend contract (v2 — SQLite + attachments)

Storage root: `app_data_dir()` (Linux: `~/.local/share/com.paulo.dailytasks/`)
- `tasks.db` — SQLite (rusqlite, `bundled` feature), WAL mode, schema migrations via `PRAGMA user_version`
- `attachments/<taskId>/<attachmentId>-<sanitized original name>` — copied files
- DB design: hybrid JSONB — `tasks(id, date, done, created_at, doc)` / `attachments(id, task_id, created_at, doc)`; `doc` is the full record as SQLite JSONB, the other columns are indexed copies kept in sync on write, so new fields need no migration (files stay on disk, never blobs).

Deleting a task deletes its rows (FK `ON DELETE CASCADE`) AND its `attachments/<taskId>/` folder.
Uninstall (`install.sh --uninstall`) removes the app AND the whole storage root (with a confirm prompt; `--keep-data` skips it).

## Types (camelCase JSON)

```ts
type Priority = "low" | "normal" | "high";
interface Task {
  id: string; title: string; done: boolean;
  date: string;            // YYYY-MM-DD local
  createdAt: number;       // ms epoch
  completedAt: number | null;
  priority: Priority;
  notes: string;           // free text, "" default
  attachmentCount: number; // computed on read, ignored on write
}
interface Attachment {
  id: string; taskId: string;
  kind: "file" | "link";
  name: string;            // display name (original filename or link title)
  path: string | null;     // absolute path on disk for kind=file
  url: string | null;      // for kind=link
  mime: string | null;     // guessed from extension (mime_guess crate)
  size: number | null;     // bytes
  createdAt: number;
}
```

## Commands (`invoke` from `@tauri-apps/api/core`)

| Command | Args | Returns |
|---|---|---|
| `load_tasks` | — | `Task[]` (all tasks) |
| `upsert_task` | `{ task: Task }` | `Task` |
| `delete_task` | `{ id }` | `void` (removes attachments folder too) |
| `delete_tasks` | `{ ids: string[] }` | `void` (bulk, e.g. clear completed) |
| `list_attachments` | `{ taskId }` | `Attachment[]` (newest first) |
| `add_attachment_files` | `{ taskId, paths: string[] }` | `Attachment[]` (copies files in) |
| `add_attachment_bytes` | `{ taskId, name: string, bytes: number[] }` | `Attachment` (clipboard paste of images) |
| `add_attachment_link` | `{ taskId, url, name?: string }` | `Attachment` |
| `delete_attachment` | `{ id }` | `void` (removes file too) |
| `open_attachment` | `{ id }` | `void` (opens with system default app / browser) |
| `reveal_attachment` | `{ id }` | `void` (opens containing folder in file manager) |
| `get_data_dir` | — | `string` |
| `open_data_dir` | — | `void` |
| `wipe_all_data` | — | `void` (drops everything, recreates empty DB) |

## Plugins / config
- `tauri-plugin-dialog` (file picker, multiple files) — frontend uses `open({ multiple: true })` from `@tauri-apps/plugin-dialog`.
- `tauri-plugin-opener` for opening files/urls/folders.
- Asset protocol enabled, scope `$APPDATA/attachments/**`, so the frontend shows image thumbnails via `convertFileSrc(path)`. CSP must allow `img-src 'self' asset: http://asset.localhost data: blob:`.
- Drag & drop files onto the window: frontend listens via `getCurrentWebview().onDragDropEvent` (gives absolute paths) and calls `add_attachment_files` for the open task.
