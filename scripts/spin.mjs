#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { assert, json, saveJSON, newDirectory, frameName, bounds, readRGBA, transform, difference, writePNG, loadConfig, interval } from './core.mjs';
import { morph, signedDistance, validatePoints } from './morph.mjs';
import { encodeGIF, inspectGIF } from './gif.mjs';

export async function contactSheet(files, out, size = 128) {
  const cols = Math.min(6, files.length), cellH = size + 22, rows = Math.ceil(files.length / cols), items = [];
  for (let i = 0; i < files.length; i++) {
    const tile = await sharp(files[i]).resize(size, size).png().toBuffer();
    items.push({ input: tile, left: (i % cols) * size, top: Math.floor(i / cols) * cellH });
    const label = Buffer.from(`<svg width="${size}" height="22"><text x="8" y="16" fill="#eee" font-size="13" font-family="sans-serif">${i}</text></svg>`);
    items.push({ input: label, left: (i % cols) * size, top: Math.floor(i / cols) * cellH + size });
  }
  await sharp({ create: { width: cols * size, height: rows * cellH, channels: 4, background: '#353740' } }).composite(items).png().toFile(out);
}

export async function prepare(configFile, out) {
  const c = await loadConfig(configFile), size = c.masterSize, source = [];
  let maxX = 0, maxUp = 0, maxDown = 0;
  for (const k of c.keyframes) {
    let image = sharp(k.file); if (k.crop) image = image.extract(k.crop);
    const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = bounds(data, info.width, info.height), ax = k.anchor[0] * info.width, ay = k.anchor[1] * info.height;
    assert(Math.abs(ay - b.y1 - 1) <= Math.max(3, b.height * .04), `Baseline for angle ${k.angle} is not near the seated bottom; inspect anchor`);
    maxX = Math.max(maxX, Math.abs(b.x0 - ax) / b.height, Math.abs(b.x1 + 1 - ax) / b.height);
    maxUp = Math.max(maxUp, (ay - b.y0) / b.height); maxDown = Math.max(maxDown, (b.y1 + 1 - ay) / b.height);
    source.push({ ...k, data, width: info.width, height: info.height, b, ax, ay });
  }
  // Downsampling needs a few pixels of room for the reconstruction filter.
  const effectiveMargin = Math.max(c.margin, 4 / Math.min(...c.sizes));
  const baseY = size * (1 - effectiveMargin), axisX = size / 2;
  const targetHeight = Math.min(size * (.5 - effectiveMargin) * c.squashMin / maxX, size * (1 - 2 * effectiveMargin) / maxUp, maxDown > 0 ? size * effectiveMargin / maxDown : Infinity);
  assert(Number.isFinite(targetHeight) && targetHeight > 0, 'Invalid character geometry');
  for (const s of source) assert(c.allowUpscale === true || targetHeight <= s.b.height * 1.001, `Angle ${s.angle} needs upscaling (${s.b.height}px source, ${targetHeight.toFixed(1)}px target). Generate larger source art or explicitly set allowUpscale for a diagnostic only.`);
  await newDirectory(out); await fs.mkdir(path.join(out, 'poses'));
  const keys = [];
  for (let i = 0; i < source.length; i++) {
    const s = source[i], scale = targetHeight / s.b.height, data = transform(s.data, s.width, s.height, size, s.ax, s.ay, scale, scale, axisX, baseY);
    const file = `poses/pose-${String(i).padStart(3, '0')}.png`; await writePNG(path.join(out, file), data, size);
    keys.push({ angle: s.angle, file, source: s.file, sourceSize: [s.width, s.height], scale, sourceAnchor: s.anchor, sourceCrop: s.crop ?? null });
  }
  const manifest = { version: 1, ...c, keyframes: keys, effectiveMargin, axisX, baselineY: baseY, targetHeight, note: 'Landmarks must be measured on these canonical poses, not on the original sheet. Normalize coordinates by masterSize.' };
  await saveJSON(path.join(out, 'manifest.json'), manifest);
  await contactSheet(keys.map(k => path.join(out, k.file)), path.join(out, 'keyframes-contact.png'));
  return manifest;
}

