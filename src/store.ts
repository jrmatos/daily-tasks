/**
 * Storage layer. Talks to the Tauri/SQLite backend (see CONTRACT.md) when running
 * inside the desktop app; falls back to localStorage in a plain browser
 * (`npm run dev`) so the UI stays testable. File attachments need the desktop
 * app; link attachments work in both.
 */
import { invoke } from "@tauri-apps/api/core";
import { isValidKey, todayKey } from "./dates";

export type Priority = "low" | "normal" | "high";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** YYYY-MM-DD, local time */
  date: string;
  createdAt: number;
  completedAt: number | null;
  priority: Priority;
  notes: string;
  /** computed by the backend on read; ignored on write */
  attachmentCount: number;
}

export interface Attachment {
  id: string;
  taskId: string;
  kind: "file" | "link";
  name: string;
  path: string | null;
  url: string | null;
  mime: string | null;
  size: number | null;
  createdAt: number;
}

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** File attachments (picker, drag & drop, paste) require the desktop app. */
export const supportsFiles = isTauri;

export class DesktopOnlyError extends Error {
  constructor(what = "File attachments") {
    super(`${what} are only available in the desktop app`);
  }
}

// ---------- normalization ----------
function normalizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || typeof t.title !== "string") return null;
  return {
    id: t.id,
    title: t.title,
    done: Boolean(t.done),
    date: isValidKey(t.date) ? t.date : todayKey(),
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
    completedAt: typeof t.completedAt === "number" ? t.completedAt : null,
    priority: t.priority === "low" || t.priority === "high" ? t.priority : "normal",
    notes: typeof t.notes === "string" ? t.notes : "",
    attachmentCount: typeof t.attachmentCount === "number" ? t.attachmentCount : 0,
  };
}

// ---------- browser (localStorage) fallback ----------
const LS_TASKS = "daily-tasks.v1";
const LS_ATTACHMENTS = "daily-tasks.attachments.v1";

function lsRead<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function lsWrite<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

const local = {
  loadTasks(): Task[] {
    const atts = lsRead<Attachment>(LS_ATTACHMENTS);
    return lsRead<unknown>(LS_TASKS)
      .map(normalizeTask)
      .filter((t): t is Task => t !== null)
      .map((t) => ({ ...t, attachmentCount: atts.filter((a) => a.taskId === t.id).length }));
  },
  upsertTask(task: Task): Task {
    const tasks = lsRead<Task>(LS_TASKS);
    const i = tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) tasks[i] = task;
    else tasks.push(task);
    lsWrite(LS_TASKS, tasks);
    return task;
  },
  deleteTasks(ids: string[]): void {
    const set = new Set(ids);
    lsWrite(LS_TASKS, lsRead<Task>(LS_TASKS).filter((t) => !set.has(t.id)));
    lsWrite(LS_ATTACHMENTS, lsRead<Attachment>(LS_ATTACHMENTS).filter((a) => !set.has(a.taskId)));
  },
  listAttachments(taskId: string): Attachment[] {
    return lsRead<Attachment>(LS_ATTACHMENTS)
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  addLink(taskId: string, url: string, name?: string): Attachment {
    const a: Attachment = {
      id: crypto.randomUUID(),
      taskId,
      kind: "link",
      name: name?.trim() || url,
      path: null,
      url,
      mime: null,
      size: null,
      createdAt: Date.now(),
    };
    lsWrite(LS_ATTACHMENTS, [...lsRead<Attachment>(LS_ATTACHMENTS), a]);
    return a;
  },
  deleteAttachment(id: string): void {
    lsWrite(LS_ATTACHMENTS, lsRead<Attachment>(LS_ATTACHMENTS).filter((a) => a.id !== id));
  },
  openAttachment(id: string): void {
    const a = lsRead<Attachment>(LS_ATTACHMENTS).find((x) => x.id === id);
    if (a?.url) window.open(a.url, "_blank", "noopener");
  },
  wipe(): void {
    localStorage.removeItem(LS_TASKS);
    localStorage.removeItem(LS_ATTACHMENTS);
  },
};

