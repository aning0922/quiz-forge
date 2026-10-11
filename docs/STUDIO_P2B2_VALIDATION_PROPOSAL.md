# B2-2：实际复验与 Product 私有资源归档提案

日期：2026-10-12。状态：**仅提案，未冻结、未实现、未验收**。分析基线为 `codex/quizpack-receipt` 的 `5f2f8e5`；B2-1 两条实现流仍在进行。本文件不修改其冻结合同、不授权提前运行迁移或服务。总控已技术决定采用选项 B，先设独立 launcher 可行性里程碑，B2-1 完成后才实施；这不是 B2-2 合同冻结。B2-2 的 A/B 实现流均未启动，收口后仍须先核实际实现再冻结接口、迁移及检查条件。

依据：[P2-B 总预案](STUDIO_P2B_PREFLIGHT.md)、[B2-1 冻结合同](STUDIO_P2B2.md)、[P1 合同](QUIZPACK_P1.md)、[资源归属](ASSESSMENT_RESOURCES.md)、[P3 表现版本预案](PRESENTATION_P3_PREFLIGHT.md)。以下新增服务、表与状态均为建议名称，不是现有 API。

## 最小纵向范围

只交付：运营者对一个已接收原包显式发起有界复验，确认实际包结构与目标 Product，保存不可变技术证据，将全部资源字节冻结为私有 blob、建立 Product 资源引用，并在原导入详情展示真实结果。两个 P1 synthetic 引擎夹具各走通一次。

- B2-1 的 `quizpack_import.status=received` 继续只表示原字节已冻结。复验失败也不把接收状态改成 rejected，不覆盖 archive、expected/actual hash、接收时间或上传 attempts。
- 本批没有草稿、revision、评分执行、见证执行、渲染 registry、图片下载/缩略图、人工审批或发布。`ready` 只表示本批资源候选归档完成，不能显示“草稿已导入”或“可发布”。
- 仍限默认关闭、显式开启的本机 loopback 运营工具链；实际内容必须通过严格解析且 `kind === "synthetic"`。这证明解析字段，不证明作者身份、图像来源或“所有输入天然可信”。authored 被明确拒绝；四卡真实内容不自动改成 synthetic。
- 不新增常驻 worker、通用队列、对象存储服务、全局 GC、远端 URL 取图、通用资源管理 CMS 或新进程管理平台。

## 已存在的 P1 能力与必须补的适配器

[validateQuizPack](../src/features/quizpack/v1/validate.ts) 实际签名为 `validateQuizPack(source, context): Promise<QuizPackValidationReport>`，不返回解析后的内容或媒体字节。[readRestrictedZip](../src/features/quizpack/v1/zip.ts) 返回 `Result<{archiveSha256, files: ReadonlyMap<string, Buffer>}>`；[parsePackJson/canonicalPackJson](../src/features/quizpack/v1/io.ts)、[manifest parser](../src/features/quizpack/v1/manifest.ts)、[content parser](../src/features/quizpack/v1/content.ts) 已存在。`ReadonlyMap` 的类型不令 Buffer 不可变；内部候选不能暴露给浏览器或可变调用方。

推荐增加 server-only 候选适配器，复用这些真实入口，首批不重构 P1 公共返回类型：

1. 当前身份预检与 claim 确认后，按 B2-1 的受管路径、权限、无链接规则有界读取 archive；实际 bytes/hash 再次匹配 received 冻结事实。取得一份私有字节快照，此后不重新打开路径拼接第二份内容。
2. 在同一外层绝对期限内，先用 `readRestrictedZip` 及原 parser 作受限结构预检，确认版本、Product 与 synthetic，再执行完整 `validateQuizPack`。这样 authored/未知版本不必先进入媒体解码；预检不是最终验证证据。
3. 完整验证使用同一 archive 快照、冻结的可信 compatibility policy 和有效 limits。只有六项 checks 全 passed、`candidateValid=true` 且全部 hash 一致，预检候选才可进入归档。初版允许两次受限解压，第二次不能重置总期限，也不能换成另一 ZIP/JSON 解码器。
4. 候选内部固定实际 manifest/content、资源字节与声明；再次核对资源清单、每项 hash/bytes 和报告绑定。任何差异失败关闭；不能凭报告 passed 从另一路径补取文件。

外层建议沿用 B2-1 的 `{signal, deadlineMonotonicMs}`：Handler 起点 60 秒，包含鉴权、扫描、两次读取/解压、完整解码、归档及完成事务之前的检查。P1 自身 60 秒、单图 5 秒只可被外层进一步收紧，不延长；定时器之外在每个不可逆阶段前检查绝对剩余预算。IO 已发出而超时仍须如实等待 settle/记录未知，不声称 OS 硬实时。稳定 policy limits/`effectiveLimitsHash` 与本次 request absolute deadline 分开：前者固定证据键，后者仅收紧本次执行预算，不把剩余时间混入政策 hash。可信 P1 桥接仍须另补，完整验证要绑定同一快照、冻结政策和 launcher 事实；现有入口不代表已完成此适配。

