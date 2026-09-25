/** Task detail view: title, date, priority, done, notes, attachments. */
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { dayLabel, isValidKey } from "./dates";
import { getTask, notify, patchLocal, removeTasks, state, subscribe, updateTask } from "./state";
import {
  addAttachmentBytes,
  addAttachmentFiles,
  addAttachmentLink,
  deleteAttachment,
  flush,
  isTauri,
  listAttachments,
  openAttachment,
  revealAttachment,
  supportsFiles,
  type Attachment,
  type Priority,
} from "./store";
import {
  confirmDialog,
  errorMessage,
  formatBytes,
  h,
  iconButton,
  isModalOpen,
  promptLink,
  svg,
  toast,
  truncate,
  type IconName,
} from "./ui";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = {
  root: $<HTMLElement>("#detail"),
  back: $<HTMLButtonElement>("#detail-back"),
  crumb: $<HTMLSpanElement>("#detail-crumb"),
  del: $<HTMLButtonElement>("#detail-delete"),
  check: $<HTMLButtonElement>("#detail-check"),
  title: $<HTMLTextAreaElement>("#detail-title"),
  date: $<HTMLInputElement>("#detail-date"),
  prio: $<HTMLDivElement>("#detail-priority"),
  notes: $<HTMLTextAreaElement>("#detail-notes"),
  notesStatus: $<HTMLSpanElement>("#notes-status"),
  addFiles: $<HTMLButtonElement>("#add-files"),
  addLink: $<HTMLButtonElement>("#add-link"),
  attCount: $<HTMLSpanElement>("#att-count"),
  images: $<HTMLDivElement>("#att-images"),
  files: $<HTMLDivElement>("#att-files"),
  links: $<HTMLDivElement>("#att-links"),
  attEmpty: $<HTMLParagraphElement>("#att-empty"),
  meta: $<HTMLParagraphElement>("#detail-meta"),
  overlay: $<HTMLDivElement>("#drop-overlay"),
  scroll: $<HTMLDivElement>("#detail-scroll"),
};

let attachments: Attachment[] = [];
let onClosed: ((taskId: string) => void) | null = null;
/** bumps on every open so stale async results for another task are ignored */
let generation = 0;

export const isDetailOpen = () => state.detailId !== null;

// ---------- auto-grow textareas ----------
function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

// ---------- debounced text saving (title + notes) ----------
let saveTimer: number | undefined;
let dirty = false;

function scheduleTextSave(): void {
  dirty = true;
  el.notesStatus.textContent = "Saving…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveText, 500);
}

function saveText(): void {
  window.clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  const t = getTask(state.detailId);
  if (!t) return;
  const title = el.title.value.replace(/\s*\n\s*/g, " ").trim();
  const patch: { title?: string; notes?: string } = {};
  if (title && title !== t.title) patch.title = title;
  if (el.notes.value !== t.notes) patch.notes = el.notes.value;
  if (Object.keys(patch).length) updateTask(t.id, patch);
  el.notesStatus.textContent = "Saved";
}

/** Flush pending title/notes edits into the store queue. */
export function flushDetail(): Promise<void> {
  saveText();
  return flush();
}

// ---------- open / close ----------
export function openDetail(id: string): void {
  const t = getTask(id);
  if (!t) return;
  if (state.detailId && state.detailId !== id) saveText();
  state.detailId = id;
  generation++;
  attachments = [];
  el.title.value = t.title;
  el.notes.value = t.notes;
  el.notesStatus.textContent = "";
  sync();
  renderAttachments();
  void refreshAttachments();

  el.root.hidden = false;
  el.scroll.scrollTop = 0;
  requestAnimationFrame(() => {
    el.root.classList.add("open");
    autosize(el.title);
    autosize(el.notes);
  });
  el.back.focus({ preventScroll: true });
}

export function closeDetail(): void {
  const id = state.detailId;
  if (!id) return;
  saveText();
  state.detailId = null;
  generation++;
  hideOverlay();
  el.root.classList.remove("open");
  window.setTimeout(() => {
    if (!state.detailId) el.root.hidden = true;
  }, 220);
  notify();
  onClosed?.(id);
}

