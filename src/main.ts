import { addDays, dayLabel, longDate, todayKey } from "./dates";
import { closeDetail, flushDetail, initDetail, isDetailOpen, openDetail } from "./detail";
import { closeMenu, initMenu, isMenuOpen } from "./menu";
import {
  newTask,
  notify,
  persistFilter,
  removeTasks,
  replaceAll,
  restoreTasks,
  state,
  subscribe,
  updateTask,
  type Filter,
} from "./state";
import { loadTasks, onSaveError, type Priority, type Task } from "./store";
import { confirmDialog, h, isModalOpen, isTyping, svg, toast, truncate } from "./ui";

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const PRIORITY_CYCLE: Priority[] = ["normal", "high", "low"];

// ---------- DOM ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = {
  dayLabel: $<HTMLHeadingElement>("#day-label"),
  daySub: $<HTMLParagraphElement>("#day-sub"),
  prev: $<HTMLButtonElement>("#prev-day"),
  next: $<HTMLButtonElement>("#next-day"),
  todayBtn: $<HTMLButtonElement>("#today-btn"),
  progressLabel: $<HTMLSpanElement>("#progress-label"),
  progressPct: $<HTMLSpanElement>("#progress-pct"),
  progressFill: $<HTMLDivElement>("#progress-fill"),
  addForm: $<HTMLFormElement>("#add-form"),
  addInput: $<HTMLInputElement>("#add-input"),
  addPriority: $<HTMLButtonElement>("#add-priority"),
  banner: $<HTMLDivElement>("#carry-banner"),
  bannerText: $<HTMLSpanElement>("#carry-text"),
  bannerBtn: $<HTMLButtonElement>("#carry-btn"),
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>(".tab")),
  list: $<HTMLUListElement>("#task-list"),
  empty: $<HTMLDivElement>("#empty"),
  emptyTitle: $<HTMLParagraphElement>("#empty-title"),
  emptySub: $<HTMLParagraphElement>("#empty-sub"),
  clearDone: $<HTMLButtonElement>("#clear-done"),
  listView: $<HTMLDivElement>("#list-view"),
};

// ---------- helpers ----------
function tasksForDay(day = state.day): Task[] {
  return state.tasks.filter((t) => t.date === day);
}

function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) return (a.completedAt ?? 0) - (b.completedAt ?? 0);
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return p !== 0 ? p : a.createdAt - b.createdAt;
  });
}

function overdue(): Task[] {
  const today = todayKey();
  return state.tasks.filter((t) => !t.done && t.date < today);
}

function nextPriority(p: Priority): Priority {
  return PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(p) + 1) % PRIORITY_CYCLE.length];
}

