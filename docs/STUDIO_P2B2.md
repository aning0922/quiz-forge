# P2-B2：第一批原包接收实施合同

日期：2026-10-12。状态：**总控冻结B2-1实施合同；尚未实施、未验收**。B1已完成技术退出，本文件授权下一批隔离实现；不代表接收或后续验证功能已经存在。背景、风险与原理见[接收提案](STUDIO_P2B2_RECEIVE_PROPOSAL.md)；本文规定首批交付接口及边界，二者不一致时以本文件冻结后的决定为准。

实施基线：`codex/quizpack-receipt`，基于B1最终文档 `e8da98b27ed1469a5e15f927cfdbf51445d553fe`，该head的CI38169117712两个job均实际success。继承 [B1](STUDIO_P2B1.md) 的当前身份写事务、[P2-B预案](STUDIO_P2B_PREFLIGHT.md) 的Product归属，以及受追踪的postgres3.4.9补丁；不新建认证或进程管理平台。

## 首批范围与事实用语

只新增 `qf.quizpack_import`：意图、原包冻结接收、读取状态和显式恢复。首批内部称B2-1；后续B2-2才验证/归档资源，B2-3才应用首稿。没有draft/blob/asset表、假FK、process/apply/publish接口或按钮。

`received`只证明私有原字节与声明的实际bytes/hash一致，**未验证ZIP、Schema、包内Product、synthetic、图片、授权或发布**。接收DTO固定 `validationStatus:"not-run"`、`publishable:false`。synthetic-only必须由下一批P1实际解析确认，不能信客户端声明或文件名。

未知内容schema目前不解析、不伪填v1；下一批实现dispatcher时才决定接受版本。未来schemaVersion列用有界text，不CHECK死为content.v1。new-draft仅是未来用途，不保证届时仍无草稿，不创建空草稿/revision0。

## 已选择的配置与管理入口

runtime文件严格分派v1/v2：v1原字段不变，内部imports.enabled=false；v2增加必填 `{imports:{enabled:boolean}}`；新实例写v2/false，旧文件不自动升级。loader、management、createDatabase共用兼容解析/规范模型，避免将带新字段对象误标v1或被第二次旧schema解析拒绝。

唯一环境入口仍为QUIZFORGE_P2A_CONFIG；无环境变量覆写、任意路径/配额、HTTP或UI启用入口。admin/manifest的version1及DB实例marker不变。B1在上传关闭或旧v1下继续可用。

`pnpm p2a:db imports --instance <id> --enabled true|false` 为唯一显式启停入口：核受管实例、owner身份、所需迁移/权限及目录，取得storage try-lock后复读配置，同目录0600临时文件sync后原子替换runtime.json。原凭据原样保留，不输出正文、不轮换secret；B流不手工写配置文件。更新未知则重读核实，不声称已成功回滚。disable不强制终止正在接收：锁忙返回RECEIVE_BUSY，成功后阻断新操作。

CLI在可能发出runtime修改之前，必须先在受管instance根创建固定 `imports-config.guard`，然后才尝试storage锁；禁止取得数据库锁后才首次建立guard。guard为0600、当前用户、O_EXCL/O_NOFOLLOW的普通文件，最多2048实际bytes，strict `{version:1,instanceId,ownerPid,ownerNonce}`，nonce为32随机bytes的base64url。祖先遵循原0700/无链接规则，保留创建时inode。创建guard过程中它一旦存在就阻断其他CLI和新导入写操作，未写完整也不得绕过。

固定顺序是：核受管实例/owner→取得文件guard→storage try-lock→核自身guard身份与当前配置→原子替换。取得storage失败且未发出runtime写时，在自身guard操作全部settle后按inode移除；不能在auth锁内做这些IO。导入写操作取得storage后，在claim之前核guard不存在；settings和历史读取可继续提供只读快照。已持有storage的上传不会被CLI强制取消，CLI取锁失败后清除自己的guard。

CLI数据库连接失效会永久中止本操作，但已经发出的文件操作可能晚到；guard必须保留到全部写/sync/rename/close实际settle，之后只能按自身inode清除。不向后续操作宣称回滚；重新读取runtime确认实际值。既有guard的PID存活/复用/EPERM/未知时返回RECEIVE_BUSY，不删除、不等待无限期限。仅管理CLI可在有效strict guard的服务端PID被ESRCH证明结束后，取得storage锁、重核guard inode与内容、检查runtime有效性，清除旧guard并从头重新申请自己的guard；不重放旧目标。损坏/超限/链接guard返回RECEIVE_STORAGE_CONFLICT并保留维护，不因lease或锁空闲恢复。无需常驻进程管理器或新业务表。