## 身份、版本和兼容边界

- route Product、`manifest.productId`、`content.product.productId` 和每项引用必须精确相同；实际由 [references.ts](../src/features/quizpack/v1/references.ts) 校验。运营标题、slug、类目、标签不被包声明覆盖。
- 当前 P1 并不要求 `manifest.packId === productId`。Product 使用同一小写 hyphen/max80 的 ID 语法，不等于两字段天然同值。建议保留 P1 语义，以 `(productId, packId, packVersion)` 为包身份；若总控希望额外相等规则，应单独冻结为后台 policy，不能冒称 P1 已检查。
- 本批只支持 `quizpack.v1 + quizpack-content.v1`。manifest 与 content 当前都是 literal v1 parser；只在 compatibility allowlist 加 v2 **不能**获得 v2 支持。未知版本返回明确 `VALIDATION_UNSUPPORTED_SCHEMA`，不能降级、修补字段或试用 v1 猜读。
- dispatcher 首期是有界版本识别加唯一 v1 分支，仍用原严格 parser 验完整对象。未来 P3 在保留 v1 分支后新增 content.v2 分支、兼容 policy、组件合同及验证器版本；不在本批提前接受 v2。
- DB 的 container/content schema version 用有界文本（建议 varchar64），不建仅含 v1 的 enum/CHECK；其与实际 JSON 一致由版本化服务检查。引擎/组件三元组保留完整值，不固化成 DB 六组件枚举或 latest。

## 最小持久化建议：新增三表，不建草稿假 FK

建议 `quizpack_validation` 承载复验进度与证据，`asset_blob` 承载已冻结物理事实，`product_asset` 承载不可变业务归属。这是对总预案“把全部进度塞进 import”的局部收敛：原接收记录不改语义，复验有独立 CAS/fence；不是通用任务表。

| 表                  | 建议字段及不变量                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| quizpack_validation | `id uuid PK`、`product_id varchar80`、`import_id uuid`、`validation_key char64`、`created_by uuid`、时间；复合 FK `(product_id,import_id)` 指向 import。冻结输入为 received archive hash/bytes、服务端 validator bundle ID、P1 validatorVersion/policyId、compatibilityPolicyHash/effectiveLimitsHash、后台 policy version。`UNIQUE(import_id,validation_key)`；`UNIQUE(product_id,id)` 供复合引用。               |
| 复验可变进度        | `status`、`state_revision`、`fence`、`lease_until`、`current_attempt_id`、有限 `attempts`、`storage_condition`、`last_error_code`、`reserved_bytes`、`accounted_bytes`。建议每证据键最多 3 次执行尝试；显式恢复不追加次数。ownerPid/nonce、停止证据规则沿用接收模式，但命名空间/身份明确为 validation。                                                                                                            |
| 复验冻结结果        | `pack_id`、`pack_version`、`container_schema_version`、`content_schema_version`、`content_kind`、原 manifest/content hash、canonical content hash、asset-set hash、完整有界 manifest/content JSON、P1 report、report hash、各 domain version、`validated_at`、`ready_at`。这些事实在首次确认时写一次；状态恢复不得改内容或技术报告。另有同 Product 的 nullable `canonical_validation_id` 用于相同包身份/字节复用。 |
| asset_blob          | `sha256 char64 PK`、实际 bytes、受限 MIME、width/height/frames、服务端 storage key、created_at。建议只插入物理已冻结且重新核验的完整 ready 行，没有空 bytes 或假 pending blob。归档中/孤儿由 validation 的计划、文件和预留承担；已存在 blob 必须核真实文件，不只查 DB。                                                                                                                                            |
| product_asset       | 主键 `(product_id,resource_id,resource_version)`，blob hash FK，完整严格资源 declaration、declaration hash、purpose、`source_validation_id` 与同 Product 复合 FK、created_at；平台审核固定 `unverified`。只插入，声明相同幂等复用；同三元组不同声明或 blob 冲突，即使只改 license/evidence 也不可覆盖。                                                                                                            |

