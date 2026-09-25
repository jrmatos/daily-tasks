/** Shared app state + task mutations. Every mutation persists and notifies listeners. */
import { todayKey } from "./dates";
import { deleteTasks, saveTask, type Priority, type Task } from "./store";

export type Filter = "all" | "active" | "done";

const FILTER_KEY = "daily-tasks.filter";

function initialFilter(): Filter {
  try {
    const f = localStorage.getItem(FILTER_KEY);
    if (f === "all" || f === "active" || f === "done") return f;
  } catch {
    /* ignore */
  }
  return "all";
}

export const state = {
  tasks: [] as Task[],
  day: todayKey(),
  filter: initialFilter(),
  addPriority: "normal" as Priority,
  /** id of the task whose checkbox should play the pop animation on next render */
  popId: null as string | null,
  /** false until the initial load succeeds; no writes happen before that */
  ready: false,
  /** task shown in the detail view */
  detailId: null as string | null,
};

export function persistFilter(f: Filter): void {
  state.filter = f;
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* ignore */
  }
}

// ---------- change notification ----------
type Listener = () => void;
const listeners: Listener[] = [];
export function subscribe(fn: Listener): void {
  listeners.push(fn);
}
export function notify(): void {
  for (const fn of listeners) fn();
}

// ---------- queries ----------
export function getTask(id: string | null): Task | undefined {
  return id ? state.tasks.find((t) => t.id === id) : undefined;
}

// ---------- mutations ----------
export function newTask(title: string, date: string, priority: Priority): Task | null {
  const trimmed = title.trim();
  if (!trimmed || !state.ready) return null;
  const task: Task = {
    id: crypto.randomUUID(),
    title: trimmed,
    done: false,
    date,
    createdAt: Date.now(),
    completedAt: null,
    priority,
    notes: "",
    attachmentCount: 0,
  };
  state.tasks.push(task);
  void saveTask(task);
  notify();
  return task;
}

/**
 * Patch a task. `completedAt` follows `done` automatically.
 * `silent` skips the immediate notify (caller re-renders later).
 */
export function updateTask(id: string, patch: Partial<Task>, opts: { silent?: boolean } = {}): Task | undefined {
  const t = getTask(id);
  if (!t || !state.ready) return undefined;
  const wasDone = t.done;
  Object.assign(t, patch);
  if (t.done !== wasDone) t.completedAt = t.done ? Date.now() : null;
  void saveTask(t);
  if (!opts.silent) notify();
  return t;
}

/** Local-only patch (e.g. attachmentCount, which the backend computes). */
export function patchLocal(id: string, patch: Partial<Task>): void {
  const t = getTask(id);
  if (!t) return;
  Object.assign(t, patch);
  notify();
}

export function removeTasks(ids: string[]): Task[] {
  if (!state.ready || !ids.length) return [];
  const set = new Set(ids);
  const removed = state.tasks.filter((t) => set.has(t.id));
  state.tasks = state.tasks.filter((t) => !set.has(t.id));
  void deleteTasks(ids);
  notify();
  return removed;
}

/** Re-insert previously removed tasks (undo). Only safe for tasks without attachments. */
export function restoreTasks(tasks: Task[]): void {
  for (const t of tasks) {
    if (getTask(t.id)) continue;
    const copy = { ...t, attachmentCount: 0 };
    state.tasks.push(copy);
    void saveTask(copy);
  }
  notify();
}

export function replaceAll(tasks: Task[]): void {
  state.tasks = tasks;
  notify();
}
