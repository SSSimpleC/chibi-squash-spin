#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { assert, json, saveJSON, newDirectory, frameName, bounds, readRGBA, nearestTransform, binaryAlpha, writePNG, loadConfig, sharedPalette, sequenceDiagnostics, paletteCount, REVIEW_CHECKS } from './core.mjs';
import { encodeGIF, inspectGIF } from './gif.mjs';

export async function contactSheet(files, out, size = 144) {
  const cols = Math.min(6, files.length), cellH = size + 22, rows = Math.ceil(files.length / cols), items = [];
  for (let i=0;i<files.length;i++) {
    items.push({ input:await sharp(files[i]).resize(size,size,{kernel:'nearest'}).png().toBuffer(), left:i%cols*size, top:Math.floor(i/cols)*cellH });
    const label=Buffer.from(`<svg width="${size}" height="22"><text x="8" y="16" fill="#eee" font-size="13" font-family="sans-serif">${i} / ${(i*360/files.length).toFixed(1)}°</text></svg>`);
    items.push({input:label,left:i%cols*size,top:Math.floor(i/cols)*cellH+size});
  }
  await sharp({create:{width:cols*size,height:rows*cellH,channels:4,background:'#353740'}}).composite(items).png().toFile(out);
}
function checkInside(data,size,label) {
  const b=bounds(data,size,size);
  assert(b.x0>0&&b.x1<size-1&&b.y0>0&&b.y1<size-1,`${label} touches canvas edge; adjust common margin, never crop each animation frame separately`); return b;
}

export async function prepare(configFile,out) {
  const c=await loadConfig(configFile),size=c.masterSize,source=[];let maxX=0,maxUp=0,maxDown=0;
  for(const k of c.keyframes){
    let image=sharp(k.file);if(k.crop)image=image.extract(k.crop);
    const {data:input,info}=await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});const data=binaryAlpha(input);
    const b=bounds(data,info.width,info.height),ax=k.anchor[0]*info.width,ay=k.anchor[1]*info.height;
    assert(Math.abs(ay-b.y1-1)<=Math.max(3,b.height*.035),`Angle ${k.angle}: baseline must be the seated contact point`);
    assert(b.width<info.width||b.height<info.height,`Angle ${k.angle}: opaque rectangular background; regenerate with real transparency`);
    maxX=Math.max(maxX,Math.abs(b.x0-ax)/b.height,Math.abs(b.x1+1-ax)/b.height);
    maxUp=Math.max(maxUp,(ay-b.y0)/b.height);maxDown=Math.max(maxDown,(b.y1+1-ay)/b.height);
    source.push({...k,data,width:info.width,height:info.height,b,ax,ay});
  }
  // Compare height relative to each source canvas; tolerate minor generation/cropping drift, not baked-in squash.
  const relativeHeights=source.map(s=>s.b.height/s.height),spread=Math.max(...relativeHeights)/Math.min(...relativeHeights);
  assert(spread<=1.15,`Neutral source heights vary ${(100*(spread-1)).toFixed(1)}%; repair the rotation sequence before adding squash (no baked-in Q bounce)`);
  const margin=Math.max(c.margin,2/Math.min(...c.sizes)),axisX=Math.floor(size/2),baselineY=Math.floor(size*(1-margin));
  const targetHeight=Math.min(size*(.5-margin)*c.squashMin/maxX,size*(1-2*margin)/maxUp,maxDown>0?size*margin/maxDown:Infinity);
  assert(Number.isFinite(targetHeight)&&targetHeight>0,'Invalid source geometry');
  for(const s of source)assert(targetHeight<=s.b.height*1.001,`Angle ${s.angle} requires upscaling; generate a usable source sprite instead`);
  const registered=source.map(s=>nearestTransform(s.data,s.width,s.height,size,s.ax,s.ay,targetHeight/s.b.height,targetHeight/s.b.height,axisX,baselineY));
  const frames=await sharedPalette(registered,size,c.paletteColours),diagnostics=sequenceDiagnostics(frames);
  assert(diagnostics.duplicates.length===0,`Repeated neutral pose after pixel registration: ${JSON.stringify(diagnostics.duplicates)}. Generate missing rotation frames; no repeated-angle Q animation.`);
  frames.forEach((f,i)=>checkInside(f,size,`Neutral frame ${i}`));
  await newDirectory(out);await fs.mkdir(path.join(out,'poses'));
  const keys=[];
  for(let i=0;i<frames.length;i++){
    const file=`poses/${frameName(i)}`;await writePNG(path.join(out,file),frames[i],size);
    keys.push({angle:source[i].angle,file,source:source[i].file,sourceCrop:source[i].crop??null,sourceSize:[source[i].width,source[i].height],sourceAnchor:source[i].anchor,scale:targetHeight/source[i].b.height});
  }
  const manifest={version:2,...c,keyframes:keys,effectiveMargin:margin,axisX,baselineY,targetHeight,sourceHeightSpread:spread,rotationDigest:diagnostics.digest,sequenceMode:'direct-one-source-frame-per-output-frame'};
  await saveJSON(path.join(out,'manifest.json'),manifest);await saveJSON(path.join(out,'rotation-diagnostics.json'),diagnostics);
  await contactSheet(keys.map(k=>path.join(out,k.file)),path.join(out,'rotation-contact.png'),size);
  const rotationGif=path.join(out,`rotation-only-${size}.gif`);await encodeGIF(path.join(out,'poses'),rotationGif,c.frames,c.delayCs,true);
  await inspectGIF(rotationGif,path.join(out,'poses'),size,c.frames,c.delayCs);
  await saveJSON(path.join(out,'rotation-review.template.json'),{version:2,rotationDigest:diagnostics.digest,status:'pending',checks:Object.fromEntries(REVIEW_CHECKS.map(k=>[k,false])),observations:{proportions:'',expression:'',frontToSide:'',backHalf:'',returnToFront:'',seam:''},evidence:[`rotation-only-${size}.gif`,'rotation-contact.png'],reviewer:''});
  return manifest;
}

