# 角色姿态生成与定点修补

## 参考的角色

- 原设定图：身份、服装、色彩、不对称细节的权威。
- 已检查的正面坐姿：Q版比例、画风、坐姿的权威。
- 相邻已检查姿态：转身方向、遮挡、尾巴和发饰连续性的参考。

先用 `view_image` 查看本地输入图，再通过图片生成工具的引用路径传入。图片生成负责角色内容；裁切拼图、配准、格式转换与导出由确定性脚本处理。

单张角色的有效分辨率应满足最后 512 输出，通常至少约 512 像素高。拼图总像素不等于每个角色的像素；检查生成文件的真实尺寸和每格可见内容。多格结果过小时改为较少格或逐张生成，不放大已有小图。

## 正面坐姿提示词示例

把方括号替换成实际观察，不直接保留占位符：

> Create a high-resolution chibi seated version of the character in the reference. Preserve [specific hair, face, palette, outfit, accessories, asymmetric features]. A large head and compact body, sitting on the bottom with [fixed leg and hand arrangement], cheerful expression. Keep [reference style]. Entire silhouette visible, true transparent background. Front-facing, fixed orthographic camera, character upright around one vertical head/torso axis. No floor, cast shadow, checkerboard, text, or extra figures. Do not bake squash, stretch, bounce, or rotation into this base pose.

## 方向组提示词示例

可从 0、30、60……330 度规划整圈，但将这些度数视为**绘制目标**，不能把标签当作实测角度。通常每组 3–4 张，引用同一正面坐姿并附上相邻已接受姿态。

> Draw [N] clearly separated high-resolution poses of the SAME seated chibi character, at consecutive yaw targets [angles], where 0 is front and 180 is back, rotating toward [image left/right]. Match the approved reference's identity, skull size, outfit, seated pose and line style. Camera, lighting, pelvis position and seated baseline stay fixed. Hair, ears, tail and clothing turn WITH the body with plausible progressive occlusion. [List visible and hidden features for this interval.] Do not duplicate the same angle. No squash or stretch yet. Equal cells with transparent gutters; full silhouette inside every cell. True transparent background, no labels, grid, shadows or extra characters.

对于非对称设计明确写出“角色自身左／右”及图像中对应位置，不能把正面“图像左侧”沿用到背面。

## 分段检查与修补

| 现象 | 优先处理 |
| --- | --- |
| 多帧几乎相同，随后突然转过去 | 改关键姿态的方向分配；补画中间角度 |
| 尾巴或手突然换侧、出现或消失 | 检查部件归属和遮挡顺序；补画遮挡变化 |
| 面部／服装细节漂移 | 以正面坐姿和邻帧共同作为身份参考 |
| 轮廓晃动 | 检查头／躯干轴和坐姿锚点，不用全图质心定位 |
| 配准后出现融化或双影 | 缩短补间跨度、调整对应点或改为直接绘制 |
| 最后回第一帧卡顿 | 检查 330→0 区间，不追加一张重复的 360 度正面 |

修补只替换失败区间，并同时查看前后邻帧。生成图若没有改善可弃用，但记录哪些图进入了成品，不声称弃用图已用于动画。
