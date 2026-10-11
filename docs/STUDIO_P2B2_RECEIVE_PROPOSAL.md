# P2-B2 第一批：隔离接收原包合同提案

日期：2026-10-12。状态：**供总控决策，尚未冻结、未实施**。本文只设计 B2-1 的导入意图、原字节冻结接收和状态页；不因此启动代码开发、迁移、DB、服务或构建。文件名中的 B2 指 [P2-B 预案](STUDIO_P2B_PREFLIGHT.md) 的隔离导入里程碑，其中首批称 B2-1。

分析基线：`codex/catalog-workspace`，`2fcd7b155914ba8022ba2e369f78cc1c2fd19c8e`。已读 [B1 合同](STUDIO_P2B1.md)、[runtime config](../src/lib/db/runtime.ts)、[management](../src/lib/db/management.ts)、[withStudioWrite](../src/lib/auth/write.ts)、[P1 limits](../src/features/quizpack/v1/limits.ts)及[postgres 驱动补丁](../patches/postgres@3.4.9.patch)。以下接口和常量均是推荐默认值，须总控冻结后实施。

## 本批边界

只新增 `qf.quizpack_import` 一张业务表，交付真实导入意图、受限 application/octet-stream 接收、实际 bytes/SHA-256、私有原包冻结、状态读取与显式接收恢复。不建 draft、revision、blob、asset 表，不引入通用任务队列，不做发布或审核按钮。

`received` 仅表示完整隔离字节已经冻结并与本次声明的 bytes/hash 一致。它不证明 ZIP 合法、包身份、内容版本、Product 内容归属、synthetic、图片可解码或许可成立。UI必须显示“原包已隔离接收，尚未验证”，不能显示“合成包验证成功”或“已导入草稿”。

B2-2 才运行 P1 并确认 `kind=synthetic`、目标 Product、Schema/资源等；B2-3 才建立及应用首个草稿。B2-1 的 target 是服务端工作区接收归属，不是包内 Product 已验证。当前接收任意有界原字节，不执行或解压；synthetic-only 是后续内容验收门槛，不能信客户端自报。

## runtime 配置与显式启用

当前唯一入口仍为 `QUIZFORGE_P2A_CONFIG` 指向私有 runtime.json；不增加环境变量开关、URL参数或UI启用开关。现有 runtime v1 严格解析，不得直接向v1文件塞新字段。

推荐增加严格文件版本联合：

- v1：原字段完全保留，读取时内部视为 `imports.enabled=false`。
- v2：原字段与身份关系不变，增加必填严格对象 `imports: { enabled: boolean }`。路径、配额、期限不由配置提供，使用受控常量和实例身份派生。
- 新建实例建议写v2且enabled=false；旧实例不自动修改，仍可登录/使用B1。
- loader/management/createDatabase共同采用同一版本分派与内部规范模型，避免createDatabase再次用旧schema解析后拒绝已规范化对象。保留文件版本用于显式管理，不能把带新字段对象标成v1写回。
- admin.json、manifest.json仍保持其现有version1；它们的格式和内容未变。DB身份comment仍为现有P2-A实例marker，不因runtime文件格式升级而改变集群身份。

推荐管理入口：`pnpm p2a:db imports --instance <id> --enabled <true|false>`。只允许本机管理CLI在验证manifest/owner数据库身份后使用，不接受请求提供路径/连接信息。B流不手工改含密钥文件，Web进程永不读取admin.json。

CLI和接收使用相同实例storage操作锁，在锁外获取连接、取得锁后重新读取私有配置；失败不能声称开关已生效。使用2秒以内有界/非等待取锁，忙时明确返回。disable不取消进行中的接收；它须先取得操作锁，成功后阻断下一次操作，不返回虚假“立即关闭”。

启用前验证B2-1迁移、应用权限及受管uploads目录；未就绪则不写true。v1升级保留原全部数据库身份/凭据，写入同目录新的0600临时文件，sync后原子替换runtime.json；该替换是显式管理操作，不放宽上传文件的no-clobber要求。核对原文件inode/内容身份与受管目录，配置更新不创建/轮换凭据。替换结果不确定时重读验证，输出固定状态和enabled/version，不打印配置正文或secret。