function priorityTitle(p: Priority): string {
  return `Priority: ${p} (click to change)`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- actions ----------
function addTask(title: string): void {
  if (!newTask(title, state.day, state.addPriority)) return;
  if (state.filter === "done") setFilter("all");
}

function toggleTask(id: string, rowEl: HTMLElement): void {
  const t = updateTask(id, { done: !state.tasks.find((x) => x.id === id)?.done }, { silent: true });
  if (!t) return;
  // let the check animation play in place before re-sorting
  rowEl.classList.toggle("done", t.done);
  rowEl.classList.add("pop");
  window.setTimeout(notify, 260);
}

function cyclePriority(id: string): void {
  const t = state.tasks.find((x) => x.id === id);
  if (t) updateTask(id, { priority: nextPriority(t.priority) });
}

async function deleteTask(t: Task): Promise<void> {
  if (t.attachmentCount > 0) {
    const ok = await confirmDialog(
      "Delete task?",
      `“${truncate(t.title, 40)}” and its ${plural(t.attachmentCount, "attachment")} will be permanently deleted.`,
      "Delete task",
    );
    if (!ok) return;
    removeTasks([t.id]);
    toast(`Deleted “${truncate(t.title)}”`);
    return;
  }
  const removed = removeTasks([t.id]);
  toast(`Deleted “${truncate(t.title)}”`, () => restoreTasks(removed));
}

async function clearCompleted(): Promise<void> {
  const done = tasksForDay().filter((t) => t.done);
  if (!done.length) return;
  const withFiles = done.reduce((n, t) => n + t.attachmentCount, 0);
  if (withFiles > 0) {
    const ok = await confirmDialog(
      "Clear completed?",
      `${plural(done.length, "completed task")} and ${plural(withFiles, "attachment")} will be permanently deleted.`,
      "Clear",
    );
    if (!ok) return;
    removeTasks(done.map((t) => t.id));
    toast(`Cleared ${done.length} completed`);
    return;
  }
  const removed = removeTasks(done.map((t) => t.id));
  toast(`Cleared ${done.length} completed`, () => restoreTasks(removed));
}

function carryOver(): void {
  const today = todayKey();
  const list = overdue();
  if (!list.length) return;
  for (const t of list) updateTask(t.id, { date: today }, { silent: true });
  notify();
  toast(`Moved ${plural(list.length, "task")} to today`);
}

// ---------- navigation ----------
function setDay(day: string): void {
  if (day === state.day) return;
  state.day = day;
  render();
}

function setFilter(f: Filter): void {
  persistFilter(f);
  render();
}

function setAddPriority(p: Priority): void {
  state.addPriority = p;
  el.addPriority.dataset.priority = p;
  el.addPriority.title = priorityTitle(p);
  el.addPriority.setAttribute("aria-label", `Priority: ${p}`);
}

// ---------- rendering ----------
let renderedIds = new Set<string>();

function renderRow(t: Task): HTMLLIElement {
  const li = h("li", { class: "task", tabIndex: 0, data: { id: t.id, priority: t.priority } });
  li.setAttribute("aria-label", `${t.title}${t.done ? " (done)" : ""}. Press Enter for details.`);
  if (t.done) li.classList.add("done");
  if (state.popId === t.id) li.classList.add("pop");
  if (!renderedIds.has(t.id)) li.classList.add("enter");

  const check = h("button", { type: "button", class: "check" });
  check.setAttribute("role", "checkbox");
  check.setAttribute("aria-checked", String(t.done));
  check.setAttribute("aria-label", t.done ? "Mark as not done" : "Mark as done");
  check.append(svg("check"));
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTask(t.id, li);
  });

  const dot = h("button", { type: "button", class: "prio", title: priorityTitle(t.priority) });
  dot.setAttribute("aria-label", `Priority: ${t.priority}`);
  dot.append(h("span", { class: "dot" }));
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    cyclePriority(t.id);
  });

  const indicators = h("span", { class: "indicators" });
  if (t.notes.trim()) {
    const n = h("span", { class: "ind", title: "Has notes" }, svg("notes"));
    n.setAttribute("aria-label", "Has notes");
    indicators.append(n);
  }
  if (t.attachmentCount > 0) {
    const a = h(
      "span",
      { class: "ind", title: plural(t.attachmentCount, "attachment") },
      svg("paperclip"),
      h("span", { textContent: String(t.attachmentCount) }),
    );
    a.setAttribute("aria-label", plural(t.attachmentCount, "attachment"));
    indicators.append(a);
  }

  const body = h(
    "div",
    { class: "task-body" },
    h("span", { class: "title", textContent: t.title }),
    indicators.childElementCount ? indicators : null,
  );

  const del = h("button", { type: "button", class: "del", title: "Delete" });
  del.setAttribute("aria-label", "Delete task");
  del.append(svg("close"));
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    void deleteTask(t);
  });

  li.addEventListener("click", () => openDetail(t.id));
  li.addEventListener("keydown", (e) => {
    if (e.target !== li) return;
    if (e.key === "Enter") {
      e.preventDefault();
      openDetail(t.id);
    } else if (e.key === " ") {
      e.preventDefault();
      toggleTask(t.id, li);
    } else if (e.key === "Delete") {
      e.preventDefault();
      void deleteTask(t);
    }
  });

  li.append(check, dot, body, del);
  return li;
}

