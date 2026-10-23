import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { STANDARD } from './standard.mjs';

const execFileAsync = promisify(execFile);

export const assert = (ok, message) => { if (!ok) throw new Error(message); };
export const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const saveJSON = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
export const frameName = i => `frame-${String(i).padStart(4, '0')}.png`;
export const hash = data => createHash('sha256').update(data).digest('hex');
export const newDirectory = dir => fs.mkdir(dir, { recursive: false });
export const REVIEW_CHECKS = ['twoHeadChibi', 'shortTuckedFeet', 'armsAtSides', 'referenceExpression', 'stableIdentityAndCostume', 'neutralHeightBeforeSquash', 'everyFrameAdvances', 'headBodyTurnTogether', 'nearUniformSteps', 'frontSideBackCoverage', 'seamContinuous', 'pixelArtStyle'];

export function bounds(data, width, height, threshold = 0) {
  let x0 = width, x1 = -1, y0 = height, y1 = -1, area = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = data[(y * width + x) * 4 + 3]; area += a / 255;
    if (a > threshold) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  assert(x1 >= x0 && y1 >= y0, 'Empty transparent frame');
  return { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, area };
}
export async function readRGBA(file) {
  const { data, info } = await sharp(file).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
export function binaryAlpha(data) {
  const out = Buffer.from(data);
  for (let p = 0; p < out.length; p += 4) {
    if (out[p + 3] < 128) out.fill(0, p, p + 4); else out[p + 3] = 255;
  }
  return out;
}
export function nearestTransform(data, width, height, size, ax, ay, sx, sy, destX, destY) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xx = Math.floor((x + .5 - destX) / sx + ax), yy = Math.floor((y + .5 - destY) / sy + ay);
    if (xx >= 0 && yy >= 0 && xx < width && yy < height) data.copy(out, (y * size + x) * 4, (yy * width + xx) * 4, (yy * width + xx + 1) * 4);
  }
  return out;
}
export function difference(a, b) {
  assert(a.length === b.length, 'Difference needs equal canvases'); let sum = 0;
  for (let p = 0; p < a.length; p += 4) {
    for (let c = 0; c < 3; c++) sum += Math.abs(a[p + c] * a[p + 3] / 255 - b[p + c] * b[p + 3] / 255);
    sum += Math.abs(a[p + 3] - b[p + 3]);
  }
  return sum / a.length;
}
export const writePNG = (file, data, size) => sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toFile(file);

