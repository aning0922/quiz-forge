# B2-3 首个持久草稿合同

本批从已 ready 的私有候选建立 Product 的首个不可变 revision 1，并提供真实只读草稿工作区。B2-2B 已技术验收，基线为其交付提交 `7fc0c55`；本合同经Astra前置审查后冻结，现已按[P2B3_ACCEPTANCE](P2B3_ACCEPTANCE.md)完成技术验收。常规工程沿既有托管授权推进；内容、素材、main 合并、生产迁移与发布批准不由本合同授予。

## 范围与事实

支持 private-archive.v2 当前明确 policy/hash、candidate-receipt-db-ack.v1、quizpack.v1 / quizpack-content.v1 / synthetic 来源，target 为 new-draft。未知协议、旧 v1 和 authored 不自动放行。不能把历史人物 authored 草案改标 synthetic。原 import received 与 validation ready 事实保持不变；新的 draft_application 是独立成功应用账本。

本批不含编辑、revision 2、替换、送审、评分、受控消费者预览、Key、报告或发布。只读结构正文不称可视运行预览。首次草稿仍显示 platformApproval=unverified、publishable=false。

## 领域边界和来源

`features/quizpack/draft-source.ts` 提供受控 `readReadyDraftSource(tx, scope, expected)` 应用接口，拥有 import/validation/assets 查询。`features/product/drafts` 只调用这个接口，不自由互查 QuizPack 数据表。

新应用按当前授权后锁 Product → import → validation；Product 必须 active。显式读取 import.target_kind，要求 received 且 new-draft。validation 必须属于同 Product/import、ready、clean、零 reserved、所有 attempt released，并具当前协议 ACK；匹配预期 state revision 与 candidate SHA。检查 policy 版本和 SHA 白名单及 container/content/kind 白名单。既有成功原 key 重放先于以上资格核实，但始终在当前会话及 draft:write 权限下执行。

严格核对 canonical manifest/content/asset-set 原文本、Schema、版本、字节上限与 SHA；candidate SHA 使用 A 的唯一受控算法，不另写相似算法。asset-set 必须是同 Product 完整、无重复的引用集合；逐项核 product_asset 的 resourceId/version、blob SHA、declaration SHA、canonical declaration 原文与内容声明，且 blob 事实一致。同 Product 额外合法资源不属于此 revision，不据全 Product 资产数误拒。alias 可引用较早 canonical validation 归档的资源，不能要求每一 product_asset 首次来源都等于当前 alias。

应用只有数据库工作，不读 ZIP、不复制文件、不重做媒体解码、不查询当前部署，不新增 storage 锁/扫描/预留/租约/ACK 生命周期。imports.enabled 控制接收与验证，不控制这个纯 DB apply。

## 请求、身份与幂等

路由作用域 Product/import/validation 为校验后的 ID。POST 严格输入：

```
{
  idempotencyKey: UUID,
  expectedValidationStateRevision: int32(1..2147483647),
  expectedCandidateSha256: lower-hex SHA256,
  target: {kind: "new-draft"}
}
```

fingerprint=`SHA256(canonicalP1Json({schemaVersion:"quizpack-draft-application.v1",productId,sourceImportId,sourceValidationId,expectedValidationStateRevision,expectedCandidateSha256,target:{kind:"new-draft"}}))`。只列显式字段，不把 idempotency key、requestId、时钟、当前媒体或解析后的内容混入 fingerprint。

短事务顺序：withStudioWrite(draft:write) → Product row lock → 按 Product/key 查询成功账本 → 同 fingerprint 返回固定原结果、不同 fingerprint 报 IDEMPOTENCY_CONFLICT → 新请求再核 active、来源资格及无草稿 → 插入三表和单条 draft_applied 审计 → COMMIT 确认。成功响应直接使用事务内固定 DTO，不追加读取决定成败。重放不新增审计、不跟随未来 current revision 改写结果。不同 key 已用同 import 或已有其他首稿，明确 DRAFT_ALREADY_EXISTS；只核 key 找到的账本才能证明原请求成功。

WRITE_OUTCOME_UNKNOWN、断连、取消或未知响应保留原请求。GET 空只表示此刻未观察到成功，不证明回滚。允许用户显式重放完整原 key/原 tuple，由相同事务锁和唯一约束处理；不得自动重发、生成新 key 或因当前 draft 存在擅自解除 pending。

## 持久化与迁移

0013 仅追加 audit enum draft_applied，独立提交；0014 建三表、约束及必要保护函数。已应用迁移不改写。生产迁移不执行。

