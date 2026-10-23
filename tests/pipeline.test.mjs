import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { prepare, render, validate } from '../scripts/spin.mjs';
import { loadConfig, interval, bounds, transform, readRGBA } from '../scripts/core.mjs';
import { tps, morph, validatePoints } from '../scripts/morph.mjs';

async function fixture(dir, count, options = {}) {
  const keyframes = [];
  for (let i = 0; i < count; i++) {
    const theta = i * Math.PI * 2 / count, x = 256 + 50 * Math.sin(theta), rx = 112 + 15 * Math.cos(theta);
    // Deliberately asymmetric, disconnected geometry: regression fixture, not character art.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><ellipse cx="256" cy="277" rx="${rx}" ry="183" fill="#547db2"/><rect x="220" y="424" width="72" height="40" fill="#638ac0"/><circle cx="${x}" cy="220" r="20" fill="#ffe5bb"/><circle cx="435" cy="345" r="8" fill="#dbad58"/></svg>`;
    const file = `pose-${i}.png`; await sharp(Buffer.from(svg)).png().toFile(path.join(dir, file));
    keyframes.push({ angle: i * 360 / count, file, anchor: [.5, 464 / 512] });
  }
  const cfg = { ...options, keyframes }; const file = path.join(dir, 'config.json'); await fs.writeFile(file, JSON.stringify(cfg)); return file;
}

test('config: defaults, 360 duplicate and fractional GIF timing', async t => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'chibi-config-')); t.after(() => fs.rm(d, { recursive: true, force: true }));
  const f = await fixture(d, 2); const c = await loadConfig(f);
  assert.deepEqual(c.sizes, [256, 512]); assert.equal(c.frames, 60); assert.equal(c.delayCs, 4);
  const bad = JSON.parse(await fs.readFile(f)); bad.keyframes[1].angle = 360; await fs.writeFile(f, JSON.stringify(bad));
  await assert.rejects(loadConfig(f), /Angles must be unique/);
  bad.keyframes[1].angle = 180; bad.durationSeconds = 2.5; await fs.writeFile(f, JSON.stringify(bad));
  await assert.rejects(loadConfig(f), /exact multiple/);
});

test('wrap interval spans last pose to front without a duplicated endpoint', () => {
  assert.deepEqual(interval([{ angle: 0 }, { angle: 90 }, { angle: 180 }, { angle: 270 }], 315), { i: 3, j: 0, t: .5 });
});

test('TPS reproduces affine correspondence; duplicate landmarks fail', () => {
  const a = [[.1, .1], [.8, .1], [.1, .8], [.8, .8]], b = a.map(([x, y]) => [x + .04, y - .02]);
  const fn = tps(a, b), out = [0, 0]; fn(.4, .5, out); assert.ok(Math.abs(out[0] - .44) < 1e-6); assert.ok(Math.abs(out[1] - .48) < 1e-6);
  assert.throws(() => validatePoints([[.3, .3], [.3, .3], [.5, .5]], a.slice(0, 3)), /Duplicate/);
});

test('premultiplied sampling keeps saturated colours on transparent edges', () => {
  const a = Buffer.alloc(8 * 8 * 4); for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) { a[(y * 8 + x) * 4] = 255; a[(y * 8 + x) * 4 + 3] = 255; }
  const b = transform(a, 8, 8, 16, 4, 4, 1.7, 1.7, 8, 8);
  let edge = 0; for (let p = 0; p < b.length; p += 4) if (b[p + 3] > 0 && b[p + 3] < 255) { edge++; assert.equal(b[p], 255); }
  assert.ok(edge > 0);
});

test('registered morph preserves exact endpoints and produces a single midpoint silhouette', () => {
  const size = 48, a = Buffer.alloc(size * size * 4), b = Buffer.alloc(size * size * 4);
  for (let y = 12; y < 36; y++) for (let x = 14; x < 30; x++) for (const [buf, dx] of [[a, 0], [b, 4]]) { const p = (y * size + x + dx) * 4; buf[p] = 180; buf[p + 3] = 255; }
  const pa = [[14/48,12/48],[30/48,12/48],[14/48,36/48],[30/48,36/48]], pb = pa.map(([x,y])=>[x+4/48,y]);
  assert.deepEqual(morph(a,b,size,pa,pb,0),a); assert.deepEqual(morph(a,b,size,pa,pb,1),b);
  const m=morph(a,b,size,pa,pb,.5), box=bounds(m,size,size,127); assert.ok(Math.abs(box.x0-16)<=1); assert.ok(Math.abs(box.x1-31)<=1);
  for(let y=15;y<33;y++)for(let x=18;x<30;x++)assert.ok(m[(y*size+x)*4+3]>220);
});

