# 首款四卡内测展示文案草案

日期：2026-10-12（Asia/Shanghai）。修订：presentation-draft-1。状态：**待作者审读的展示候选，未批准、未转写或运行**。仅新增本文件；核心题目、选项、贡献、边界、目标、顺序、四份baseline与见证保留 `e8ba8108c30168c8120f0b05354c8821c1d787f9`，不重新修改。

## 来源与接入边界

- 内容来源：[四卡内测draft-2](FIRST_PRODUCT_CONTENT_DRAFT.md)。作者已选择李白/苏轼/陶渊明/白居易四卡内测草案；这不批准本次展示文案、人物画作、素材商用或发布。
- 方向来源：[folio主方向与cabinet收藏语言](D1A1_VISUAL_DECISION.md)、[Visual V2-C藏馆收束](VISUAL_V2_C.md)、[四厅研究](VISUAL_V2_QUESTIONS.md)及现有房间定义。历史研究的固定李白、五维图谱、时代/生平/相似人物内容不带入本稿；本稿只对齐已经选定的四维、四卡。
- P3来源：按总控指定只读读取 `codex/catalog-workspace` worktree中的 `docs/PRESENTATION_P3_PREFLIGHT.md`，连续两次读取大小/修改时间一致（13,323 bytes）；读取内容SHA-256为 `a08bb587b0e358cb02c5c454b3c1099adf6aabedce2d34715b8bb82eb760633c`。该文档状态为推荐方向已采纳、计划未实现、待合同审查冻结；本稿不把其字段或限长当作正式Schema。

本稿为未来content.v2准备有限纯文本与引用草案：封面场景、四个sections、十二条questionFrames、四张resultCards和九项resourceDescriptions。字段归属依P3预检方向：分厅/题签/场景/alt随visualVersion固定，结果显示文案/原创短句随reportVersion固定；正式人物仍由既有结果的portraitRef绑定，baseline仍由reportTemplateRef绑定。此处不提供可导入JSON、组件三元组、包、路径型资源引用、网络地址、HTML、样式或源码。

### ID与引用状态

问题 `q01`–`q12`、结果 `li-bai` / `su-shi` / `tao-yuan-ming` / `bai-ju-yi` 已存在于选定draft-2，本稿逐字引用这些ID，不另建逻辑身份。它们在该草案中稳定，尚不代表正式包合同、Product身份或版本已冻结。

下文 `candidate-hall-*` 厅ID与 `candidate-*` 资源ID都是**本次新提出的candidate映射**，不是已登记资源。表格只用ID简写审读；未来完整引用须由P3固定Product、resource/content版本后补齐三元身份，不能用占位符构造有效Ref，不填造资源hash、尺寸、许可或approval。

## 中性封面场景说明

封面继续采用folio的无人物入馆情境：一册闭合的无字藏册置于展台，后方是青绿山水与院门；留出阅读标题的位置，以纸面、铜灯和低浓度山水连接后续四厅。没有可辨识人物、剪影、姓名、称号、人物标志物、分数、答案提示或预先匹配的卡片。

封面场景引用候选为 `candidate-cover-scene`，purpose为cover。它是独立中性封面槽位，不借任何一张结果人物画作作背景，也不因答案、进度或预期结果更换。现有中性概念素材只能在来源/权利、实际画面与审批复核后决定能否复用；本文不新增或批准图片。

封面标题沿用「千载同心」，副标题沿用「藏馆探寻 · 风骨映月」。建议只展示以下介绍：

> 走过四间藏厅，在十二个日常情境中选择此刻更愿意采用的做法。翻到最后一页，收藏一张与这次选择呼应的人物文化意象卡。

答题说明仍取核心草案的当前意愿口径，不新增题目规则。人物阵容表、人物alt及结果短句属于揭晓后内容，不送入封面、题目或恢复的消费者展示数据。

## 四厅文本与场景引用候选

厅名/章节名沿用既有方向；引导短文是本次候选。引导描述阅读节奏，不夸奖某种选择，不提示维度、人物或正确答案。场景位置由下节十二条明确映射决定，所有人看到同一序列。

