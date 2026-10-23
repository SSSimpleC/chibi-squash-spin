# 直接旋转源帧：身份、比例与像素风

## 参考优先级

1. 人物设定图决定身份与神态，逐项看头发／眼色、眼型与眼睑、眉毛、嘴角、情绪、服饰与配饰。
2. 用户给的二头身示例只决定比例；不要把示例的发色、衣服、表情套到目标角色上。
3. 已验收的正面像素坐姿决定简化后的同一模型。后续整圈都引用它，不能每组重新设计角色。

建议 `character-contract.json` 记录：`identityFeatures`、`expression`、`seatedPose`、`asymmetry`、`palette`、`backDesignInferences`、`basePoseReview`。内容应来自实际观察，不能用泛化的“可爱微笑”替代。

## 正面像素坐姿提示词

把括号内容替换为观察结果：

> Create ONE pixel-art sprite of the character from the identity reference. The second reference, if supplied, is ONLY a two-head-tall proportion example, not the character identity. Preserve [hair shape and colour, eye shape/eyelids/colour, eyebrow angle, mouth and emotional attitude, outfit, accessories, asymmetry]. Extremely compact super-deformed two-head-tall proportions; when seated the head from crown to chin is about 60% of the visible body height. Sit on the bottom, tiny bent legs tucked close under the outfit, small shoes close to the body. Both arms hang naturally at the body's sides with small hands beside the hips, NOT on knees. No long legs toward the camera, no large shoe soles. [Exact reference expression], no added smile unless the identity reference has it. Deliberate low-resolution pixel-art clusters, hard stepped outlines, limited coherent palette, readable at 144×144, no painterly detail, no smooth gradients or soft lighting. Full silhouette on genuine transparent alpha. Front view, fixed camera, neutral unsquashed proportions, no floor/shadow/text/checkerboard.

生成源图可能比 144 大，允许后处理映射到 144 像素网格，但源画本身应是像素风。检查头、手脚和表情后才继续；不能把生成器给出的高清二次元画直接缩小当作通过。

## 完整中性旋转序列提示词

优先 6 列 × 4 行的 24 帧整圈。角度是绘制目标，并非生成结果自动具有正确角度。相机固定，旋转的是同一个坐着的人偶；0 为正面，90 为一个侧面，180 为背面，270 为另一侧，345 回到近正面。选择一个方向后保持整圈一致。

> Make a complete 24-frame PIXEL-ART turntable sprite sheet of the EXACT same approved seated chibi model. Six equal columns, four equal rows, row-major chronological order. Frame yaw targets: row 1 [0,15,30,45,60,75]; row 2 [90,105,120,135,150,165]; row 3 [180,195,210,225,240,255]; row 4 [270,285,300,315,330,345]. Each adjacent frame advances a small equal yaw step; do not repeat a direction. Last frame is almost front so it wraps naturally to frame 0. Maintain the same large head, short tucked feet, both hands hanging at hips, exact expression, hair, clothes and accessories. No pose acting, blinking, facial changes, swaying, or changes in skull size. Hair/accessories rotate with the body and occlude progressively; [explicit asymmetry and rear design]. Lock camera, seated baseline, vertical head/torso axis, neutral height and light. ABSOLUTELY NO squash, stretch, bouncing or varying height in this sheet: elasticity is added later by code. Consistent pixel clusters and palette, crisp stepped outlines, no anti-aliased illustration style. One full isolated character per cell with transparent gutters, true alpha background, no grid lines, captions, numbers, floor or shadows.

给图片生成工具的参考应包括原设定与已接受的正面。不要把仍有长腿／神态错误的初版作为权威母版。

## 查漏与补画

- 对照帧 0/6/12/18 检查正面、侧面、背面、另一侧，随后逐帧检查其间的转向。不会仅因有 24 张图就验收。
- 针对失败区间引用前后正确邻帧与全圈母版，要求直接画缺失的中间姿态，不重画整个角色设计。
- 同一个朝向停留几帧后跳转：补真正的中间方向，而非多做几张压扁图。
- 配饰忽现、错侧或背面露出正面鞋：修正遮挡。不要用镜像或者纹理切换盖住。
- 神态漂移：重新指出眼睑、眼型、嘴形，不把“same character”当作足够约束。
- 源序列已经有明显高矮变化：重画为自然高度，之后才统一 Q 弹。
- 像素图边缘有模糊、柔光或插画渐变：回到像素风生成步骤，不能把清晰度下降当作像素风。

裁切必须按实际透明沟槽定位，检查边角配饰是否越格；保留属于角色的独立像素块，不能默认只取最大连通区域。背景不透明时使用图片生成工具修正透明背景，不能用会擦掉眼白／白衣的简单白色删除替代。