/** Refresh non-text fields from state (text fields only when not being edited). */
function sync(): void {
  const t = getTask(state.detailId);
  if (!t) {
    if (state.detailId) closeDetail();
    return;
  }
  el.root.dataset.prio = t.priority;
  el.root.classList.toggle("is-done", t.done);
  el.crumb.textContent = dayLabel(t.date);
  el.check.setAttribute("aria-checked", String(t.done));
  el.check.setAttribute("aria-label", t.done ? "Mark as not done" : "Mark as done");
  el.check.title = el.check.getAttribute("aria-label") ?? "";
  if (el.date.value !== t.date) el.date.value = t.date;
  for (const b of el.prio.querySelectorAll<HTMLButtonElement>("button")) {
    const on = b.dataset.p === t.priority;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  if (document.activeElement !== el.title && !dirty && el.title.value !== t.title) {
    el.title.value = t.title;
    autosize(el.title);
  }
  if (document.activeElement !== el.notes && !dirty && el.notes.value !== t.notes) {
    el.notes.value = t.notes;
    autosize(el.notes);
  }
  const created = new Date(t.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const completed = t.completedAt
    ? ` · Completed ${new Date(t.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "";
  el.meta.textContent = `Created ${created}${completed}`;
}

// ---------- attachments ----------
async function refreshAttachments(): Promise<void> {
  const id = state.detailId;
  if (!id) return;
  const gen = generation;
  try {
    const list = await listAttachments(id);
    if (gen !== generation) return;
    attachments = list;
    if (getTask(id)?.attachmentCount !== list.length) patchLocal(id, { attachmentCount: list.length });
    renderAttachments();
  } catch (err) {
    if (gen === generation) toast(`Couldn’t load attachments: ${errorMessage(err)}`);
  }
}

function addedToast(n: number): void {
  toast(n === 1 ? "Attachment added" : `${n} attachments added`);
}

async function withTask<T>(fn: (taskId: string) => Promise<T>): Promise<T | undefined> {
  const id = state.detailId;
  if (!id) return undefined;
  el.root.classList.add("busy");
  try {
    return await fn(id);
  } catch (err) {
    toast(errorMessage(err));
    return undefined;
  } finally {
    el.root.classList.remove("busy");
    if (state.detailId === id) await refreshAttachments();
  }
}

async function attachPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const added = await withTask((id) => addAttachmentFiles(id, paths));
  if (added) addedToast(added.length);
}

async function pickFiles(): Promise<void> {
  if (!supportsFiles) {
    toast("File attachments are only available in the desktop app");
    return;
  }
  try {
    const picked = await openFileDialog({ multiple: true, directory: false, title: "Attach files" });
    if (!picked) return;
    await attachPaths(Array.isArray(picked) ? picked : [picked]);
  } catch (err) {
    toast(errorMessage(err));
  }
}

async function addLink(): Promise<void> {
  const res = await promptLink();
  if (!res) return;
  const added = await withTask((id) => addAttachmentLink(id, res.url, res.name || undefined));
  if (added) addedToast(1);
}

async function removeAttachment(a: Attachment): Promise<void> {
  const ok = await confirmDialog(
    "Delete attachment?",
    a.kind === "file" ? `“${truncate(a.name, 40)}” will be deleted from disk.` : `Remove the link “${truncate(a.name, 40)}”?`,
  );
  if (!ok) return;
  await withTask(() => deleteAttachment(a.id));
}

async function openAtt(a: Attachment): Promise<void> {
  try {
    await openAttachment(a.id);
  } catch (err) {
    toast(`Couldn’t open: ${errorMessage(err)}`);
  }
}

async function revealAtt(a: Attachment): Promise<void> {
  try {
    await revealAttachment(a.id);
  } catch (err) {
    toast(errorMessage(err));
  }
}

type FileKind = "image" | "pdf" | "doc" | "zip" | "file";

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function fileKind(a: Attachment): FileKind {
  const mime = (a.mime ?? "").toLowerCase();
  const ext = extOf(a.name);
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (
    /zip|compressed|x-tar|x-7z|x-rar|gzip|x-bzip|x-xz|zstd/.test(mime) ||
    ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst"].includes(ext)
  ) {
    return "zip";
  }
  if (
    mime.startsWith("text/") ||
    /word|document|spreadsheet|presentation|rtf|msword|excel|powerpoint|opendocument/.test(mime) ||
    ["doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "pages"].includes(ext)
  ) {
    return "doc";
  }
  return "file";
}

function attActions(a: Attachment): HTMLDivElement {
  const actions = h("div", { class: "att-actions" });
  if (a.kind === "file" && isTauri) {
    const reveal = iconButton("reveal", "Show in folder", "att-action");
    reveal.addEventListener("click", (e) => {
      e.stopPropagation();
      void revealAtt(a);
    });
    actions.append(reveal);
  }
  const del = iconButton("trash", "Delete attachment", "att-action danger");
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    void removeAttachment(a);
  });
  actions.append(del);
  return actions;
}

function attItem(cls: string, a: Attachment, ...children: Node[]): HTMLDivElement {
  const item = h("div", { class: `att ${cls}`, tabIndex: 0, title: a.url ?? a.name });
  item.setAttribute("role", "button");
  item.append(...children, attActions(a));
  item.addEventListener("click", () => void openAtt(a));
  item.addEventListener("keydown", (e) => {
    if (e.target !== item) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void openAtt(a);
    } else if (e.key === "Delete") {
      e.preventDefault();
      void removeAttachment(a);
    }
  });
  return item;
}

function renderThumb(a: Attachment): HTMLDivElement {
  const img = h("img", { alt: a.name, loading: "lazy", decoding: "async", draggable: false });
  const fallback = h("span", { class: "thumb-fallback" }, svg("image"));
  img.addEventListener("error", () => img.replaceWith(fallback));
  if (a.path && isTauri) img.src = convertFileSrc(a.path);
  else img.replaceWith(fallback);
  const box = h("div", { class: "thumb-img" }, a.path && isTauri ? img : fallback);
  return attItem("att-thumb", a, box, h("span", { class: "thumb-name", textContent: a.name }));
}

const KIND_ICON: Record<Exclude<FileKind, "image">, IconName> = {
  pdf: "pdf",
  doc: "doc",
  zip: "zip",
  file: "file",
};

function renderFileCard(a: Attachment, kind: Exclude<FileKind, "image">): HTMLDivElement {
  const ext = extOf(a.name).toUpperCase();
  const meta = [ext, formatBytes(a.size)].filter(Boolean).join(" · ");
  return attItem(
    `att-file kind-${kind}`,
    a,
    h("span", { class: "file-icon" }, svg(KIND_ICON[kind])),
    h(
      "span",
      { class: "att-text" },
      h("span", { class: "att-name", textContent: a.name }),
      h("span", { class: "att-sub", textContent: meta }),
    ),
  );
}

function renderLink(a: Attachment): HTMLDivElement {
  const url = a.url ?? "";
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw */
  }
  const showName = a.name && a.name !== url;
  return attItem(
    "att-link",
    a,
    h("span", { class: "link-icon" }, svg("link")),
    h(
      "span",
      { class: "att-text" },
      h("span", { class: "att-name", textContent: showName ? a.name : host }),
      h("span", { class: "att-sub url", textContent: url }),
    ),
  );
}

function renderAttachments(): void {
  const images: HTMLElement[] = [];
  const files: HTMLElement[] = [];
  const links: HTMLElement[] = [];
  for (const a of attachments) {
    if (a.kind === "link") links.push(renderLink(a));
    else {
      const kind = fileKind(a);
      if (kind === "image") images.push(renderThumb(a));
      else files.push(renderFileCard(a, kind));
    }
  }
  el.images.replaceChildren(...images);
  el.files.replaceChildren(...files);
  el.links.replaceChildren(...links);
  el.images.hidden = !images.length;
  el.files.hidden = !files.length;
  el.links.hidden = !links.length;
  el.attEmpty.hidden = attachments.length > 0;
  el.attCount.textContent = attachments.length ? String(attachments.length) : "";
}

// ---------- drag & drop + paste ----------
function showOverlay(): void {
  el.overlay.hidden = false;
  requestAnimationFrame(() => el.overlay.classList.add("show"));
}
function hideOverlay(): void {
  el.overlay.classList.remove("show");
  el.overlay.hidden = true;
}

async function setupDragDrop(): Promise<void> {
  if (!isTauri) return;
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (!isDetailOpen() || isModalOpen()) {
        if (p.type === "drop" && !isModalOpen()) toast("Open a task to attach files");
        return;
      }
      if (p.type === "enter") showOverlay();
      else if (p.type === "leave") hideOverlay();
      else if (p.type === "drop") {
        hideOverlay();
        void attachPaths(p.paths);
      }
    });
  } catch (err) {
    console.error("Drag & drop unavailable", err);
  }
}

function imageExt(mime: string): string {
  const sub = mime.split("/")[1]?.split("+")[0] ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
}

function onPaste(e: ClipboardEvent): void {
  if (!isDetailOpen() || isModalOpen() || !e.clipboardData) return;
  const images = Array.from(e.clipboardData.items)
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
  // No image on the clipboard: let normal text paste happen.
  if (!images.length) return;
  e.preventDefault();
  if (!supportsFiles) {
    toast("Pasting images is only available in the desktop app");
    return;
  }
  void (async () => {
    let count = 0;
    await withTask(async (id) => {
      for (const [i, file] of images.entries()) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const generic = !file.name || /^image\.\w+$/i.test(file.name);
        const name = generic
          ? `pasted-${stamp}${images.length > 1 ? `-${i + 1}` : ""}.${imageExt(file.type)}`
          : file.name;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await addAttachmentBytes(id, name, bytes);
        count++;
      }
    });
    if (count) addedToast(count);
  })();
}

// ---------- delete task ----------
async function deleteCurrentTask(): Promise<void> {
  const t = getTask(state.detailId);
  if (!t) return;
  const n = attachments.length || t.attachmentCount;
  const ok = await confirmDialog(
    "Delete task?",
    `“${truncate(t.title, 40)}”${n ? ` and its ${n} attachment${n === 1 ? "" : "s"}` : ""} will be permanently deleted.`,
    "Delete task",
  );
  if (!ok || state.detailId !== t.id) return;
  dirty = false;
  closeDetail();
  removeTasks([t.id]);
  toast(`Deleted “${truncate(t.title)}”`);
}

// ---------- wiring ----------
export function initDetail(opts: { onClosed: (taskId: string) => void }): void {
  onClosed = opts.onClosed;

  el.back.addEventListener("click", closeDetail);
  el.del.addEventListener("click", () => void deleteCurrentTask());
  el.check.addEventListener("click", () => {
    const t = getTask(state.detailId);
    if (!t) return;
    updateTask(t.id, { done: !t.done });
    el.check.classList.remove("pop");
    void el.check.offsetWidth; // restart animation
    el.check.classList.add("pop");
  });

  el.title.addEventListener("input", () => {
    autosize(el.title);
    scheduleTextSave();
  });
  el.title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.title.blur();
    }
  });
  el.title.addEventListener("blur", () => {
    saveText();
    const t = getTask(state.detailId);
    if (t && !el.title.value.trim()) el.title.value = t.title; // don't allow an empty title
    autosize(el.title);
  });

  el.notes.addEventListener("input", () => {
    autosize(el.notes);
    scheduleTextSave();
  });
  el.notes.addEventListener("blur", saveText);

  el.date.addEventListener("change", () => {
    const t = getTask(state.detailId);
    const v = el.date.value;
    if (!t || !isValidKey(v) || v === t.date) {
      if (t) el.date.value = t.date;
      return;
    }
    updateTask(t.id, { date: v });
    toast(`Moved to ${dayLabel(v)}`);
  });

  for (const b of el.prio.querySelectorAll<HTMLButtonElement>("button")) {
    b.addEventListener("click", () => {
      const t = getTask(state.detailId);
      if (t) updateTask(t.id, { priority: b.dataset.p as Priority });
    });
  }

  el.addFiles.addEventListener("click", () => void pickFiles());
  el.addLink.addEventListener("click", () => void addLink());
  if (!supportsFiles) {
    el.addFiles.title = "File attachments are only available in the desktop app";
    el.addFiles.classList.add("unavailable");
  }

  document.addEventListener("paste", onPaste);
  subscribe(() => {
    if (state.detailId) sync();
  });
  window.addEventListener("resize", () => {
    if (!isDetailOpen()) return;
    autosize(el.title);
    autosize(el.notes);
  });
  void setupDragDrop();
}