冻结时建议数值限额：P1 原 content ≤1MiB、manifest ≤256KiB 不变；持久化 canonical content ≤2MiB、manifest ≤512KiB、单资源声明 ≤64KiB、单报告 ≤256KiB，均按 UTF-8 canonical JSON 字节计。64KiB 的前提是显式后台持久化 policy 在写前拒绝 NUL/未配对 surrogate，并要求数据库与连接使用 UTF-8；该 policy 比当前 P1 Schema 窄，须绑定版本/hash 与稳定 validation_key，不能修补原内容、替换字符或截断后称原包通过。报告最多3份、净 payload 字节之和 ≤768KiB；数组包装与外层证据/attempt 控制元数据另有独立上限，数值仍待冻结，不沿用 B2-1 的 8KiB 控制数组容纳大报告。

[持久化尺寸预检](QUIZPACK_PERSISTENCE_PREFLIGHT.md) 已记录纯 parser/canonical/引用证据及条件上界，不是完整 P1/DB 验收。当前 canonicalPackJson 沿用 F1 1MiB 硬限，raw 边界输入经科学数值规范化后可能超限；后续可信桥接须提供独立 P1 canonical 预算，不全局放宽 F1。任意 PackToolError 字符串使 report 无无条件尺寸上界，桥接必须约束异常来源为有限错误码并严格检查有界最终报告；parser 原始 issues 不作为最终 validator report 保存。超出后台限额或文本 policy 明确拒绝，不截 JSON、不改原包；真实 DB 容量、UTF-8 与确定失败/未知提交语义仍待验证。

建议 SQL 约束/授权：身份/请求绑定无 UPDATE 权限；报告、候选和包身份 write-once 由触发器保护；blob/product_asset 应用角色 INSERT/SELECT、无 UPDATE/DELETE/TRUNCATE/DDL。validation 仅有限状态/租约/计量列可变。CHECK 检查有限状态、字节/长度/JSON 体积、hash 形状及冻结列空值组合；复杂内容 Schema 不冒充已由 SQL 完整验证。新增迁移，不改旧迁移；同步受管实例版本、集中权限、真实 DB fixture 清理范围。

## 包身份、幂等和状态

`validation_key` 由服务端 canonical 绑定计算：原 import/received hash 与 bytes、目标 Product、实际 validator bundle ID、P1 版本/policy/兼容 hash/limits hash、后台 synthetic/归档/持久化 policy version/hash（含 UTF-8、NUL/surrogate 拒绝和序列化限额）。客户端不选择 policy、validator 或证据。部署 bundle ID 要绑定受审 worker 代码、Node/sharp/libvips 等 native 依赖、launcher policy，以及固定容器镜像 digest/受支持平台组合，不能只拿 P1 的 `1.0.0` 代表此后任意代码；hash 也不是签名或审批。

建议状态：`validating → validated → archiving → ready`；确定的内容/后台 policy 失败为 `rejected`；运行 timeout、cancel、worker fail 与可恢复 IO 在实际停止已确认时为 `retryable-failed`，不能把内容永久判为 rejected；提交未知保留实际已知阶段与 `storage_condition=unknown`，不臆造 failed。`received` 原记录不参与这组转换。

- 同证据键重复 POST：先当前鉴权，查已有结果；ready/rejected 返回原结果，进行中返回状态冲突/busy，retryable-failed 仅由显式 recover 推进。同一 POST 自动重发不能增加执行 attempt。
- 完整技术成功后，在短事务取得规范包身份：对 `canonical_validation_id IS NULL AND validated_at IS NOT NULL` 建 `(product_id,pack_id,pack_version)` 部分唯一约束。同身份异 archive hash 拒绝；同 hash 链接已取得身份的 canonical validation（复合 Product FK），不覆盖原证据。规范行的身份/hash 永不释放，归档失败也不让另一份字节占位。
- alias 必须同 Product、同包身份、同 archive hash/bytes，直接指向 `canonical_validation_id IS NULL` 的 canonical 行，不允许链/环；报告属于本次 validator/policy，不能复制旧报告冒充重验。相同 archive 的另一 import 可各自保留请求和技术记录，再复用同一 Product 资源事实。规范身份冲突和资源声明冲突均留下可读拒绝结果。
- 拒绝包不取得规范身份。若技术成功后资源声明发生冲突，保留该已取得包身份及证据，本次归档拒绝；不得释放身份允许同版本改字节“修复”。
- 建议每 Product 同时最多 20 条未完成 validation，独立于 B2-1 接收意图上限；幂等重放先查旧记录。全实例扫描/记录上限同时约束历史增长，到限提示维护，不悄悄 GC。

## 证据和归档完成的权威

三种 hash 分开：archive hash 是原 ZIP；P1 contentSha256 是原 content.json 字节；canonical content hash 是解析后 canonical JSON。asset-set hash 建议为排序后的 `{productId,resourceId,resourceVersion,blobSha256,declarationSha256}` 完整资源集合的 canonical hash，首期归档包中全部已验证资源，不做“未使用资源”优化。

