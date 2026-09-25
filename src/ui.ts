/** Small DOM/UI helpers shared across views: icons, toast, modal dialogs. */

export const icons = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" />',
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  back: '<path d="M15 6l-6 6 6 6" />',
  trash:
    '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />',
  paperclip:
    '<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />',
  notes: '<path d="M5 6h14M5 10h14M5 14h9M5 18h6" />',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  reveal:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5" />',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />',
  upload: '<path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8.5 17c1.5-1 3.5-5 3.5-7.5 0-1-1-1-1 0 0 2.5 3 6 5 6.5.8.2 1-.8 0-1-2-.4-5.5.5-7.5 2z" />',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 12h6M9 15h6M9 18h4" />',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M11 4v1M11 7v1M11 10v1M10 13h2v3h-2z" />',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 9" />',
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />',
} as const;

export type IconName = keyof typeof icons;

export function svg(name: IconName): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = icons[name];
  return s;
}

/** Tiny element builder. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; data?: Record<string, string> } = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, data, ...rest } = props;
  if (cls) node.className = cls;
  if (data) Object.assign(node.dataset, data);
  Object.assign(node, rest);
  for (const c of children) if (c) node.append(c);
  return node;
}

export function iconButton(icon: IconName, label: string, cls = "icon-btn"): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls, title: label });
  b.setAttribute("aria-label", label);
  b.append(svg(icon));
  return b;
}

export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function truncate(s: string, n = 28): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong";
}

// ---------- toast ----------
let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

export function toast(message: string, undo?: () => void): void {
  toastEl ??= document.querySelector<HTMLDivElement>("#toast");
  const t = toastEl;
  if (!t) return;
  t.replaceChildren(h("span", { textContent: message }));
  if (undo) {
    const btn = h("button", { type: "button", textContent: "Undo" });
    btn.addEventListener("click", () => {
      undo();
      hideToast();
    });
    t.append(btn);
  }
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 5000);
}

function hideToast(): void {
  const t = toastEl;
  if (!t) return;
  t.classList.remove("show");
  window.setTimeout(() => {
    if (!t.classList.contains("show")) t.hidden = true;
  }, 200);
}

// ---------- modal dialogs ----------
let openModals = 0;
export const isModalOpen = () => openModals > 0;

interface ModalOptions {
  title: string;
  message?: string;
  body?: HTMLElement;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** return false to keep the dialog open (e.g. invalid input) */
  validate?: () => boolean;
}

export function modal(opts: ModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const confirmBtn = h("button", {
      type: "submit",
      class: `btn ${opts.danger ? "btn-danger" : "btn-primary"}`,
      textContent: opts.confirmLabel ?? "OK",
    });
    const cancelBtn = h("button", { type: "button", class: "btn", textContent: opts.cancelLabel ?? "Cancel" });
    const form = h(
      "form",
      { class: "modal", method: "dialog" },
      h("h2", { class: "modal-title", textContent: opts.title }),
      opts.message ? h("p", { class: "modal-msg", textContent: opts.message }) : null,
      opts.body,
      h("div", { class: "modal-actions" }, cancelBtn, confirmBtn),
    );
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    const backdrop = h("div", { class: "modal-backdrop" }, form);

    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      openModals--;
      backdrop.classList.remove("show");
      window.setTimeout(() => backdrop.remove(), 160);
      previousFocus?.focus?.();
      resolve(result);
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (opts.validate && !opts.validate()) return;
      finish(true);
    });
    cancelBtn.addEventListener("click", () => finish(false));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) finish(false);
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Tab") {
        // keep focus inside the dialog
        const f = Array.from(form.querySelectorAll<HTMLElement>("input, button, textarea")).filter(
          (x) => !(x as HTMLButtonElement).disabled,
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    openModals++;
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("show"));
    const firstInput = form.querySelector<HTMLInputElement>("input, textarea");
    (firstInput ?? (opts.danger ? cancelBtn : confirmBtn)).focus();
  });
}

export function confirmDialog(
  title: string,
  message: string,
  confirmLabel = "Delete",
  danger = true,
): Promise<boolean> {
  return modal({ title, message, confirmLabel, danger });
}

/** Ask for a URL (+ optional title). Returns null when cancelled. */
export async function promptLink(): Promise<{ url: string; name: string } | null> {
  const urlInput = h("input", { type: "text", placeholder: "https://example.com", class: "field" });
  const nameInput = h("input", { type: "text", placeholder: "Title (optional)", class: "field" });
  const error = h("p", { class: "field-error", hidden: true });
  urlInput.setAttribute("aria-label", "URL");
  nameInput.setAttribute("aria-label", "Title");
  urlInput.addEventListener("input", () => (error.hidden = true));

  let url = "";
  const ok = await modal({
    title: "Add link",
    body: h("div", { class: "modal-fields" }, urlInput, error, nameInput),
    confirmLabel: "Add link",
    validate: () => {
      const normalized = normalizeUrl(urlInput.value);
      if (!normalized) {
        error.textContent = "Enter a valid URL";
        error.hidden = false;
        urlInput.focus();
        return false;
      }
      url = normalized;
      return true;
    },
  });
  return ok ? { url, name: nameInput.value.trim() } : null;
}

export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname.includes(".") && u.hostname !== "localhost") {
      return null;
    }
    return u.href;
  } catch {
    return null;
  }
}
