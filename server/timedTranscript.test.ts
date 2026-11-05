import test from "node:test";
import assert from "node:assert/strict";
import { formatCueTime, hasTimedLines, lastTimedSecond, sampleTranscript, subtitleToTimedText } from "./timedTranscript";

test("SRT cues keep their start time, numbers inside speech stay", () => {
  const srt = "1\r\n00:12:34,500 --> 00:12:37,000\r\n<i>大家好</i>\r\n今天講三件事\r\n\r\n2\r\n01:02:03,000 --> 01:02:05,000\r\n1984\r\n";
  assert.equal(subtitleToTimedText(srt), "[12:34] 大家好 今天講三件事\n[1:02:03] 1984");
});

test("VTT cues without hours are read too", () => {
  const vtt = "WEBVTT\n\nNOTE made by hand\n\n00:05.000 --> 00:07.000\n開場\n\n01:10.000 --> 01:12.000 align:start\n報名方式\n";
  assert.equal(subtitleToTimedText(vtt), "[0:05] 開場\n[1:10] 報名方式");
});

test("time helpers read the markers back", () => {
  assert.equal(formatCueTime(754), "12:34");
  assert.equal(formatCueTime(3723), "1:02:03");
  const text = "[0:05] 開場\n[1:02:03] 結尾";
  assert.equal(hasTimedLines(text), true);
  assert.equal(hasTimedLines("普通文字"), false);
  assert.equal(lastTimedSecond(text), 3723);
});

test("sampling keeps the start and the end of a long transcript", () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `[${formatCueTime(i * 6)}] 第 ${i} 句台詞內容`);
  const sampled = sampleTranscript(lines.join("\n"), 5000);
  assert.ok(sampled.length <= 5000);
  const kept = sampled.split("\n");
  assert.ok(kept.length > 100);
  assert.ok(lastTimedSecond(sampled) > 5400, "the last part of the video is still represented");
  assert.equal(sampleTranscript("短", 5000), "短");
  assert.equal(sampleTranscript("x".repeat(9000), 5000).length, 5000);
});
