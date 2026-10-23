import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { prepare, render, validate, checkSequenceSteps } from '../scripts/spin.mjs';
import { createAudit, validateAudit } from '../scripts/audit-rotation.mjs';
import { loadConfig, nearestTransform, readRGBA, paletteCount, sharedPalette, REVIEW_CHECKS, json } from '../scripts/core.mjs';
import { STANDARD, framePlan, squashAt } from '../scripts/standard.mjs';

async function fixture(dir, count=24, options={}){
  const keys=[];
  for(let i=0;i<count;i++){
    const theta=i*2*Math.PI/count,x=128+48*Math.cos(theta),y=119+25*Math.sin(theta);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="67" y="36" width="122" height="178" rx="32" fill="#5279b4"/><rect x="95" y="204" width="66" height="20" fill="#5279b4"/><rect x="${x-7}" y="${y-7}" width="14" height="14" fill="#ffe9a0"/><rect x="208" y="171" width="9" height="9" fill="#d88848"/></svg>`;
    const file=`pose-${i}.png`;await sharp(Buffer.from(svg)).png().toFile(path.join(dir,file));keys.push({angle:i*360/count,file,anchor:[.5,224/256]});
  }
  const file=path.join(dir,'config.json');await fs.writeFile(file,JSON.stringify({...options,keyframes:keys}));return file;
}
async function temp(t,prefix){const dir=await fs.mkdtemp(path.join(os.tmpdir(),prefix));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function fixtureReview(prepared){
  const r=await json(path.join(prepared,'rotation-review.template.json'));r.status='passed';r.checks=Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]));
  r.observations=Object.fromEntries(Object.keys(r.observations).map(k=>[k,'Synthetic geometry fixture; this validates the tool contract, not actual character quality.']));r.reviewer='automated regression fixture';
  for(const s of r.steps){s.progress='forward';s.stepSize='small-even';s.headBodyCoupled=true;s.appearanceStable=true;s.observation='Synthetic test contract only, not observed character rotation.';}
  const dir=path.join(prepared,'audit');await createAudit(prepared,dir);
  const key=await json(path.join(dir,'answer-key.json')),a=await json(path.join(dir,'answers.template.json'));
  a.reviewer='Synthetic regression fixture only, not a visual character review';
  for(const p of a.pairs){const k=key.entries.find(e=>e.id===p.id);p.verdict=k.kind==='adjacent'?'clear-rotation':'same-heading';p.identityStable=true;p.headGeometry='Synthetic fixture for exercising review completeness, not visual evidence.';p.torsoGeometry=p.headGeometry;}
  await fs.writeFile(path.join(dir,'answers.json'),JSON.stringify(a));r.blindAudit='audit';
  await fs.writeFile(path.join(prepared,'rotation-review.json'),JSON.stringify(r));
}

test('default is 144px, duration and output count follow the 24 drawn source frames',async t=>{
  const d=await temp(t,'chibi-v2-config-'),f=await fixture(d),c=await loadConfig(f);
  assert.deepEqual(c.sizes,[144]);assert.equal(c.frames,24);assert.equal(c.delayCs,8);assert.equal(c.durationSeconds,1.92);
});
test('fixed profile refuses silent frame, size, timing or bounce changes; explicit custom profile records why',async t=>{
  const d=await temp(t,'chibi-standard-');
  for(const options of [{sizes:[256]},{durationSeconds:2.4},{bounces:3},{squashMin:.8},{paletteColours:64}]){
    const f=await fixture(d,24,options);await assert.rejects(loadConfig(f),/fixes 144px/);
  }
  let f=await fixture(d,36);await assert.rejects(loadConfig(f),/fixes 144px/);
  f=await fixture(d,36,{profile:'custom'});await assert.rejects(loadConfig(f),/specChangeReason/);
  f=await fixture(d,36,{profile:'custom',specChangeReason:'Test fixture representing an explicit 36-pose user request.'});assert.equal((await loadConfig(f)).frames,36);
});
test('frame plan has 24 evenly spaced targets, midpoint brackets and wrap, with exact two-bounce scaling',()=>{
  const p=framePlan();assert.equal(p.standard.id,STANDARD.id);assert.equal(p.frames.length,24);
  for(let i=0;i<24;i++){
    const f=p.frames[i];assert.equal(f.targetYaw,i*15);assert.equal(f.index,i);assert.equal(f.delayMs,80);
    assert.ok(Math.abs(f.scaleX*f.scaleY-1)<1e-12);assert.deepEqual(squashAt(i),squashAt(i+24));
    if(i%2){assert.equal(f.bracket.length,2);assert.equal(f.bracket[0],p.frames[i-1].frame);assert.equal(f.bracket[1],p.frames[(i+1)%24].frame);}
  }
  assert.deepEqual(p.frames[23].bracket,['F23','F01']);assert.equal(p.frames[23].next,'F01');
  const extrema=p.frames.filter(f=>Math.abs(f.scaleY-2/3)<1e-12);assert.deepEqual(extrema.map(f=>f.index),[6,18]);
  assert.ok(p.frames[23].scaleY<1);assert.ok(Math.abs((p.frames[0].scaleY-p.frames[23].scaleY)-(p.frames[0].scaleY-p.frames[1].scaleY))<1e-12);
});
test('ordered windows cannot approve reverse, hold, jump, decoupled head/body or a missing wrap',()=>{
  const steps=Array.from({length:24},(_,i)=>({from:i,to:(i+1)%24,progress:'forward',stepSize:'small-even',headBodyCoupled:true,appearanceStable:true,observation:'Synthetic fixture for contract checks, not real visual evidence.'}));
  checkSequenceSteps({steps},24);
  for(const mutation of [{progress:'reverse'},{progress:'hold'},{stepSize:'jump'},{headBodyCoupled:false},{appearanceStable:false}]){
    const s=structuredClone(steps);Object.assign(s[8],mutation);assert.throws(()=>checkSequenceSteps({steps:s},24),/needs repair/);
  }
  const s=structuredClone(steps);s[23].to=24;assert.throws(()=>checkSequenceSteps({steps:s},24),/include wrap/);
});
test('sparse directions and output count inflation cannot masquerade as rotation',async t=>{
  const d=await temp(t,'chibi-v2-sparse-');let f=await fixture(d,12);await assert.rejects(loadConfig(f),/24..96/);
  f=await fixture(d,24,{frames:60});await assert.rejects(loadConfig(f),/must equal source rotation/);
});
test('uneven or duplicate angle labels fail before rendering',async t=>{
  const d=await temp(t,'chibi-v2-angles-'),f=await fixture(d),c=await json(f);c.keyframes[1].angle=0;await fs.writeFile(f,JSON.stringify(c));await assert.rejects(loadConfig(f),/cover 0..360 uniformly/);
});
test('nearest transforms preserve the source colour set and hard alpha',()=>{
  const a=Buffer.alloc(8*8*4);for(let y=2;y<7;y++)for(let x=2;x<6;x++){const p=(y*8+x)*4;a[p]=200;a[p+1]=60;a[p+3]=255;}
  const b=nearestTransform(a,8,8,16,4,7,1.5,.7,8,14);assert.equal(paletteCount([b]),1);for(let p=3;p<b.length;p+=4)assert.ok(b[p]===0||b[p]===255);
});
test('rich source frames honour arbitrary shared palette limits and preserve alpha masks',async()=>{
  const size=32,frames=Array.from({length:3},(_,i)=>{
    const frame=Buffer.alloc(size*size*4);
    for(let y=2;y<size-2;y++)for(let x=2;x<size-2;x++){
      const p=(y*size+x)*4;frame[p]=(x*9+i*31)%256;frame[p+1]=(y*11+i*17)%256;frame[p+2]=(x*y+i*47)%256;frame[p+3]=255;
    }
    frame.set([200,30,180,255],(10*size+10)*4);return frame;
  });
  assert.ok(paletteCount(frames)>256);
  for(const limit of [8,17,48,96,128]){
    const result=await sharedPalette(frames,size,limit);
    assert.ok(paletteCount(result)<=limit,`requested ${limit}, got ${paletteCount(result)}`);
    for(let i=0;i<frames.length;i++)for(let p=3;p<frames[i].length;p+=4)assert.equal(result[i][p],frames[i][p]);
    const p=(10*size+10)*4;for(const frame of result)assert.deepEqual(frame.subarray(p,p+4),result[0].subarray(p,p+4));
  }
});
test('duplicate pictures with different angle labels are rejected',async t=>{
  const d=await temp(t,'chibi-v2-duplicate-'),f=await fixture(d),c=await json(f);for(const k of c.keyframes)k.file='pose-0.png';await fs.writeFile(f,JSON.stringify(c));
  await assert.rejects(prepare(f,path.join(d,'prepared')),/Repeated neutral pose/);await assert.rejects(fs.stat(path.join(d,'prepared')),/ENOENT/);
});
test('source images with large pre-baked height changes require repair',async t=>{
  const d=await temp(t,'chibi-v2-baked-'),f=await fixture(d);const small=await sharp(path.join(d,'pose-5.png')).resize(256,160,{fit:'fill'}).extend({top:96,bottom:0,left:0,right:0,background:'#00000000'}).png().toBuffer();await fs.writeFile(path.join(d,'pose-5.png'),small);
  const c=await json(f);c.keyframes[5].anchor=[.5,(96+224/256*160)/256];await fs.writeFile(f,JSON.stringify(c));await assert.rejects(prepare(f,path.join(d,'prepared')),/Neutral source heights vary/);
});
test('Q bounce cannot be rendered before neutral rotation review',async t=>{
  const d=await temp(t,'chibi-v2-review-'),f=await fixture(d),p=path.join(d,'prepared'),o=path.join(d,'out');await prepare(f,p);
  await assert.rejects(render(p,o),/ENOENT/);await fs.copyFile(path.join(p,'rotation-review.template.json'),path.join(p,'rotation-review.json'));await assert.rejects(render(p,o),/Review the neutral rotation/);await assert.rejects(fs.stat(o),/ENOENT/);
});
test('a changed neutral sequence invalidates the visual review',async t=>{
  const d=await temp(t,'chibi-v2-stale-'),f=await fixture(d),p=path.join(d,'prepared');await prepare(f,p);await fixtureReview(p);
  const file=path.join(p,'poses/frame-0003.png'),im=await readRGBA(file);im.data[(90*144+72)*4]=17;await sharp(im.data,{raw:{width:144,height:144,channels:4}}).png().toFile(file);
  await assert.rejects(render(p,path.join(d,'out')),/changed after review/);
});
test('blanket visual approval cannot bypass the blind pair audit',async t=>{
  const d=await temp(t,'chibi-v2-blind-'),f=await fixture(d),p=path.join(d,'prepared');await prepare(f,p);await fixtureReview(p);
  const file=path.join(p,'rotation-review.json'),r=await json(file);delete r.blindAudit;await fs.writeFile(file,JSON.stringify(r));
  await assert.rejects(render(p,path.join(d,'out')),/blind adjacent-pair audit is required/);
});
test('blind audit rejects all-rotation answers and a same-heading real pair',async t=>{
  const d=await temp(t,'chibi-v2-controls-'),f=await fixture(d),p=path.join(d,'prepared');await prepare(f,p);await fixtureReview(p);
  const dir=path.join(p,'audit'),file=path.join(dir,'answers.json'),a=await json(file),key=await json(path.join(dir,'answer-key.json'));
  for(const pair of a.pairs)pair.verdict='clear-rotation';await fs.writeFile(file,JSON.stringify(a));assert.equal((await validateAudit(dir)).status,'needs-repair');
  for(const pair of a.pairs)pair.verdict=key.entries.find(e=>e.id===pair.id).kind==='adjacent'?'clear-rotation':'same-heading';
  const real=key.entries.find(e=>e.kind==='adjacent');a.pairs.find(x=>x.id===real.id).verdict='same-heading';await fs.writeFile(file,JSON.stringify(a));
  await assert.rejects(render(p,path.join(d,'out')),/Blind rotation audit needs repair/);
});
test('direct 144px loop: one distinct source pose per frame, no morph, stable baseline, palette and GIF disposal',async t=>{
  const d=await temp(t,'chibi-v2-loop-'),f=await fixture(d),p=path.join(d,'prepared'),o=path.join(d,'output'),c=await prepare(f,p);await fixtureReview(p);
  const r=await render(p,o);assert.equal(r.frames,24);assert.equal(r.sourceFrames,24);assert.equal(r.visualReview,'pending');assert.equal(r.automatedPass,true);assert.equal(r.gifs[0].maskMismatch,0);assert.equal(r.gifs[0].size,144);
  for(let i=0;i<24;i++){
    assert.equal(r.records[i].sourceFrame,i);assert.deepEqual((await readRGBA(path.join(o,'pose-only',`frame-${String(i).padStart(4,'0')}.png`))).data,(await readRGBA(path.join(p,c.keyframes[i].file))).data);
    assert.equal(r.records[i].axisX,c.axisX);assert.equal(r.records[i].baselineY,c.baselineY);
  }
  const bottoms=r.records.map(x=>x.bounds.y1);assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=1);assert.ok(Math.abs(Math.min(...r.records.map(x=>x.scaleY))-2/3)<1e-12);assert.ok(Math.abs(Math.max(...r.records.map(x=>x.scaleY))-1)<1e-12);
  assert.equal((await validate(o)).automatedPass,true);await assert.rejects(prepare(f,p),/EEXIST/);
});
