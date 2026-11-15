import test from "node:test";
import assert from "node:assert/strict";
import { analyzePCM } from "../site/src/analysis-core.js";
import { packAnalysis, unpackBand } from "../scripts/lib/analysis.mjs";
import { decodeWav } from "../scripts/lib/audio.mjs";
import { parseFrontMatter, stringifyFrontMatter } from "../scripts/lib/frontmatter.mjs";
import { renderAutoCover } from "../scripts/lib/png.mjs";
import { renderMarkdown, slugify } from "../scripts/lib/util.mjs";

// 16bit ステレオ WAV のクリックトラック
function clickWav(bpm, seconds, rate = 22050) {
  const frames = rate * seconds, buffer = Buffer.alloc(44 + frames * 4), period = 60 / bpm;
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + frames * 4, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const phase = (i / rate) % period;
    const sample = Math.round(Math.sin(2 * Math.PI * 60 * phase) * Math.exp(-phase * 30) * 0.8 * 32767);
    buffer.writeInt16LE(sample, 44 + i * 4); buffer.writeInt16LE(sample, 46 + i * 4);
  }
  return buffer;
}

test("front matter round-trips strings, numbers, booleans and both list styles", () => {
  const source = '---\ntitle: "A: B"\nbpm: 128.5\ndownload: true\ntags: [house, "deep cut"]\nlinks:\n  - one\n  - two\nalbum:\n---\n\nBody **text**\n';
  const { data, body } = parseFrontMatter(source);
  assert.deepEqual(data, { title: "A: B", bpm: 128.5, download: true, tags: ["house", "deep cut"], links: ["one", "two"], album: "" });
  assert.equal(body, "Body **text**");
  assert.deepEqual(parseFrontMatter(stringifyFrontMatter(data, body)).data, data);
});

test("slugs keep unicode and replace unsafe characters", () => {
  assert.equal(slugify("My Song (final) v2"), "My-Song-final-v2");
  assert.equal(slugify("夜の 回路"), "夜の-回路");
  assert.equal(slugify("???"), "track");
});

test("markdown escapes HTML and only links http(s)", () => {
  const html = renderMarkdown("<script>x</script> [ok](https://example.com) [bad](javascript:alert(1))\n\n- a\n- b");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('<a href="https://example.com"'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes("<ul><li>a</li><li>b</li></ul>"));
});

test("WAV decode → dt-cue analysis → packed data keeps tempo and waveform", () => {
  const pcm = decodeWav(clickWav(120, 20));
  assert.equal(pcm.channels.length, 2);
  assert.equal(pcm.sampleRate, 22050);
  const packed = packAnalysis(analyzePCM(pcm.channels, pcm.sampleRate), { hash: "x" });
  assert.ok(Math.abs(packed.bpm - 120) < 1, `bpm ${packed.bpm}`);
  assert.equal(packed.engines.length, 3);
  assert.ok(Math.abs(packed.duration - 20) < 0.01);
  for (const key of ["low", "mid", "high", "peak"]) assert.equal(unpackBand(packed.wave[key]).length, packed.wave.n);
  assert.ok(Math.max(...unpackBand(packed.wave.peak)) >= 250);
  assert.ok(packed.mini.length > 0 && packed.mini.every((v) => v >= 0 && v <= 100));
  const png = renderAutoCover(packed, "demo", 64);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
