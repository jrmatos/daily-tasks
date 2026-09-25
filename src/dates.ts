/** Local-time date helpers. Keys are "YYYY-MM-DD" in the user's local timezone. */

const pad = (n: number) => String(n).padStart(2, "0");

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(key: string, days: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

export function isValidKey(key: unknown): key is string {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/** "Today" / "Tomorrow" / "Yesterday" / "Thu, Sep 25" (year appended if not current). */
export function dayLabel(key: string): string {
  const today = todayKey();
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  const d = fromKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Full descriptive date, e.g. "Thursday, September 25, 2026". */
export function longDate(key: string): string {
  return fromKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