完整 P1 report 原样绑定与保存：archive/manifest/content hash、targetProductId、validatorVersion、policyId、compatibilityPolicyHash、effectiveLimitsHash、六项 checks、issues/截断标记及 unverified。后台另保存 synthetic/Product/schema 确认、物理归档结果与 policy version，不能把 P1 的 `importable:false/publishable:false` 改成 true。

P1 当前 unverified 仍包含数据库导入/发布；不回写历史 P1 报告去删除它。UI 分别显示“P1 技术检查”“后台私有资源已归档”，说明后者是新增服务证据。包内 approval=approved、commercialUse/redistribution=true 只保存为 claim，product_asset 平台状态仍 unverified。

`product_asset.source_validation_id` 只记录首次资源来源；复用资源不能改写它，本次 validation 仍须保留独立 asset-set 证据，不能拿首次来源代替此次集合确认。

`ready` 必须在一个完成事务内同时成立：当前身份/角色/能力与 Product active、received 绑定未变、当前 validation fence/lease 正确、技术候选固定、每个 blob 的物理事实已确认、全部 product_asset 精确一致、asset-set hash 一致、审计写入。没有一个资源可以因 INSERT conflict 被静默跳过。事务前完成文件核验；事务中不读文件/解码/hash。

## 私有存储、配额和扫描

建议保留 B2-1 `uploads/imports/<id>/archive.quizpack`，新增同一私有 uploads 根下的固定 `validation/<validationId>/` 暂存和 `blobs/<sha256>.blob`。路径全由服务端生成，包内 `assets/...` 只用于内存 map 查找，不映射本地目录。0700/0600、当前用户、祖先与叶子无链接、O_EXCL/O_NOFOLLOW、inode 身份检查和 no-clobber 沿用接收合同；不在 public、不返回裸 storage key 或原包下载链接。

只由主服务逐个资源写临时文件，hash/bytes 校验、sync/close 后同文件系统 no-clobber 冻结。已有同 hash 目标必须重读核 byte/hash/媒体事实，冲突不覆盖。不依赖 POSIX rename 覆盖目标，也不以 readonly TS 类型声称物理不可变；此处 immutable 指应用/DB 写入合同。

配额仍为同实例受管文件 **512MiB 总逻辑字节**。接收原包、所有旧 namespace 的残留/held/unknown、已有 blob、待清理/orphan，以及 B2-1/B2-2 未覆盖的 held headroom 全部参与同一计量，临时/最终双名同时存在时不得少计。B2-2 启用后，B2-1 新接收也必须调用升级后的统一计量；否则两功能各自合格仍会超总额。

推荐每次实际执行先保守预留 `2 * 64MiB + 64KiB`，覆盖最坏实际资源总量的临时/最终双名及有限 receipt；原包存量额外计入，不能包含在这份新预留中抵扣。预检得到资源总量后可继续保留全额至结束，首批不做中途缩额优化。容器镜像、媒体解码 RAM/RSS、DB JSON/WAL 不属于这份逻辑字节配额，512MiB 不能声称为镜像/RAM/DB WAL 或全实例磁盘硬限额；ENOSPC 仍独立失败。

建议资源串行提升，单 validation 目录最多 16 文件（仅受控 attempt partial、stopped receipt/原子临时名），最多 1024 validation 目录；blob 平层最多 4096 文件。与原 imports 一起，全次扫描仍最多 8192 目录项/5秒，采用有界迭代，不递归未知目录；所有记录查询有 `limit+1`，原接收记录和 validation 各最多1024，超限拒绝新增 IO。receipt 实际读取仍单份2048、当前对象最多3份。任何阈值先到即保守维护；这些新增形状/上限需冻结，旧 scanner 的“拒绝未知目录”不能原封不动接入新 namespace。

无归属物理 blob 也计量，不自动删除；不确定是否被成功事务引用时保留。引用读取不能由“知道 SHA”授予权限：后台资源元数据查询必须从当前 Product 的 product_asset 出发，即使另一个 Product 有同 hash，也不能越权枚举其声明或使用权。本批只展示 metadata，私有像素读取留 P2-C。

## 短事务、文件提交和显式恢复

复用 B2-1 独立 storage reserved connection/try-lock `(72461,2)`、配置两个文件 guard、失效句柄永不重连规则。建议继续使用 imports.enabled 作为 receive/validate/archive 写入口总开关，不增加另一套开关或环境覆盖。取得 storage 后复读 config、检查 config/recovery guard，再做有界计量；历史读取仍可用。

固定顺序：不持锁的身份预检 → storage try-lock → 配置/扫描 IO → `withStudioWrite(auth → Product → import → validation)` claim → 事务外读取/解码/文件提升 → 新短事务核当前身份/fence/事实并提交。资源插入顺序按 blob hash、再 Product/resource/version 稳定排序。无 auth 锁跨 IO，无持 auth 等 storage，无新鉴权体系。