## 固定限额与有界扫描

以下固定值及超限保守维护策略已由总控冻结，实施者不能自行放宽。

| 项目                  | 固定值/行为                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON请求              | 4KiB实际字节/5秒；复用现有strict读取器                                                                                                        |
| 原包                  | 实际1..33554432 bytes；raw application/octet-stream；无Content-Encoding或identity；拒绝multipart/Range                                        |
| receive/recover总预算 | 每请求60秒，从Handler开始处理请求时启动并通过ReceiveContext传入服务；含鉴权/取锁/扫描/IO，不按chunk或服务入口重置；没有剩余预算不进入完成事务 |
| lease/尝试            | 120秒、不自动续期；每intent最多3次接收attempt；恢复不占新的上传次数                                                                           |
| storage并发           | 独立reserved connection，`pg_try_advisory_lock(72461,2)`，不排队                                                                              |
| 配额                  | uploads受管逻辑字节共512MiB；新attempt峰值 `2*expectedBytes+65536`                                                                            |
| 未完成意图            | 每Product最多20；awaiting-upload/receiving/retryable-failed以及任何storageCondition非clean的行计入；received-clean/rejected-clean不计入       |
| 扫描形状              | 仅uploads下固定`imports/<UUID>/<file>`；根下深度最多3，不进入其他目录                                                                         |
| 扫描数量              | 最多1024个import目录、每目录16个普通文件、全次8192个目录项；任一+1立即拒绝新增接收                                                            |
| receipt               | 单个实际读取≤2048 bytes；当前import最多3个stopped receipt，单次累计≤6144 bytes；配额扫描不读取其他import的receipt正文                         |
| 扫描期限              | 扫描自身≤5秒且从请求60秒总预算扣除；DB预留记录查询最多1025行，超1024拒绝，不截断后算作完整                                                    |

使用有界opendir迭代（建议bufferSize32）及lstat；不得一次无界readdir/readFile。receipt使用O_NOFOLLOW打开、fstat和2049字节上限读取，不能只相信stat.size。仅扫描当前实例uploads，不扫描PGDATA、admin.json、整个.cache或其他项目。未知目录/链接/设备、数量或期限超限返回RECEIVE_SCAN_LIMIT/RECEIVE_STORAGE_CONFLICT，不以部分扫描结果继续。

总预算到期后不再开始新的成功写阶段；文件IO已发出时必须settle/close后才声明停止。不能取消的OS I/O不构成硬实时保证，不能提前释放锁并让写入继续。最终短事务沿用有界withStudioWrite；提交结果未知仍按unknown处理，不用超时臆断rollback。

## 浏览器安全DTO与服务签名

以下名字和字段由A先交B，严格拒绝未知字段。ProductId沿用P1小写hyphen/max80，UUID为canonical小写，hash为64位小写hex。

```ts
type CreateImportIntent = {
  expectedArchiveSha256: string;
  expectedArchiveBytes: number;
  target: { kind: "new-draft" };
};
type RecoverReceive = { expectedStateRevision: number };
type ImportStatus =
  | "awaiting-upload"
  | "receiving"
  | "received"
  | "retryable-failed"
  | "rejected";
type StorageCondition = "clean" | "cleanup-required" | "unknown";
type ImportDto = {
  id: string;
  productId: string;
  status: ImportStatus;
  stateRevision: number;
  expectedArchiveSha256: string;
  expectedArchiveBytes: number;
  actualArchiveSha256: string | null;
  actualArchiveBytes: number | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  storageCondition: StorageCondition;
  lastErrorCode: ReceiveErrorCode | null;
  validationStatus: "not-run";
  publishable: false;
};
type ImportListQuery = {
  page: number;
  pageSize: number;
  status?: ImportStatus;
  idempotencyKey?: string; // Product内精确匹配的canonical UUID
};
type ImportSettingsDto = {
  enabled: boolean;
  maxArchiveBytes: 33554432;
  receiveTimeoutMs: 60000;
};
```

以下ReceiveSource、ReceiveContext及服务签名只放server-only service-contract，不能进入浏览器DTO；HTTP适配层持有reader，但在服务迭代前不得read。