export async function loadRotationReview(prepared,manifest,frames,reviewFile) {
  const review=await json(reviewFile??path.join(prepared,'rotation-review.json'));
  assert(review.version===2&&review.status==='passed','Review the neutral rotation GIF before adding Q bounce; rotation-review.json must record passed after actual inspection');
  const diagnostics=sequenceDiagnostics(frames);assert(diagnostics.duplicates.length===0,'Neutral sequence contains repeated frames');
  assert(review.rotationDigest===diagnostics.digest&&manifest.rotationDigest===diagnostics.digest,'Rotation changed after review; inspect the updated sequence and record a new review');
  assert(REVIEW_CHECKS.every(k=>review.checks?.[k]===true),'Unfinished rotation review: proportions, short feet, arms, expression, consistency, angles, seam, pixel style all required');
  assert(['proportions','expression','frontToSide','backHalf','returnToFront','seam'].every(k=>typeof review.observations?.[k]==='string'&&review.observations[k].trim().length>=8),'Record concrete observations, not only checkboxes');
  assert(typeof review.reviewer==='string'&&review.reviewer.trim(),'Record reviewer');
  assert(Array.isArray(review.evidence)&&review.evidence.length>=2,'Record GIF and contact-sheet evidence paths');
  for(const p of review.evidence)assert((await fs.stat(path.resolve(prepared,p))).isFile(),`Review evidence missing: ${p}`);
  return review;
}

export async function render(prepared,out,reviewFile) {
  const c=await json(path.join(prepared,'manifest.json'));assert(c.version===2,'v2 requires a newly prepared direct pixel rotation sequence');const size=c.masterSize,poses=[];
  for(const k of c.keyframes){const p=await readRGBA(path.join(prepared,k.file));assert(p.width===size&&p.height===size,'Canonical pose size mismatch');poses.push(p.data);}
  assert(c.frames===poses.length,'Never repeat rotation poses to fill output frames');
  const review=await loadRotationReview(prepared,c,poses,reviewFile);
  await newDirectory(out);await fs.mkdir(path.join(out,'pose-only'));for(const s of c.sizes)await fs.mkdir(path.join(out,`frames-${s}`));
  const records=[];
  for(let i=0;i<c.frames;i++){
    const sy=(1+c.squashMin)/2+(1-c.squashMin)/2*Math.cos(2*Math.PI*c.bounces*i/c.frames),sx=1/sy;
    const frame=nearestTransform(poses[i],size,size,size,c.axisX,c.baselineY,sx,sy,c.axisX,c.baselineY);
    const b=checkInside(frame,size,`Frame ${i}`);await writePNG(path.join(out,'pose-only',frameName(i)),poses[i],size);
    for(const s of c.sizes){const img=sharp(frame,{raw:{width:size,height:size,channels:4}});await(s===size?img:img.resize(s,s,{kernel:'nearest'})).png().toFile(path.join(out,`frames-${s}`,frameName(i)));}
    records.push({frame:i,sourceFrame:i,angle:c.keyframes[i].angle,scaleX:sx,scaleY:sy,axisX:c.axisX,baselineY:c.baselineY,bounds:b});
  }
  const gifs=[];for(const s of c.sizes){const dir=path.join(out,`frames-${s}`),file=path.join(out,`spin-${s}.gif`);await encodeGIF(dir,file,c.frames,c.delayCs,true);gifs.push(await inspectGIF(file,dir,s,c.frames,c.delayCs));}
  const rotationGif=path.join(out,`rotation-only-${size}.gif`);await encodeGIF(path.join(out,'pose-only'),rotationGif,c.frames,c.delayCs,true);
  await contactSheet(records.map(r=>path.join(out,`frames-${size}`,frameName(r.frame))),path.join(out,'contact-sheet.png'),size);
  const report={version:2,style:'pixel',sizes:c.sizes,frames:c.frames,sourceFrames:c.keyframes.length,durationSeconds:c.durationSeconds,delayCs:c.delayCs,paletteColours:c.paletteColours,rotationDigest:c.rotationDigest,gifs,records,neutralRotationReview:review,visualReview:'pending',automatedPass:false};
  await saveJSON(path.join(out,'validation.json'),report);await saveJSON(path.join(out,'reproduction.json'),{prepared:path.resolve(prepared),manifest:c});
  await validate(out);report.automatedPass=true;await saveJSON(path.join(out,'validation.json'),report);return report;
}