启停每次均在操作锁内原子完成，所以接收取得锁后复读的开关在该操作期间稳定；文件读取不能放在withStudioWrite的auth锁里。配置缺失/未知版本仍fail closed；上传关闭只关闭导入写操作，不让B1登录/目录不可用。read-only仍可读已有导入状态。

## HTTP与资源限额

意图/恢复使用既有 strict JSON 4 KiB、5秒读取器；不改变认证或B1限额。原包PUT使用独立raw reader：

| 项目           | 推荐值/规则                                                                                |
| -------------- | ------------------------------------------------------------------------------------------ |
| 实际原包上限   | `PACK_LIMITS.archiveBytes`，32 MiB；不接受客户端上调                                       |
| 接收期限       | 总60秒，复用P1 operationMs作为本批最大接收预算；从处理该接收请求开始计时，不给每次read重置 |
| 类型/编码      | application/octet-stream；Content-Encoding缺省或identity；拒绝multipart和自动解压请求      |
| 接收方式       | 流式计量/增量hash/写私有临时文件，不用无界formData或先整体读内存                           |
| 期望值         | 每次实际字节既不能超过32MiB，也不能超过该意图expectedBytes；EOF必须精确相等且hash相同      |
| Content-Length | 可用于提前拒绝，不能替代实际计量；缺失仍可有界读取，不信filename/扩展名/MIME证明内容合法   |
| 同时操作数     | 每实例一个storage操作，不在应用层排长队；取不到锁返回busy                                  |
| 无效/零字节    | 拒绝；意图expectedBytes为1..32MiB整数                                                      |

计时覆盖鉴权/取锁/接收/冻结准备；任何期限到达后不得再成功提交received。取消/断流关闭请求reader，不假定cancel总能立即完成。文件write/sync等在途操作必须settle并关闭handle后才发布“已停止”记录或释放操作锁；若OS I/O卡住，不声称具有OS级硬时限。

浏览器可在本地对≤32MiB选择文件计算SHA用于建立意图；此值不是验证证据。服务器永远独立计算。只显示实际传输阶段，不把进度100%当作冻结/DB提交成功。

## 意图、幂等与未来目标

```ts
CreateImportIntent = {
  expectedArchiveSha256: string; // 64位小写hex
  expectedArchiveBytes: number;  // 整数1..32MiB
  target: { kind: "new-draft" };
};
```

Product从受限路径ID选定；`Idempotency-Key`建议canonical UUID。指纹对 `{operation:"receive.v1",productId,expectedArchiveSha256,expectedArchiveBytes,target}` 作服务端canonical SHA-256。唯一键 `(product_id,idempotency_key)`；同键同指纹返回原意图，同键异输入409；不能通过第二次上传改expected值。

B2-1只接收new-draft目标，不收尚不存在的draftId/expectedRevision，不建指向未建表的假FK。这里只记录未来用途，不能保证应用时仍无草稿。B2-3再增加replace-draft目标字段、真实复合FK及CAS；旧new-draft意图的指纹不变。

创建意图本身不创建空draft/revision0，也不锁定未来Product内容版本；Product运营元数据不被上传覆盖。相同字节在不同Product的意图是不同操作，不能凭相同hash跨工作区授予归属。

## 单表与列可变性

建议 `quizpack_import` 初版列如下。内部UUID由服务器生成，所有时间timestamptz，Product FK为既有稳定字符串并RESTRICT删除/更新。需要时提供UNIQUE(product_id,id)，供后续复合FK使用。

