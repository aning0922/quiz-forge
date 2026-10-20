# 架构

2026-10-12：F1、P1和P2-A已在堆叠分支完成技术验收，main仍为下文D1-C基线。P1提供本地内容/资源合同、受限ZIP、真实图片验证、构建与CLI；P2-A提供隔离数据库、迁移、运营认证。P2-B1现已接入Product目录、单一主类目、8标签、CAS、归档恢复及真实HTTP/Studio，技术验收已完成，见[B1合同](STUDIO_P2B1.md)、[验收](P2B1_ACCEPTANCE.md)。所有新增能力仍在Draft PR #6–#9，没有自动进入main或生产环境。

B1的app路由只组合页面或调用HTTP适配层；features/studio负责可交互表单和受控DTO，features/product/workspace负责目录规则/应用服务/数据库访问，lib/auth的同事务鉴权在开始和提交前重验当前身份。错误提交不自动重发，界面保留冲突输入，目录自动刷新不能丢失未保存状态。运营metadata_revision独立于尚未实现的content revision。

B2-1已在Draft PR #10接入每个Product的原包接收列表、状态详情、上传与显式恢复，已完成代码技术验收，见[接收验收](P2B2_RECEIVE_ACCEPTANCE.md)。`app`只组合路由；`features/studio/imports`拥有浏览器状态与HTTP适配，`features/quizpack/import`拥有接收、配额、文件冻结和恢复服务。原字节存于受管实例私有目录，数据库保存不可变接收声明与实际字节事实。文件IO不占用鉴权事务，写入前后均检查当前权限；结果未知时先核实，不自动重复写。

媒体隔离可行性与B2-2A同字节P1可信桥接已技术验收，分别在Draft PR #11/#12；生产媒体模块使用受限launcher，实际Next构建与平台身份绑定，失去停止证明时保留未知状态。能力与限制见MEDIA_ISOLATION_ACCEPTANCE和P2B2A_ACCEPTANCE。

当前B2-2B已按[冻结合同](STUDIO_P2B2B.md)集成三表与真实事务、可信适配及统一私有存储内核，应用服务和后台页面仍在实施；尚未完成业务验收。`features/quizpack/server/validation`提供可信候选、同ctx身份准备与不再解码的恢复；`features/quizpack/validation`拥有验证记录/事务/归档应用服务；`features/studio`和app只使用安全DTO及领域接口。prepare→start使浏览器发送前保存固定验证标识，响应未知只查原key，已有key查证不依赖当前平台。原包接收事实不可被验证失败改写；资源物理blob与Product内不可变声明分开，统一storage锁和512MiB账本覆盖imports/validation/blobs。完整资源引用与ready在同一数据库事务确认，文件写入仍在事务外。后续顺序为B2-3首稿→有限编辑→结构预览/送审。评分预案和[P3表现预案](PRESENTATION_P3_PREFLIGHT.md)均未实现；拟保留content.v1并以有限content.v2表达分厅、题签、场景和海报，不开放包内代码或任意props。

## D1-C 与 F1 历史基线

截至 `b3e30bc`，已实现的是 Next.js 工程底座、主题与多轮历史人物**合成研究体验**、本机演示答题/恢复边界、只读 synthetic 报告展示，以及真实 PNG 海报导出的研究功能。D1-C 的 PNG 导出已经存在；它的输入仍是已批准研究路由提供的合成展示 DTO，不能被表述为正式报告、授权分享或消费者交付。

尚未实现 PostgreSQL/Drizzle 连接和迁移、运营后台、认证、正式商品目录、QuizPack ZIP 处理、确定性评分、Key、服务端会话、一次完成事务、发布工作流或正式报告。D1-B 的 `localStorage` 暂存只验证浏览器交互与冲突提示，不是跨设备或权威会话。

F1 仅建立本地可测试的运行时契约、商品归属引用验证、草稿纯逻辑和三结果 synthetic 参考包。F1 的 JSON Schema 名称为 `foundation.v1`，只是后续内容合同的基础，**不是**完整 `quizpack.v1`，不会处理 ZIP、远端上传、数据库、后台、评分、真实发布或 Key。此前 39 项 unit、186 项 E2E、10 项 intentional skip 是已合并视觉研究的历史证据，不覆盖 F1。

## D0 实际范围（历史基础）

D0 已有条件通过；D0.1 修正独立检出与治理文档，新增消费者访问规划、开源复用研究计划和根目录 CI。消费者业务与 D1 视觉实现均未启动。

