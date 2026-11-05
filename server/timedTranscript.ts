// Subtitle files keep their timing as a "[m:ss] text" prefix on each cue, so
// the AI can place interactions at the moment the speaker says something.

const TIMING_LINE = /^\s*.*?(\d{1,2}:)?(\d{1,2}):(\d{2})[.,]\d{3}\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}.*$/;
const TIMED_LINE = /^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]/;

export function formatCueTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Cues starting within this many seconds share one "[m:ss]" line. */
export const SUBTITLE_BLOCK_SECONDS = 30;

/**
 * Turns SRT/VTT text into "[m:ss] words" lines, one per ~30 seconds of
 * speech: precise enough to place interactions, with little overhead.
 */
export function subtitleToTimedText(raw: string): string {
  const lines = raw
    .replace(/^﻿/, "")
    .replace(/^WEBVTT.*$/gim, "")
    .replace(/^NOTE(?:[ \t].*)?(?:\r?\n(?!\r?\n)[\s\S]*?)?(?=\r?\n\r?\n|$)/gim, "")
    .replace(/\r/g, "")
    .split("\n");
  const out: string[] = [];
  let start: number | null = null;
  let words: string[] = [];
  const flush = () => {
    const text = words.join(" ").trim();
    if (text) out.push(start === null ? text : `[${formatCueTime(start)}] ${text}`);
    words = [];
  };
  lines.forEach((line, index) => {
    const timing = line.match(TIMING_LINE);
    if (timing) {
      const cueStart = Number(timing[1] ? timing[1].slice(0, -1) : 0) * 3600 + Number(timing[2]) * 60 + Number(timing[3]);
      if (start === null || cueStart - start >= SUBTITLE_BLOCK_SECONDS || cueStart < start) {
        flush();
        start = cueStart;
      }
      return;
    }
    // SRT sequence numbers are metadata only when directly followed by a
    // timestamp. A spoken standalone number such as "1984" is retained.
    if (/^\s*\d+\s*$/.test(line) && TIMING_LINE.test(lines[index + 1] ?? "")) return;
    const text = line.replace(/<[^>]+>/g, "").trim();
    if (text) words.push(text);
  });
  flush();
  return out.join("\n");
}

export function hasTimedLines(text: string): boolean {
  return text.split("\n").some((line) => TIMED_LINE.test(line));
}

/** Seconds of the last "[m:ss]" marker, or 0 when there is none. */
export function lastTimedSecond(text: string): number {
  let last = 0;
  for (const line of text.split("\n")) {
    const match = line.match(TIMED_LINE);
    if (match) last = Math.max(last, Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  }
  return last;
}

/**
 * Shortens a transcript to at most `maxChars` by keeping lines evenly spread
 * from start to end, so the closing (sales) part is not cut off.
 */
export function sampleTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const ratio = maxChars / text.length;
  const kept: string[] = [];
  let credit = 0;
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    credit += cost * ratio;
    if (credit >= cost && used + cost <= maxChars) {
      kept.push(line);
      credit -= cost;
      used += cost;
    }
  }
  // Text with very long lines (e.g. one pasted paragraph) cannot be spread out.
  return kept.length ? kept.join("\n") : text.slice(0, maxChars);
}

/**
 * Splits text into pieces of at most `maxChars`, cutting only between lines
 * (or, for a single huge line, at the limit) so nothing is dropped.
 */
export function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > maxChars) {
      if (current) { parts.push(current); current = ""; }
      parts.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    const next = current ? `${current}\n${rest}` : rest;
    if (next.length > maxChars) {
      parts.push(current);
      current = rest;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}