| 分组         | 列/约束                                                                                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 永久请求身份 | id UUID PK；product_id varchar(80) FK；created_by UUID FK operator；idempotency_key UUID；request_fingerprint char(64)；expected_archive_sha256 char(64)；expected_archive_bytes integer 1..33554432；target_kind text CHECK=new-draft；created_at；UNIQUE(product_id,idempotency_key) |
| 状态与CAS    | status有限CHECK；state_revision integer≥1；updated_at；last_error_code有限枚举或null；storage_condition为clean/cleanup-required/unknown。状态变化递增state_revision，HTTP恢复携带expectedStateRevision                                                                                 |
| 当前尝试     | attempt_id UUID nullable；fence integer≥0；lease_until nullable；owner_instance_process标识（非浏览器提供）；尝试记录有界JSON，最多3次，固定字段记录attemptId/fence/phase/预留与停止证据，不允许任意metadata                                                                           |
| 冻结事实     | actual_archive_sha256/actual_archive_bytes nullable；archive_storage_key nullable；received_at nullable。received时必有、与expected相同；第一次成功固定后不可改，不是blob/验证证据                                                                                                     |
| 配额/恢复    | reserved_bytes非负；accounted_bytes非负；receipt/cleanup的有限状态及时间。不能只依赖该缓存值做磁盘安全判断，见下文账目规则                                                                                                                                                             |

recommend status为 `awaiting-upload | receiving | received | retryable-failed | rejected`。本批不预先写入未实现的validated/ready/staged状态或默认false的假验证报告。artifact schemaVersion/packId等尚未从原字节解析，不伪填content.v1。B2-2再增加有界schemaVersion文本及真实报告，服务仍按实现支持列表分派，DB不写死v1。

请求身份列无app UPDATE权限。received事实一旦非null必须由数据库触发器/约束保护不变；状态转换、fence递增、尝试记录上限及received不可覆盖同样由迁移约束配合服务CAS保证。app仅SELECT/INSERT及明确状态列UPDATE，无DELETE/TRUNCATE/DDL；普通请求不能硬删导入审计。

仅追加当前migration序列，不重写旧SQL/checksum；集中授权清单同步新增表权限。审计有限增加intent_created/receive_started/receive_completed/receive_failed/receive_recovered；target_kind=import、target_id为UUID、target_revision=state_revision，actor为当前鉴权身份。无原文件名、路径、内容、Cookie、CSRF或任意文本；no-op和状态轮询不刷审计。

尝试记录仍属于一个导入操作，不是通用队列。若总控选择减少JSON列，也必须保留旧未停止尝试的预留与文件归属，不能复用一个attempt字段后丢掉旧worker的账目。

## 状态机

```text
awaiting-upload → receiving → received
                      ├──→ retryable-failed
                      └──→ rejected
retryable-failed → 显式恢复核查 → received 或 awaiting-upload
```

- receiving只表示一个已登记attempt取得接收权限；意图创建为awaiting-upload，避免“未上传”和“活动接收”混淆。
- hash/长度不匹配、超限为rejected；不证明ZIP内容无效，只表示本次接收不满足合同。需要改变expected值时创建新幂等意图。
- 确认可恢复的I/O/断流/期限故障进入retryable-failed；DB不可用或授权失效不能写状态时，保留receiving，由显式恢复判断。
- received只读、不可重传覆盖；重复PUT不读取新body来替换字节，可返回已有状态并取消输入。
- 同一意图最多3次完整接收尝试，不做Range/分段续传；超限需要先核查/清理旧操作，再用新意图。
- cleanup-required/unknown独立于业务状态：rejected也可能仍有需保留计量的文件，不允许因status终结就释放配额。

## 锁、身份重验与失效句柄

复用现有withStudioWrite，不复制认证SQL。它的短事务有READ COMMITTED、auth lock、开始/结束两次当前session/active/role/capability检查及条件touch；绝不能把原包流、文件hash/sync或复验放进其回调。

storage操作使用独立客户端与`reserve()`专用连接，固定新的advisory key（建议(72461,2)，与auth的(72461,1)分开），不与请求database.sql共享生命周期。取锁为有界try，不持auth等待storage。锁连接先核实例事实，操作期间不释放/换池连接。

