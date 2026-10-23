# 纯二维逐帧绘制：固定母版、两端约束、单帧补画

先读 [standard.md](standard.md)。使用内置 `image_gen` 及环境中的 imagegen 技能。不要自行引入3D模型、深度图、ControlNet或另一套模型安装流程；角色不稳或朝向失败，先修提示、引用关系与逐帧检查。

## 锁住角色；不重设计已接受的母版

查看原设定和已接受的正面坐姿。若后者已经合格，直接复用，不能因为修旋转重新设计比例、神态或画风。比例示例只提供二头身/姿势，不能提供身份。

`character-contract.json` 简短记录：眼型/眼睑/眉嘴/情绪、头发色块与分缕、衣服色块、饰品数量与人物自身左右、短脚与髋侧双手、推断的背面设计、母版路径及实际检查结果。区分人物左/右与画面左/右，不能在背面将大、小饰品换边。长发按固定发束形状随身体旋转，不另做飘动。

新角色尚无母版时，用以下提示并替换方括号；已有合格母版跳过：

> Use case: identity-preserve. Create ONE front-view 2D pixel sprite of [identity]. Preserve [observed eyelids, gaze, mouth, hair, clothes, accessories, asymmetry]. Compact seated two-head chibi: crown-to-chin head about 60% of seated height, tiny tucked feet, both hands hanging beside hips, no forward stretched legs or hands on knees. [Observed expression], not a default smile. Deliberate low-resolution pixel clusters and stepped outlines, limited palette, designed for 144×144; no smooth illustration shading. Full isolated silhouette, true transparent alpha, no floor, shadow, captions or grid. Neutral unsquashed height.

允许生成工具返回较大的像素风原图，再映射到144网格；不能把高清插画缩小后当作像素风合格。查看实际透明度、手脚、神态、画风后才继续。

## 调用顺序：12个方向锚点，再补12张中间帧

运行帧表工具。**每次调用只输出一个目标方向。** 不再默认让一张六格/二十四格表承担全部角度约束。

1. F01使用母版。绘制/检查F07=90°、F13=180°、F19=270°；这三张和母版共同确定背面与两侧设计。它们只是方向端点，不能复制成动画。
2. 依照帧表补齐偶数索引：30/60/120/150/210/240/300/330°。每次引用母版和包围目标的已检查二维方向图；角度目标写成“位于两端之间的1/3或2/3”。每个锚点实际观察合格后才供后续使用。原有素材若确实合格可复用，但旧标签不等于实际朝向。
3. 对每个30°区间只补一张15°中间帧：例如60°→**75°**→90°、150°→**165°**→180°；最后330°→**345°**→0°。新图不得复制任意端点。12个补画端点关系由帧表明确给出。
4. 一张新图出来后，先以共用尺度/轴线摆出A→M→B，判断推进与身份，再决定保留或修补。不要等24张都生成后才发现前面端点失效。

每次都显式提供本次需要的本地参考路径，先查看尚未看过的图片。一般只附3张：**图1母版只锁身份；图2前端A锁起点；图3后端B锁终点**。原设定已在合同/母版中体现，只有修身份问题才再附，避免参考数量过多、含角色无关图或失败稿。不要依赖上一轮对话中默认包含的图片。

## 单张中间帧调用模板

不需要冗长叠加“完美/绝对一致”；把差异与不变量写具体。下面模板的四个方括号必须依据实际A、B填写，不能只重复角度词：

> Use case: identity-preserve. Asset: ONE missing 2D pixel-animation drawing, not a sheet.
> Image 1 is the approved character/style master. Image 2 is earlier endpoint A [angle/view]; Image 3 is later endpoint B [angle/view]. Keep their exact compact seated character, expression, outfit, short feet and hands beside hips.
> Draw ONLY the missing midpoint M at [target] between A and B. The camera does not move. The whole seated head and torso turn together toward [screen direction], with the same height, skull size, axis and baseline. M must be visibly distinct from BOTH endpoints, halfway in turn progress; do not copy either endpoint or snap to a generic three-quarter/profile/back pose.
> Relative to A: [specific head geometry/occlusion change] AND [specific shoulder/chest/hand/hem projection change]. Relative to B: [what is still less turned/less occluded in M]. [Fixed asymmetric accessory's own-side and gradual occlusion]. These are changes in viewing direction, not hair movement, expression changes or redesigned clothing.
> Lock the master's pixel clusters, palette, restrained expression and silhouette design. No squash/stretch/bounce, no blinking or new pose, no mirror flip, no new accessories. Deliberate 144px-readable 2D pixel art, full transparent silhouette, no text/grid/background/shadow. Return ONE full character.

对近侧面：看脸颊宽度、鼻眼遮挡、前胸变窄与肩袖转向；不要要求任何发型都必须出现“第二只眼”。对近背面：看后脑/侧头、侧袖/手/裙摆与固定发饰的遮挡；胸被长发挡住时不能要求画出不存在的胸饰。目标是保持人物，不是人为加标记来证明转身。

## 调用后分析和修补

记录每次提示、参考角色、原始输出路径、目标帧、实际观察及 `accepted/needs-repair`。生成返回的目标角不写成测得角度。至少比较：

- A→M与M→B：分别前进了什么；是否一段停住、一段跳远；头和身体是否同向。
- 母版→M：眼睑/嘴形、头大小、手脚姿势、配饰数量与侧别、色块风格是否保持。
- 登记后144图：微小转向是否仍可见；源图有区别但缩小后相同，仍需修原画。

复制端点：只重画M，明确它与被复制端点之间缺少的头部和身体投影变化。中间帧越界或倒退：先复查A/B是否本身错误，再修M。两次同类提示无改善，缩小修补范围、修错误端点、减少无关引用或改写观察到的具体差异；不能默认重做母版、切3D路线或改帧数掩盖。

背景错误用图片生成修透明；裁切只处理实际边界，保留独立配饰像素，禁止删除白色当去背景。禁止镜像补半圈、复制朝向、跨帧混合、光流/TPS融化或把扭曲端点当新朝向。后处理只负责登记、像素映射、共享色板和通过后的Q弹。