validation lease 建议120秒、每请求总期限60秒；心跳只检测持锁连接健康，不无限续期。租约过期/锁空闲本身不证明旧任务停止。原 upload attempt 不动，复验有自己的 attempt/fence/停止记录；recover 增当前 validation fence、校验旧 attempt 的不可变 owner/fence，不追加 attempt。真正重新跑验证或归档时才追加新的执行 attempt，最多3次，不能靠 recover 无限重跑。

停止 receipt 只有全部 archive reader、解压 iterator、媒体 worker 的实际停止核验与 stdio settled、write/sync/link/unlink/close 均 settle 且无晚到写后才可写。Docker CLI exit 或 host ESRCH 不证明实际 container 停止；必须使用服务端生成的有界身份核验实际 stop/wait，未知则保留预留，不盲重试。DB断连取消后，已发出的文件 IO 不能被逻辑 abort 倒推成未发生。无停止证明保留 reservation、路径与 RECOVERY_REQUIRED。

| 故障点                                     | 处理与恢复                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| claim 提交未知                             | 不读/解码/写候选文件；fresh auth 查 validation_key 得到既有行，不能自动新建另一次任务。                                    |
| P1 不通过/非 synthetic/版本或 Product 不符 | 保存已取得的有限技术证据和拒绝码，不建 Product 资源；原 archive 保留 received。无需重传同一字节。                          |
| 已保存验证证据，文件提升失败               | 证据不可改；保留资源计划、计量与已冻结 blob。停止证据成立后可继续同一计划，禁止再次运行 decoder 却沿用旧报告冒充本次验证。 |
| blob 冻结后 DB 未记/提交未知               | 留物理对象和预留；显式恢复先查权威 DB，再核受管文件。相同 hash 无需复制第二份，仍核真实事实；不能先删再重试。              |
| 部分资源冻结、最后一个冲突/失败            | 不提交部分 product_asset 集合或 ready；事务回滚，物理已冻对象计孤儿/存量。无全局补偿删除。                                 |
| ready 已提交，HTTP 响应丢失                | 查询原 validation_key/ID 返回同一结果；无新资源版本、无新报告、无新审计成功事件。                                          |
| 完成前 operator 降权/退出/Product 归档     | 不完成业务事务，保留文件/恢复信息；由新的有效 operator 在 Product 恢复 active 后显式处理。                                 |
| 运行代码/policy 升级                       | 不重写旧报告；新证据键产生新复验记录。旧资源只可按同字节/声明核验复用，旧 identity 保持不可变。                            |

恢复只处理本次 validation 的受管临时对象；永不删除 received 原包，首批也不删除最终 blob。已经 validated 的记录可在同一冻结 bundle/policy 下由原 archive 重建候选并核全部绑定后继续归档；这次有界读取不是偷偷修改技术报告。若可用代码不再支持旧 bundle/版本，则返回需新验证，不把新验证伪装成旧恢复。新版本不能因 alias 自动跳过实际 P1 复验。

## 媒体子进程：已选路线与 launcher 可行性闸门

[media.ts](../src/features/quizpack/v1/media.ts) 当前调用普通 `spawn(process.execPath, ...)`，仅 stdin 输入 bytes、stdout 输出有界事实、精简 env，等待 child close；[worker](../src/features/quizpack/v1/media-worker.mjs) 只用 buffer loader/内存完整解码。没有归档路径、写句柄、数据库配置或归档 IPC API，是可复用的只读应用职责。

但它与主进程同 UID，没有 OS 沙箱。0700/0600 对同 UID 不构成权限隔离，不传路径也不能阻止受损 native decoder 探索文件系统。因此 B2-1 “媒体子进程不能拥有归档目录写权限”若指 OS 强制禁写，**当前实现不满足，不能原样冻结为已解决**。

**选项 A（未采纳、未实施，保留取舍记录）**：本批维持本机运营 synthetic 工具链，仅不传 path/handle、由父进程唯一写入，并等待 child close；明确没有 OS 恶意 native 隔离。需要总控在冻结 B2-2 时显式处理原条文的威胁模型，本文不能静默削弱已冻结条文。实现成本较小：接入现有字节 worker、取消/close 屏障、停止证据和真实子进程故障测试。验证必须包括无归档路径/写句柄/secret 传递、异常解码 kill 后实际 close、子进程尚未 close 时不能写 stopped receipt。主进程 ESRCH 不能单凭“child 没拿路径”冒称任意恶意后代已停止；没有 child 完成证据的崩溃窗口仍需保守维护，冻结时不能漏掉该可用性成本。