export async function sharedPalette(frames, size, colours) {
  // Sharp's PNG colour option rounds up to a legal bit depth (48 can become
  // 256 entries). Quantise the complete stack once with an explicit limit.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chibi-palette-'));
  try {
    const input = path.join(dir, 'stack.png'), output = path.join(dir, 'quantised.png');
    await sharp(Buffer.concat(frames), { raw: { width: size, height: size * frames.length, channels: 4 } }).png().toFile(input);
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-i', input, '-filter_complex', `[0:v]split[a][b];[a]palettegen=max_colors=${colours}:reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=none:alpha_threshold=128`, '-frames:v', '1', output]);
    const { data: raw } = await readRGBA(output);
    const result = frames.map((_, i) => binaryAlpha(raw.subarray(i * size * size * 4, (i + 1) * size * size * 4)));
    assert(paletteCount(result) <= colours, 'Shared palette quantisation exceeded its colour limit');
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
export function paletteCount(frames) {
  const colours = new Set();
  for (const frame of frames) for (let p = 0; p < frame.length; p += 4) if (frame[p + 3]) colours.add(frame.readUInt32BE(p));
  return colours.size;
}
export function sequenceDiagnostics(frames) {
  const hashes = frames.map(hash), duplicates = [];
  for (let i = 0; i < hashes.length; i++) { const earlier = hashes.indexOf(hashes[i]); if (earlier < i) duplicates.push({ earlier, repeated: i }); }
  const differences = frames.map((f, i) => difference(f, frames[(i + 1) % frames.length]));
  const sorted = [...differences].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  const flags = differences.flatMap((d, i) => d < .03 || d > Math.max(.15, median * 2.5) ? [{ from: i, to: (i + 1) % frames.length, difference: d, reason: d < .03 ? 'near-hold' : 'large-step' }] : []);
  return { hashes, digest: hash(hashes.join('\n')), duplicates, differences, flags, note: 'Image difference detects suspect intervals, not actual yaw angle or identity consistency; visual rotation review is required.' };
}

export async function loadConfig(file) {
  const c = await json(file), base = path.dirname(path.resolve(file));
  c.profile ??= STANDARD.id;
  c.style ??= 'pixel'; c.sizes ??= [STANDARD.size]; c.margin ??= STANDARD.margin; c.squashMin ??= STANDARD.squashMin; c.bounces ??= STANDARD.bounces; c.paletteColours ??= STANDARD.paletteColours;
  assert(c.style === 'pixel', 'v2 is a pixel-art direct-sequence workflow; do not reuse the v1 morph pipeline');
  assert(!c.transitions?.length, 'v2 does not accept morph transitions: generate a complete neutral rotation sequence');
  assert(Array.isArray(c.sizes) && c.sizes.length > 0 && c.sizes.every(s => Number.isInteger(s) && s >= 32 && s <= 512), 'sizes: integer 32..512; default [144]');
  c.sizes = [...new Set(c.sizes)].sort((a,b) => a-b); c.masterSize = Math.max(...c.sizes);
  assert(Array.isArray(c.keyframes) && c.keyframes.length >= 24 && c.keyframes.length <= 96, 'Provide 24..96 directly drawn neutral rotation frames; a few directions cannot be repeated into an animation');
  assert(c.frames === undefined || c.frames === c.keyframes.length, 'Output frame count must equal source rotation frame count; no repeated directions or interpolated holds');
  c.frames = c.keyframes.length;
  c.durationSeconds ??= c.frames * .08; c.delayCs = Math.round(c.durationSeconds * 100 / c.frames);
  assert(Number.isFinite(c.durationSeconds) && c.delayCs >= 2 && Math.abs(c.delayCs * c.frames / 100 - c.durationSeconds) < 1e-6, 'Use an exact GIF delay of at least 20ms per frame; omit durationSeconds for 80ms/frame');
  assert(Number.isFinite(c.margin) && c.margin >= .02 && c.margin <= .2, 'margin: .02.. .2');
  assert(Number.isFinite(c.squashMin) && c.squashMin >= .5 && c.squashMin <= 1, 'squashMin: .5..1');
  assert(Number.isInteger(c.bounces) && c.bounces >= 0 && c.bounces <= 8, 'bounces: integer 0..8');
  assert(Number.isInteger(c.paletteColours) && c.paletteColours >= 8 && c.paletteColours <= 128, 'paletteColours: integer 8..128');
  assert([STANDARD.id,'custom'].includes(c.profile), 'Unknown production profile');
  if(c.profile===STANDARD.id){
    assert(c.frames===STANDARD.frames && c.sizes.length===1 && c.sizes[0]===STANDARD.size && c.delayCs===STANDARD.delayCs && c.bounces===STANDARD.bounces && Math.abs(c.squashMin-STANDARD.squashMin)<1e-9 && c.margin===STANDARD.margin && c.paletteColours===STANDARD.paletteColours,
      'pixel-144-24-v1 fixes 144px, 24 frames, 80ms, 2 bounces, squash 2/3, margin .045 and 48 colours; a user-requested specification change needs profile custom and specChangeReason');
  } else assert(typeof c.specChangeReason==='string' && c.specChangeReason.trim().length>=8,'Custom specification requires specChangeReason describing the user-requested change, not a way to hide failed rotation');
  c.keyframes.sort((a,b) => a.angle-b.angle);
  for (let i = 0; i < c.frames; i++) {
    const k = c.keyframes[i];
    assert(Number.isFinite(k.angle) && Math.abs(k.angle - i * 360 / c.frames) < .001, 'Source angles must cover 0..360 uniformly, excluding duplicate 360; angle labels still require visual verification');
    assert(typeof k.file === 'string', 'Each source frame needs file'); k.file = path.resolve(base, k.file);
    assert(Array.isArray(k.anchor) && k.anchor.length === 2 && k.anchor.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'anchor: normalized [head/torso axis x, seated contact y] in the crop');
    if (k.crop) assert(['left','top','width','height'].every(n => Number.isInteger(k.crop[n]) && k.crop[n] >= (['width','height'].includes(n) ? 1 : 0)), 'Invalid pixel crop');
  }
  return c;
}
