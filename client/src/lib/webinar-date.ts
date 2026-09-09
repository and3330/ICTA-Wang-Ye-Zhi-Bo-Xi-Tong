function zonedParts(value: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function dateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function applyDatePreservingTime(
  currentInstant: string | Date,
  newDate: string,
  timeZone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) throw new Error("Invalid event date");
  const current = new Date(currentInstant);
  if (dateKeyInTimeZone(current, timeZone) === newDate) return current.toISOString();

  const [year, month, day] = newDate.split("-").map(Number);
  const time = zonedParts(current, timeZone);
  const targetAsUtc = Date.UTC(year, month - 1, day, time.hour, time.minute, time.second);
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const represented = zonedParts(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    const correction = targetAsUtc - representedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate).toISOString();
}