Next.js App Router 的工程入口、主题列表、主题简报和 404；严格 TypeScript、Tailwind v4、shadcn/ui 手工基础配置及 Button、Motion 依赖与动态偏好边界、Vitest、Playwright。PostgreSQL 尚未检查或启动，Drizzle/postgres 依赖仅安装，没有 ORM 表、迁移或连接调用。

补充指令后保留上述工程，增加 QuizPack、商品版本/视觉绑定和报告模式的编译期提案类型。没有运行时 Schema、构建器、导入器、ZIP 解析、组件注册实现或 AI 报告任务。

## 一个 Product 即一个测评工作区

`Product` 是一款测评的稳定业务身份和归档边界，例如一个历史人物商品；不新增与之重叠的 `QuizProject` 实体。题目、选项、规则、结果原型、私有素材、视觉配方和报告文案都通过 `productId` 归属到这一商品，且在版本内引用。不同商品不能从一个可变“全局题库”自动取题。

可复用的内容、视觉或素材必须显式成为带版本的受控模板/资源包；被某个 ProductVersion 使用时固定其版本或内容哈希。未来若加入题组模板，发布时复制或冻结到目标 QuizVersion，不能让模板更新悄悄改写已发布商品、会话或报告。

## 核心生产流程（规划）

Codex 独立研发单款测评 → 版本化 `.quizpack` → 自动结构/规则/兼容/安全验证 → 隔离导入草稿 → 可视预览 → 人工审核 → 发布固定商品版本。生产端、消费端、销售渠道解耦。后台 AI 生成和编辑只是可选辅助，普通商品运行和发布不要求模型服务可用。

后台职责为包导入/验证、内容及版本编辑、素材、预览、审核发布、独立 Key 批量生成/导出、已发布管理、访问与完成统计。编辑已导入包时创建新草稿版本并重新验证，不能原地改发布内容。

最小 Studio 信息架构按工作流组织：商品目录（类目、标签、专题、公开介绍）→ 商品草稿（逻辑、视觉、报告、资源）→ 导入与验证证据 → 预览 → 审核/发布 → Key 与交付。它不等同消费者页面，也不把主题研究路由作为后台。首期可只支持一个管理员角色和一个商品草稿；认证、角色和审计仍必须在真正开放 Studio 前实现。

## 模块化单体

新增 `features/quizpack` 为包构建/验证/导入边界；调用 quiz/theme/report/product 的受控接口组装草稿，拥有原始包哈希、导入审计与验证证据，不能绕过任何领域不变量。详细容器与文件提案见 `QUIZPACK_SPEC.md`。所有服务仍在同一单体内。

同一仓库、同一部署单元、未来同一 PostgreSQL。路由只组合视图与调用应用服务。避免微服务、消息队列和过早插件执行框架。

| 模块          | 拥有的概念                                                              | 允许的协作                                    | 禁止                                 |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| quiz          | QuizDefinition、QuizVersion、Question、Option、ScoringRule、QuizSession | 输出确定性评分结果给 report；读取发布版本引用 | 导入主题渲染或 AI 运行代码           |
| theme         | ThemeDefinition、AssetPack、PageLayout                                  | 向 report/路由提供版本化配方及素材引用        | 计算分数或消费 Key                   |
| report        | ResultProfile、ReportTemplate、QuizReport、AIReportJob、海报模板        | 通过评分输出和固定模板生成快照                | 读取最新规则重新算旧报告             |
| product       | Product、ProductVersion、发布组合                                       | 引用完整已审核测评版本与主题/模板版本         | 修改进行中会话或历史快照             |
| ai-generation | 生成任务、结构化草稿、审核记录                                          | 校验后产生 quiz/theme 的候选内容              | 直接发布、运行生成代码、取得完成权威 |
| fulfillment   | FulfillmentAdapter、交付请求、AccessKey 发放                            | 接受授权渠道的幂等请求，发放商品凭证          | 内嵌特定平台订单假设或改评分规则     |

`product` 同时拥有商品工作区的生命周期：创建草稿、比较 revision、发起预览、请求发布和切换当前发布版本；`quiz` 只验证/解释版本化内容并输出确定性结论；`theme` 只解析受控布局和资源引用；`report` 只从锁定结论生成/读取快照；`fulfillment` 只通过凭证服务发放和查询 Key。任何模块都不得直接拿 `access_key` 表或绕过 product 的发布不变量。

AccessKey 生命周期和提交事务由后续应用服务协调 fulfillment、quiz、report；其表访问只通过凭证服务接口，不让各模块重复实现凭证校验。管理权限、审计等横向能力置于 `lib` 的服务层并保持服务端专用。