```ts
type ReceiveContext = {
  signal: AbortSignal;
  deadlineMonotonicMs: number; // Handler起点performance.now()+60000，跨层不重置
};

type ReceiveSource = {
  chunks: AsyncIterable<Uint8Array>;
  cancel: () => Promise<void>;
};

interface ImportReceiveService {
  readImportSettings(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
  ): Promise<ImportSettingsDto>;
  createIntent(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    idempotencyKey: string,
    input: CreateImportIntent,
  ): Promise<{ import: ImportDto; created: boolean }>;
  readImport(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    importId: string,
  ): Promise<ImportDto>;
  listImports(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    query: ImportListQuery,
  ): Promise<Page<ImportDto>>;
  receiveArchive(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    source: ReceiveSource,
    context: ReceiveContext,
  ): Promise<ImportDto>;
  recoverReceive(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    input: RecoverReceive,
    context: ReceiveContext,
  ): Promise<ImportDto>;
}
```

服务strict复核输入，不能只信Handler的TypeScript。共享DTO为browser-safe文件，service-contract及ReceiveSource单独server-only；内部path/ownerPID/nonce/lease/凭据不进入DTO。source.chunks只能在claim提交确认后迭代；HTTP层检查raw类型/编码，服务负责实际计量和hash。每次文件写入前先验证当前chunk将使累计字节不超过expectedArchiveBytes和32MiB；超出立即拒绝，不先写后在EOF检查，避免小expected值的预留不足以覆盖实际输入。

Handler开始时即创建单调绝对deadline并组合request取消/60秒timer；A提供统一server-only上下文工厂与剩余预算检查，B负责finally清理timer。期限用同一performance.now时钟贯穿所有层，每次开始鉴权/取锁/扫描/读写/冻结/完成事务及其成功阶段前检查真实剩余时间，不能只等待signal.aborted。扫描子期限为min(总deadline,扫描开始+5000)，组合signal不重设deadline；有界DB语句也必须考虑剩余预算。期限后停止发起成功阶段，已经开始的不可取消IO仍须settle；提交回执未知仍是unknown。

ReceiveSource.cancel必须幂等，直接取消HTTP适配层已持有的reader，不依赖尚未开始的generator.return/finally。Handler的finally对未消费或失败body发起cancel，最多等待1秒，处理迟到reject，不无限await、不排空body。cancel正常resolve必须表示适配层在途read已settle且reader锁已安全释放；超时/reject不是停止证明。服务在abort时同样发起cancel，并在stopped receipt之前确认其自身在途迭代/read/write/sync/handle全部settle；无法确认时不写stopped、不假称清理完成，保留RECOVERY_REQUIRED与预留。仅Handler已返回错误不能证明attempt已停止。

`Idempotency-Key`固定canonical UUID；指纹为canonical `{operation:"receive.v1",productId,expectedArchiveSha256,expectedArchiveBytes,target}` 的SHA256。相同Product/key同指纹返回原记录，异指纹409；幂等重放先查既有行，不因20条限额误拒已有请求。不能修改既有expected值或跨Product命中记录。

创建POST响应丢失时，浏览器可能没有server importId。UI保留本次idempotencyKey及完整CreateImportIntent，按当前身份GET列表`idempotencyKey=<key>&page=1&pageSize=1`核实0/1条，恢复查询省略status。空结果不证明未提交，不生成新key盲重发；显式重提仍用同key、同完整input/指纹。仅首次真实创建返回201，重放返回200；当前operator必须重新通过权威读取鉴权。

## HTTP与UI

| 路由                                                  | 结果                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/studio/products/[productId]/imports         | strict意图＋Idempotency-Key；201新建/200重放，body为ImportDto                                                                           |
| GET /api/studio/products/[productId]/imports/settings | 200 ImportSettingsDto；当前studio:read与Product存在/归属检查，不输出私有配置                                                            |
| PUT .../imports/[importId]/archive                    | raw接收，200 ImportDto；received重复请求仅返回原记录并取消输入                                                                          |
| GET .../imports/[importId]                            | 200 ImportDto，当前身份/归属检查，只读不修复                                                                                            |
| GET .../imports                                       | page默认1、1..1000；pageSize默认20、1..50；可选合法status及exact idempotencyKey，拒绝未知/重复query；`created_at DESC,id ASC`，返回Page |
| POST .../imports/[importId]/recover                   | strict RecoverReceive，200实际恢复状态；不自动重试                                                                                      |

所有写需固定Host/Origin、session CSRF及import:create；read-only只读。配置关闭阻断写、不阻断历史状态读取。Product归档可读，但不新增/接收/业务恢复；先正常恢复Product再操作。本批不增加归档清理特权HTTP后门。

