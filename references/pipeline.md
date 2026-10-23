# v2：144px 像素直接序列流程

依赖 Node.js >=22、`npm ci`、PATH 中的 FFmpeg。工具不画角色，不做时间补间。旧版 12 朝向 + 控制点配置不能直接当作 v2 输入；需先补齐真实旋转源帧。旧实现保存在 Git 历史中。

## 1. 整理完整源序列

默认至少 24 帧。每张 PNG 或拼图裁块代表一个真实不同朝向，均为同一自然高度，尚未 Q 弹。所有源图保留在任务目录。

创建 `config.json`：

```json
{
  "style": "pixel",
  "sizes": [144],
  "paletteColours": 48,
  "margin": 0.045,
  "squashMin": 0.6666666666666666,
  "bounces": 2,
  "keyframes": [
    {"angle": 0, "file": "source/frame-0000.png", "anchor": [0.5, 0.95]},
    {"angle": 15, "file": "source/frame-0001.png", "anchor": [0.5, 0.95]}
  ]
}
```

示例只展示前两项；实际必须有完整的 24…96 项，等间隔覆盖 0…360，末尾不复制 360 度。24 帧时角度为 0、15……345；36 帧时为 0、10……350。`frames` 通常省略，自动使用源图数量；不能设置为更大值以扩增稀疏朝向。

`anchor` 是裁块内归一化的 `[头／躯干旋转轴x, 坐姿接触底线y]`，不是全图质心。源图来自拼图时可加 `crop:{left,top,width,height}`，单位为实际像素，anchor 相对于裁块。路径相对于配置文件。

默认每张 80ms；24 张为 1.92 秒。需要改变速度时可设置 `durationSeconds`，要求每帧是至少 20ms 的 10ms 整数倍。Q 弹总是按实际 N 帧计算两次周期，不给同一方向加额外帧。

## 2. 先制作、检查纯旋转

```sh
node scripts/spin.mjs prepare /path/to/config.json /path/to/job/prepared
```

输出目录必须不存在。`prepare`：

- 检查帧数、角度标签和源高矮；源高相对于画布变化超过 15% 时拒绝疑似预制 Q 弹。这个检查不能证明姿态正确。
- 以头／躯干轴和坐姿底线统一登记，最多保留轻微源比例差的高度校正，不删除独立配饰。
- 以最近邻映射到 144 网格，alpha 二值化、全圈共用最多 48 色调色板，避免逐帧独立量化引起颜色闪烁。
- 预留整圈最大横向拉伸需要的画布；拒绝在登记后完全相同的姿态。
- 导出 `poses/`、`rotation-only-144.gif`、`rotation-contact.png`、`rotation-diagnostics.json`、`manifest.json` 与 `rotation-review.template.json`。

实际观看纯旋转 GIF，并检查接触表及可疑相邻帧。复制模板为 `rotation-review.json`，记录检查者、证据、具体观察与结论。不能用脚本批量勾选模拟观察，也不能为了绕过门槛修改工具。

以下检查全部合格后才能设置 `status: "passed"`：二头身、短脚收拢、双手在两侧、原人物神态、身份服饰稳定、无预制 Q 弹、每帧转向推进、正侧背完整、首尾连续、像素画风。`observations` 分别记录比例、神态、正转侧、背面半圈、回正面、首尾的真实表现。

诊断中的像素差和角度标签仅提供检查入口，不证明正确旋转。若存在少量方向反复保持、变脸、动作改变或突然换装，状态必须为 needs-repair，回到源图修补。

## 3. 最后施加 Q 弹

```sh
node scripts/spin.mjs render /path/to/job/prepared /path/to/job/output
node scripts/spin.mjs validate /path/to/job/output
```

`render` 要求有效的纯旋转检查记录，记录必须匹配当前源序列摘要。**源帧 i → 成品帧 i**，无时间插值、淡入淡出、镜像、纹理切换或重复朝向。源图更换后需要重新 prepare 和观察。

缩放公式：`sy=(1+squashMin)/2+(1-squashMin)/2*cos(2π*bounces*i/N)`，`sx=1/sy`。围绕固定轴／坐姿底线用最近邻做横竖缩放，像素颜色不会因平滑滤波新增。

成品输出：`spin-144.gif`、`rotation-only-144.gif`、`frames-144/`、`pose-only/`、`contact-sheet.png`、`validation.json` 和 `reproduction.json`。自动检查覆盖帧数一一对应、无重复中性帧、统一色板、硬 alpha、边界、时序和 GIF 残影；`visualReview` 保持 pending，等待成品观察。

需要放大观察时，只用整数倍最近邻预览或浏览器 `image-rendering: pixelated`，不要把放大预览当作另一个真实像素规格。调尺寸或 Q 弹强度时从原始像素素材重新 prepare，不能直接放大已压缩 GIF。
