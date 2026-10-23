#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { json, saveJSON, readRGBA, sequenceDiagnostics, assert } from './core.mjs';

// Reviewers receive only images/ and answers.template.json, never the answer key.
// Pixel differences and intended angle labels deliberately do not appear in the cards.
export async function createAudit(prepared,out){
  const m=await json(path.join(prepared,'manifest.json'));
  const frames=await Promise.all(m.keyframes.map(k=>readRGBA(path.join(prepared,k.file))));
  const digest=sequenceDiagnostics(frames.map(f=>f.data)).digest;
  assert(m.rotationDigest===digest,'Prepared poses changed; prepare the source sequence again before auditing');
  const pairs=frames.map((_,i)=>({from:i,to:(i+1)%frames.length,kind:'adjacent'}));
  for(const i of [0,Math.floor(frames.length/4),Math.floor(frames.length/2)])pairs.push({from:i,to:i,kind:'same-pose-control'});
  for(let i=pairs.length-1;i>0;i--){const j=randomInt(i+1);[pairs[i],pairs[j]]=[pairs[j],pairs[i]];}
  await fs.mkdir(out);await fs.mkdir(path.join(out,'images'));
  const entries=[];
  for(const pair of pairs){
    const id=randomBytes(4).toString('hex'),file=`images/pair-${id}.png`,size=432,gap=24,height=size+40;
    const a=await sharp(path.join(prepared,m.keyframes[pair.from].file)).resize(size,size,{kernel:'nearest'}).png().toBuffer();
    const b=await sharp(path.join(prepared,m.keyframes[pair.to].file)).resize(size,size,{kernel:'nearest'}).png().toBuffer();
    const label=Buffer.from(`<svg width="${size*2+gap}" height="40"><text x="12" y="25" fill="#eee" font-size="18">${id}   A → B · same fixed axis and scale</text></svg>`);
    await sharp({create:{width:size*2+gap,height,channels:4,background:'#353740'}}).composite([{input:label,left:0,top:0},{input:a,left:0,top:40},{input:b,left:size+gap,top:40}]).png().toFile(path.join(out,file));
    entries.push({id,file,...pair});
  }
  await saveJSON(path.join(out,'answer-key.json'),{version:1,rotationDigest:digest,frames:m.frames,entries});
  await saveJSON(path.join(out,'answers.template.json'),{version:1,rotationDigest:digest,reviewer:'',instructions:'Do not read answer-key.json. Judge actual rigid head AND body turn. Body evidence can be visible shoulders, sleeves, hands, feet, garment projection or occlusion; never invent hidden anatomy. Hair texture, face redraw, palette or silhouette alone is not evidence. Verdict: clear-rotation / same-heading / uncertain / identity-drift. Use uncertain when not clear; do not infer angles from a supplied sequence. Ordered direction and step-size are reviewed separately.',pairs:entries.map(e=>({id:e.id,file:e.file,verdict:'unreviewed',headGeometry:'',torsoGeometry:'',identityStable:null}))});
  return {pairs:entries.length,frames:m.frames,rotationDigest:digest};
}
export async function validateAudit(dir,answersFile=path.join(dir,'answers.json')){
  const key=await json(path.join(dir,'answer-key.json')),answers=await json(answersFile),issues=[];
  const real=key.entries.filter(e=>e.kind==='adjacent'),controls=key.entries.filter(e=>e.kind==='same-pose-control');
  if(real.length!==key.frames || new Set(real.map(e=>e.from)).size!==key.frames || real.some(e=>e.from<0||e.from>=key.frames||e.to!==(e.from+1)%key.frames) || controls.length!==3 || controls.some(e=>e.from!==e.to)) issues.push('Invalid audit coverage or missing wrap/negative controls');
  if(answers.rotationDigest!==key.rotationDigest)issues.push('Sequence changed after audit preparation');
  if(!answers.reviewer?.trim())issues.push('Missing reviewer');
  const byId=new Map((answers.pairs??[]).map(p=>[p.id,p]));
  if(byId.size!==key.entries.length||(answers.pairs??[]).length!==key.entries.length)issues.push('Missing or duplicate pair answers');
  for(const e of key.entries){
    const a=byId.get(e.id);if(!a){issues.push(`Missing ${e.id}`);continue;}
    const expected=e.kind==='same-pose-control'?'same-heading':'clear-rotation';
    if(a.verdict!==expected)issues.push(`${e.id} (${e.from}→${e.to}): ${a.verdict}, expected ${expected}`);
    if(e.kind==='adjacent'){
      if(a.identityStable!==true)issues.push(`${e.id}: identity/pose drift or uncertainty`);
      if(!['headGeometry','torsoGeometry'].every(k=>typeof a[k]==='string'&&a[k].trim().length>=16))issues.push(`${e.id}: record separate head and torso geometric evidence`);
    }
  }
  return {status:issues.length?'needs-repair':'passed',rotationDigest:key.rotationDigest,issues,scope:'Checks completeness and negative controls only. Does not automatically infer yaw or prove visual quality.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [cmd,a,b]=process.argv.slice(2);
  if(cmd==='create')console.log(JSON.stringify(await createAudit(path.resolve(a),path.resolve(b))));
  else if(cmd==='validate'){const r=await validateAudit(path.resolve(a),b&&path.resolve(b));console.log(JSON.stringify(r,null,2));if(r.status!=='passed')process.exitCode=1;}
  else throw new Error('Usage: audit-rotation.mjs create PREPARED NEW_AUDIT | validate AUDIT [ANSWERS]');
}