| section ID（candidate）  | name：厅名 | chapter：章节名 | introduction：引导短文候选                               | sceneRef候选              | 连续题目ID    |
| ------------------------ | ---------- | --------------- | -------------------------------------------------------- | ------------------------- | ------------- |
| candidate-hall-jade      | 青玉门庭   | 入馆            | 推门入馆，先看清眼前的情境，再选此刻更愿意采用的做法。   | candidate-scene-jade      | q01、q02、q03 |
| candidate-hall-lamplight | 暖灯书室   | 观心            | 灯光落在页边，慢慢读完问笺，再留下这一页的选择。         | candidate-scene-lamplight | q04、q05、q06 |
| candidate-hall-rain      | 听雨回廊   | 照影            | 走过回廊，继续读眼前的情境；每种回应都有它的用途。       | candidate-scene-rain      | q07、q08、q09 |
| candidate-hall-stars     | 星穹内藏   | 留记            | 最后几页，依旧按此刻的想法选择；读完后再回看自己的行记。 | candidate-scene-stars     | q10、q11、q12 |

四厅场景purpose均为decoration；没有人物、脸、剪影、姓名、分数或结果关联。恢复展示只沿授权进度与本映射读取中性场景，不预判结果；保存、恢复或完成是否成功仍由实际状态决定，引导短文不假称已保存或已分析。

## 十二条questionFrames明确映射

caption沿用核心草案每题的短题签；不是替代题干，也不新增答案提示。每条questionRef恰一次，顺序与核心十二题一致。当前候选不使用sceneOverrideRef，实际场景全部取所属section.sceneRef；表中展开引用只为人工核对。

| 内容顺序 | questionRef ID | sectionId（candidate）   | caption：短题签 | 实际中性场景引用候选      |
| -------- | -------------- | ------------------------ | --------------- | ------------------------- |
| 1        | q01            | candidate-hall-jade      | 归物            | candidate-scene-jade      |
| 2        | q02            | candidate-hall-jade      | 新页            | candidate-scene-jade      |
| 3        | q03            | candidate-hall-jade      | 择路            | candidate-scene-jade      |
| 4        | q04            | candidate-hall-lamplight | 留白            | candidate-scene-lamplight |
| 5        | q05            | candidate-hall-lamplight | 传意            | candidate-scene-lamplight |
| 6        | q06            | candidate-hall-lamplight | 一改            | candidate-scene-lamplight |
| 7        | q07            | candidate-hall-rain      | 同议            | candidate-scene-rain      |
| 8        | q08            | candidate-hall-rain      | 应邀            | candidate-scene-rain      |
| 9        | q09            | candidate-hall-rain      | 共页            | candidate-scene-rain      |
| 10       | q10            | candidate-hall-stars     | 续页            | candidate-scene-stars     |
| 11       | q11            | candidate-hall-stars     | 一周            | candidate-scene-stars     |
| 12       | q12            | candidate-hall-stars     | 归册            | candidate-scene-stars     |

四厅各有三题是这份内容的明确分组，不是组件内的“每三题切厅”算法。接入时逐条读取questionRef/sectionId；不得按序号除以三、答案内容、分数或Product ID推断厅景。分厅不跳题、筛题、改变题干/选项，也不改变评分输入。返回、修改或取消答案仍使用相同问题对应场景；未来改分组须更新版本与审核证据。

## 揭晓后四张resultCards文本候选

displayName采用人物名；subtitle沿用核心baseline称号；posterLine逐字沿用核心草案的原创短句，kind为original。原创是编辑声明，非历史人物原话、典籍引文或商用批准。posterDisclosure沿用核心海报的娱乐说明；不新增时代、生平、相似人物、排名、概率、诊断或宿命解释。

| resultRef ID  | displayName | subtitle：短副标题 | posterLine：原创一句       | posterDisclosure：娱乐说明           |
| ------------- | ----------- | ------------------ | -------------------------- | ------------------------------------ |
| li-bai        | 李白        | 开卷寻光者         | 把好奇翻开，让心意成页。   | 娱乐性格测评 · 文化意象 · 非心理诊断 |
| su-shi        | 苏轼        | 共鸣织意者         | 让想法有声，让回应成页。   | 娱乐性格测评 · 文化意象 · 非心理诊断 |
| tao-yuan-ming | 陶渊明      | 自择守序者         | 自选一程，把今日稳稳写下。 | 娱乐性格测评 · 文化意象 · 非心理诊断 |
| bai-ju-yi     | 白居易      | 同行成事者         | 听清彼此，把约定落在今日。 | 娱乐性格测评 · 文化意象 · 非心理诊断 |

