
# Star 普通小猫素材

主角为橘白猫，猫爪替代原素材中的虾钳。使用内置 ImageGen 编辑生成，保留待机座椅、工位椅、休息床和困惑表情。源动画图保存在 source-atlas.png；empty-bed.png 是原同步素材的空床帧，不包含角色。

scripts/build_cat_sprites.py 只做裁切、最近邻缩放和动画表装配，不绘制或改色。它保持两种客户端和迷你桌宠现有的纹理名称、帧尺寸、网格尺寸和播放范围，避免影响素材管理。静态空床在同步表的第 0、48 帧，防止非同步状态显示第二只主角。工作表末尾两个未使用的格子保持透明。关键动作按原帧数延长，保留眨眼、打字、睡眠呼吸和困惑动作。

运行：python scripts/build_cat_sprites.py

下面保留实际使用的生成提示词。
Create a production-ready TRANSPARENT pixel-art sprite atlas for the Star Office UI game. The referenced images show the old artwork. Use them ONLY for the orange-and-white kitten's face, colors, pixel style and chair/bed proportions. REPLACE all lobster/crab claws with small natural furry CAT PAWS, remove all shell armor. Repair any corrupted colored stripes in the old references. Every sprite is the SAME cute ordinary orange tabby kitten with white muzzle, white chest, small rounded white paws, orange tail, dark brown pixel outlines, no extra limbs, no lobster motifs.

Output ONE square 1024x1024 RGBA sprite atlas on fully transparent background, EXACTLY 4 columns by 4 rows, each cell exactly 256x256. No borders, gridlines, text, labels or numbers. Keep every sprite entirely inside its cell with at least 20px transparent margin. Cell centers and furniture stay aligned across frames in each row. Sharp chunky pixel-art like the references, no gradients, no blur, no photorealism. Row-major layout:
ROW 1 (idle): the kitten sits relaxed in the beige armchair from reference1. Four consecutive loop frames: open eyes and relaxed front paws; subtle breath/tail shift; brief closed-eye blink; eyes open again. Chair geometry absolutely identical all four cells. Entire chair about 190px tall and centered in the 256px cell.
ROW 2 (working): same kitten sitting upright on the small brown rolling office chair from reference2, without any corrupted background. Small normal cat paws alternately reach forward to type on an unseen keyboard; keep arms low enough to fit behind the game's desk overlay. Four subtly different typing loop poses. Same chair in every cell, total chair+cat height about 200px, centered.
ROW 3 (sync/rest): same kitten curled up sleeping on the beige bed with cream pillow and small wooden bedside table/lamp from reference3. Natural white cat paws tucked under its head, NO RED CLAWS. Four subtly different breathing poses, exactly same bed position. Bed fills roughly 216x216 pixels centered.
ROW 4 (error): same kitten standing upright with normal paws, concerned but cute. Four consecutive puzzled poses: paw at cheek; paw scratching ear; other paw raised slightly; returns to first stance. One small pixel question mark above head. No glitched background. Cat total height about 170px including question mark centered in cell.
These 16 individual images will be sliced into real game animations; perfect 4x4 cell alignment and complete transparency between sprites are essential.

Edit this generated 4x4 sprite atlas to make it safe for a pixel-art game. Preserve the SAME normal orange-white tabby kitten, beige armchair, brown office chair, sleeping bed and concerned standing kitten, exact 4 columns x 4 rows and frame alignment. The kitten must have only normal furry cat paws and zero lobster claws.
Two essential fixes:
1. REMOVE every bright red, yellow or green stray pixel, fringe, colored halo and speckle OUTSIDE the sprites. Sprite boundaries must be a clean sharp dark-brown outline bordering fully TRANSPARENT pixels. No red matte line anywhere. Do not soften edges. Retain the cat's orange fur and pink ear interiors.
2. Add comfortable transparent padding inside EVERY 4x4 cell: every sprite including bed and lamp must fit entirely inside the central 80% of its cell, no element touches a cell edge. Keep furniture geometry, pixel positions and size aligned consistently across all four frames in each row. Fix the last bed so it is complete rather than touching the atlas edge.
Final output a square PNG atlas, ideally 1024x1024 pixels with 16 cells of 256x256. Entire space between sprites fully transparent (true alpha zero), no gridlines, no shadows outside contours, no text. Preserve the sharp chunky retro pixel style. This is a cleanup of the atlas, not a redesign.