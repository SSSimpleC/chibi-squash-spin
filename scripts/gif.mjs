import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { assert, frameName, readRGBA } from './core.mjs';

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let err = '';
    child.stdout.resume(); child.stderr.on('data', b => { err = (err + b).slice(-12000); });
    child.on('error', e => reject(new Error(`${command}: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${err}`)));
  });
}

export async function encodeGIF(dir, output, count, delayCs) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-framerate', `${100}/${delayCs}`, '-start_number', '0', '-i', path.join(dir, 'frame-%04d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:alpha_threshold=128', '-frames:v', String(count), '-loop', '0', '-gifflags', '0', output]);
}

export async function inspectGIF(file, dir, size, count, delayCs) {
  const meta = await sharp(file, { animated: true }).metadata();
  assert(meta.width === size && meta.pageHeight === size, `GIF dimensions do not match ${size}`);
  assert(meta.pages === count, `GIF frame count ${meta.pages} != ${count}`);
  assert(meta.loop === 0, 'GIF does not loop infinitely');
  assert(meta.delay?.length === count && meta.delay.every(d => d === delayCs * 10), 'GIF frame timing differs from requested timing');
  const { data, info } = await sharp(file, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert(info.channels === 4, 'GIF must decode to RGBA');
  let maskMismatch = 0, transparentPixels = 0;
  for (let i = 0; i < count; i++) {
    const expected = await readRGBA(path.join(dir, frameName(i)));
    for (let p = 0; p < size * size; p++) {
      const a = data[(i * size * size + p) * 4 + 3], on = expected.data[p * 4 + 3] >= 128;
      if ((a > 0) !== on) maskMismatch++; if (a === 0) transparentPixels++;
    }
  }
  assert(transparentPixels > 0, 'GIF has no transparent pixels');
  assert(maskMismatch === 0, `GIF transparency differs from source masks at ${maskMismatch} pixels; possible disposal/ghosting issue`);
  const bytes = await fs.readFile(file);
  return { file: path.basename(file), size, frames: count, durationSeconds: meta.delay.reduce((a, b) => a + b, 0) / 1000, loop: meta.loop, maskMismatch, globalPalette: Boolean(bytes[10] & 0x80), bytes: bytes.length };
}