readImportSettings是A提供的显式只读服务，页面组合可调用它；B不能自行读取runtime.json或以第一次POST失败猜开关。返回no-store快照及固定限额，不包含路径/凭据/完整config；disabled也是正常200。写入仍在storage锁内复读配置并执行权威检查，UI快照不授上传权。exact key筛选仅限当前Product；未指定status时不限制状态，避免隐藏已received/rejected的原意图。

UI只有上传配置状态说明、意图/文件选择、导入列表及`/studio/products/[productId]/imports/[importId]`状态页。received文案明确“原包已隔离接收，尚未验证”。未知提交保留已有importId或本次key/完整input，引导精确核实/显式恢复；不自动重新PUT。无验证/资源归档/草稿应用/发布按钮，不把上传100%当事务成功。

## quizpack_import列合同

只增一表。UUID由服务生成，时间timestamptz；Product/created_by分别FK既有product/operator、RESTRICT；UNIQUE(product_id,id)、UNIQUE(product_id,idempotency_key)。列分组如下：

| 组         | 列名与类型                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 请求不变量 | `id uuid PK, product_id varchar(80), created_by uuid, idempotency_key uuid, request_fingerprint char(64), expected_archive_sha256 char(64), expected_archive_bytes integer, target_kind text, created_at timestamptz`，全部NOT NULL；target_kind仅new-draft |
| 状态       | `status text NOT NULL, state_revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL, storage_condition text NOT NULL DEFAULT 'clean', last_error_code text NULL`                                                                              |
| 租约/CAS   | `fence integer NOT NULL DEFAULT 0, lease_until timestamptz NULL, current_attempt_id uuid NULL, attempts jsonb NOT NULL DEFAULT '[]'`                                                                                                                        |
| 冻结事实   | `actual_archive_sha256 char(64) NULL, actual_archive_bytes integer NULL, archive_storage_key varchar(160) NULL, received_at timestamptz NULL`                                                                                                               |
| 计量缓存   | `reserved_bytes bigint NOT NULL DEFAULT 0, accounted_bytes bigint NOT NULL DEFAULT 0`，0..512MiB；不是独立权威配额                                                                                                                                          |

revision/fence上限2147483647，溢出拒绝；expectedBytes按32MiB限制；hash正则；status/storage/error有限CHECK；updated_at≥created_at。冻结四列全空或全有，received必须全有且actual=expected，storage key只能为服务器派生的imports/<id>/archive.quizpack。尚未接收不填archive schema/packId/validation report。

attempts为严格最多3条记录：`{attemptId,fence,ownerPid,ownerNonce,reservationBytes,disposition}`。ownerPid为当前主进程正整数，ownerNonce为服务生成32随机bytes的base64url，不来自请求；disposition仅held/released。身份、fence、预算一经追加不可改，只允许held→released；新条必须当前fence并匹配current_attempt_id。元数据总大小另限8KiB；没有任意JSON/自由文本。

“新条匹配当前fence”仅适用于上传attempt追加时。recover提升row.fence但不追加upload attempt，stopped receipt始终对照旧attempt内不可变fence/ownerPid/ownerNonce；恢复完成事务验证新领取的recovery fence。禁止全局CHECK row.fence必须等于旧attempt.fence，也不能为适配恢复改写旧attempt身份。

UPDATE列权限仅给状态/租约/计量及首次冻结事实；请求不变量无UPDATE。触发器保护append-only尝试身份、fence单调、received事实写一次和terminal字节不可改。无DELETE/TRUNCATE/DDL。reserved_bytes为held预算总和，迁移/服务共同防止与attempts不一致。集中授权清单同步，不修改旧迁移。

审计追加有限import动作intent_created/receive_started/receive_completed/receive_failed/receive_recovered及target_kind=import；target_revision为state_revision。无正文/路径/原文件名/secret，no-op不刷审计。created_by不因恢复人改变，恢复人记本次actor。

## 身份、锁和可证停止

按提案三检查点执行：claim事务确认→事务外接收冻结→received事务确认。storage使用独立client/reserved句柄，不能被请求db的错误关闭连带复用；每次try-lock一次，连接查询≤2秒，接收期间每1秒有界健康检查及冻结前检查，不覆盖驱动内部onclose钩子。

