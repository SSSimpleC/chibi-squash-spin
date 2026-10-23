# 动画工具与输入约定

在技能目录执行 `npm ci`。系统需要 Node.js >=22 和 FFmpeg；脚本不调用外部付费 API，不负责生成角色插画。所有输出目录必须尚不存在；修订使用新目录，避免覆盖已接受版本。

## 配置

文件路径相对于配置文件。`anchor` 为 `[旋转轴x, 坐姿底线y]`，在裁切后的图像内归一化到 0–1；例如 800×800 图像上锚点为 (400,760)，填写 `[0.5,0.95]`。它是人体轴线和接触点，不是包含尾巴的轮廓中点。

```json
{
  "sizes": [256, 512],
  "frames": 60,
  "durationSeconds": 2.4,
  "margin": 0.05,
  "squashMin": 0.6666666666666666,
  "bounces": 2,
  "keyframes": [
    {"angle": 0, "file": "source/front.png", "anchor": [0.5, 0.95]},
    {"angle": 30, "file": "source/turn-030.png", "anchor": [0.5, 0.95]},
    {"angle": 60, "file": "source/turn-060.png", "anchor": [0.5, 0.95]},
    {"angle": 90, "file": "source/turn-090.png", "anchor": [0.5, 0.95]},
    {"angle": 120, "file": "source/turn-120.png", "anchor": [0.5, 0.95]},
    {"angle": 150, "file": "source/turn-150.png", "anchor": [0.5, 0.95]},
    {"angle": 180, "file": "source/back.png", "anchor": [0.5, 0.95]},
    {"angle": 210, "file": "source/turn-210.png", "anchor": [0.5, 0.95]},
    {"angle": 240, "file": "source/turn-240.png", "anchor": [0.5, 0.95]},
    {"angle": 270, "file": "source/turn-270.png", "anchor": [0.5, 0.95]},
    {"angle": 300, "file": "source/turn-300.png", "anchor": [0.5, 0.95]},
    {"angle": 330, "file": "source/turn-330.png", "anchor": [0.5, 0.95]}
  ]
}
```

这些路径和锚点只是格式示例，必须按实际素材填写。来自拼图的姿态可加 `"crop":{"left":0,"top":0,"width":800,"height":800}`；先查看分格，不能假定 AI 严格遵守网格。保留所有属于角色的透明分离部件。

## 登记姿态

```sh
node scripts/spin.mjs prepare /path/to/config.json /path/to/job/prepared
```

`prepared/poses` 是同一正方形画布、统一高度、轴线居中、底线固定的 RGBA 姿态。`manifest.json` 保存源图与转换信息；`keyframes-contact.png` 供视觉检查。

目标高度由整圈最大左右轮廓及最大横向拉伸共同决定，外圈默认保留 5% 留白，小尺寸至少留出 4 像素供重采样使用。默认拒绝把源角色放大；`allowUpscale: true` 仅适合用户明确接受或低分辨率回归检查，不可将其描述为高分辨率重绘。

## 对应点和局部补间

在 **prepared/poses 输出图**上标记对应点，除以 `masterSize` 得到归一化坐标。每个区间提供相同数量、相同语义顺序的点；通常覆盖头部中心、头顶、身体轴线、裙摆／脚、两侧轮廓，以及移动配饰。不要把已经遮挡的手硬对应到另一只手。

将所有需要插值的区间存为 `transitions.json` 数组：

```json
[
  {
    "fromAngle": 0,
    "toAngle": 30,
    "fromPoints": [[0.50,0.35],[0.50,0.60],[0.50,0.90],[0.36,0.55],[0.64,0.55]],
    "toPoints":   [[0.50,0.35],[0.50,0.60],[0.50,0.90],[0.38,0.55],[0.63,0.55]]
  }
]
```

这只是一个区间的格式示例，不能直接复用于任意角色。默认 12 关键姿态需要补齐全部 12 个区间，最后是 `330 -> 0`；控制点必须在 (0,1) 内，脚本自动添加固定画布边界点。每区间 3–64 对，无重复点。需要时增加近邻关键姿态，减少插值跨度。若已经直接画好 60 帧并标为 0、6……354 度，则不需要任何补间点。

工具使用反向薄板样条配准、预乘 alpha 纹理采样和距离场轮廓插值。它不能恢复原图不存在的三维结构，也不会保证脸部和遮挡自动正确。

## 渲染与验证

```sh
node scripts/spin.mjs render /path/to/job/prepared /path/to/job/output /path/to/transitions.json
node scripts/spin.mjs validate /path/to/job/output
```

Q 弹公式：`sy=(1+squashMin)/2+(1-squashMin)/2*cos(2π*bounces*i/frames)`，`sx=1/sy`。所有帧围绕相同锚点变形，i 取 0…frames−1，避免复制结束帧导致停顿。

GIF 使用全循环调色板，透明阈值 128/255；输出重新解码后，与 PNG 二值 alpha 掩码逐帧比较，检测累积残影。GIF 每帧时长必须是 10ms 的整倍数且至少 20ms；默认 40ms，60 帧正好 2.4 秒。

输出：

- `spin-256.gif`、`spin-512.gif`：双规格成品。
- `frames-512/`、`frames-256/`：同相位 RGBA PNG 帧。
- `pose-only/`：关闭 Q 弹的转身序列，用于定位姿态跳变。
- `contact-sheet.png`：完整帧接触表。
- `validation.json`：尺寸、时序、透明度、边界检查和可疑过渡；`visualReview` 默认 pending。
- `reproduction.json`：渲染配置和最终控制点。仍需保留 prepared 与源图才能完整重做。

`render` 中途失败时保留现场以便检查，修正后使用新的输出目录。若需要调整动画强度、周期或尺寸，修改配置并重新 prepare，避免跳过整圈边界计算。