test('identity interpolation preserves translucent materials below and above GIF threshold', () => {
  const size=32, points=[[.2,.2],[.8,.2],[.2,.8],[.8,.8]];
  for(const alpha of [64,96,160,255]){
    const a=Buffer.alloc(size*size*4);
    for(let y=5;y<27;y++)for(let x=5;x<27;x++){const p=(y*size+x)*4;a[p]=200;a[p+1]=100;a[p+3]=alpha;}
    const b=morph(a,a,size,points,points,.5);
    assert.deepEqual(b,a,`material alpha ${alpha} changed during identity interpolation`);
  }
});

test('small source art cannot silently become a high-resolution deliverable', async t => {
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'chibi-upscale-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));
  const f=await fixture(d,2);for(let i=0;i<2;i++){const buf=await sharp(path.join(d,`pose-${i}.png`)).resize(32,32).png().toBuffer();await fs.writeFile(path.join(d,`pose-${i}.png`),buf);}
  await assert.rejects(prepare(f,path.join(d,'prepared')),/needs upscaling/);
  await assert.rejects(fs.stat(path.join(d,'prepared')),/ENOENT/);
});

test('missing wraparound correspondence fails before writing output', async t => {
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'chibi-missing-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));
  const f=await fixture(d,4,{sizes:[32,64],frames:8,durationSeconds:.32});const prep=path.join(d,'prepared');await prepare(f,prep);
  const points=[[.5,.3],[.5,.6],[.5,.9],[.35,.6],[.65,.6]];
  const transitions=[0,90,180].map(a=>({fromAngle:a,toAngle:a+90,fromPoints:points,toPoints:points}));const tr=path.join(d,'transitions.json');await fs.writeFile(tr,JSON.stringify(transitions));
  await assert.rejects(render(prep,path.join(d,'output'),tr),/270 -> 0/);
  await assert.rejects(fs.stat(path.join(d,'output')),/ENOENT/);
});

test('registered interpolation exports a correctly disposed transparent GIF', async t => {
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'chibi-morph-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));
  const f=await fixture(d,4,{sizes:[32,64],frames:8,durationSeconds:.32});const prep=path.join(d,'prepared');await prepare(f,prep);
  const points=[[.5,.3],[.5,.6],[.5,.9],[.35,.6],[.65,.6]];
  const transitions=[0,90,180,270].map(a=>({fromAngle:a,toAngle:(a+90)%360,fromPoints:points,toPoints:points}));const tr=path.join(d,'transitions.json');await fs.writeFile(tr,JSON.stringify(transitions));
  const out=path.join(d,'output');const report=await render(prep,out,tr);assert.equal(report.automatedPass,true);assert.equal(report.visualReview,'pending');assert.equal(report.poseOnlyDifferences.length,8);
  assert.equal((await validate(out)).automatedPass,true);
});

test('default 256/512, 60-frame export is in phase, fixed at the seat, and retains detached parts', async t => {
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'chibi-default-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));
  const f=await fixture(d,60),prep=path.join(d,'prepared'),out=path.join(d,'output');const c=await prepare(f,prep);
  const p=await readRGBA(path.join(prep,'poses/pose-000.png'));
  // The detached gold fixture must survive prepare; a largest-component filter would remove it.
  let gold=0;for(let i=0;i<p.data.length;i+=4)if(p.data[i]>170&&p.data[i+1]>110&&p.data[i+2]<120&&p.data[i+3]>128)gold++;assert.ok(gold>0);
  const report=await render(prep,out);assert.deepEqual(report.sizes,[256,512]);assert.equal(report.frames,60);assert.equal(report.durationSeconds,2.4);
  for(const g of report.gifs){assert.equal(g.maskMismatch,0);assert.equal(g.loop,0);assert.equal(g.globalPalette,true);}
  assert.equal(report.records[0].scaleY,1);assert.ok(Math.min(...report.records.map(r=>r.scaleY))<.68);
  const bottoms=report.records.map(r=>r.bounds.y1);assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=1);
  for(const r of report.records){assert.equal(r.axisX,c.axisX);assert.equal(r.baselineY,c.baselineY);}
  const master=await fs.readFile(path.join(out,'frames-512/frame-0007.png')),small=await sharp(master).resize(256,256,{kernel:'lanczos3'}).raw().toBuffer();
  assert.deepEqual(small,(await readRGBA(path.join(out,'frames-256/frame-0007.png'))).data);
  assert.equal((await validate(out)).automatedPass,true);
  await assert.rejects(prepare(f,prep),/EEXIST/);
});