- product_draft：UUID PK、Product 唯一、current_revision=1、initial_application_id、创建人/时间。首批应用角色只有 SELECT/INSERT，无 UPDATE。
- draft_revision：Product/draft/revision 复合唯一，revision=1；source import/validation、application ID、canonical content text/SHA（≤2MiB UTF-8）、asset-set text/SHA（≤64KiB）、canonical manifest SHA、candidate SHA、schema/kind/pack/version与六类版本、创建人/时间，全部不可变。manifest 原文通过不可删除、不可变 ready source 的复合 FK 固定读取，不重复复制。
- draft_application：UUID、Product/key 唯一、Product/sourceImport 唯一、每(Product/draft/revision)唯一、完整原请求绑定、fingerprint、draft/revision、固定成功 DTO 必要事实、创建人/时间；只记录成功，全部不可变，账本不设 TTL 或删除路径。

所有跨域身份使用含 Product/import 的复合 FK，所有引用列 NOT NULL，被引用主键/唯一约束非延迟。product_draft(Product/id/current_revision) → revision(Product/draft/revision)，revision(Product/draft/revision/application_id) → application(Product/draft/revision/id)，application(Product/draft) → product_draft(Product/id)，加 product_draft 初始 application 同 Product/draft/revision 精确关联，建立 DEFERRABLE INITIALLY DEFERRED 闭环。COMMIT 时不能遗留无 revision 的 draft、无成功应用的 revision 或不属同一草稿的 application。初稿不存在 revision 0。SQL 条件要求 IS TRUE + NOT NULL，hash核原 UTF-8，不使用 jsonb::text 重构。应用角色无 DELETE/TRUNCATE/DDL，PUBLIC 不获权限；审计 target_kind=draft、target_revision=1。

闭环 FK 只证明关系。另设窄的 revision INSERT 来源保护：校验同 Product/import/validation、明确允许的 policy/protocol、ready 资格，以及复制的 canonical content/asset-set 原文与各 hash 完全等于不可变来源；不能拿合法source ID配任意正文。深入资源解释仍由quizpack接口承担，SQL沿用既有ready关系约束。实际PG覆盖直接SQL伪来源/错指针/空值拒绝，不把FK冒称完整内容验证。固定历史读取不受未来新应用policy白名单变化影响；content中的Product metadata只保留快照，不覆盖B1目录字段。

四条闭环FK使用ON DELETE NO ACTION，并延迟到COMMIT检查，使测试owner可在单一事务精确删除完整闭环；外部source/Product/operator FK仍RESTRICT，应用角色没有删除权限，不采用CASCADE。总控负责 DDL、Drizzle schema、migration runner grants、DB schema guard、共享错误和测试 reset。owner迁移入口核完整版本/校验和收据；应用开库guard核实际列/完整约束/权限/保护函数和内部FK enforcement trigger，不增加应用对私有迁移元数据的读取权限，不因缺新表降级旧行为。升级测试覆盖 0012 → 仅0013拒新业务 → 0014，重复 migrate 无操作，保留旧归档数据。

## 服务、HTTP 与 DTO

四个服务：applyReadyValidation、readDraft、readDraftRevision、readDraftApplicationByKey。读操作 studio:read，写操作 draft:write；当前 cookie/session、Origin/Fetch Metadata、CSRF，nodejs / force-dynamic，private no-store 响应。handler 从路由入口建立不可延长的独占 DatabaseBudget，15秒覆盖body/鉴权/建连/事务，不在步骤间重置；超时或取消使原DB失效且实际关闭，禁止后继事务，不能仅Promise.race返回。COMMIT附近断连、超时或close失败不补回滚证明，沿用WRITE_OUTCOME_UNKNOWN。不得复用媒体状态机或错误码。沿用 readStudioJson 的实际流4096 UTF-8 bytes/5秒上限。

| HTTP                                                              | 结果                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| POST `/api/studio/products/{p}/imports/{i}/validations/{v}/apply` | 201新建/200精确重放；`{created,application}`                                |
| GET `/api/studio/products/{p}/draft`                              | `{kind:"empty",productId}` 或 `{kind:"draft",draft:summary}`                |
| GET `/api/studio/products/{p}/drafts/{d}/revisions/{r}`           | 固定 revision 的原文本、hash、完整 asset-set、summary                       |
| GET `/api/studio/products/{p}/draft-applications/{key}`           | `{kind:"empty",productId,idempotencyKey}` 或 `{kind:"applied",application}` |