统一顺序：HTTP安全检查及短身份预检（结束后无锁）→事务外取得storage锁→复读配置/目录事实→短withStudioWrite(auth→Product→import)登记attempt→事务外IO→短withStudioWrite(auth→Product→import)核fence并完成。管理enable/disable与接收恢复也先取storage锁；任何路径不得反向在auth事务内取storage锁。

领取attempt推荐lease为120秒，不自动无限续期；接收60秒预算内完成。fence每次新attempt递增，attempt_id随机且文件名独立。最终写入条件包含Product匹配、当前attempt/fence、lease未过期、状态与expected revision；新事务重新检查Product未归档、session有效且具备import:create。

已受追踪的postgres补丁使失效reserved/transaction句柄终止。应用仍必须实现终止状态：锁连接一旦断开/查询失败/被release，该操作永久abort；不重新reserve、不自动重连后继续旧attempt，不以重新取得同一advisory key冒充原锁。关闭原客户端并取消reader；后续只允许另一个显式恢复操作建立全新连接/fence。

通过该reserved句柄的有界健康检查检测断连（建议接收中每1秒，单次≤2秒）；不能覆盖驱动内部onclose钩子或借未公开字段挂监听。领取与冻结前再检查健康。临时检查成功不证明未来锁永不失效，最终数据库fence和不可覆盖文件协议仍必需。

lease过期只是允许核查，不证明旧进程/文件IO停止。旧worker丢锁后可能仍有在途写入；其路径按attempt隔离，禁止它删除别的attempt或改received。只有reader/write/sync/handle全部settle关闭后，才写受控的attempt停止receipt。恢复不能仅凭时钟删除旧文件或复用预留。

跨进程恢复若无停止receipt，只有在受管进程身份/启动标识可证原owner已结束时才能回收；不能确定则保留RECOVERY_REQUIRED与足额预留。首版优先保守拒绝接管，不用“文件两秒没变”冒充停止证明，不杀未知PID。此细节须在冻结时选定可测试的owner证明实现。

## 私有文件协议

目录从已验证当前实例派生：`.cache/p2a/<instanceId>/uploads/imports/<importId>/`，不能由用户或配置指定任意根。只检查/记账uploads子树，不扫描PGDATA、admin.json或其他项目；已有构建trace排除/守卫继续覆盖它。

所有受管祖先为当前用户、真实0700目录、无symlink/越界realpath；文件0600、普通文件、O_NOFOLLOW。接收用服务器生成 `attempt-<uuid>.partial`，O_CREAT|O_EXCL；每次重试新名称。原文件名完全不参与路径或日志。

临时文件增量计量/hash，EOF核expected，sync并关闭。最终路径固定 `archive.quizpack`，用P1同类no-clobber原子提交协议（优先同一文件系统hard-link提交，再移除自己临时名）；不能用可覆盖rename当作上传成功。已有目标核对实际bytes/hash/inode，匹配则视为恢复证据，不匹配则storage conflict并保留双方。

同inode的临时名与最终名在unlink前都要记录；只有自己创建且身份匹配的临时路径可删。断连/未知提交后不在finally盲删archive。必要receipt由程序生成，固定字段/尺寸、原子写入、0600；不把receipt当客户端授权或P1验证证据。

无symlink不等于OS沙箱：这是本机loopback、单运营空间、当前用户可信文件系统下的应用协议，不保证并发恶意本机进程、OS硬内存/磁盘隔离或公开上传安全。B2-1不执行ZIP/图片，未来B2-2仍需保留P1媒体进程限制说明。

## 配额与B2-2的衔接

预案512MiB总量继续建议保留，但128MiB单次预留不直接照搬B2-1。本批只有原包和临时名：建议新尝试预留 `2×expectedArchiveBytes + 64KiB`，最大约64MiB，保守覆盖最终/临时双计数及小receipt；采用hard-link时宁可保守双计，不因同inode误释放未知占用。