## 依赖方向

`app → features → lib`；`app → components → lib`。通用组件不能导入 `features`，领域不能反向导入 `app`（ESLint 已设置路径别名边界）。主题专有构图组件留在 `features/theme`。相对路径和跨领域依赖仍需代码审查；D0 不宣称实现完整静态架构治理。

服务端数据库代码将放 `src/lib/db`，标记 server-only；Client Components 不可读取连接字符串或调用 ORM。D0 只放边界说明，不添加会在启动时要求数据库的空连接模块。

应用服务也必须 server-only：`ProductDraftService` 处理草稿 revision/hash 和 preview；`ImportService` 管理 staging/验证/补偿；`PublicationService` 冻结完整版本；`AccessService` 交换 Key 与固定版本；`SessionService` 保存答案；`CompletionService` 在事务内评分和封存报告。Route Handler 或 Server Action 只负责认证、运行时 DTO 解析、CSRF/速率限制等 HTTP 边界，再调用这些服务；React 组件、Drizzle repository 和路由文件不承载跨领域业务规则。

## 草稿、发布和资源的边界

草稿是可编辑的 `ProductDraft`，每次保存都携带递增 `revision`，并由服务端比较后写入。草稿可保存可复核的内容 hash；hash 用来关联验证证据和发现编辑后失效，不能替代 revision 的并发控制。发布前再次验证草稿 revision、内容 hash、组件兼容性、资源审批和审核记录。

发布会创建新的不可变 `ProductVersion`，固定 QuizVersion、ProductVisualVersion、ReportTemplate、AssetPack、受控组件版本与相应 content hash。发布版本、其会话和报告不可原地编辑；新编辑只能从旧版本复制到新草稿。回滚仅切换新激活使用的 `currentPublishedVersionId`，不得重写已有 session/report。

资源默认属于一个 `productId`，并由 `AssetPackVersion` 或等价的版本化引用固定。对象存储采用内容 hash 作为不可变 blob 标识；逻辑路径、用途、来源、许可证、审批状态和裁切信息在数据库/声明中记录。共享资源必须有明确共享批准，不能因文件名相同跨商品复用。

上传和导入先进入受限 staging 存储，不直接写 public 或正式 asset prefix。对象存储与 PostgreSQL 不能假定同一事务：写入顺序、staging 状态、失败补偿和定期清理必须可审计；数据库事务失败时删除或标记孤儿对象，移动/复制失败时保持不可发布状态并可重试。最终发布只引用已确认存在、hash 一致且获准的不可变 blob。

## 三类测评引擎（设计，未实现）

- 多维度：有限维度 ID、有限整数权重、定义域检查、归一化策略、上限、缺答案拒绝；输入完全由已发布规则及选项 ID 决定。
- 原型匹配：定义原型向量、明确距离函数和维度权重；平分用已发布优先级或稳定 ID 顺序，不能随机；输出原型与解释依据。
- 分支状态机：显式节点、条件数据结构、状态变更白名单与终点；校验可达性、无非法目标、循环步数上限；不执行 JS 条件字符串。

未来统一输入为已发布版本及规范化答案，统一输出为版本、分量分数、结果 ID、可审计轨迹。不要为了统一接口抹掉剧情路径与普通选择题的语义差别。AI 输出是版本化 JSON Schema，类型检查不能替代运行时校验。

## 一次正式完成的可靠性（未实现）

建议完成事务：核验凭证/会话所有权与固定版本 → 锁 Key 行 → 若已有报告返回同一报告 → 拒绝过期、撤销及不完整答案 → 服务端确定性评分 → 同事务写唯一 `QuizReport(access_key_id)`、会话完成、Key 完成状态 → 提交。失败回滚，不消耗 Key。重复/并发提交收敛到同一报告，不能产生两份不同结果。

暂存采用递增 revision 做乐观并发控制；每 Key 一个可恢复会话，多设备编辑有冲突提示；提交后任何答案写入均拒绝。客户端本地存储不是事实来源。未来需要事务并发集成测试，D0 单元测试不覆盖该需求。

Key 存随机高熵摘要，不存可回读原文。推荐初次交换为 Secure/HttpOnly 会话 Cookie 后从地址栏移除凭证；原链接仍可重新交换获取同一报告。部署时设置 Referrer-Policy、日志脱敏、禁止第三方追踪脚本、限定缓存。具体路由及跨设备策略须在凭证阶段确认。

## 视觉系统组合

