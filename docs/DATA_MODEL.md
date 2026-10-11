# 核心数据模型（P2-A/B1实现与后续规划）

P2-A已实现qf.operator、operator_session、audit_event及qf_meta.schema_migrations。P2-B1已追加product、category、tag、product_tag，已完成技术验收。真实字段、权限、锁序与CAS以[目录合同](STUDIO_P2B1.md)为准；运营metadata_revision与未来草稿content revision分离。Product使用包的稳定字符串ID，category/tag使用服务器UUID，不能把下方历史拟议UUID一概套到Product。

B2-1候选已追加quizpack_import，当前共八张业务表；真实DB与权限检查进行中，尚未完成阶段验收。以下保留D0/F1业务约束和后续完整商品关系，其余实体尚未建立。当前Product只有运营身份/slug/title/主类目FK/metadata_revision/时间/归档字段，没有published指针或内容发布状态。草稿、资源、版本、Key和报告仍待后续追加迁移；B2-1的quizpack_import只记录接收意图、原字节冻结与显式恢复；实施合同见[STUDIO_P2B2](STUDIO_P2B2.md)，received不代表ZIP/内容或资源验证通过。完整草稿/blob/asset模型仍属后续批次。

| 概念                  | 关键字段（拟议）                                                                                                                         | 关系与约束                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| QuizPack              | id、packId、packVersion、formatVersion、manifest、hash、compatibility、importStatus                                                      | ID/版本唯一；同版本不同哈希拒绝；validated 不等于人工批准                                       |
| QuizPackImport        | id、productId、幂等key/指纹、声明bytes/hash、target、接收stateRevision/fence/attempts、实际bytes/hash及时间                              | B2-1已实现接收候选；received仅表示原字节冻结，不能代表验证、审核或草稿导入                      |
| QuizPackValidation    | importId、稳定validationKey、validator/policy身份、独立状态、不可变候选与报告、asset-set hash                                            | B2-2提案；原接收事实不因复验失败而改写，运行故障与内容拒绝分开                                  |
| QuizDefinition        | id、slug、title、engineType、status                                                                                                      | 1:N QuizVersion；slug 唯一；身份与内容版本分离                                                  |
| QuizVersion           | id、definitionId、version、schemaVersion、engineVersion、status、contentHash                                                             | 同测评版本号唯一；发布后不可编辑；同一 Product 可绑定不同视觉版本；跨 Product 通过模板复制/冻结 |
| Question              | id、versionId、stableId、prompt、order、nodeId?                                                                                          | 版本内 ID/顺序唯一；剧情节点关联；不跨版本引用                                                  |
| Option                | id、questionId、stableId、label、order                                                                                                   | 选项归属校验；不能接受客户端分数                                                                |
| ScoringRule           | id、versionId、kind、schemaVersion、config                                                                                               | 三引擎数据合同；有限值、有效引用、无执行代码                                                    |
| ResultProfile         | id、versionId、stableId、title、traits、content                                                                                          | 原型/结局属于本逻辑版本；视觉资源映射由视觉版本提供                                             |
| ThemeDefinition       | id、slug、version、tokens、componentRecipes、motionRules、status                                                                         | Theme System；不可变已审核设计语言，可多商品共用                                                |
| AssetPack             | id、version、manifest、hash、approvalStatus                                                                                              | 商品独立或共享；路径/尺寸/类型/授权/审核；缺必需素材阻断发布                                    |
| ProductVisualVersion  | id、productId、version、themeVersionId、assetPackRefs、layoutRefs、interactionRefs、profileAssetMap                                      | 逻辑与素材解耦；一逻辑可对应多个视觉版本                                                        |
| PageLayout            | id、visualVersionId、state、registryId、componentVersion、propsSchemaVersion、config                                                     | cover/question/resume/result/report/poster；只引用审核注册组件                                  |
| ComponentRegistration | registryId、componentVersion、propsSchemaVersion、capabilities、runtimeRange                                                             | 由主工程受控发布管理，包不能新增可执行组件；旧引用需保留                                        |
| ReportTemplate        | id、version、mode、baselineTemplate、compositionRules、resultRecipe、reportRecipe、posterRecipe                                          | DETERMINISTIC/COMPOSED/AI_ENHANCED；完整非 AI 基线必需                                          |
| Product               | id、slug、title、currentPublishedVersionId、status                                                                                       | 商品稳定身份；draft/published/paused；发布指针变更不改旧会话                                    |
| ProductVersion        | id、productId、version、quizPackId、quizVersionId、visualVersionId、reportTemplateVersionId、componentRefs、status                       | 固定完整发布组合；不可变；升级/回滚只影响新激活                                                 |
| FulfillmentAdapter    | id、type、configRef、enabled、authorizationRef                                                                                           | 程序注册渠道，密钥外置，无授权不可启用                                                          |
| AccessKey             | id、tokenDigest、productId、pinnedProductVersionId、status、expiresAt?、completedAt?                                                     | 摘要唯一；一 Key 最多正式完成一次及一个报告                                                     |
| QuizSession           | id、accessKeyId、productVersionId、quizVersionId、answers、branchState、revision、status                                                 | accessKeyId 唯一；暂存/恢复，完成后答案锁定                                                     |
| QuizReport            | id、accessKeyId、sessionId、answersSnapshot、scores、matchedProfile、ending、versions、mode、baselineSnapshot、finalSnapshot、sealStatus | Key/session 唯一；提交保存结论与完整基线；最终快照仅封存一次                                    |
| AIReportJob           | id、reportId、idempotencyKey、providerRequestId、status、attempts、deadline、outputHash                                                  | reportId 唯一；最多接受一次成功增强；未知远端成功不盲重试                                       |

