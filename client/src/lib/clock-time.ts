/**
 * Parses a video time typed by a host: "m:ss" (minutes may exceed 59),
 * "h:mm:ss", or a whole number of minutes. Returns seconds, or null when the
 * text is not one of those forms (for example "5分" or "1:75").
 */
export function parseClock(text: string): number | null {
  const value = text.trim();
  if (/^\d+$/.test(value)) return Number(value) * 60;
  const parts = value.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (!parts) return null;
  if (parts[3] !== undefined) {
    return Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
  }
  return Number(parts[1]) * 60 + Number(parts[2]);
}

export const CLOCK_FORMAT_HINT = "請用「分:秒」格式，例如 5:30 或 1:05:30";