**选项 B（总控已技术选定，未冻结、未实施）**：只为该 worker 引入平台限定的真实 FS 沙箱/无归档可写挂载；未知平台 fail closed。运行代码/依赖只读，候选仅字节/只读输入，全部私有 runtime/admin/PGDATA/uploads 不挂载且不可读写，不挂载整个 repo 或 Docker socket；无继承写 FD/密钥、网络或委托 IPC。正常 Node/native 线程可用，额外进程必须拒绝。成本是新增平台 launcher、能力探测、打包/CI 路径与失败关闭行为，不扩为通用执行平台。验收须让实际同类 worker/native sharp 尝试创建、改写、链接、删除归档及运行凭据路径并被 OS 拒绝，同时验证正常三格式解码、取消/回收与未知平台拒绝。不能把 Node 参数、cwd、env 清空或 mock 测试当作 OS 隔离；具体平台机制另审，本文不研究外部产品或安装依赖。

Astra 预审已完成并确认上述边界需进一步冻结，**不代表 launcher 或 B2-2 已通过验收**。先做独立、限时的 launcher 可行性里程碑：服务端生成有界执行身份并绑定受支持 OS/架构、native 依赖和 launcher policy，容器再固定镜像 digest；身份、实际 stop/wait、stdio settled 必须形成可核验事实。两平台均须用正常 PNG/JPEG/WebP、native 失败及拒读/拒写/拒网络/拒额外进程/禁止委托 IPC 探针取得真实证据。`--read-only`、`--network none`、seccomp 参数或 CLI 退出码都不是验收证明；未知能力或停止结果失败关闭，保留必要对象与计量，绝不回退裸 spawn。

synthetic 字段本身不能缓解恶意图片风险；如需更窄首批入口，可增加服务端已审合成夹具 archive hash allowlist，完整 P1 复验仍执行。它显著限制运营可用性，也不是沙箱替代物，需总控明确采纳才进入合同。

## 建议 HTTP/服务交接与真实 UI

先由 A 冻结 browser-safe DTO 与 server-only 服务签名；下面是建议原型，不是调用现有代码：

```ts
validateReceivedImport(db, credentials, productId, importId,
  { expectedImportStateRevision }, context): Promise<ValidationDto>;
readImportValidations(db, sessionToken, productId, importId,
  { page, pageSize }): Promise<Page<ValidationDto>>;
readValidation(db, sessionToken, productId, importId, validationId): Promise<ValidationDto>;
recoverValidation(db, credentials, productId, importId, validationId,
  { expectedStateRevision }, context): Promise<ValidationDto>;
```

建议 POST `.../imports/[importId]/validations` 发起/重放；GET 同路径及 `/[validationId]` 读证据；POST `/[validationId]/recover` 显式恢复。复用4KiB/5秒 strict JSON、Host/Origin/CSRF、当前 `import:create` 与 `studio:read`，并使用 Handler 起点的绝对操作期限；不让 UI 上传技术报告、选择路径、修改角色或给任意 policy。首次记录201、重放200；接收时 importId 已知，响应丢失可按 import 查询全部有界验证记录，不要求客户端猜 server policy key。

DTO 含 ID/Product/import、状态/revision、只读版本/hash/检查摘要、资源数量和已归档数量、平台 approval=unverified、publishable=false、已脱敏固定码；完整报告可有独立授权详情投影。不可把资源 evidence/路径/包正文无界塞进错误，不能回传 ownerPID/nonce/storage key、SQL 或堆栈。

新增有限码建议：VALIDATION_UNSUPPORTED_SCHEMA、VALIDATION_SYNTHETIC_REQUIRED、VALIDATION_REJECTED、PACK_IDENTITY_CONFLICT、RESOURCE_DECLARATION_CONFLICT、VALIDATION_STATE_CONFLICT、VALIDATION_RECOVERY_REQUIRED；配额/锁/超时/未知结果优先复用成熟语义，`WRITE_OUTCOME_UNKNOWN` 不降格为普通 retryable failed。精确 HTTP 映射冻结时一次交接。

导入详情分开显示“原包已接收”与“尚未验证/验证中/技术拒绝/归档中/资源已归档/需显式恢复”。本批可有真实“验证并归档”按钮，但没有应用草稿/发布按钮。只读角色只有状态和声明元数据；关闭开关/归档 Product 时真实禁写。B2-1 `ImportDto.validationStatus:'not-run'` 不能继续作为整个导入的最新权威：本批组合 DTO 加独立 validation 摘要并更新 UI，保留 received 的原语义，不让两个字段互相矛盾。

## 拆分、验收和留后边界