在storage锁下核算 `known existing usage + orphan/uncertain usage + outstanding reserved headroom + new headroom ≤ 512MiB`。扫描只做受管文件元数据和有限receipt读取，遇未知链接/对象/无法计量即拒绝新增接收；不遍历PGDATA。磁盘实际bytes与DBaccounted缓存不一致时取保守值并要求reconcile，不忽略孤儿。

同一attempt的预留表示“该尝试文件占用的上界”，避免既全额计算该文件又全额计算相同reservation：记账函数必须显式区分已计量bytes和未用headroom；无法分辨则保守多计，不能少计。failed/rejected/lease过期不自动使reservation归零；确认文件状态和旧worker停止之后才能对账释放。

建立意图不预留磁盘，首次PUT领取attempt时预留；仅创建意图不会长期耗尽字节额度。仍须限制元数据滥用，建议每Product最多20个未完成/待恢复意图，计数和创建在auth/Product锁下原子执行；具体限额待总控冻结。

B2-2开始处理一个received候选时必须将已有原包、旧临时/receipt/孤儿作为存量计入，再为解压材料/资源临时/不可变归档的新增峰值预留。不能给每个received候选无条件额外128MiB，也不能把512MiB只算“当前上传”。未验证received原包一直占量；自动删除成功原包和全局blob GC不在本批。

这是应用层逻辑字节预算，不是OS磁盘硬配额；ENOSPC等故障仍需处理，不能据预算声称永不磁盘不足。

## 非原子提交与显式恢复

推荐三个可审检查点：

1. **claim事务**：当前鉴权/Product未归档、请求指纹、状态、次数和配额成立，持久化attempt/fence/lease与预留；提交确认后才创建接收文件。claim结果未知则不读取body/创建新文件，返回导入ID供核实。
2. **文件冻结**：事务外完成接收/hash/sync/no-clobber。持久化物理receipt仅证明程序完成该文件阶段。
3. **received事务**：重新withStudioWrite并检查Product、当前身份、attempt/fence/lease；登记事实/received及审计。提交后返回成功。

如果received事务失败或结果未知，冻结原包保留、配额保留；不能回报“已验证”，也不能尝试删除它。当前身份失效时不能借旧actor记业务成功，待新的有效operator显式恢复。新操作者恢复不改created_by，另记recovered审计。

`POST .../recover` 取得storage锁、核原attempt已停止、用新fence登记有限恢复作业；事务外核受管文件身份/实际bytes/hash，再新短鉴权事务结束：若存在匹配的冻结原包，登记received；若只有已停止的部分文件，按确认拥有的路径清理后回到awaiting-upload；若事实冲突或无法证明停止，保留RECOVERY_REQUIRED。清理结果未知不得回到awaiting-upload或释放预留。

不从超时自动推断未提交。重连只能属于新的状态查询/恢复请求，不能复活旧事务/旧reserved句柄。received重试查询返回同一记录，不重新创建文件或更改字节；只读查询不做隐式修复。

## 固定HTTP/DTO与错误方向

| 路由                                                             | 行为                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| POST /api/studio/products/[productId]/imports                    | 4KiB strict意图＋Idempotency-Key；新建201，相同请求重放200        |
| PUT /api/studio/products/[productId]/imports/[importId]/archive  | raw有界接收；成功200，DTO明确received且未验证                     |
| GET /api/studio/products/[productId]/imports/[importId]          | 当前studio:read、精确Product归属；状态，不修复                    |
| GET /api/studio/products/[productId]/imports                     | 分页status列表，默认20、最大50；无任意文件查询                    |
| POST /api/studio/products/[productId]/imports/[importId]/recover | strict `{expectedStateRevision}`；有效import:create、显式有界恢复 |

写入复用Host/Origin/CSRF；read-only只能读。Product归档不阻断读取，但阻断新意图/上传/业务恢复；如需清理归档Product的残留，只由受限本机维护流程执行机械核查，不创建草稿或授予业务成功。

安全ImportDto建议只含id/productId/status/stateRevision、expected/actual bytes/hash、createdAt/updatedAt/receivedAt、固定lastErrorCode和`validationStatus:"not-run"`、`publishable:false`；storageCondition可用安全状态名。无path、文件名、配置、lease owner、raw token或报告原文。UI操作可用性从角色/状态计算，但服务每次仍重验。