版本化 Tokens + AssetPack + PageLayout Recipes + Result Templates + Poster Templates。布局配方引用可信、程序实现的组件注册表；配置只选布局和允许的参数，不运行 AI 生成组件。正文可读与选项触达是公共约束，主题可改变页面层次与构图。

升级为全局设计基础 → Theme System → 商品独立资源 → 商品专属布局 → 商品交互表现。上述五项实现工具继续保留，是各层的交付载体，不能把商品强行收缩到单一主题布局。详情见 `VISUAL_SYSTEM.md`。

专属 React 页面放主项目 `features/theme/product-layouts/<product>/`（未来），经代码审查、测试、视觉审核及应用版本发布后进入注册表。每项固定 registryId、componentVersion、propsSchemaVersion、支持的状态/引擎、能力与兼容范围。包只能引用已有 ID，不携带 React/JS；未知 ID/不兼容版本阻断导入。组件读取只读展示 DTO，通过受控回调操作答案，不能直接消费 Key、改分数、查数据库或请求模型。

逻辑 QuizVersion 与 ProductVisualVersion 解耦，ProductVersion 固定二者及 ReportTemplate/AssetPack/组件注册版本；同逻辑可有多套视觉发布。回滚只切换新激活使用的 ProductVersion，不改变旧会话和快照，应用部署须保留旧组件的兼容读取。

## 三种报告模式（规划）

DETERMINISTIC 使用固定模板；COMPOSED 根据原型、分数、白名单关键答案选择预设文案块；AI_ENHANCED 在完整基线报告及结论已锁定后增强文字。三者共用确定性结论及提交事务。答案、分数、原型/结局、逻辑/视觉/模板版本与完整基线快照在正式完成时保存。

AI 文案通过严格结构化 Schema 和内容边界验证，不能新增/修改结论或编造经历。每报告一个幂等增强任务，成功或超时回退后封存最终快照，历史读取不调用模型。远端请求的未知成功采用供应商幂等键或状态查询；不支持时回退，不能盲重试声称外部 exactly-once。完整生命周期见 `REPORT_MODES.md`。

## DTO 和前后端隔离

所有浏览器输入、导入内容和 AI 输出都要在服务端做运行时 Schema 校验；现有 TypeScript interface 只提供编译期帮助。内部实体、草稿 DTO、预览 DTO、消费者 DTO 与公开 DTO 是不同合同：

- Catalog DTO 只含已发布商品的安全介绍、批准封面和类目/标签；没有题目、规则、草稿或 Key。
- Play DTO 只含当前授权会话可见的题目/选项、进度和 revision；没有评分权重、候选结果或其他会话。
- 保存输入只接受 `sessionRef`、`expectedRevision`、问题 ID 与选项 ID；服务端从固定 QuizVersion 验证归属、可达性和值域，拒绝客户端分数和版本。
- Report/Poster/Share DTO 都从锁定报告快照投影；分享 DTO 进一步脱敏，不能含 Key、原始答案或可恢复会话的信息。D1-C 的真实 PNG 导出属于研究 DTO 的本地成品能力，正式分享授权另行实现。
- Studio DTO 显式携带 product/draft ID 与 expected revision；导入 manifest 只是待验证内容，不能指定可越权写入的目标 Product。

## 未来路由草案（无正式业务路由实现）

以下路由是规划，不是本轮新增页面。D0 的 `/themes` 保持研究入口，不是公共商品目录或管理后台。

| 路由草案                 | 权限与行为                                                                 | 布局边界                        |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------- |
| `/quizzes`               | 公共浏览已发布商品的安全摘要，不返回草稿或受保护题库                       | `(catalog)`                     |
| `/quizzes/[productSlug]` | 商品介绍、娱乐声明、已授权演示入口；访问介绍不授予正式答题权               | `(catalog)`                     |
| `/demo/[demoId]`         | 只运行作者批准的演示范围与合成结果；不消费 Key、不写正式报告               | `(catalog)` 或演示专用布局      |
| `/access`                | 接收原访问链接，交换凭证；活跃 Key 进入同一会话，完成 Key 直接读取历史报告 | `(consumer)`                    |
| `/play/[sessionRef]`     | 验证对应商品有效 Key 授予的会话权限，暂存/恢复，最多正式提交一次           | `(consumer)`，商品专属配方      |
| `/reports/[reportRef]`   | 验证报告访问授权后只读锁定历史快照，不重算、不请求新的 AI 增强             | `(consumer)`，商品结果/报告模板 |
| `/share/[shareToken]`    | 独立只读分享授权，仅返回用户明确允许公开的字段                             | 分享专用布局                    |
| `/studio/...`            | 已认证且具备运营角色的管理访问；商品、草稿、导入、资源、审核和发布在此进行 | `(studio)`                      |

