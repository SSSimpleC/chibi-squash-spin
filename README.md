# 朋友的酒（DJ版）· 欧耶耶！144px 像素弹转梗图

**欧耶耶！开心比什么都贵！把你的角色做成坐着Q弹转圈的梗图。**

`chibi-squash-spin` 是一个Codex技能：根据人物设定与已接受的Q版母版，制作接近二头身、短脚收拢、双手垂在髋侧的纯二维像素角色。先绘制连续旋转，再加Q弹，输出透明GIF。

适合「朋友的酒旋转梗」「欧耶耶表情包」「开心比什么都贵」「像素Q弹旋转GIF」「坐姿转圈梗图」。[Bilibili动作参考](https://www.bilibili.com/video/BV1tRaH6oET9/)。BGM为《朋友的酒（DJ版）》；GIF无音轨，技能不附带歌曲或默认对拍。

## 统一标准

| 项目 | 默认值 |
| --- | --- |
| 像素画布 | 144×144，透明 |
| 整圈 | 24张真实方向，目标每帧15°，不复制360° |
| 时序 | 80ms/帧，一圈1.92秒 |
| Q弹 | 每圈2次；高100%–66.7%，宽100%–150%，固定坐姿底线 |
| 色板 | 全圈共享48槽，最近邻、硬alpha |

标准编号 `pixel-144-24-v1`。完整帧表和缩放公式见 [standard](references/standard.md)。15°是绘制目标，图像生成不保证精确遵守；逐帧实际验收是流程的一部分。

## 绘制与验收

- 复用合格Q版母版，保留眼型、眼睑、嘴形、服饰与左右配饰差异。
- 单次画一张二维方向图；先检查每30°的12张锚点，再用相邻端点逐张补12张15°中间帧。
- 每张中间图比较A→M→B，头和身体一起转。禁止几种朝向反复压扁、镜像凑帧、混合变形或纹理切换。
- 先看无角度标签相邻对，再看顺序三帧、整圈与首尾；停顿、倒转、跳跃和身份漂移都要修原画。
- 纯旋转通过才做Q弹。哈希不同、帧数齐全、脚本通过不代表转身正确；无法确认就保留needs-repair。

默认使用内置图片生成，纯二维绘制；不需要三维模型、ControlNet或本地大模型。当前流程对生成结果设置检查门槛，不承诺一次生成就能通过全部方向。

## 安装与使用

需要Node.js22+、FFmpeg，以及Codex可用的内置图片生成工具。

```sh
git clone https://github.com/SSSimpleC/chibi-squash-spin.git ~/.codex/skills/chibi-squash-spin
cd ~/.codex/skills/chibi-squash-spin
npm ci
```

附上设定图后输入：

> 使用 $chibi-squash-spin，保留这位角色的神态与Q版画风，按144px、24帧、每步15°的统一标准制作《朋友的酒（DJ版）》欧耶耶像素坐姿弹转GIF。先检查纯旋转，再加Q弹。

入口见 [SKILL.md](SKILL.md)，提示与调用方式见 [generation](references/generation.md)，操作命令见 [pipeline](references/pipeline.md)，验收见 [quality](references/quality.md)。脚本不自行生成角色，不修改RunCat；用户原图与生成角色素材不包含在公共仓库。

## 检查

```sh
npm test
node scripts/spin.mjs --help
```

测试覆盖固定规格、帧表首尾、周期缩放、直接帧对应、重复拒绝、视觉记录门槛、顺序步和盲检对照、变更后记录失效、共享色板与GIF残影。合成测试图只验证工具合同，不能证明某个角色已通过视觉验收。
