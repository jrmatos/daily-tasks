/** Header settings popover: theme, data folder, wipe all data. */
import { getDataDir, isTauri, openDataDir, wipeAllData } from "./store";
import { confirmDialog, errorMessage, toast } from "./ui";
import { checkForUpdates, initUpdater } from "./updater";

type Theme = "dark" | "light";
type Style = "solid" | "glass";
type Bg = "aurora" | "sunset" | "ocean" | "forest" | "mono";
const BGS: readonly Bg[] = ["aurora", "sunset", "ocean", "forest", "mono"];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = {
  btn: $<HTMLButtonElement>("#menu-btn"),
  menu: $<HTMLDivElement>("#menu"),
  themeBtns: Array.from(document.querySelectorAll<HTMLButtonElement>("#menu [data-theme-set]")),
  styleBtns: Array.from(document.querySelectorAll<HTMLButtonElement>("#menu [data-style-set]")),
  bgBtns: Array.from(document.querySelectorAll<HTMLButtonElement>("#menu [data-bg-set]")),
  openData: $<HTMLButtonElement>("#menu-open-data"),
  dataPath: $<HTMLSpanElement>("#menu-data-path"),
  wipe: $<HTMLButtonElement>("#menu-wipe"),
};

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  for (const b of el.themeBtns) {
    const on = b.dataset.themeSet === theme;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* ignore */
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Style (solid | glass) is independent of light/dark; the pre-paint script in index.html sets it first. */
export function currentStyle(): Style {
  return document.documentElement.dataset.style === "solid" ? "solid" : "glass";
}

export function applyStyle(style: Style): void {
  document.documentElement.dataset.style = style;
  for (const b of el.styleBtns) {
    const on = b.dataset.styleSet === style;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  store("style", style);
}

export function currentBg(): Bg {
  const v = document.documentElement.dataset.bg as Bg | undefined;
  return v && BGS.includes(v) ? v : "aurora";
}

export function applyBg(bg: Bg): void {
  document.documentElement.dataset.bg = bg;
  for (const b of el.bgBtns) {
    const on = b.dataset.bgSet === bg;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  }
  store("bg", bg);
}

/** Pause the animated glass background while the window is unfocused or hidden (saves CPU). */
function watchIdle(): void {
  const root = document.documentElement;
  const update = () => {
    const idle = document.visibilityState === "hidden" || !document.hasFocus();
    root.toggleAttribute("data-idle", idle);
  };
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", update);
  update();
}

export const isMenuOpen = () => !el.menu.hidden;

export function openMenu(): void {
  el.menu.hidden = false;
  el.btn.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => el.menu.classList.add("show"));
  el.menu.querySelector<HTMLButtonElement>("button.active, button")?.focus();
}

export function closeMenu(focusButton = false): void {
  if (el.menu.hidden) return;
  el.menu.classList.remove("show");
  el.menu.hidden = true;
  el.btn.setAttribute("aria-expanded", "false");
  if (focusButton) el.btn.focus();
}

async function wipe(onWiped: () => void): Promise<void> {
  closeMenu();
  const first = await confirmDialog(
    "Delete all data?",
    "This permanently deletes every task, note and attachment on this computer.",
    "Continue",
  );
  if (!first) return;
  const second = await confirmDialog(
    "Are you absolutely sure?",
    "There is no undo. All tasks, notes and attached files will be gone for good.",
    "Delete everything",
  );
  if (!second) return;
  try {
    await wipeAllData();
    onWiped();
    toast("All data deleted");
  } catch (err) {
    toast(`Couldn’t delete data: ${errorMessage(err)}`);
  }
}

export function initMenu(opts: { onWiped: () => void }): void {
  applyTheme(currentTheme());

  el.btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMenuOpen()) closeMenu();
    else openMenu();
  });
  document.addEventListener("mousedown", (e) => {
    if (!isMenuOpen()) return;
    const target = e.target as Node;
    if (!el.menu.contains(target) && !el.btn.contains(target)) closeMenu();
  });
  el.menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    }
  });

  for (const b of el.themeBtns) {
    b.addEventListener("click", () => applyTheme(b.dataset.themeSet as Theme));
  }

  applyStyle(currentStyle());
  applyBg(currentBg());
  for (const b of el.styleBtns) {
    b.addEventListener("click", () => applyStyle(b.dataset.styleSet as Style));
  }
  for (const b of el.bgBtns) {
    b.addEventListener("click", () => applyBg(b.dataset.bgSet as Bg));
  }
  watchIdle();

  if (isTauri) {
    void getDataDir()
      .then((dir) => {
        if (dir) {
          el.dataPath.textContent = dir.replace(/^\/home\/[^/]+/, "~");
          el.dataPath.title = dir;
        }
      })
      .catch(() => {
        /* path is informational only */
      });
  } else {
    el.openData.disabled = true;
    el.dataPath.textContent = "Desktop app only (browser uses localStorage)";
  }

  el.openData.addEventListener("click", async () => {
    closeMenu();
    try {
      await openDataDir();
    } catch (err) {
      toast(errorMessage(err));
    }
  });
  el.wipe.addEventListener("click", () => void wipe(opts.onWiped));

  // "Check for updates" (hidden in a plain browser) + silent startup check
  document.querySelector<HTMLButtonElement>("#menu-update")?.addEventListener("click", () => {
    closeMenu();
    void checkForUpdates();
  });
  initUpdater();
}