App Router route groups 不出现在 URL。实施时根 layout 只保留必要 providers/global 基础，目录、消费者与运营采用独立 layout；不能把管理侧栏/导航强制带到消费者页面。当前研究页 root layout 不在 D0.1 重构。

## 消费者访问模型（规划）

公开目录只暴露已发布介绍、预览素材和授权演示；未购买/无 Key 用户不能通过路由跳转或客户端标记获得正式题库、评分配置或提交权限。演示允许范围独立审核，fixture 标注演示，不借用真实 AccessKey 或正式 QuizSession。

正式答题以对应商品的高熵 AccessKey 为凭证，不强制普通买家注册。服务端验证摘要、商品绑定、有效期/状态和固定 ProductVersion；身份账号不是首版前置。原链接再次进入时：未完成则恢复唯一会话，完成则直接读取已锁定报告。清理 Cookie、换设备、重复提交不能重置完成次数。

建议原链接采用 `/access#key=<opaque>`（待凭证阶段确认）：浏览器通过同源 HTTPS POST 交换凭证为 Secure/HttpOnly Cookie，并移除地址栏凭证；fragment 避免 Key 进入常规服务器 URL 日志。请求体、监控和异常日志同样需脱敏，凭证页面不加载第三方追踪。此方案需后续跨设备、平台发货链接兼容性验证，本轮没有实现交换接口。

sessionRef/reportRef 是资源选择标识，不能单凭 URL ID 读取答案或报告，必须服务端授权，防止越权。正式答题有效期策略与已完成报告保留策略分离，商品新版本或答题 Key 到期不能自行重算/删除历史结果。详情见数据模型。

公开分享由用户主动选择范围，使用独立可撤销的只读 shareToken，不包含原始 Key、正式访问链接或私密答案。分享海报只展示批准的结果摘要，分享权限不能用于恢复或提交。

未来可让用户主动证明持有多个 Key 后关联个人账号，按唯一 Key 归属管理，登录后汇总结果；关联不释放 Key、不重置会话、不改变历史报告，也不能替代消费者或后台权限校验。首版没有账号关联、注册强制或账号系统依赖。

后续验收需覆盖：匿名介绍/授权演示可用、无 Key/错商品/无效 Key 拒绝、恢复和重复提交、完成原链接只读、多端及 ID 越权、分享不含 Key/不可提交。D0.1 只规划，现有 smoke 测试不能作为这些业务通过证据。

## 运行与可移植性

正式 Git 根为当前独立 QuizForge 检出，origin 指向 `aning0922/quiz-forge`，默认 main。安装、开发、测试和提交从根执行；不使用父目录、子树导出或其他项目配置。Next 根据根锁文件推断应用根，已移除旧目录特有的 Turbopack root 覆盖。暂用系统字体，无远程字体构建依赖。Next 的 agentRules=false 禁止 dev 启动自动改写 AGENTS.md，治理规则由项目显式维护。

根目录 GitHub Actions 基线固定动作提交，使用只读 contents 权限、Node 24 和 packageManager 中 pnpm，冻结安装后运行格式/lint/类型/单测/生产构建，无 DB、模型凭据或部署步骤。E2E 仍是本地阶段验收；远端 CI 需依据实际 run 状态，权限/额度受限时如实记录。

开源复用在 D1 期间或 D2 大规模实现前单独评估，候选与证据清单见 `OPEN_SOURCE_REUSE_PLAN.md`。不以引入外部问卷/编辑器为理由改变引擎权威、包安全、Key 完成事务或商品视觉边界。

## 类目、标签和专题（规划）

视觉主题不是业务类目。`ThemeDefinition` 描述视觉语言；`Category` 描述稳定目录层级；`Tag` 是可多选筛选属性；`Collection`/专题是可排序、可定时上下线的运营集合。`Product` 通过关联表进入类目、标签和专题，ProductVersion 发布时可保存目录投影快照，防止后续运营编辑改变历史商品页或已完成报告的语义。首期后台可以只实现一个主类目和少量标签，不因目录功能先建全局题库或通用 CMS。

## 待解决风险

事务和唯一约束必须在 PostgreSQL 验证；结构化 Schema 和草稿审核需先于 AI 生成；后台认证需先于真实运营；字体/角色授权与设备性能需先于正式商品发布。迁移按最小纵向闭环编写、可重复运行并在隔离数据库集成测试；不能在 F1 创建连接、迁移或生产表。D0/F1 不以空服务桩宣称这些风险已解决。