`Product` 是一个测评的唯一稳定工作区身份，不另设 `QuizProject`。`QuizDefinition`/`QuizVersion`、`ProductVisualVersion`、`ReportTemplate` 和商品私有 `AssetPack` 均需带有可验证的 product 归属，且由 ProductVersion 一次性冻结。不同 Product 不共享可变题目；未来可复用题组必须有单独版本并在发布时复制/冻结。

已实现category/tag及product_tag。Product以primary_category_id表达单一主类目，不另建ProductCategory多对多表；标签关联使用product/tag复合主键和每Product唯一slot(1..8)形成数据库硬上限。归档保留唯一身份和旧引用，新增分配要求active；不删除实体。Collection/CollectionProduct仍预留。目录组织不决定评分引擎或改写题目/报告。

为草稿与资源导入预留的最小实体是 `ProductDraft(productId, revision, contentHash, state)`、`AssetBlob(contentHash, storageKey, mediaType, bytes)`、`AssetPackVersion`、`AssetPackItem`、`QuizPackImport`、`QuizPackImportFile` 与 `ValidationEvidence`。其字段/约束由 `ASSESSMENT_RESOURCES.md` 进一步说明；此处不表示已经有表或对象存储。

`pinnedProductVersionId` 表示首次激活固定的 ProductVersion，其中绑定 QuizPack、QuizVersion、ProductVisualVersion、AssetPack、ReportTemplate 和专属组件版本。未激活 Key 默认首次激活绑定当前批准版本；之后 Product 升级/回滚均不改变进行中会话与已完成报告。

## 生命周期

消费者访问不要求账号。公开 Product 介绍必须从 published 版本投影安全字段；完整题库、评分规则和报告为受保护内容。演示独立授权，不等价于正式会话。

- Draft → Review → Published：Schema 校验、评分夹具、完整素材与作者审核通过后发布；发布版本不再修改，返修创建新版本。
- issued → active：首次激活固定完整发布组合，创建唯一会话；重进恢复同一会话。
- active → completed：仅完整提交事务可消耗；同事务保存答案、评分、原型/结局、报告版本与完整非 AI 基线；AI 模式同时持久化唯一增强任务。网络超时重试返回原报告。
- completed：原链接读取报告；不会返回新问卷、清空答案或重算。已完成结果不能随 Product 更新而变化。
- revoked/expired：禁止新答题和正式提交。已完成报告的到期/撤销可见性需业务确认，默认需求是继续可读；不要静默用 Key 过期破坏已购结果。

未来草稿生命周期为 `editing → validating → review → sealed`，另创建 published ProductVersion；F1 仅有 editing 草稿纯逻辑，不实现这些服务端状态迁移；编辑携带 expected revision，服务端只在匹配时更新并递增 revision。内容 hash 绑定验证证据和资源清单，编辑后 hash 改变即需重新验证。发布把草稿的依赖复制/固定为新的 ProductVersion，草稿不再原地变成已发布内容；下一轮编辑创建新草稿。

## 发布完整性

QuizPack 结构/兼容/安全与规则夹具通过；测评版本、题/选项、评分和原型一致；ProductVisualVersion 支持引擎，五基础状态及详细报告布局有绑定；所有注册组件可用；三模式都有完整非 AI 模板；素材授权与人工审核证据齐全。自动 valid 不等于内容正确，不能用方向简报当已发布主题。

## 数据合同与评分

拟议 `quiz.schema.v1` 包含 engineType、dimensions、questions/options、scoringConfig、profiles。使用 discriminated union 区分三引擎。运行时验证：最大题数/长度、稳定 ID 唯一、选项归属、全部引用、有限数字、维度定义、原型匹配/平分策略、分支目标和终止边界。拒绝额外可执行字段、无效路径和提示词注入导致的代码输出。

