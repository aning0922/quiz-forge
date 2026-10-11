# D1-A 素材制作与来源

日期：2026-10-11（Asia/Shanghai）。所有AI图为已生成概念素材、待人工审核，不能标为商用approved。

## 已制作

| 素材                               | 来源/制作                                                          | 当前状态                           | 授权依据与限制                                                            |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| 李白概念立绘                       | 内置imagegen，原创描述，无人物参考图；1024×1536 RGBA→800×1200 WebP | review                             | 尚未附账户适用条款/商用审核证据，待作者审阅人物/服饰/IP适用性             |
| 青绿山水宣纸背景                   | 内置imagegen，原创提示词，无参考图；1024×1536→900×1350 WebP        | review                             | 同上；背景不带人物/文字/印章                                              |
| 印章、卷轴分隔线、云纹、双层藏品框 | 本项目原创CSS/SVG/程序文字                                         | review                             | 工程原创，无外部素材；视觉适用性待审                                      |
| 宋体标题500/600子集                | Noto Serif SC，Google Fonts v36分发，397字/标点，自托管TTF         | license-documented / visual-review | SIL OFL 1.1已附本地；不可单独售卖字体，保留版权和许可证；新增标题重导子集 |

字体来源：[Google Fonts Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc)，[OFL授权原文](https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt)。字体允许按OFL条件嵌入并随软件分发。本轮只使用明确子集，未声称完整中文覆盖。

字节/哈希/提示词/裁切焦点见manifest。原始图在内置工具产物目录留存，Git仅保存项目使用的优化版，没有运行依赖指向本机缓存。格式/缩放导出由现有Next依赖Sharp完成，不改变人物/背景内容；未新增依赖。

## 待补齐

1. 作者选择方向并审核代表人物的美术/文化适用性；确认系列名与标题。
2. AI商用依据、实际审核人/日期和素材授权记录，目前均null。
3. 正式低噪纸纹单独资源：本轮封面背景有纸纹，阅读面用纯色。D0独立reading-texture仍pending，不假称已有。
4. 正式海报边框/母版与字体导出覆盖，D1-C才做真实导出；网页CSS框不是已完成海报素材。
5. 跨设备正文黑体方案与完整长文子集，iOS/Android实机字体/裁切验证。
6. 历史人物结果原型清单和扩展角色数量未定；不扩完整角色库。

## 原始生成提示词（实际使用）

### li-bai-concept / prompt-v1

```text
Use case: stylized-concept. Asset type: original transparent portrait illustration for a premium Chinese historical personality visual prototype. Subject: an artistic interpretation of Tang poet Li Bai, Chinese man around 35, slender dignified face, small moustache and neat short beard, long black hair in a simple topknot, warm ivory wide-sleeved Tang-inspired robes with muted jade-green inner layer and narrow dark belt. Standing three-quarter view facing left, face turned slightly toward viewer, serene confident expression; one hand gently holds a slim bamboo scroll, other hand rests naturally, exactly two hands anatomically correct. Show complete head, both hands, robe silhouette to calves with ample crop safety, graceful breeze in flowing sleeves. Fine contemporary Chinese gongbi illustration mixed with delicate ink washes, nuanced silk folds, expressive refined face, mineral green and tiny antique gold details, museum-quality editorial art, no anime/game character imitation, no armor, no fantasy weapon, no existing IP reference. Isolated on truly transparent background, no scene, no text, no watermark, no frame, no seal. Tall 2:3 composition, beautiful detailed original character, natural soft directional lighting, low contrast ink edges.
```

请求参数：`transparent_background=true`。实测有透明通道，alpha范围0–254，WebP导出保留alpha。人物最终姿态/服饰有模型演绎差异，不能仅凭提示词判通过。

### jade-landscape / prompt-v1

```text
Use case: stylized-concept. Asset type: vertical background painting for a refined mobile Chinese cultural editorial interface. No people and no text. Original Chinese mineral-green landscape with gongbi detail and soft ink wash on warm ivory fibrous xuan paper. Very tall 2:3 artwork. Top 40 percent is luminous almost-empty warm paper and pale atmospheric mist, quiet safe area for typography. Lower 60 percent has layered soft jade and teal mountains, dark pine silhouettes toward bottom left, small gold and ochre touches on mountain ridges, winding pale river, faded distant peaks, white space in center-right where a portrait will be overlaid. Sophisticated light hand-painted silk and paper grain, museum painting finish, calm elegant restrained Chinese landscape, not geometric polygons, no frame, no seal, no logo, no watermark, no buildings, no writing. Fine detail in lower scene but upper area extremely quiet.
```

请求参数：`transparent_background=false`。生成有细密画纸纤维，阅读区不直接复用整幅山水。

## D1-A.1 延续

作者已定folio主方向＋cabinet揭晓语言，未改变素材的商用/人物批准字段。封面复用无人物山水；新增定向标题子集385字见 `public/assets/fonts/d1a1/`，与旧397字研究子集分开。统一角色规范、缺图/未知ID及未揭晓素材隔离见 `D1A1_VISUAL_DECISION.md`。