揭晓引导沿用「这次选择，映出这张人物意象卡」，收藏区可使用「收藏这张人物意象卡」作为候选区标题；不新增业务按钮或导出成功提示。实际导出/分享可用性由对应能力与授权决定。

四份报告继续使用原baseline；合同字段strengths对应的用户端标题保持**「这张卡可借用的做法」**，不写成固有优势或能力认证。该栏目语义由受控报告组件承载，不把短句塞进strengths/reflection，不依Product ID硬编码。卡片名字/称号与真实四维分数分开显示，不能用目标向量冒充用户分数或用图画推断人格。

## 九项resourceDescriptions候选与alt

以下alt是**与拟用画面brief对应的替代文本草案**，不是已经查看/验收的图片描述。实际图片定稿后应逐项核对可见内容，必要时修订alt并更新完整内容/资源证据；不能把尚未存在的画面描述当成图片已经生成。neutral/portrait的用途边界须在P3引用验证与消费者投影中落实。

| resourceRef候选ID（未登记）      | purpose    | 用途/场景brief                                                                     | alt候选                                                                      |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| candidate-cover-scene            | cover      | 独立中性入馆封面：闭合无字藏册、展台、青绿山水与院门，无人物。                     | 一册闭合的无字藏册置于展台，后方是青绿山水与院门，画面没有人物。             |
| candidate-scene-jade             | decoration | 青玉门庭：晨光、层叠拱门、铜灯与无字册页，不出现身份线索。                         | 晨光穿过青玉拱门，照在铜灯和无字册页旁，展厅里没有人物。                     |
| candidate-scene-lamplight        | decoration | 暖灯书室：纸灯、藏架与空白册页，保留读题的安定感，无人物。                         | 暖金纸灯照亮藏架和空白册页，室内没有人物。                                   |
| candidate-scene-rain             | decoration | 听雨回廊：圆窗、雨中庭院、竹影、展台与灯，无人物。                                 | 圆窗外是雨中的庭院与竹影，近处摆着展台和灯，回廊里没有人物。                 |
| candidate-scene-stars            | decoration | 星穹内藏：靛夜空间、克制星光、展台与闭合无字藏册，不揭露藏册内容。                 | 靛夜星光下的内藏室里，展台上放着闭合的无字藏册，画面没有人物。               |
| candidate-portrait-li-bai        | portrait   | 李白编辑意象画作：人物站立、手持闭合无字藏册，背景为淡山水。                       | 李白的编辑意象画作，人物站立并手持一册无字藏册，身后是淡山水。               |
| candidate-portrait-su-shi        | portrait   | 苏轼编辑意象画作：人物坐于案边、手托无字册页，身体略向观者转，背景留白。           | 苏轼的编辑意象画作，人物坐在案边，一手托起无字册页，身后留白。               |
| candidate-portrait-tao-yuan-ming | portrait   | 陶渊明编辑意象画作：人物立于窗边、双手收拢无字藏册，窗外少量植物。                 | 陶渊明的编辑意象画作，人物立于窗边，双手收拢无字藏册，窗外可见植物。         |
| candidate-portrait-bai-ju-yi     | portrait   | 白居易编辑意象画作：人物坐于案边、一手扶摊开的无字册页、另一手指向页边，背景留白。 | 白居易的编辑意象画作，人物坐在案边，一手扶着摊开的无字册页，另一手指向页边。 |

### 人物需图brief与pending引用

四幅人物画只在揭晓后使用，沿既定细笔设色/轻水墨与浅纸、深青收藏面保持一致阅读语言。姓名由结果数据提供，不在图内嵌字；姿态/场景是原创表现提案，不声称真实肖像、服饰复原、历史经历或人物性格依据。脸部、手部和人物辨识须逐人审读，不仅换脸、换衣色或沿用同一人物图。