顺序为无持锁身份预检→storage锁→复读配置/有界计量→withStudioWrite(auth→Product→import)领取fence/120秒lease→事务外IO→新withStudioWrite核当前session/role/能力、Product active、当前fence/lease/状态并完成。决不在auth锁内等storage、读文件/网络或hash。连接失效/release后当前操作永久abort，旧reserved/tx永不重连复用；新连接只用于新的查询或显式恢复。

停止证据固定为以下二选一：

1. `stopped-<attemptId>.json`，固定strict `{version:1,importId,attemptId,fence,ownerPid,ownerNonce}`，与DBattempt逐项一致；只能在该主进程对本attempt的reader/write/sync/handle全部settle并关闭后no-clobber写入。没有任何遗留文件写入任务才可宣告stopped。读取受2048bytes和权限检查。
2. 没有有效receipt时，只允许服务端记录owner_pid经`process.kill(pid,0)`得到ESRCH认定原进程结束；成功/PID复用/EPERM/其他错误都不证明停止。先校验pid为正且为记录值，不能检查用户提供PID，更不能kill进程。

lease到期或操作锁已空闲都不是停止证据；PID仍在即使任务可能已结束，也保守拒绝接管/删除/释放。维护者可正常重启已知本机server后再用有效身份recover，但不能让AI杀未知进程。此可用性取舍明确接受，不新造进程管理服务。

此证明只针对当前主进程写文件；后续B2-2媒体子进程不能拥有归档目录写权限。receipt不能由客户端上传路径覆盖。重复恢复只清理已证停止的旧attempt特有临时文件，永不覆盖/删除archive；恢复若断连，旧恢复句柄不能写DB，但已开始的旧临时路径删除仍需settle。

## 文件、状态与恢复

路径固定派生于当前受管实例的`uploads/imports/<importId>/`。祖先0700、普通文件0600、当前用户、无symlink；lstat/realpath/O_NOFOLLOW检查。允许文件名仅archive.quizpack、attempt-<UUID>.partial、stopped-<UUID>.json及其单次原子写入的受控临时名；路径不接受客户端输入。

partial用O_EXCL创建，增量计量/hash、EOF核expected、sync并close；archive.quizpack同文件系统no-clobber提交，禁止可覆盖rename。已有archive只能核事实，不覆盖。保护自己创建的inode，不能用finally盲删archive。临时与最终同inode双名可保守双计。

状态：awaiting-upload→receiving→received；确认断流/期限/IO失败→retryable-failed；确认长度/hash/超量失败→rejected。连接/提交未知不能伪记失败；可留下receiving并要求恢复。rejected只可恢复清理，不能重传改expected；received字节永不改变。cleanup-required/unknown不因terminal状态而释放账目。

recover携expectedStateRevision、fresh auth，先核跨Product归属/当前状态，再取得storage锁与停止证据；用新fence领取有界恢复（不追加上传attempt），事务外核受管文件，再短事务CAS结束。匹配冻结archive→received；只有已停止partial→清理确认后awaiting-upload；rejected仅清理并保留rejected；无停止证据/不匹配→保留RECEIVE_RECOVERY_REQUIRED或STORAGE_CONFLICT。恢复不将partial自动提升archive，便于只保留一种冻结写入路径。

received之前或claim的提交未知都保留足额reservation：claim未知不开始消费body/创建文件，冻结后DB未知不删文件。读查询不修复，不自动重试。即使文件已就绪，过期/撤销身份也不能写received，必须新的有效operator显式恢复。对unknown先查权威DB，再核文件，不能反向从文件存在推断业务事务完成。

## 账目与资源上限

建立意图不预留字节，PUT领取attempt前在storage锁下有界扫描并查询全部held预算，实际文件、孤儿及未知尝试都计入。总额为已知存量＋未覆盖的held headroom＋新attempt峰值；同一attempt文件与其预算避免少算，不确定归属宁可多计。扫描不全或未知owner仍可能写入时保留旧预算。

只有停止证据成立、文件清理/冻结情况确认、DB状态对账提交明确后才把对应disposition置released及释放余量。received原包继续作为存量占用，released不代表删除原包。数量/大小缓存不能覆盖实际文件事实；ENOSPC照常失败。

B2-2处理现有received候选时，原包/旧partial/孤儿继续计存量，再计算新增解码/资源临时/归档峰值；不能只给当前请求128MiB而忽略所有现有候选。本批不清理成功原包、不做blob GC；到扫描上限需受控维护或后续合同，不能静默跳过老文件。

## 错误与交接所有权