function resolveTransitions(c, override) {
  const transitions = override ?? c.transitions, map = new Map();
  assert(Array.isArray(transitions), 'Transitions must be an array');
  for (const tr of transitions) {
    validatePoints(tr.fromPoints, tr.toPoints);
    const key = `${tr.fromAngle}:${tr.toAngle}`; assert(!map.has(key), `Duplicate transition ${key}`); map.set(key, tr);
  }
  // Fail before writing output; never silently hold/repeat poses or raw-crossfade missing transitions.
  for (let n = 0; n < c.frames; n++) {
    const { i, j, t } = interval(c.keyframes, n * 360 / c.frames);
    if (t > 1e-10) assert(map.has(`${c.keyframes[i].angle}:${c.keyframes[j].angle}`), `Missing landmarks for ${c.keyframes[i].angle} -> ${c.keyframes[j].angle}. Add registered point pairs or directly drawn intermediate poses, including the wraparound interval.`);
  }
  return map;
}

export async function render(prepared, out, transitionFile) {
  const c = await json(path.join(prepared, 'manifest.json')), size = c.masterSize;
  assert(c.version === 1, 'Unsupported manifest version');
  const trOverride = transitionFile ? await json(transitionFile) : undefined, transitions = resolveTransitions(c, trOverride);
  const keys = [];
  for (const k of c.keyframes) {
    const p = await readRGBA(path.resolve(prepared, k.file)); assert(p.width === size && p.height === size, 'Canonical pose size mismatch');
    keys.push({ ...k, data: p.data, sdf: signedDistance(p.data, size) });
  }
  await newDirectory(out); await fs.mkdir(path.join(out, 'pose-only'));
  for (const s of c.sizes) await fs.mkdir(path.join(out, `frames-${s}`));
  const poseDiff = [], animatedDiff = [], records = []; let firstPose, prevPose, firstFrame, prevFrame;
  for (let n = 0; n < c.frames; n++) {
    const angle = n * 360 / c.frames, { i, j, t } = interval(keys, angle), a = keys[i], b = keys[j];
    const tr = transitions.get(`${a.angle}:${b.angle}`);
    const pose = t <= 1e-10 ? Buffer.from(a.data) : morph(a.data, b.data, size, tr.fromPoints, tr.toPoints, t, a.sdf, b.sdf);
    const sy = (1 + c.squashMin) / 2 + (1 - c.squashMin) / 2 * Math.cos(2 * Math.PI * c.bounces * n / c.frames), sx = 1 / sy;
    const frame = transform(pose, size, size, size, c.axisX, c.baselineY, sx, sy, c.axisX, c.baselineY), bnd = bounds(frame, size, size);
    assert(bnd.x0 > 0 && bnd.x1 < size - 1 && bnd.y0 > 0 && bnd.y1 < size - 1, `Frame ${n} touches the canvas edge. Increase common margin and prepare again; do not crop individual frames.`);
    await writePNG(path.join(out, 'pose-only', frameName(n)), pose, size);
    for (const s of c.sizes) {
      const image = sharp(frame, { raw: { width: size, height: size, channels: 4 } });
      await (s === size ? image : image.resize(s, s, { kernel: 'lanczos3' })).png().toFile(path.join(out, `frames-${s}`, frameName(n)));
    }
    if (n) { poseDiff.push(difference(prevPose, pose)); animatedDiff.push(difference(prevFrame, frame)); }
    else { firstPose = pose; firstFrame = frame; }
    prevPose = pose; prevFrame = frame;
    records.push({ frame: n, angle, sourceAngles: [a.angle, b.angle], interpolation: t, scaleX: sx, scaleY: sy, axisX: c.axisX, baselineY: c.baselineY, bounds: bnd });
  }
  poseDiff.push(difference(prevPose, firstPose)); animatedDiff.push(difference(prevFrame, firstFrame));
  const ordered = [...poseDiff].sort((a, b) => a - b), median = ordered[Math.floor(ordered.length / 2)];
  const flags = poseDiff.flatMap((v, i) => v < .01 || v > Math.max(.1, median * 2.5) ? [{ from: i, to: (i + 1) % c.frames, difference: v, reason: v < .01 ? 'near-duplicate' : 'large-change' }] : []);
  const gifs = [];
  for (const s of c.sizes) {
    const dir = path.join(out, `frames-${s}`), file = path.join(out, `spin-${s}.gif`);
    await encodeGIF(dir, file, c.frames, c.delayCs); gifs.push(await inspectGIF(file, dir, s, c.frames, c.delayCs));
  }
  await contactSheet(records.map(r => path.join(out, `frames-${size}`, frameName(r.frame))), path.join(out, 'contact-sheet.png'));
  const report = { version: 1, sizes: c.sizes, frames: c.frames, durationSeconds: c.durationSeconds, delayCs: c.delayCs, gifs, poseOnlyDifferences: poseDiff, animatedDifferences: animatedDiff, reviewFlags: flags, records, visualReview: 'pending', automatedPass: false };
  await saveJSON(path.join(out, 'validation.json'), report);
  await saveJSON(path.join(out, 'reproduction.json'), { prepared: path.resolve(prepared), manifest: c, transitions: [...transitions.values()] });
  await validate(out);
  report.automatedPass = true;
  await saveJSON(path.join(out, 'validation.json'), report);
  return report;
}

