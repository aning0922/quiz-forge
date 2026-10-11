# 核心数据模型（D0 规划）

以下是业务约束和拟议关系，没有已建表或迁移。ID 暂规划 UUID；版本内容使用版本化 JSON/规范化子表的组合，最终存储形状在数据库阶段评审。

| 概念                  | 关键字段（拟议）                                                                                                                         | 关系与约束                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| QuizPack              | id、packId、packVersion、formatVersion、manifest、hash、compatibility、importStatus                                                      | ID/版本唯一；同版本不同哈希拒绝；validated 不等于人工批准           |
| QuizPackImport        | id、packId、hash、validationReport、status、reviewer、createdAt                                                                          | 原包/验证证据绑定；staged/validated/imported/rejected；失败无半发布 |
| QuizDefinition        | id、slug、title、engineType、status                                                                                                      | 1:N QuizVersion；slug 唯一；身份与内容版本分离                      |
| QuizVersion           | id、definitionId、version、schemaVersion、engineVersion、status、contentHash                                                             | 同测评版本号唯一；发布后不可编辑；可由不同商品视觉复用              |
| Question              | id、versionId、stableId、prompt、order、nodeId?                                                                                          | 版本内 ID/顺序唯一；剧情节点关联；不跨版本引用                      |
| Option                | id、questionId、stableId、label、order                                                                                                   | 选项归属校验；不能接受客户端分数                                    |
| ScoringRule           | id、versionId、kind、schemaVersion、config                                                                                               | 三引擎数据合同；有限值、有效引用、无执行代码                        |
| ResultProfile         | id、versionId、stableId、title、traits、content                                                                                          | 原型/结局属于本逻辑版本；视觉资源映射由视觉版本提供                 |
| ThemeDefinition       | id、slug、version、tokens、componentRecipes、motionRules、status                                                                         | Theme System；不可变已审核设计语言，可多商品共用                    |
| AssetPack             | id、version、manifest、hash、approvalStatus                                                                                              | 商品独立或共享；路径/尺寸/类型/授权/审核；缺必需素材阻断发布        |
| ProductVisualVersion  | id、productId、version、themeVersionId、assetPackRefs、layoutRefs、interactionRefs、profileAssetMap                                      | 逻辑与素材解耦；一逻辑可对应多个视觉版本                            |
| PageLayout            | id、visualVersionId、state、registryId、componentVersion、propsSchemaVersion、config                                                     | cover/question/resume/result/report/poster；只引用审核注册组件      |
| ComponentRegistration | registryId、componentVersion、propsSchemaVersion、capabilities、runtimeRange                                                             | 由主工程受控发布管理，包不能新增可执行组件；旧引用需保留            |
| ReportTemplate        | id、version、mode、baselineTemplate、compositionRules、resultRecipe、reportRecipe、posterRecipe                                          | DETERMINISTIC/COMPOSED/AI_ENHANCED；完整非 AI 基线必需              |
| Product               | id、slug、title、currentPublishedVersionId、status                                                                                       | 商品稳定身份；draft/published/paused；发布指针变更不改旧会话        |
| ProductVersion        | id、productId、version、quizPackId、quizVersionId、visualVersionId、reportTemplateVersionId、componentRefs、status                       | 固定完整发布组合；不可变；升级/回滚只影响新激活                     |
| FulfillmentAdapter    | id、type、configRef、enabled、authorizationRef                                                                                           | 程序注册渠道，密钥外置，无授权不可启用                              |
| AccessKey             | id、tokenDigest、productId、pinnedProductVersionId、status、expiresAt?、completedAt?                                                     | 摘要唯一；一 Key 最多正式完成一次及一个报告                         |
| QuizSession           | id、accessKeyId、productVersionId、quizVersionId、answers、branchState、revision、status                                                 | accessKeyId 唯一；暂存/恢复，完成后答案锁定                         |
| QuizReport            | id、accessKeyId、sessionId、answersSnapshot、scores、matchedProfile、ending、versions、mode、baselineSnapshot、finalSnapshot、sealStatus | Key/session 唯一；提交保存结论与完整基线；最终快照仅封存一次        |
| AIReportJob           | id、reportId、idempotencyKey、providerRequestId、status、attempts、deadline、outputHash                                                  | reportId 唯一；最多接受一次成功增强；未知远端成功不盲重试           |

