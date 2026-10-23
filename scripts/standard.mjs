#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// One maintained specification for prompts, review, registration and export.
export const STANDARD = Object.freeze({
  id: 'pixel-144-24-v1', size: 144, frames: 24, stepDegrees: 15,
  delayCs: 8, durationSeconds: 1.92, paletteColours: 48,
  margin: .045, squashMin: 2 / 3, bounces: 2,
  direction: 'front → nose-screen-left → back → nose-screen-right → front'
});

export function squashAt(i, count = STANDARD.frames, min = STANDARD.squashMin, bounces = STANDARD.bounces) {
  const phase = ((i % count) + count) % count;
  const scaleY = (1 + min) / 2 + (1 - min) / 2 * Math.cos(2 * Math.PI * bounces * phase / count);
  return { scaleX: 1 / scaleY, scaleY };
}

export const userFrame = i => `F${String(i + 1).padStart(2, '0')}`;

export function framePlan() {
  const views = [
    '正面；头与胸朝前，左右固有差异保留',
    '正面与30°之间；远侧脸、肩、脚略收窄，尚不能成为三分之二侧脸',
    '前侧浅角；远侧脸部按发型遮挡收窄，脸与胸同时偏向画面左侧',
    '30°与60°之间；远侧眼、肩与胸饰的投影继续收窄',
    '前侧深角；仍是侧面之前，不能复制90°正侧面',
    '60°与90°之间；比60°更侧，比90°保留更多前脸/前胸可见区域',
    '正侧面，鼻尖朝画面左；头与胸共用侧向，远侧肢体按遮挡隐藏',
    '90°与120°之间；前脸/前胸开始被遮住，不能仍停在正侧面',
    '后侧浅角；背部份额增加，脸与前胸继续消失',
    '120°与150°之间；近侧身体与背部的遮挡逐渐交替',
    '后侧深角；尚未正背，侧面轮廓/袖口/裙摆仍不对称',
    '150°与180°之间；比150°更接近背面，不能提前成为正背',
    '正背；没有正脸/正胸，原配饰在人物自己的左右侧',
    '180°与210°之间；另一侧侧面开始显露，不能复制正背',
    '另一后侧深角；侧头/肩袖/裙摆逐渐显露',
    '210°与240°之间；朝画面右的侧向继续打开',
    '另一后侧浅角；向正侧面接近，但不能提前到270°',
    '240°与270°之间；头与身体比240°更接近正侧面，仍保留后侧遮挡',
    '另一正侧面，鼻尖朝画面右；不能镜像90°来交换固有配饰',
    '270°与300°之间；前脸/前胸开始打开，不能仍是正侧面',
    '另一前侧深角；前脸与前胸份额继续增加',
    '300°与330°之间；远侧眼/肩逐渐显露，不突然跳成正面',
    '另一前侧浅角；仍保留偏转，不能提前到0°',
    '330°与0°之间；近正面但尚未正面；与F01之间同样只有一个小步'
  ];
  return {
    version: 1, standard: STANDARD, note: 'Angles are drawing targets, never measured proof of a generated picture. One output per target; no 360° duplicate.',
    generationOrder: [
      {stage: 'anchors', frames: Array.from({length:12}, (_,j) => userFrame(j*2)), rule: 'Generate/check one 2D anchor at a time; original master controls identity. Neighbour references only control the turn. Verify before using as endpoint.'},
      {stage: 'inbetweens', frames: Array.from({length:12}, (_,j) => userFrame(j*2+1)), rule: 'One image-generation call produces one midpoint drawing between accepted endpoints. Compare A→M→B; do not redraw endpoints.'}
    ],
    frames: views.map((cue,i) => ({
      index:i, frame:userFrame(i), file:`frame-${String(i).padStart(4,'0')}.png`, targetYaw:i*15,
      role:i%2?'inbetween':'anchor', previous:userFrame((i+23)%24), next:userFrame((i+1)%24),
      bracket:i%2?[userFrame(i-1),userFrame((i+1)%24)]:null,
      cue, ...squashAt(i), delayMs:80
    }))
  };
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const out=process.argv[2];
  if(!out) throw new Error('Usage: node scripts/standard.mjs NEW_FRAME_PLAN.json');
  await fs.writeFile(out,JSON.stringify(framePlan(),null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({plan:path.resolve(out),standard:STANDARD.id,frames:STANDARD.frames}));
}