export async function validate(out) {
  const report = await json(path.join(out, 'validation.json'));
  assert(report.version === 1, 'Unsupported report version');
  for (const size of report.sizes) {
    const dir = path.join(out, `frames-${size}`);
    assert((await fs.readdir(dir)).filter(n => /^frame-\d{4}\.png$/.test(n)).length === report.frames, 'Unexpected PNG frame count');
    for (let i = 0; i < report.frames; i++) {
      const p = await readRGBA(path.join(dir, frameName(i))); assert(p.width === size && p.height === size, 'PNG size mismatch');
      const b = bounds(p.data, size, size); assert(b.x0 > 0 && b.x1 < size - 1 && b.y0 > 0 && b.y1 < size - 1, `Clipped PNG frame ${i} at ${size}px`);
    }
    await inspectGIF(path.join(out, `spin-${size}.gif`), dir, size, report.frames, report.delayCs);
  }
  return { automatedPass: true, visualReview: report.visualReview, reviewFlags: report.reviewFlags };
}

async function main() {
  const [cmd, a, b, extra] = process.argv.slice(2);
  if (cmd === 'prepare' && a && b) { const c = await prepare(path.resolve(a), path.resolve(b)); console.log(JSON.stringify({ prepared: path.resolve(b), poses: c.keyframes.length, masterSize: c.masterSize })); }
  else if (cmd === 'render' && a && b) { const r = await render(path.resolve(a), path.resolve(b), extra && path.resolve(extra)); console.log(JSON.stringify({ output: path.resolve(b), gifs: r.gifs, reviewFlags: r.reviewFlags, visualReview: r.visualReview })); }
  else if (cmd === 'validate' && a) console.log(JSON.stringify(await validate(path.resolve(a))));
  else { console.log('Usage:\n  node scripts/spin.mjs prepare CONFIG.json NEW_PREPARED_DIR\n  node scripts/spin.mjs render PREPARED_DIR NEW_OUTPUT_DIR [TRANSITIONS.json]\n  node scripts/spin.mjs validate OUTPUT_DIR\n\nRequires Node >=22, npm ci, and FFmpeg on PATH. Outputs must not already exist.'); if (cmd && cmd !== '--help') process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
