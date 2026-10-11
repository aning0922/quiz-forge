# D1-A.1 交付、验证与阶段审查

日期：2026-10-11（Asia/Shanghai）。作者转述D1-A工程范围及两方案价值已通过外部审查，本轮已明确folio主方向＋cabinet揭晓/收藏语言。D1-A.1改动待阶段审查，不把上次通过推广到本次新增内容或商用素材。

## 交付范围

从独立仓库和现有 `codex/d1a-historical-visual`、干净基线 `89123610611f58e964a2cb94493769678a64a858` 开始，fetch核对正式origin/main。没有改其他项目、main、数据库、Key、评分、AI后台或D1-B答题/恢复。

- 单套定向Token及封面/结果静态预览。封面只有中性山水；结果深青人物卡＋浅纸人物志长卷。
- 七类展示槽位和只读DTO提案，合成fixture；未知肖像不回退默认人物，空相似列表不补造。
- 原研究原型保留，比较页标为留档并导向统一预览；26张原始截图保持不变，回归截图改写到忽略的test-results，避免覆盖历史证据。
- 人物揭晓规则、统一角色规范、字体子集/审批风险，以及D1-B/C验收计划已记录。
- 14张新截图：两页面×四视口全页8张、390首屏2张、reduce2张、缺素材2张。

## 预览和前后证据

- [未揭晓封面](http://127.0.0.1:3100/studies/historical/selected/cover)
- [合成结果及七槽位长卷](http://127.0.0.1:3100/studies/historical/selected/result)
- [原始研究留档](http://127.0.0.1:3100/studies/historical)

| 比较         | 改动前：基线8912361                                                                  | 改动后：D1-A.1                                                                |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 封面390×844  | [folio含李白示例](qa/d1a/historical-folio-cover-390x844-chromium-156-first.png)      | [中性山水，无具体人物](qa/d1a1/selected-cover-390x844-chromium-156-first.png) |
| 揭晓390×844  | [cabinet人物档案](qa/d1a/historical-cabinet-portrait-390x844-chromium-156-first.png) | [统一揭晓卡](qa/d1a1/selected-result-390x844-chromium-156-first.png)          |
| 结果信息全页 | [原档案少量解读](qa/d1a/historical-cabinet-portrait-390x844-chromium-156-full.png)   | [七类槽位长卷](qa/d1a1/selected-result-390x844-chromium-156-full.png)         |
| 桌面构图     | [原folio封面](qa/d1a/historical-folio-cover-1440x1000-chromium-156-full.png)         | [中性封面＋阅读栏](qa/d1a1/selected-cover-1440x1000-chromium-156-full.png)    |

全部新证据见 [截图索引](qa/d1a1/README.md)。原始截图从给定Git基线保留，不重新生成“改动前”图片。

## 浏览器检查

Playwright生产构建独占3100，不复用未知服务器；原任务保留的预览服务器先核实PID/cwd后停止。Chromium156、DPR1，375×812、390×844、430×932、1440×1000。截图矩阵使用桌面UA的CSS视口模拟；另有Pixel7模拟UA的核心揭晓/信息槽位导航测试，不冒充实机。

助手已查看实际截图：未揭晓封面无人物和名字，标题安全区清晰，右侧竖排仅是短装饰；深青卡的姓名、称号与人物轮廓分层，浅紙长卷独立阅读。深青卡沿用山水材质、同一宋体/章序/印章与金线；原cabinet月轮不延用。程序通过不代表作者审美/内容通过。

浏览器断言：封面SSR不含李白/称号/立绘URL，无portrait请求；研究入口明确synthetic，点击仅导航。结果七类槽位可读、无百分比和业务按钮，长卷锚点可用。320宽、段落放大24px无横向溢出，链接44×44，减少动效、背景/人物失败均检查，question/resume路径404。

## 工程检查

| 检查         | 实际结果                       |
| ------------ | ------------------------------ |
| format:check | 通过                           |
| lint         | 通过，无警告                   |
| typecheck    | 通过                           |
| test         | 6项通过（新增3项揭晓边界）     |
| build        | 通过，静态生成15页             |
| test:e2e     | 34项通过、10项有意跳过重复矩阵 |

首轮构建出现CSS索引可能undefined与单测React泛型cast错误，已修正显式空类名与测试ComponentType。构建失败时启动E2E没有生产BUILD_ID而失败，随后按build成功→E2E顺序重跑通过；最终格式检查报告新增Playwright文件需格式化，重格式化后完整check通过；没有把失败启动计作浏览器通过。

## Git/PR/CI

本轮相关差异检查后独立提交并推送现有开发分支；面向main创建Draft PR。最终SHA、PR和CI运行结果见交付消息及GitHub记录。本地检查不能代替GitHub Actions成功；现有workflow检查冻结安装/格式/lint/类型/6项单测/构建，不运行Playwright。PR不会自动合并或部署。本轮未改变CI配置；远端CI状态只能在PR创建后核实，最终以交付所链接run为准。

## 仍待完成与阶段退出

方向已定；AI素材商业依据与作者素材审批仍pending，服饰/史实核验未完成。新标题字体仅385字，新增文案需重导；正文跨OS一致性与Safari/iOS/Android实机仍待验证。相似人物和维度是合成示例，不是题库/评分/诊断依据。正式揭晓依赖后续可信服务与权限，当前DTO/静态研究路由不实现该权威。完整角色库、正式报告快照、海报绘制/导出/保存尚未完成。

D1-B/C计划见 `D1A1_VISUAL_DECISION.md`。本轮提交、Draft PR和实际CI核验交付后停止，等待阶段审查；不得自动开发答题或恢复。
