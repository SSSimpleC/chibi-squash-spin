# 制作命令与记录

依赖Node.js≥22、`npm ci`、PATH中的FFmpeg。脚本不画角色、不制造旋转、不做时间补间。先读 [standard.md](standard.md)；只对真实二维生成素材做机械处理。

## 1. 帧表与配置

```sh
node scripts/standard.mjs /path/to/job/frame-plan.json
```

输出24帧的目标角、前后关系、补画端点、80ms时长及Q弹比例。帧表是计划，不是验收。

`config.json` 使用固定标准，省略的参数由脚本填入：

```json
{
  "profile": "pixel-144-24-v1",
  "keyframes": [
    {"angle": 0, "file": "source/frame-0000.png", "anchor": [0.5, 0.95]},
    {"angle": 15, "file": "source/frame-0001.png", "anchor": [0.5, 0.95]}
  ]
}
```

这里只展示两项；实际须有24项0、15…345°。F01对应frame-0000.png，F24对应frame-0023.png。不能重复360°或为了凑帧数复用文件。路径相对于配置文件。

`anchor` 是裁块内归一化的 `[头/躯干旋转轴x, 坐姿接触底线y]`，必须观察后标定，不是轮廓中心或全图质心。旧拼图素材可以加 `crop:{left,top,width,height}`，anchor相对于裁块。不要把所有图的任意透明边界当作身体轴。

默认标准会拒绝未经说明的尺寸、帧数、时长、色板、边距或Q弹参数漂移。用户明确改规格时才设 `profile:"custom"`、`specChangeReason`，并显式写改变的参数；自定义仍要求24…96个等角度目标、源帧与成品帧一一对应、像素风及完整验收。不能以custom绕过旋转失败。

## 2. 登记与纯旋转

```sh
node scripts/spin.mjs prepare /path/to/job/config.json /path/to/job/prepared
```

目标目录必须不存在。prepare会：

- 检查帧数、角度目标、完全重复帧及明显源高度异常。源高度跨度超过15%是自动拒绝线，不是允许15%身体变形的视觉标准。
- 按同一坐姿底线/转轴登记，以各源帧高度校准轻微生成尺寸差。该校准不能修头身比例或独立扭头；画面仍须检查。
- 统一保留最大横向拉伸空间，最近邻映射到144网格、硬alpha、整圈共享最多48槽调色板。
- 输出 `poses/`、`manifest.json`、`rotation-only-144.gif`、`rotation-contact.png`、全部 `rotation-windows/window-Fxx.png`、诊断和检查模板。

## 3. 相邻对与顺序验收

```sh
node scripts/audit-rotation.mjs create /path/to/job/prepared /path/to/job/audit
```

按 [quality.md](quality.md) 检查。只把 `images/` 和 `answers.template.json` 给盲检者，不给答案键。实际查看后写 `answers.json`，再核对：

```sh
node scripts/audit-rotation.mjs validate /path/to/job/audit
```

`rotation-review.template.json` 复制为 `rotation-review.json`，填写：

- `blindAudit`: 相对于prepared的审核目录路径，如 `../audit`。
- `steps`: 24个有序前进步，含首尾；实际看三帧窗口，写forward、小且近似均匀、头身共转、身份稳定及具体证据。未确认就不填通过。
- 比例、神态、各段、首尾的整体观察、检查者、实际证据路径；最终status只有真实合格才为passed。

无角度相邻对检查只能判断是否有转向；有序窗口检查方向和步幅；整圈播放与母版对比检查动画观感和身份。三者不能互相替代。审核与当前姿态像素摘要绑定；源图更换后重做prepare和审核。

## 4. 渲染与成品检查

```sh
node scripts/spin.mjs render /path/to/job/prepared /path/to/job/output
node scripts/spin.mjs validate /path/to/job/output
```

render要求相邻对、顺序步与整体记录通过。源姿态i只生成成品帧i；按standard中的余弦周期做固定底线的最近邻横竖缩放，不复制方向或混合角色图。

输出：`spin-144.gif`、`rotation-only-144.gif`、`frames-144/`、`pose-only/`、两种接触表、`rotation-audit/`、`rotation-windows/`、`validation.json`、`reproduction.json`。默认帧数24、80ms/帧、1.92秒，画面144×144。

自动检查覆盖格式、硬alpha、颜色、边界、GIF残影、摘要及审核记录完整性，不会判断人物是否真的转了15°。`visualReview` 保持pending，完成实际成品观察后才更新。最近邻放大图仅用于检查，不是额外分辨率成品。
