# Q版坐姿弹转 GIF · chibi-squash-spin

一个 Codex 技能：根据人物设定图制作同角色的 Q 版坐姿、Q 弹压扁拉长、绕竖轴旋转的透明 GIF。

默认同时输出 **256×256 和 512×512**，每圈 2.4 秒、60 帧，并保留 RGBA PNG 母版。图片生成工具负责角色姿态，附带脚本负责对齐、局部配准、弹性和导出；脚本本身不是文生图模型。

## 安装

需要 Node.js 22 或更新版本，以及 PATH 中的 FFmpeg。角色生成需要 Codex 中可用的内置图片生成工具。

```sh
git clone https://github.com/SSSimpleC/chibi-squash-spin.git ~/.codex/skills/chibi-squash-spin
cd ~/.codex/skills/chibi-squash-spin
npm ci
```

然后在新对话中附上角色图并调用：

> 使用 $chibi-squash-spin，把这张人物设定图制作成 Q 版坐姿、Q 弹旋转的透明 GIF，同时导出 256×256 和 512×512 两个规格。

完整工作流见 [SKILL.md](SKILL.md)，脚本参数见 [pipeline](references/pipeline.md)。用户可覆盖默认尺寸、时长和 Q 弹强度。

## 开发检查

```sh
npm test
node scripts/spin.mjs --help
```

测试使用生成的几何样例检查对齐、周期、双尺寸和 GIF 透明度，不代表任何新角色已通过视觉验收。配准补间不能自动解决错误身份、缺失角度或复杂遮挡；这些需要检查和补画。

GIF 仅支持有限颜色与二值透明，完整 alpha 保存在 PNG 中。本仓库不包含用户角色原图、生成素材、应用数据或个人机器路径，也不会自动导入或修改 RunCat。