最小顺序为：B2-1 完成后先取得 launcher 两平台正常三格式/native 失败探针的实际证据 → 同字节可信 P1 桥接与持久化上限 → 私有归档/显式恢复/HTTP UI。launcher 未通过不启动后续两条实现流；通过后先由 A 交表/DTO/绑定与 P1 适配器、真实 PG 成功/拒绝证据，再完成 blob/product_asset、恢复与配额，B 接 HTTP/页面。第一检查点不能显示 ready，也不作为半完成业务对外开放。A 独占迁移/SQL/文件/验证服务；B 独占 Handler/运营 UI；总控管理共享 runtime/配额、P1 必要接口调整、构建 guard、Playwright 敏感 project 与3100，避免两流各造鉴权或存储。

| 必验             | 证据                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同字节与版本     | 原包 hash 被改变、预检/验证快照不一致、authored、未知 v2、跨 Product、packId 独立语义；两个真实 P1 引擎夹具复验成功。                                             |
| P1 安全拒绝      | 实际恶意 ZIP、重复 JSON 键、未声明资源、坏像素/动画/伪 MIME、未知组件、引用错；不能只有 builder 合法样本或 mock passed。                                          |
| 证据与权威       | claims=approved 仍平台 unverified；报告 importable/publishable 保持 false；无评分/见证通过宣称；更改政策产生新证据，旧证据只读。                                  |
| 真实 PG          | 唯一包身份并发、同身份同/异 hash、资源声明冲突、跨 Product FK、应用角色不可改事实、部分集合回滚、当前身份重验。                                                   |
| 真实文件/流/连接 | symlink/no-clobber、blob 已有同/异字节、原包/残留/新资源累计限额、扫描上限+1、write/sync/link/unlink 故障、child close、锁连接失效与晚到 IO、停止证明不明不清理。 |
| 未知提交         | 分别证明确实未提交与已提交但应答丢失；fresh auth 查询/恢复不重解码冒充旧证据、不覆盖 archive、不删成功 blob、不重复 Product 引用。                                |
| 生产浏览器/构建  | 操作员与只读真实状态、失败/恢复、移动视口截图；无私有字节公共 URL；trace guard 必须覆盖新增 validation/blobs 根。                                                 |

B2-3 才将 ready 候选应用为首个不可变 draft revision，原 new-draft 意图和同 Product 归属留存但不提前创建 draft FK/假 revision。P2-C 才有私有像素读取、结构预览、当前候选验证和送审；P3 才有评分/见证与实际组件渲染；P4/P5 负责后续消费者和真实首款内容闭环。每项工程检查、商业素材与作者内容/视觉批准分别记录。

## 供总控冻结的最少决定

1. **接受独立 validation 表和三表增量**，保留 received 不变；先证据、后资源归档，不顺带建 draft。推荐接受。
2. **隔离路线已选 B，合同仍待冻结**：先独立 launcher 可行性里程碑，B2-1 完成后才实施；A 不作回退。严格不可读/IPC 禁止、两平台实际证据和停止权威未完成前，不能把现状写成 OS 隔离通过；fixture hash allowlist 仍是另项决定。
3. **统一配额与执行限额**：推荐512MiB全局、128MiB+64KiB新处理峰值、60秒外层/120秒lease、最多3执行attempt、上述有界扫描；实际 B2-1 实现合入后核一次账目和文件guard复用。
4. **包身份与证据版本**：推荐保留 packId 与 Product 独立字段、canonical 身份部分唯一、服务端 bundle/policy 绑定及 v1-only dispatcher；不为 future v2 放宽当前验证。

这些均为总控普通技术决定，无需向作者重复询问。本文编写没有执行测试、DB、服务、构建或迁移，也不代表上述验收通过。

## 追加：选项 B 的窄范围可行性调查

2026-10-12 追加，**仍是调查证据；总控已选 B，但不改变 B2-2 合同/launcher 未冻结、未实施状态**。上一节“没有执行测试”描述初始提案编写；本次只另行执行下述授权合成沙箱探针，未运行项目测试、PG、HTTP、容器或迁移，未安装依赖、修改生产代码或读取私有配置。