export async function validate(out) {
  const r=await json(path.join(out,'validation.json'));assert(r.version===2,'Expected v2 report');assert(r.frames===r.sourceFrames,'Output expanded sparse source frames');
  const master=Math.max(...r.sizes),poses=[];for(let i=0;i<r.frames;i++){
    const p=await readRGBA(path.join(out,'pose-only',frameName(i)));assert(p.width===master&&p.height===master,'Neutral pose dimensions changed');poses.push(p.data);
    assert(r.records[i].sourceFrame===i,'Source order or one-frame-per-pose invariant violated');
  }
  const d=sequenceDiagnostics(poses);assert(d.duplicates.length===0,'Repeated neutral rotation pose');assert(d.digest===r.rotationDigest,'Neutral rotation changed');
  for(const size of r.sizes){
    const dir=path.join(out,`frames-${size}`),frames=[];assert((await fs.readdir(dir)).filter(n=>/^frame-\d{4}\.png$/.test(n)).length===r.frames,'Unexpected PNG frame count');
    for(let i=0;i<r.frames;i++){const p=await readRGBA(path.join(dir,frameName(i)));assert(p.width===size&&p.height===size,'PNG dimensions differ');checkInside(p.data,size,`Frame ${i}`);for(let k=3;k<p.data.length;k+=4)assert(p.data[k]===0||p.data[k]===255,'Pixel export contains soft alpha');frames.push(p.data);}
    assert(paletteCount(frames)<=r.paletteColours,'Pixel sequence uses more colours than its shared palette');
    await inspectGIF(path.join(out,`spin-${size}.gif`),dir,size,r.frames,r.delayCs);
  }
  return {automatedPass:true,visualReview:r.visualReview,neutralRotationReview:r.neutralRotationReview.status,frames:r.frames,sizes:r.sizes};
}

async function main(){
  const [cmd,a,b,extra]=process.argv.slice(2);
  if(cmd==='prepare'&&a&&b){const c=await prepare(path.resolve(a),path.resolve(b));console.log(JSON.stringify({prepared:path.resolve(b),frames:c.frames,size:c.masterSize,next:'Inspect rotation-only GIF, then copy and complete rotation-review.template.json as rotation-review.json'}));}
  else if(cmd==='render'&&a&&b){const r=await render(path.resolve(a),path.resolve(b),extra&&path.resolve(extra));console.log(JSON.stringify({output:path.resolve(b),gifs:r.gifs,visualReview:r.visualReview}));}
  else if(cmd==='validate'&&a)console.log(JSON.stringify(await validate(path.resolve(a))));
  else{console.log('Pixel direct-sequence workflow v2:\n  node scripts/spin.mjs prepare CONFIG.json NEW_PREPARED_DIR\n  node scripts/spin.mjs render PREPARED_DIR NEW_OUTPUT_DIR [ROTATION_REVIEW.json]\n  node scripts/spin.mjs validate OUTPUT_DIR\nRequires Node >=22, npm ci, FFmpeg. Default 144px. Provide >=24 unique neutral rotation frames; no temporal interpolation.');if(cmd&&cmd!=='--help')process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