复用P2-A/B1的400/401/403/413、PRODUCT_NOT_FOUND/PRODUCT_ARCHIVED、WRITE_BUSY、WRITE_OUTCOME_UNKNOWN和STUDIO_UNAVAILABLE。新增固定码：IMPORTS_DISABLED/IDEMPOTENCY_CONFLICT/IMPORT_STATE_CONFLICT/IMPORT_INTENT_LIMIT/RECEIVE_BUSY/RECEIVE_QUOTA_EXCEEDED/RECEIVE_ATTEMPT_LIMIT/RECEIVE_RECOVERY_REQUIRED/RECEIVE_STORAGE_CONFLICT/RECEIVE_SCAN_LIMIT均409；IMPORT_NOT_FOUND为404；RECEIVE_TIMEOUT为408；RECEIVE_LENGTH_MISMATCH/RECEIVE_HASH_MISMATCH为422；RECEIVE_LOCK_LOST为503。连接/提交未知优先WRITE_OUTCOME_UNKNOWN，不伪装busy。body仅code/requestId与已授权importId，状态冲突可带currentRevision。

A独占表/迁移/权限、runtime版本/管理CLI、`features/quizpack/import/**`服务/DTO/storage/lease/quota及DB故障测试。**先独立提交contracts.ts、service-contract.ts、限额和runtime内部类型给B，再继续实现**；B不能凭猜测自行改签名或SQL。

B独占新增import handlers、`features/studio/imports/**`及状态页/上传流程、HTTP/E2E；只调用A服务，不手写密钥配置、私有路径或文件/DB操作。raw HTTP adapter由B按上述ReceiveSource构造chunks/cancel，取消责任按本合同实现，实际byte/hash约束仍由A。A交接必须包含readImportSettings、exact key查询及ReceiveSource签名，不能留到两流各自猜测。

总控拥有package/lock、共享错误/HTTP客户端调整协调、构建守卫与配置、实例/3100/CI、最终审查。不得让两个流各造鉴权、SQL、驱动重连器。没有后台常驻队列/自动重跑。

## 必须实际验证的矩阵

| 边界      | 实际验收                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置      | v1仍可登录且上传关闭；v2false→CLI启用；两个CLI/接收争锁；CLI丢锁后晚到rename不能越过guard覆盖后继启停；原子替换失败/未知保留可读配置；无secret输出                |
| 意图      | 同key同指纹重放/异指纹冲突、创建响应丢失后的exact key核实0/1与原key重提、20/+1、跨Product、Product归档、only new-draft严格拒额外字段                              |
| 接收      | 32MiB/+1、expected长度上下界、hash错、无Content-Length/伪报、慢流/断流；迭代前拒绝也会cancel、cancel挂起/拒绝不无限等待或假写stopped；multipart/编码/Range拒绝    |
| 文件      | symlink各层、非普通文件/权限、no-clobber已有同/异hash、写/sync/link/unlink局部失败与inode归属                                                                     |
| 连接/身份 | 真实断开锁连接后旧reserved永不可用、旧fence不可提交；文件阶段logout/disable/read-only/Product归档阻断完成                                                         |
| 停止证据  | 完整receipt/错误nonce/fence/超长receipt；ESRCH可恢复，活PID/复用/EPERM不接管；不凭lease或文件静止判断                                                             |
| 配额/扫描 | held/unknown/orphan计入、512MiB与+1、双名/残留；深度/数量/期限/receipt +1拒绝、不扫PGDATA                                                                         |
| 提交/恢复 | claim/文件冻结/received三个点断开；unknown不消费新流/不删archive/不释放；fresh auth恢复、新recovery fence与旧stopped receipt正确配对、重复恢复、最多3attempt      |
| UI/构建   | settings真实只读快照/disabled200、快照后开关改变仍由写服务拒绝；received始终not-run；无process/apply/publish；只读/未知/错误/移动截图；trace guard覆盖uploads路径 |

上述均待实施。最终六项检查、真实test:db、驱动故障回归和实际构建trace由总控安排；本文件编写没有执行DB、服务或build。

## 总控确认记录

总控已接受扫描1024目录/16文件/8192项、5秒子期限及receipt2048bytes/最多3份；接受20个未完成意图的上述定义，以及到扫描上限采用保守维护提示而非自动GC。总控已迁移至新阶段工作树并冻结。独立Astra前置审查登记两项P2：绝对期限与CLI晚到配置写；以上ReceiveContext和独占文件guard为对应修订，仍需实现及实际故障验收。普通技术细节不向用户重复追问，旧B1分支不启动或提交后续代码。