Application DTO包含 product/import/validation/key、预期revision/candidateSHA、fingerprint、实际draft/revision1、content/asset-set/canonicalManifest SHA、固定版本、createdAt/by；不返回凭据、私有路径、ownerNonce、文件receipt或原始证据正文。summary 不带正文/完整asset-set；正文端点单独按固定身份读取。

JSON envelope 预算4,390,912 bytes（2×2MiB content + 2×64KiB asset-set + 64KiB实际序列化外围，含字段名/引号/标点/metadata）；canonical 文本无 literal control，二次 JSON 转义至多2倍。固定正文形状只带这两份文本，不另带完整manifest、重复声明或报告。服务端只序列化一次并核真实 UTF-8 大小；客户端流式累计、上限+1拒绝、fatal UTF-8、严格 DTO、原文hash检查。Content-Length仅提示，不截断成成功。小响应另限64KiB。raw文本的2MiB不是HTTP envelope上限。

新增有限错误：DRAFT_ALREADY_EXISTS(409)、DRAFT_SOURCE_INVALID(409)、DRAFT_SOURCE_CHANGED(409，附当前validation revision只在其有效时)、DRAFT_NOT_FOUND(404)、DRAFT_REVISION_NOT_FOUND(404)。沿用 IDEMPOTENCY_CONFLICT、PRODUCT_ARCHIVED、CAPABILITY_DENIED、WRITE_BUSY、WRITE_OUTCOME_UNKNOWN、STUDIO_UNAVAILABLE。未知内部错误不泄露 SQL 或正文。

## pending 与页面

独立 `quizforge.studio.draft-applications.v1` sessionStorage 桶，按 Product 排他；保存 schemaVersion、完整原tuple、mayHaveBeenSent。条目/桶数量与字节上限、严格字段与校验由公共合同固定。单次同步turn写入→整桶readback→sent持久化+readback→fetch，中间无await；损坏、溢出、storage异常或不同 pending 阻止POST。

只有匹配完整原 tuple 和固定成功回执才能 compare-and-remove。相邻读失败不能将旧false状态当未发送。busy/刷新核实时禁POST；有pending时禁止新tuple，唯一例外是用户显式取得同Product发送门后重放完全相同key/tuple，仍先持久化/readback、当前鉴权、Product锁内查账本。取消未知请求、一次确定错误、空GET或当前已存在draft均不抹原未知证据。GET 原key空保持待核实，提供“重新核实”和明确“用原请求重试”动作，不自动发送。迟到响应与导航必须绑定作用域，不能覆盖新 Product。只读/撤权角色可看事实，无可执行写按钮；凭据过期不清 pending。

ready详情加入明确的“应用为首个草稿”面板，RSC传已鉴权session；Product工作区加入草稿链接；新`/studio/products/{p}/draft`呈现空/摘要/原key核实，固定revision页显示结构与版本摘要及完整只读正文。复用StudioShell与现布局，正文≥16px，目标≥44px，四宽无溢出。归档、草稿、审核和发布事实严格区分，不出现虚假已批准/可发布/评分通过。

## 所有权与验收

总控先冻结 contracts/service-contract、公共错误与预算、迁移/ACL/guard；数据流实现 product/drafts service/repository、quizpack受控来源接口、单测与真实PG；界面流实现 studio/drafts、薄API/页面路由和真实E2E。最多两Sol/high实现流，Astra/high独审。共享配置/文档/迁移和3100由总控单写，DB各自独立实例。

必须覆盖：双连接竞争唯一首稿、原key重放/异输入、别key同import/别import alias；跨Product/非ready/旧协议/错误rev或hash/archived/已有稿；完整资源归属和声明/合法alias；回滚与审计失败无孤儿；UPDATE/DELETE/TRUNCATE及伪造SQL被拒；撤权、真实驱动故障与COMMIT响应丢失；>1MiB合法正文及2MiB+1、Unicode/NULL；四宽生产浏览器空态、首次应用/刷新、只读、丢响应核实、空GET、显式原key重试、storage失败零POST、错tuple/迟到响应与转义大正文。六项工程检查、PG、driver与独立审查实际完成后才技术验收，接续P3-A有限content.v2与纯评分，再authored/v2准入及固定修订真实预览；浏览器编辑后置，重新导入追加修订另批在首次返修前完成。

大正文证据须区分边界：现P1原始contentSource上限仍为1MiB，B持久化canonical预算为2MiB；本批不放宽P1发行入口。>1MiB用严格Schema/公共canonical/hash构造的明确合成历史DB快照，只证明B3持久化和HTTP完整读取预算，不能冒称该大包经过当前P1真实issuance或媒体执行。普通新包和最终P5真实包路径分别验收。