// ---------- tasks ----------
export async function loadTasks(): Promise<Task[]> {
  if (!isTauri) return local.loadTasks();
  const raw = await invoke<unknown>("load_tasks");
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeTask).filter((t): t is Task => t !== null);
}

/*
 * Write queue: all task writes run strictly in order. Upserts are coalesced
 * per task (only the latest snapshot is written), and a delete cancels any
 * pending upsert for the same task. `flush()` resolves once everything queued
 * has reached storage.
 */
let chain: Promise<void> = Promise.resolve();
let onError: ((err: unknown) => void) | null = null;
const pendingUpserts = new Map<string, Task>();

export function onSaveError(cb: (err: unknown) => void): void {
  onError = cb;
}

function enqueue(op: () => Promise<unknown> | unknown): Promise<void> {
  chain = chain.then(
    async () => {
      try {
        await op();
      } catch (err) {
        console.error("Storage operation failed", err);
        onError?.(err);
      }
    },
  );
  return chain;
}

export function saveTask(task: Task): Promise<void> {
  const alreadyQueued = pendingUpserts.has(task.id);
  pendingUpserts.set(task.id, { ...task });
  if (alreadyQueued) return chain;
  return enqueue(async () => {
    const t = pendingUpserts.get(task.id);
    pendingUpserts.delete(task.id);
    if (!t) return;
    if (isTauri) await invoke("upsert_task", { task: t });
    else local.upsertTask(t);
  });
}

export function deleteTasks(ids: string[]): Promise<void> {
  if (!ids.length) return chain;
  for (const id of ids) pendingUpserts.delete(id);
  return enqueue(async () => {
    if (!isTauri) return local.deleteTasks(ids);
    if (ids.length === 1) await invoke("delete_task", { id: ids[0] });
    else await invoke("delete_tasks", { ids });
  });
}

export function flush(): Promise<void> {
  return chain;
}

// ---------- attachments ----------
// Attachment calls wait for pending task writes so the task row exists first.

export async function listAttachments(taskId: string): Promise<Attachment[]> {
  await flush();
  if (!isTauri) return local.listAttachments(taskId);
  return invoke<Attachment[]>("list_attachments", { taskId });
}

export async function addAttachmentFiles(taskId: string, paths: string[]): Promise<Attachment[]> {
  if (!isTauri) throw new DesktopOnlyError();
  await flush();
  return invoke<Attachment[]>("add_attachment_files", { taskId, paths });
}

export async function addAttachmentBytes(taskId: string, name: string, bytes: Uint8Array): Promise<Attachment> {
  if (!isTauri) throw new DesktopOnlyError("Pasted images");
  await flush();
  return invoke<Attachment>("add_attachment_bytes", { taskId, name, bytes: Array.from(bytes) });
}

export async function addAttachmentLink(taskId: string, url: string, name?: string): Promise<Attachment> {
  await flush();
  if (!isTauri) return local.addLink(taskId, url, name);
  return invoke<Attachment>("add_attachment_link", { taskId, url, name: name?.trim() || null });
}

export async function deleteAttachment(id: string): Promise<void> {
  if (!isTauri) return local.deleteAttachment(id);
  await invoke("delete_attachment", { id });
}

export async function openAttachment(id: string): Promise<void> {
  if (!isTauri) return local.openAttachment(id);
  await invoke("open_attachment", { id });
}

export async function revealAttachment(id: string): Promise<void> {
  if (!isTauri) throw new DesktopOnlyError("Reveal in folder");
  await invoke("reveal_attachment", { id });
}

// ---------- data dir ----------
export async function getDataDir(): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string>("get_data_dir");
}

export async function openDataDir(): Promise<void> {
  if (!isTauri) throw new DesktopOnlyError("Opening the data folder");
  await invoke("open_data_dir");
}

export async function wipeAllData(): Promise<void> {
  pendingUpserts.clear();
  await flush();
  if (!isTauri) return local.wipe();
  await invoke("wipe_all_data");
}