function render(): void {
  const today = todayKey();
  const isToday = state.day === today;

  // header
  el.dayLabel.textContent = dayLabel(state.day);
  el.daySub.textContent = longDate(state.day);
  el.todayBtn.hidden = isToday;
  document.title = `Daily Tasks — ${dayLabel(state.day)}`;

  // progress
  const dayTasks = tasksForDay();
  const doneCount = dayTasks.filter((t) => t.done).length;
  const total = dayTasks.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  el.progressLabel.textContent = `${doneCount} / ${total} done`;
  el.progressPct.textContent = total ? `${pct}%` : "";
  el.progressFill.style.width = `${pct}%`;
  el.progressFill.classList.toggle("complete", total > 0 && doneCount === total);

  // carry-over banner
  const od = isToday ? overdue() : [];
  el.banner.hidden = od.length === 0;
  if (od.length) el.bannerText.textContent = `${od.length} unfinished from earlier`;

  // tabs
  const counts = { all: total, active: total - doneCount, done: doneCount };
  for (const tab of el.tabs) {
    const f = tab.dataset.filter as Filter;
    const active = f === state.filter;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    const c = tab.querySelector<HTMLSpanElement>(".count");
    if (c) c.textContent = counts[f] ? String(counts[f]) : "";
  }

  // list (keep keyboard focus on the same row across re-renders)
  const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".task")?.dataset.id;
  const visible = sortTasks(
    dayTasks.filter((t) => (state.filter === "all" ? true : state.filter === "active" ? !t.done : t.done)),
  );
  el.list.replaceChildren(...visible.map(renderRow));
  renderedIds = new Set(visible.map((t) => t.id));
  state.popId = null;
  if (focusedId && !isDetailOpen()) {
    el.list.querySelector<HTMLElement>(`.task[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

  // empty state
  el.empty.hidden = visible.length > 0;
  if (!visible.length) {
    let title: string;
    let sub: string;
    if (total === 0) {
      title = isToday ? "A fresh, clear day" : state.day < today ? "Nothing was planned" : "Nothing planned yet";
      sub = isToday ? "Add something you want to get done today." : "Type above to add a task for this day.";
    } else if (state.filter === "active") {
      title = "All done — nice work!";
      sub = "Every task for this day is complete.";
    } else {
      title = "Nothing completed yet";
      sub = "Check off a task and it will show up here.";
    }
    el.emptyTitle.textContent = title;
    el.emptySub.textContent = sub;
  }

  el.clearDone.hidden = doneCount === 0;
  el.listView.inert = isDetailOpen();
}

// ---------- events ----------
el.addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addTask(el.addInput.value);
  el.addInput.value = "";
});
el.addInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    el.addInput.value = "";
    el.addInput.blur();
  }
});
el.addPriority.addEventListener("click", () => {
  setAddPriority(nextPriority(state.addPriority));
  el.addInput.focus();
});
el.prev.addEventListener("click", () => setDay(addDays(state.day, -1)));
el.next.addEventListener("click", () => setDay(addDays(state.day, 1)));
el.todayBtn.addEventListener("click", () => setDay(todayKey()));
el.bannerBtn.addEventListener("click", carryOver);
el.clearDone.addEventListener("click", () => void clearCompleted());
for (const tab of el.tabs) {
  tab.addEventListener("click", () => setFilter(tab.dataset.filter as Filter));
}

document.addEventListener("keydown", (e) => {
  if (isModalOpen()) return;

  if (e.key === "Escape") {
    if (isMenuOpen()) {
      closeMenu(true);
      e.preventDefault();
    } else if (isDetailOpen()) {
      e.preventDefault();
      closeDetail();
    }
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    closeMenu();
    if (isDetailOpen()) closeDetail();
    el.addInput.focus();
    return;
  }

  // the remaining shortcuts belong to the list view
  if (isDetailOpen()) return;

  if (e.altKey && !e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    setDay(addDays(state.day, e.key === "ArrowLeft" ? -1 : 1));
    return;
  }
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "/") {
    e.preventDefault();
    el.addInput.focus();
  } else if (e.key === "t" || e.key === "T") {
    e.preventDefault();
    setDay(todayKey());
  }
});

// Flush pending writes when the window is hidden or closing.
const flushNow = () => void flushDetail();
window.addEventListener("pagehide", flushNow);
window.addEventListener("beforeunload", flushNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushNow();
});

onSaveError(() => toast("Couldn’t save — changes may be lost"));

// Handle midnight rollover: if the user was on "today", follow it.
let lastToday = todayKey();
window.setInterval(() => {
  const now = todayKey();
  if (now !== lastToday) {
    const wasOnToday = state.day === lastToday;
    lastToday = now;
    if (wasOnToday) state.day = now;
    render();
  }
}, 30_000);

// ---------- boot ----------
subscribe(render);
initDetail({
  onClosed: (taskId) => {
    // return focus to the row we came from, if it's still visible
    el.list.querySelector<HTMLElement>(`.task[data-id="${CSS.escape(taskId)}"]`)?.focus({ preventScroll: true });
  },
});
initMenu({
  onWiped: () => {
    closeDetail();
    replaceAll([]);
  },
});
setAddPriority("normal");
el.addInput.disabled = true;
render();
loadTasks()
  .then((tasks) => {
    state.tasks = tasks;
    state.ready = true;
    el.addInput.disabled = false;
    render();
  })
  .catch((err) => {
    console.error("Failed to load tasks", err);
    toast("Couldn’t load tasks");
  })
  .finally(() => el.addInput.focus());