`pinnedProductVersionId` 表示首次激活固定的 ProductVersion，其中绑定 QuizPack、QuizVersion、ProductVisualVersion、AssetPack、ReportTemplate 和专属组件版本。未激活 Key 默认首次激活绑定当前批准版本；之后 Product 升级/回滚均不改变进行中会话与已完成报告。

## 生命周期

- Draft → Review → Published：Schema 校验、评分夹具、完整素材与作者审核通过后发布；发布版本不再修改，返修创建新版本。
- issued → active：首次激活固定完整发布组合，创建唯一会话；重进恢复同一会话。
- active → completed：仅完整提交事务可消耗；同事务保存答案、评分、原型/结局、报告版本与完整非 AI 基线；AI 模式同时持久化唯一增强任务。网络超时重试返回原报告。
- completed：原链接读取报告；不会返回新问卷、清空答案或重算。已完成结果不能随 Product 更新而变化。
- revoked/expired：禁止新答题和正式提交。已完成报告的到期/撤销可见性需业务确认，默认需求是继续可读；不要静默用 Key 过期破坏已购结果。

## 发布完整性

QuizPack 结构/兼容/安全与规则夹具通过；测评版本、题/选项、评分和原型一致；ProductVisualVersion 支持引擎，五基础状态及详细报告布局有绑定；所有注册组件可用；三模式都有完整非 AI 模板；素材授权与人工审核证据齐全。自动 valid 不等于内容正确，不能用方向简报当已发布主题。

## 数据合同与评分

拟议 `quiz.schema.v1` 包含 engineType、dimensions、questions/options、scoringConfig、profiles。使用 discriminated union 区分三引擎。运行时验证：最大题数/长度、稳定 ID 唯一、选项归属、全部引用、有限数字、维度定义、原型匹配/平分策略、分支目标和终止边界。拒绝额外可执行字段、无效路径和提示词注入导致的代码输出。

草稿校验只说明结构符合合同；需作者检查题意、解释公平性、文化内容与娱乐边界。版本化生成提示词及生成任务记录是未来治理概念，D0 未实现 AI Schema 校验器。

## 并发、留存与隐私

唯一约束是一次完成的最终防线，事务隔离/行锁处理重复提交。服务端再次验证答案；不信任客户端得分。暂存 revision 防止多端互相覆盖，冲突需提示或明确接管。发布版本被会话/报告引用时不硬删除。

保存报告时快照答案、评分、原型/结局、结果文案与展示参数，并固定素材内容哈希、商品包和组件版本。素材版本需长期可寻址，避免仅存活动 CDN URL 导致旧报告丢图。未来报告 Schema 升级做向后兼容读取，不重跑评分。

运营身份、生成任务、交付幂等记录与审计日志是后续辅助表；D0 不扩大为完整 ERP。正式上线前明确答案与报告保存时间、删除规则和备份恢复。Key 原文、答案、报告默认私密，分享使用单独授权；不将访问链接绘制到公开海报。

## 报告封存与可选 AI

DETERMINISTIC 和 COMPOSED 在提交时立即封存 finalSnapshot。AI_ENHANCED 的答案/分数/原型/基线从提交时不变，sealStatus=enhancement-pending；唯一任务成功或失败/超时后通过比较更新封存一次最终快照，迟到响应不得修改。没有模型服务时直接封存完整基线，历史访问不重新请求模型。详见 `REPORT_MODES.md`。

报告 mode 与模板选择属于 ProductVersion，不能让前端随意要求另一种生成方式。AI 输出只增补受控文案字段，不改变匹配、分数或结局。任务表本地唯一不能单独保证外部供应商 exactly-once；需幂等/查询能力，否则未知成功回退不重试。

## 编辑、升级与回滚

后台题库/结果/素材编辑产生新的草稿包和商品版本，重新验证/人工审核后发布。对外 .quizpack 包必须能导出一致的数据与资产引用；原导入包作为审计证据保留。回滚切换当前发布指针，旧版本、资源、注册组件和报告 Schema 保持可读，不重新评分历史报告。
