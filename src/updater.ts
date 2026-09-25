/**
 * In-app updates from GitHub Releases via the official Tauri updater plugin.
 *
 * - Silent check ~5s after launch; if a newer version exists, a small "Update available" pill appears.
 * - The pill or "⋮ → Check for updates" opens a dialog with release notes and "Update & restart".
 * - Tauri desktop only: in a plain browser everything here is a no-op and the menu item stays hidden.
 */
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "./store";
import { errorMessage, formatBytes, h, modal, toast } from "./ui";

const STARTUP_DELAY_MS = 5000;

let currentVersion = "";
let pending: Update | null = null;
let checking = false;
let dialogOpen = false;
let pill: HTMLButtonElement | null = null;

const menuItem = () => document.querySelector<HTMLButtonElement>("#menu-update");
const versionLabel = () => document.querySelector<HTMLElement>("#menu-version");

/** Turn plugin errors into something a person can act on. */
function friendlyError(err: unknown): string {
  const msg = errorMessage(err);
  if (/valid release JSON/i.test(msg)) return "No releases published yet";
  if (/error sending request|dns|connect|timed out|network|offline/i.test(msg)) {
    return "Couldn’t reach GitHub. Check your internet connection.";
  }
  if (/platform .* was not found/i.test(msg)) return "No update is published for this platform yet";
  return `Update check failed: ${msg}`;
}

function renderVersion(): void {
  const label = versionLabel();
  if (!label || !currentVersion) return;
  label.textContent = pending ? `v${currentVersion} · v${pending.version} available` : `Version ${currentVersion}`;
}

function showPill(update: Update): void {
  if (!pill) {
    pill = h("button", { type: "button", class: "update-pill" });
    pill.addEventListener("click", () => void openUpdateDialog());
    const host = document.querySelector(".footer") ?? document.body;
    host.prepend(pill);
  }
  pill.textContent = `Update available v${update.version}`;
  pill.title = "Click to see what’s new and update";
  pill.hidden = false;
}

async function runCheck(): Promise<Update | null> {
  const update = await check();
  pending = update;
  renderVersion();
  if (update) showPill(update);
  else if (pill) pill.hidden = true;
  return update;
}

/** Manual check (menu item): always gives feedback. */
export async function checkForUpdates(): Promise<void> {
  if (!isTauri || checking) return;
  if (pending) return openUpdateDialog();
  checking = true;
  const item = menuItem();
  if (item) item.disabled = true;
  toast("Checking for updates…");
  try {
    const update = await runCheck();
    if (update) await openUpdateDialog();
    else toast(`You’re up to date (v${currentVersion || (await getVersion())})`);
  } catch (err) {
    console.warn("Update check failed", err);
    toast(friendlyError(err));
  } finally {
    checking = false;
    if (item) item.disabled = false;
  }
}

async function openUpdateDialog(): Promise<void> {
  const update = pending;
  if (!update || dialogOpen) return;
  dialogOpen = true;

  const notes = (update.body ?? "").trim();
  const status = h("p", { class: "update-status", hidden: true });
  const bar = h("progress", { class: "update-progress", max: 1, value: 0, hidden: true });
  const body = h(
    "div",
    { class: "update-body" },
    h("p", {
      class: "modal-msg",
      textContent: `Version ${update.version} is available (you have ${update.currentVersion}).`,
    }),
    notes
      ? h("div", { class: "update-notes", textContent: notes })
      : h("p", { class: "update-notes-empty", textContent: "No release notes." }),
    bar,
    status,
  );

  let installing = false;
  let failed = false;
  const install = async () => {
    installing = true;
    const buttons = Array.from(body.closest("form")?.querySelectorAll<HTMLButtonElement>(".modal-actions button") ?? []);
    for (const b of buttons) b.disabled = true;
    bar.hidden = false;
    status.hidden = false;
    status.textContent = "Downloading…";
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          if (!total) bar.removeAttribute("value"); // indeterminate
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total) {
            bar.value = Math.min(received / total, 1);
            status.textContent = `Downloading… ${formatBytes(received)} of ${formatBytes(total)}`;
          } else {
            status.textContent = `Downloading… ${formatBytes(received)}`;
          }
        } else if (event.event === "Finished") {
          bar.value = 1;
          status.textContent = "Installing…";
        }
      });
      status.textContent = "Restarting…";
      await relaunch();
    } catch (err) {
      console.error("Update failed", err);
      failed = true;
      installing = false;
      bar.hidden = true;
      status.textContent = `Update failed: ${errorMessage(err)}`;
      status.classList.add("error");
      for (const b of buttons) b.disabled = false;
    }
  };

  await modal({
    title: "Update available",
    body,
    confirmLabel: "Update & restart",
    cancelLabel: "Later",
    // keep the dialog open while downloading; relaunch() replaces the process when done
    validate: () => {
      if (!installing) void install();
      return false;
    },
  });
  dialogOpen = false;
  if (installing) toast("Finishing the update, the app will restart shortly…");
  else if (failed) toast("Update failed. You can retry from ⋮ → Check for updates.");
}

/** Called once at startup (from the menu setup). */
export function initUpdater(): void {
  const item = menuItem();
  if (!isTauri) {
    if (item) item.hidden = true;
    return;
  }
  if (item) item.hidden = false;
  void getVersion()
    .then((v) => {
      currentVersion = v;
      renderVersion();
    })
    .catch(() => {
      /* informational only */
    });
  window.setTimeout(() => {
    runCheck().catch((err) => console.info("Silent update check:", friendlyError(err)));
  }, STARTUP_DELAY_MS);
}