建议server-only接口为 `createIntent/readImport/listImports/receiveArchive/recoverReceive`，receive接受AsyncIterable字节/AbortSignal，不接受任意本地路径；storage adapter仅接受受控实例/import/attempt标识。HTTP层只做边界并调用服务，不自己写文件或SQL。

复用既有401/403/400/413/WRITE_BUSY/WRITE_OUTCOME_UNKNOWN。新增有限错误建议：IMPORTS_DISABLED(409)、IMPORT_NOT_FOUND(404)、IDEMPOTENCY_CONFLICT(409)、IMPORT_STATE_CONFLICT(409)、RECEIVE_BUSY(409)、RECEIVE_TIMEOUT(408)、RECEIVE_LENGTH_MISMATCH(422)、RECEIVE_HASH_MISMATCH(422)、RECEIVE_QUOTA_EXCEEDED(409)、RECEIVE_ATTEMPT_LIMIT(409)、RECEIVE_LOCK_LOST(503)、RECEIVE_RECOVERY_REQUIRED(409)、RECEIVE_STORAGE_CONFLICT(409)。失败不能输出底层路径/SQL/异常；unknown与已确认失败分开，响应含已授权importId/requestId。

## 页面、所有权与待执行检查

真实状态页在 `/studio/products/[productId]/imports/[importId]`，工作区提供意图创建与文件选择；显示关闭、只读、等待上传、接收中、received未验证、确认失败、未知结果待核查等不同状态。文件选择控件不保存原文件名进DB/log；状态页无验证/归档/应用/发布假按钮。B2-2/B2-3完成后再加入。

A流独占import表/迁移/集中授权、runtime版本兼容与管理CLI、storage/lease/配额/接收服务及真实故障测试；先交共享DTO/service-contract。B流独占HTTP/Studio/E2E，不能手写配置/secret、SQL或文件路径。总控管理共享配置、依赖补丁、构建守卫、审查及集成环境；两流均复用withStudioWrite和已patched驱动，不各造auth或连接恢复器。

验收待执行：v1默认关闭/v2显式启用/失败不损坏原配置；两次CLI互斥；同键重放/异指纹；实际32MiB与+1、期限/断流/错误hash/长度；symlink/目录权限/no-clobber；锁连接真实断连后旧reserved句柄永不可用、旧attempt不可提交；会话撤销/角色变化/Product归档发生于文件阶段；claim/冻结/received各点故障与未知提交；孤儿/未停止worker保守计量；恢复重复/有界/权限；未解析任意原字节也只显示not-run；真实UI、移动截图及构建trace无uploads路径。

定向测试使用新合成实例和字节，不使用真实admin/PGDATA内容；认证trace/HAR/video限制不变。阶段最终六项检查与test:db由总控执行，本提案没有运行这些检查。

## 总控需冻结的最少技术取舍

1. **配置兼容**：推荐runtime v1/v2联合、旧v1默认关闭，CLI原子升级；admin/manifest/DBmarker不变。
2. **接收范围**：推荐只new-draft意图、raw≤32MiB/总60秒、received明确未验证；不提前实现P1验证。
3. **操作串行与接管**：推荐独立reserved连接、(72461,2)操作锁、120秒lease、终止句柄/attempt隔离；冻结owner停止receipt及进程已结束证明，无法证明时保守不接管。
4. **记账**：推荐512MiB总量、单次2×expected+64KiB而非一律128MiB；最多3次尝试，旧未知尝试保留预留；B2-2另预算新增峰值。
5. **恢复范围**：推荐显式HTTP恢复，不自动重试未知提交、不后台续跑、不自动删除received；后续验证/资源归档/草稿应用继续分批。

以上均为普通技术决策，可由总控在既有授权下冻结，无需向用户追问。真正远端开放、OS沙箱、真实素材/内容及发布仍不在本批范围。