草稿校验只说明结构符合合同；需作者检查题意、解释公平性、文化内容与娱乐边界。版本化生成提示词及生成任务记录是未来治理概念，D0 未实现 AI Schema 校验器。

## 并发、留存与隐私

唯一约束是一次完成的最终防线，事务隔离/行锁处理重复提交。服务端再次验证答案；不信任客户端得分。暂存 revision 防止多端互相覆盖，冲突需提示或明确接管。发布版本被会话/报告引用时不硬删除。

保存报告时快照答案、评分、原型/结局、结果文案与展示参数，并固定素材内容哈希、商品包和组件版本。素材版本需长期可寻址，避免仅存活动 CDN URL 导致旧报告丢图。未来报告 Schema 升级做向后兼容读取，不重跑评分。

资源对象与数据库记录不是同一事务。B2-1先在数据库确认幂等意图和带fence的接收尝试，再于事务外接收并冻结私有原字节，最后以新事务确认当前身份与状态；received仅表示未验证原包。下一批验证与归档成功后才允许 AssetBlob/AssetPackVersion 被发布引用。若数据库事务或对象移动失败，服务必须保留可审计状态并安排删除/重试补偿，不能把孤儿对象当作已批准素材，亦不能让缺失对象进入 ProductVersion。

正式数据库阶段先建立最小纵向闭环所需的 Product/Draft/Version、Asset、AccessKey/Session/Report 与必要运营身份表，再扩展导入、分享、AI、支付和统计。每个迁移必须可重复运行并在隔离 PostgreSQL 上验证 upgrade/rollback 兼容；生产迁移和真实连接不属于 F1。

运营身份、生成任务、交付幂等记录与审计日志是后续辅助表；D0 不扩大为完整 ERP。正式上线前明确答案与报告保存时间、删除规则和备份恢复。Key 原文、答案、报告默认私密，分享使用单独授权；不将访问链接绘制到公开海报。

## 报告封存与可选 AI

DETERMINISTIC 和 COMPOSED 在提交时立即封存 finalSnapshot。AI_ENHANCED 的答案/分数/原型/基线从提交时不变，sealStatus=enhancement-pending；唯一任务成功或失败/超时后通过比较更新封存一次最终快照，迟到响应不得修改。没有模型服务时直接封存完整基线，历史访问不重新请求模型。详见 `REPORT_MODES.md`。

报告 mode 与模板选择属于 ProductVersion，不能让前端随意要求另一种生成方式。AI 输出只增补受控文案字段，不改变匹配、分数或结局。任务表本地唯一不能单独保证外部供应商 exactly-once；需幂等/查询能力，否则未知成功回退不重试。

## 编辑、升级与回滚

后台题库/结果/素材编辑产生新的草稿包和商品版本，重新验证/人工审核后发布。对外 .quizpack 包必须能导出一致的数据与资产引用；原导入包作为审计证据保留。回滚切换当前发布指针，旧版本、资源、注册组件和报告 Schema 保持可读，不重新评分历史报告。

## 消费者访问所需数据补充（仅规划）

| 概念/扩展           | 最少拟议字段                                                          | 边界                                                                  |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Product 公共投影    | slug、发布版本、介绍、批准封面、娱乐说明、demoRefs                    | 仅 published；不包含题库、规则、Key、私密结果                         |
| ProductDemo         | id、productVersionId、approvedScope、fixtureRefs、status              | 作者明确批准的演示，与正式会话/报告隔离                               |
| AccessGrant         | id、accessKeyId、sessionId?、reportId?、tokenDigest、scope、expiresAt | Key 交换后的匿名会话授权；play/read-report 权限区分，不能获得后台权限 |
| ReportShareGrant    | id、reportId、tokenDigest、allowedFields、revokedAt?                  | 用户主动创建、独立只读；分享摘要不含 Key/原访问链接/私密答案          |
| UserKeyLink（未来） | accountId、accessKeyId、linkedAt、proofRef                            | 每 Key 最多一个账号归属，多个 Key 可关联同账号；需持有证明和主动确认  |

AccessKey 的 productId/固定 ProductVersion 参与每次正式授权校验；完整提交仍由唯一约束和事务完成。普通消费者不需要 Account 行，账号关联后也不能增加次数或重算报告。管理身份与消费者 AccessGrant 独立。

completed Key 的原链接交换为只读报告授权；active Key 可恢复同一会话。答题到期与报告可读留存分别处理，不因正常答题到期破坏既有结果。shareToken 不具备 play、submit 或账号关联权限。资源 ID 不是访问凭证，所有读取/修改均验证对应 grant，后续以越权和并发测试核实。本轮未创建上述表或路由。
