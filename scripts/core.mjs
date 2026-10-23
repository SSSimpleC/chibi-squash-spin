import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const assert = (ok, message) => { if (!ok) throw new Error(message); };
export const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const saveJSON = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
export const frameName = i => `frame-${String(i).padStart(4, '0')}.png`;

export async function newDirectory(dir) {
  // Refuse overwriting an existing deliverable, including an empty directory.
  await fs.mkdir(dir, { recursive: false });
}

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
  assert(info.channels === 4, 'Expected RGBA input');
  return { data, width: info.width, height: info.height };
}

export function sample(data, width, height, x, y, out) {
  out.fill(0);
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const xx = x0 + dx, yy = y0 + dy;
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty), p = (yy * width + xx) * 4, a = data[p + 3] / 255;
    out[3] += a * w;
    for (let c = 0; c < 3; c++) out[c] += data[p + c] * a * w;
  }
  return out;
}

export function transform(data, width, height, size, ax, ay, sx, sy, destX, destY) {
  const out = Buffer.alloc(size * size * 4), v = new Float64Array(4);
  // Pixel-centre mapping around one fixed, continuous-coordinate anchor.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    sample(data, width, height, (x + .5 - destX) / sx + ax - .5, (y + .5 - destY) / sy + ay - .5, v);
    const p = (y * size + x) * 4; out[p + 3] = Math.round(v[3] * 255);
    if (v[3] > 0) for (let c = 0; c < 3; c++) out[p + c] = Math.round(v[c] / v[3]);
  }
  return out;
}

export function difference(a, b) {
  assert(a.length === b.length, 'Difference requires matching dimensions');
  let sum = 0;
  for (let p = 0; p < a.length; p += 4) {
    for (let c = 0; c < 3; c++) sum += Math.abs(a[p + c] * a[p + 3] / 255 - b[p + c] * b[p + 3] / 255);
    sum += Math.abs(a[p + 3] - b[p + 3]);
  }
  return sum / a.length;
}

export async function writePNG(file, data, size) {
  await sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toFile(file);
}

export async function loadConfig(file) {
  const c = await json(file), base = path.dirname(path.resolve(file));
  c.sizes ??= [256, 512]; c.frames ??= 60; c.durationSeconds ??= 2.4;
  c.margin ??= .05; c.squashMin ??= 2 / 3; c.bounces ??= 2;
  assert(Array.isArray(c.sizes) && c.sizes.length > 0 && c.sizes.every(x => Number.isInteger(x) && x >= 16 && x <= 2048), 'sizes: integer pixels, 16..2048');
  c.sizes = [...new Set(c.sizes)].sort((a, b) => a - b); c.masterSize = Math.max(...c.sizes);
  assert(Number.isInteger(c.frames) && c.frames >= 4 && c.frames <= 240, 'frames: integer 4..240');
  assert(Number.isFinite(c.durationSeconds) && c.durationSeconds > 0, 'durationSeconds must be positive');
  c.delayCs = Math.round(c.durationSeconds * 100 / c.frames);
  assert(c.delayCs >= 2 && Math.abs(c.delayCs * c.frames / 100 - c.durationSeconds) < 1e-6, 'GIF timing must be an exact multiple of 10 ms per frame, at least 20 ms');
  assert(Number.isFinite(c.margin) && c.margin >= .02 && c.margin <= .2, 'margin: .02.. .2');
  assert(Number.isFinite(c.squashMin) && c.squashMin >= .4 && c.squashMin <= 1, 'squashMin: .4..1');
  assert(Number.isInteger(c.bounces) && c.bounces >= 0 && c.bounces <= 8, 'bounces: integer 0..8');
  assert(Array.isArray(c.keyframes) && c.keyframes.length >= 2, 'Provide at least two inspected keyframes');
  const seen = new Set();
  for (const k of c.keyframes) {
    assert(Number.isFinite(k.angle) && k.angle >= 0 && k.angle < 360 && !seen.has(k.angle), 'Angles must be unique, 0 <= angle < 360 (do not duplicate 360)');
    seen.add(k.angle); assert(typeof k.file === 'string', 'Each keyframe needs a file');
    k.file = path.resolve(base, k.file);
    assert(Array.isArray(k.anchor) && k.anchor.length === 2 && k.anchor.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'anchor is normalized [axisX, seatedBaselineY] within the cropped image');
    if (k.crop) assert(['left', 'top', 'width', 'height'].every(n => Number.isInteger(k.crop[n]) && k.crop[n] >= (['width', 'height'].includes(n) ? 1 : 0)), 'crop must use nonnegative pixel origin and positive integer dimensions');
  }
  c.keyframes.sort((a, b) => a.angle - b.angle);
  assert(c.keyframes[0].angle === 0, 'Include an angle-0 front pose');
  c.transitions ??= [];
  return c;
}

export function interval(keys, angle) {
  let i = keys.length - 1;
  for (let j = 0; j < keys.length - 1; j++) if (angle >= keys[j].angle && angle < keys[j + 1].angle) { i = j; break; }
  const j = (i + 1) % keys.length, end = j === 0 ? 360 : keys[j].angle;
  return { i, j, t: (angle - keys[i].angle) / (end - keys[i].angle) };
}