**本机实测。** macOS 26.6.2（25G83）、arm64，Node v20.20.1、sharp 0.35.5，系统已有 `/usr/bin/sandbox-exec`；`command -v` 未找到 bwrap/unshare。系统随附 `man sandbox-exec` 和 `man sandbox_init` 均明确标记 DEPRECATED，建议正式 app 使用 App Sandbox；不能假定该 profile 接口获得长期兼容承诺。Apple 官方论坛也记录这一限制，见[官方开发者讨论](https://developer.apple.com/forums/thread/661939)。

探针只在本工作树自行创建的 `.cache/p2b2-sandbox-probe/` 操作合成输入/哨兵。成功的实验 profile 为 `(allow default)` 加全局 `deny file-write*`、`deny network*`、`deny process-fork`，并拒绝读取合成 protected 子目录；它不是生产推荐 profile。原始源码、profile 与 JSON 结果留在该忽略目录，不进入 Git。

| 实际探针                                                                  | 结果                                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node 读取合成输入、加载现有 sharp/native 依赖、2×2 RGB→PNG→原尺寸像素解码 | 成功；worker exit 0                                                                            |
| 读取 protected 哨兵、改写/新建/删除/硬链接该目录文件                      | 全部 EPERM，父进程核哨兵未改变                                                                 |
| TCP connect 至本机127.0.0.1:9（没有启动服务或访问外网）                   | EPERM，而非把连接拒绝/超时误认成沙箱阻断                                                       |
| Node spawn `/usr/bin/true`、spawn 同一个 Node                             | 均 EPERM                                                                                       |
| Apple clang 17.0.0 编译的独立 C 探针，直接 open 写、connect、fork         | 三项均 EPERM，exit 0；不是 JS 包装器或 Node permission flag 限制                               |
| 初次 C 探针仅检查 socket() 创建                                           | socket 创建仍允许；不能由此声称完全禁止 socket 创建。后续实际 connect 才被拒绝，原失败结果保留 |
| 另一个 deny-default、有限依赖读取白名单 profile                           | Node 启动 SIGABRT，无输出；未放宽后冒称该严格 profile 已成功                                   |

结论：当前 macOS 已有可作用于 native 系统调用的文件禁写/联网/创建子进程限制，**选项 B 的本机方向具备实测依据**。但成功 profile 的其他读取与 IPC 仍宽泛，尚不满足本提案“凭据不可读、无委托写入渠道”的全部要求；也没有测完 PNG/JPEG/WebP、libvips 全部运行路径、继承 FD、路径别名、崩溃/kill/reap、OS 升级或真实归档生命周期。投入正式 launcher 前必须收窄并实测权限边界，未知 OS/profile/native 依赖组合启动失败即禁用处理，不能回退裸 spawn。deprecated 带来的维护成本真实存在，不能把本次探针当完整沙箱审查通过。

**Linux CI 只有配置/官方材料证据，未实测。** 当前[workflow](../.github/workflows/ci.yml) 固定 `ubuntu-24.04` 标签并由 setup-node 指定 Node 24；标签不固定 kernel/image patch。[CI 服务脚本](../scripts/ci-p2a-service.sh) 已依赖 Docker，仅启动固定 digest 的 PostgreSQL18.4 容器；未为媒体启动沙箱。调查时 [GitHub 官方 runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) 标示 image `20261004.327.1`、Ubuntu24.04.5、kernel6.17.0-1022-azure、Docker28.0.4；这是可变清单，不是本项目某次 CI 的实际机器记录。清单没有 bwrap 条目，不据此断言它绝不存在。

- 现有 Docker 工具链使 Linux 只读镜像/最小只读依赖挂载、无归档挂载、`--network none`、drop capabilities/no-new-privileges 成为候选；[Docker run 官方说明](https://docs.docker.com/reference/cli/docker/container/run/) 支持这些隔离配置；[Docker wait 官方说明](https://docs.docker.com/reference/cli/docker/container/wait/) 定义实际容器停止等待，launcher 还须按自己的有界身份核验停止并等待 stdio settled。但需要匹配 Node/sharp 的受审镜像与固定 digest，不能复用 PG 镜像就声称能解码。
- 默认 Docker seccomp **不等于禁止所有子进程**，见[官方 seccomp 文档](https://docs.docker.com/engine/security/seccomp/)。自定义策略须保留 Node/libvips 必要线程并拒绝新增进程/不需要的网络调用，实际测 fork/vfork/clone 等路径；不能用 pids-limit=1 把线程一起禁掉后宣称生产可用。
- bwrap 是另一个小 launcher 候选，但其[上游文档](https://github.com/containers/bubblewrap)说明具体安全边界由调用参数决定；不能只因命令存在就通过。[Ubuntu24.04 官方说明](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions)记载默认 user namespace 限制，必须在实际 runner 测试，不修改全局 sysctl 来绕过。本轮没有安装或启动它。

因此不能承诺“mac + Linux CI 已经零新增成本打通”。总控已选择 B；B2-1 完成后的最小下一步是独立、限时的 launcher/探针工程：mac 收窄 profile；Linux 在真实 CI 选已有 Docker 路径或经验证的 bwrap；两端以同一正常 PNG/JPEG/WebP/native 失败、拒读写/拒网/拒额外进程/凭据不可读/禁止委托 IPC 及实际停止/stdio settled 矩阵退出。任一端缺机制或探针失败都 fail closed。调查到此停止，不拖延 B2-1，也不把 A 当默认回退。
