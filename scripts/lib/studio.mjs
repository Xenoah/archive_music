// Keep the original audition / ZIP preparation screen compatible with OTODANA media.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { DIST_DIR, SITE_DIR } from './constants.mjs';
export async function writeStudio(tracks, analyses, config) {
  const dir = path.join(DIST_DIR, 'studio');
  await mkdir(path.join(dir, 'analysis'), { recursive: true });
  const rel = value => value ? `../${value}` : null;
  const catalog = [];
  for (const track of tracks) {
    const analysis = analyses.get(track.slug);
    const analysisFile = `analysis/${encodeURIComponent(track.slug)}.json`;
    if (analysis) {
      const { wave, hash, mini, ...plain } = analysis;
      for (const band of ['low','mid','high','peak']) plain[band] = Array.from(Buffer.from(wave[band], 'base64'), v => Number((v / 255 * wave.scale).toFixed(5)));
      plain.bucketSize = analysis.sampleRate * analysis.duration / wave.n;
      await writeFile(path.join(dir, 'analysis', `${track.slug}.json`), JSON.stringify(plain));
    }
    catalog.push({ ...track, description: track.summary, audio: rel(track.audio), cover: rel(track.cover) || '../favicon.svg',
      original: rel(track.download), analysis: analysis ? analysisFile : null, createdAt: track.date,
      bpmSource: track.bpmSource === 'manual' ? 'manual' : 'estimated',
      sampleRate: analysis?.sampleRate, channels: analysis?.channels, bytes: track.audioBytes,
      peaks: (track.mini || []).map(v => (v / 100) ** (1 / .6)) });
  }
  await writeFile(path.join(dir, 'catalog.json'), JSON.stringify({ repository: config.repository || 'Xenoah/archive_music', tracks: catalog }));
  await copyFile(path.join(SITE_DIR, 'src', 'LICENSE.dt-cue.txt'), path.join(dir, 'DTCUE-LICENSE.txt'));
}