| 稳定result ID | results.portraitRef候选映射      | 资源准备状态/待审重点                                                                                             |
| ------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| li-bai        | candidate-portrait-li-bai        | pending；既有李白概念图不自动满足本brief或商业批准，需核对实际形象、来源、权利、裁切与alt；可复用与否由审核决定。 |
| su-shi        | candidate-portrait-su-shi        | pending；需独立人物定稿及来源/商用/再分发证据，审核案边构图、手部、辨识与alt。                                    |
| tao-yuan-ming | candidate-portrait-tao-yuan-ming | pending；需独立人物定稿及来源/商用/再分发证据，审核窗边构图、双手、辨识与alt。                                    |
| bai-ju-yi     | candidate-portrait-bai-ju-yi     | pending；需独立人物定稿及来源/商用/再分发证据，审核摊册/指页动作、辨识与alt。                                     |

这些候选只供准备：没有新图片、母版或衍生文件，没有正式portraitRef登记或许可字段。结果、报告、海报应从同一结果绑定读取对应人物资源；派生裁取也须保留来源、用途和证据。缺图或ID错配应明确不可用，不借另一人物、Emoji或装饰图代替。最终图片/alt和读屏行为要实际审阅，本文不代表作者视觉批准。

## 与核心评分逻辑独立

本稿只引用核心问题/结果身份，不读取答案、贡献、目标或距离来选场景，不改变选项/规则/平分顺序，不创建真实分数。分厅与题签只组织阅读；四卡文案只展示已经确定的结果，不反向选择人物。题目/选项/评分ID与原型目标仍取选定draft-2；本线不修改核心文件。

依P3预检方向，展示文本/场景/alt/短句不进入算术投影，但仍须进入完整内容与各视觉/报告版本证据。后续仅改展示时，需实际验证精确评分/结果不变，并使相应预览/审核证据失效再审；本文不冒称logicHash分离、content.v2或运行器已经实现。也不借视觉独立为理由免除文案与素材审核。

## 缺项与后续人工验收清单

本次不向作者重复提问。展示候选交总控在P3/P5依赖具备后集中审阅，保留以下未完成项：

- P3合同审查冻结字段、限长、ID/完整引用及注册版本；将十二条映射与四卡引用正式转写，检查恰一次覆盖、跨Product/版本与资源使用闭合。P2当前不因此获得接收未验证v2的能力。
- 作者审读封面中性、四厅引导与十二题签，确认无选项诱导或未揭晓身份；在消费者DTO、alt、预加载/网络请求中实际检查人物隔离，不只隐藏画面。
- 审读四张displayName/副标题/原创短句/娱乐说明与四份baseline一致，保留“这张卡可借用的做法”；不能添时代、生平、相似人物或把原创句冒充人物原话。
- 定稿九个拟用资源槽位的实际来源、权利/商用/再分发批准、hash/尺寸/版本与alt；四人画作及新文字字体覆盖分别核对。candidate引用不能当作已存在资源通过验证。
- 在320/375/390/430 CSS px及桌面实际截图检查封面、四厅切换、返回/恢复、揭晓、报告、四张真实海报；正文≥16px、触达≥44px、无横向溢出，长文/缺图/缺字/加载错误/减少动态均可读。
- 实际iOS Safari与Android Chrome及读屏检查场景/人物alt、标题阅读顺序、正文与图文重复、手脸裁切与真实PNG。自动截图、引擎测试或旧合成预览不代替作者视觉/内容批准。

## 本线检查与停止边界

本线实际通过 `corepack pnpm dlx prettier@3.9.10 --check docs/FIRST_PRODUCT_PRESENTATION_DRAFT.md`、暂存diff/新增文件范围检查与临时文本映射核对：十二个问题ID/题签恰一次且四厅连续覆盖，四个结果ID/称号/短句与核心一致，九个candidate资源闭合为1封面/4厅景/4人物且均有alt。原创短句最长13、alt最长38个code points，仅核对P3预检建议范围，不把未冻结限值称为Schema通过。核心文件与 `e8ba8108c30168c8120f0b05354c8821c1d787f9` 逐字相同；文档检查不等于兼容/评分或视觉验收。

没有运行服务器/浏览器、业务测试、DB、包构建或生成/采购素材，没有修改依赖或其他文档，不创建PR、合并main或部署。本展示稿待审读，完成本文件提交推送后停止供总控后续P3/P5接入；四卡内测选择不自动批准展示、商业资源或发布。
