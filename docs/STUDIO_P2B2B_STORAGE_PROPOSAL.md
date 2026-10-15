# B2-2B 三表、事务和 DTO 冻结候选

> 历史提案：最新修订与实施合同见 [STUDIO_P2B2B.md](STUDIO_P2B2B.md)，冲突时以新合同为准。

2026-10-12；初始只读预研基线 `29e2b49`，已按 B2-2A 至 `6420019` 的接口与审查决定修订。
状态：仅预案，未冻结、未实施、未执行 SQL/DB/Docker/build；必须等 B2-2A 退出和总控审阅。本文不是可直接运行的迁移。
补充审阅基线 `68de75db79c763cf95b9a26369d7c6cceb3aa806`：将 validate 的媒体未知意图合入 claim，以下为候选决定，不改变未冻结状态。
范围仅 received 原包复验、私有资源归档及状态界面；三张新表，无 draft/revision/发布/第四关联表。
依据 `docs/STUDIO_P2B2_VALIDATION.md` 第7节、0007/0008、现有 import storage/service、A 的候选/证据类型。

## 1. 必须先解决的真实接口冲突

1. **claim 前取得身份。** 现有 `validateArchiveCandidate` 内部才调用私有 `runtimeIdentity(binding)`。validation_key 必须在任何 archive IO 前确定，B 不能复制其 hash 算法。建议 A-V 提供固定 `prepareValidationIdentity(context)` 的受审接口，返回严格 ValidationIdentity/不含路径的身份；执行结果必须重新核 identitySha256 相同，否则无候选可提交。不要允许 HTTP 选择 identity/policy。
2. **已有 validated 候选归档重试。** PrivateArchiveCandidate 只有内存 WeakMap issuance；当前公开接口没有从已冻结 DB 证据和原包重建的入口。建议新增 server-only `restoreValidatedCandidate(archive, frozenEvidence, expectedFacts, context)`，严格复用原 parser/受限 ZIP，核全部 raw/canonical/asset-set/candidate hash，不能再解码或生成新的 P1 报告。输入仅由权威 repository 读取，不是浏览器 JSON 导入 API；旧 bundle 不可用则要求新验证。
3. **停止证明不能照搬 receive。** 当前 import `stopped()` 在无 receipt 时只靠 ownerExited/ESRCH；validation 对 media-stop-unconfirmed 必须禁止此回退。A 的 completion 可以证明正常返回的停止，但不是跨重启 invocation 权威。
4. **统一 namespace。** 当前 scanner 只认识 imports、attempt reservation 最大67174400，heldRows 只查 import。B 必须统一升级 scanner/quota/admission 和 receive 调用，不能各建512MiB账本。
5. **DTO 旧常量。** ImportDto 的 validationStatus 固定 not-run。B 改为独立 summary 投影/详情组合，不将 received 改为“已验证”。
6. **证据存储投影。** A 有 sealEvidenceEnvelope，但未导出供 SQL text 边界使用的 report canonical texts 与 metadata 投影。建议一个固定 serializer 返回下述字段，避免 B 复制 A 内部 enforceBudgets。

这些接口在 A 退出后先交桩审阅，再开 B 两流；都不扩展评分、草稿或发布。

## 2. 数据形状与精确 DDL 候选

采用 `text` 权威 canonical JSON，不用 jsonb::text 冒充同一字节。ID 为当前小写 hyphen≤80；版本采用当前纯三段整数≤32；schema/policy列为有界文本，不 hardcode content.v1。
下方 `qf.*_valid` helper 是**待实现的 CHECK/trigger 合同**，定义要求见第3节；须先建函数再建表。函数无动态 SQL、默认 invoker、固定 search_path=pg_catalog，PUBLIC 无 EXECUTE。
hash helper 精确为 `encode(sha256(convert_to(t,'UTF8')),'hex')`；PG18 内置函数，不引入 pgcrypto/扩展。

```sql
CREATE TABLE qf.quizpack_validation (
 id uuid PRIMARY KEY,
 product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 import_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 validation_key char(64) NOT NULL CHECK(validation_key ~ '^[0-9a-f]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[0-9a-f]{64}$'),
 archive_bytes integer NOT NULL CHECK(archive_bytes BETWEEN 1 AND 33554432),
 identity_text text NOT NULL CHECK(octet_length(identity_text) BETWEEN 2 AND 16384),
 identity_sha256 char(64) NOT NULL CHECK(identity_sha256 ~ '^[0-9a-f]{64}$'),
 archive_policy_version varchar(64) NOT NULL,
 archive_policy_sha256 char(64) NOT NULL CHECK(archive_policy_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('validating','validated','archiving','ready','rejected','retryable-failed')),
 state_revision integer NOT NULL CHECK(state_revision BETWEEN 1 AND 2147483647),
 updated_at timestamptz NOT NULL CHECK(updated_at >= created_at),
 fence integer NOT NULL CHECK(fence BETWEEN 1 AND 2147483647),
 lease_until timestamptz,
 current_attempt_id uuid NOT NULL,
 attempts_text text NOT NULL CHECK(octet_length(attempts_text) BETWEEN 2 AND 8192),
 storage_condition text NOT NULL CHECK(storage_condition IN ('clean','cleanup-required','unknown')),
 last_error_code varchar(64) CHECK(last_error_code IN (
   'VALIDATION_TIMEOUT','VALIDATION_CANCELLED','VALIDATION_LOCK_LOST',
   'VALIDATION_RECOVERY_REQUIRED','VALIDATION_STORAGE_CONFLICT','VALIDATION_SCAN_LIMIT',
   'VALIDATION_QUOTA_EXCEEDED','VALIDATION_STATE_CONFLICT','VALIDATION_IDENTITY_CHANGED',
   'VALIDATION_REVALIDATION_REQUIRED','VALIDATION_ATTEMPT_LIMIT','VALIDATION_REJECTED',
   'PACK_IDENTITY_CONFLICT','RESOURCE_DECLARATION_CONFLICT','MEDIA_UNAVAILABLE',
   'EVIDENCE_INVALID','WRITE_OUTCOME_UNKNOWN','STUDIO_UNAVAILABLE')),
 reserved_bytes bigint NOT NULL CHECK(reserved_bytes BETWEEN 0 AND 536870912),
 accounted_bytes bigint NOT NULL CHECK(accounted_bytes BETWEEN 0 AND 536870912),
 evidence_text text CHECK(octet_length(evidence_text) BETWEEN 2 AND 1048576),
 evidence_sha256 char(64) CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 report_texts text[] NOT NULL DEFAULT '{}',
 evidence_metadata_text text CHECK(octet_length(evidence_metadata_text) BETWEEN 2 AND 65536),
 pack_id varchar(80), pack_version varchar(32),
 container_schema_version varchar(64), content_schema_version varchar(64), content_kind varchar(32),
 manifest_sha256 char(64), content_sha256 char(64),
 canonical_manifest_text text CHECK(octet_length(canonical_manifest_text) BETWEEN 2 AND 524288),
 canonical_manifest_sha256 char(64),
 canonical_content_text text CHECK(octet_length(canonical_content_text) BETWEEN 2 AND 2097152),
 canonical_content_sha256 char(64),
 asset_set_text text CHECK(octet_length(asset_set_text) BETWEEN 2 AND 65536),
 asset_set_sha256 char(64), candidate_sha256 char(64),
 resource_count smallint CHECK(resource_count BETWEEN 1 AND 64),
 identity_kind text NOT NULL CHECK(identity_kind IN ('unclaimed','canonical','alias','conflict')),
 canonical_validation_id uuid,
 validated_at timestamptz,
 ready_at timestamptz,
 UNIQUE(product_id,id), UNIQUE(import_id,validation_key),
 FOREIGN KEY(product_id,import_id) REFERENCES qf.quizpack_import(product_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(product_id,canonical_validation_id) REFERENCES qf.quizpack_validation(product_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(canonical_validation_id IS NULL OR canonical_validation_id <> id),
 CHECK(qf.validation_attempts_valid(attempts_text,fence,current_attempt_id,reserved_bytes)),
 CHECK(qf.validation_evidence_valid(evidence_text,report_texts,evidence_metadata_text,attempts_text)),
 CHECK((evidence_text IS NULL AND evidence_sha256 IS NULL)
    OR (evidence_text IS NOT NULL AND evidence_sha256=qf.sha256_utf8(evidence_text)))
);
CREATE UNIQUE INDEX validation_canonical_pack
 ON qf.quizpack_validation(product_id,pack_id,pack_version) WHERE identity_kind='canonical';
CREATE INDEX validation_import_created ON qf.quizpack_validation(product_id,import_id,created_at DESC,id DESC);
CREATE INDEX validation_product_pending ON qf.quizpack_validation(product_id,id)
 WHERE status NOT IN ('ready','rejected') OR storage_condition <> 'clean' OR reserved_bytes > 0;
CREATE INDEX validation_held ON qf.quizpack_validation(id) WHERE reserved_bytes > 0;
CREATE INDEX validation_alias_target ON qf.quizpack_validation(product_id,canonical_validation_id)
 WHERE canonical_validation_id IS NOT NULL;

CREATE TABLE qf.asset_blob (
 sha256 char(64) PRIMARY KEY CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 8388608),
 media_type varchar(32) NOT NULL CHECK(media_type IN ('image/png','image/jpeg','image/webp')),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 8192),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 8192),
 frames smallint NOT NULL CHECK(frames=1),
 storage_key varchar(96) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL,
 CHECK(width::bigint*height::bigint <= 16000000),
 CHECK(storage_key='blobs/'||sha256::text||'.blob')
);

CREATE TABLE qf.product_asset (
 product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 resource_id varchar(80) NOT NULL CHECK(resource_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 resource_version varchar(32) NOT NULL CHECK(resource_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
 blob_sha256 char(64) NOT NULL REFERENCES qf.asset_blob(sha256) ON DELETE RESTRICT ON UPDATE RESTRICT,
 declaration_text text NOT NULL CHECK(octet_length(declaration_text) BETWEEN 2 AND 65536),
 declaration_sha256 char(64) NOT NULL CHECK(declaration_sha256 ~ '^[0-9a-f]{64}$'),
 purpose varchar(16) NOT NULL CHECK(purpose IN ('cover','portrait','decoration')),
 source_validation_id uuid NOT NULL,
 platform_approval varchar(16) NOT NULL DEFAULT 'unverified' CHECK(platform_approval='unverified'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(product_id,resource_id,resource_version),
 FOREIGN KEY(product_id,source_validation_id) REFERENCES qf.quizpack_validation(product_id,id)
   ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(declaration_sha256=qf.sha256_utf8(declaration_text)),
 CHECK(qf.product_asset_declaration_valid(product_id,resource_id,resource_version,blob_sha256,purpose,declaration_text))
);
CREATE INDEX product_asset_source ON qf.product_asset(product_id,source_validation_id);
```

整行shape、状态转换、包身份和immutable规则必须由BEFORE INSERT OR UPDATE trigger调用shape helper实现；不把whole-row CHECK当作已验证语法。另两个延迟constraint trigger的函数体见第3节语义，待A退出后编写真实迁移并独立审冻。
不为 blob 建 pending 行；物理冻结和重新核验之后才在 complete 中插入。孤儿/部分提升由文件、冻结计划和 reservation 表示。
content/manifest/domain版本全部保留在完整文本内，专用列只保留查询所需项；不另复制五个领域版本字段，DTO从严格 parser 投影。

### 2.1 为什么有 identity_kind 和三份 report text 冗余

- `identity_kind=conflict` 让“P1技术成功、同包身份异字节冲突”保留候选和报告，又不占 canonical 唯一键。仅 nullable canonical_validation_id 的部分唯一索引不能表达这种拒绝行。
- canonical/alias/conflict 在首次 accepted evidence 事务确定后不可再改；alias 必须直接指向同 Product、packId/version、archive bytes/hash 的 canonical 行，不允许链/环，也不要求 canonical 已 ready。
- evidence_text 是 A 的完整 canonical envelope。report_texts 是其中 sealed report 的原始 canonical text（按 attempt 排序），evidence_metadata_text 是 A 已有 value:null 投影。
- 这两个冗余字段用于SQL精确检查256KiB单报告/768KiB净payload/64KiB外围，以及 report hash/bytes；避免另实现一套 SQL canonical serializer 或误用 jsonb::text。冗余不创建第四表。
- 冗余使物理 DB 行可大于1MiB；1MiB是单一 evidence envelope 合同，不是整行/WAL/磁盘上限。若总控不接受冗余，应另冻结等效精确字节方案，不能默默退回声明长度。

## 3. 必须实现的 SQL helper/trigger 精确语义

所有函数先检查 UTF8数据库/连接、有限文本字节及容器形状再展开数组；坏 JSON/数值溢出返回 false 或有限23514。不得用裸 `<>` 让 SQL NULL 漏过关键判断，所有最终谓词必须 `IS TRUE`。
JSON semantic 比较仅用于结构/关系；权威原文 hash 使用text实际字节。应用在写前通过 A strict Schema/Unicode/canonical序列化；SQL不冒称重新执行了 P1/图片验证。

### 3.1 validation_shape_valid 与 INSERT/UPDATE guard

- 所有 identity/policy/schema文本ASCII有界非空；所有非空SHA列64小写hex；packId/version遵从上述ID/版本语法。
- INSERT只能是首次claim：revision=fence=1、status=validating、identity_kind=unclaimed、一个kind=validate/mediaStop=unconfirmed的held attempt、候选/报告/validated_at/ready_at为空、reserved=134283264、storage=unknown。媒体未知标记、完整预留和attempt身份必须在同一原子claim中出现。
- INSERT trigger核 import.status=received、actual archive bytes/hash完全等于validation快照；检查identity_text严格身份的identitySha256=identity_sha256，并核validation_key规范（见第4节）。
- 候选整组全空 iff validated_at为空；非空时组内所有hash/文本/schema/pack/resource_count齐全且hash匹配、validated_at>=created_at，content_kind=synthetic（本批策略，不作未来schema enum）。
- semantic manifest.productId/content.product.productId=product_id；pack/version/schema专用列与文本相等；content.resources与asset-set一一对应且1..64，按A排序，无重复三元组。
- asset-set形状精确沿A：schemaVersion/productId/resources[{resourceId,resourceVersion,productId,blobSha256,declarationSha256}]；其hash匹配asset_set_sha256。每项能在content.resources找到且blobSha256=声明sha256。
- canonical_content/manifest hash精确对应文本；raw manifest/content hash与accepted report相等；candidate_sha256按A既有绑定公式在应用计算，SQL核相关输入字段和accepted身份一致。不能宣称SQL重算了未经定义的canonical算法。
- ready要求validated_at、ready_at>=validated_at、identity_kind∈canonical/alias、storage=clean、reserved=0、lease=NULL，全部attempt released/停止已证实。
- rejected可有候选（identity/资源冲突），也可无候选（P1/policy拒绝）；terminal仅status不可退出，允许fresh recover清理held占用但不能改变结论。
- validated/archiving必须有候选；validating必须无候选；retryable-failed可有或无候选，由是否存在validated_at决定retry阶段。
- 每次UPDATE revision恰+1、updated_at不倒退；immutable请求/身份/创建字段不变；fence不降且至多+1；同fence不可换lease，非空lease≤clock_timestamp()+120s。
- 首次accepted候选组可从全空变完整一次，之后逐列IS NOT DISTINCT FROM；canonical目标/identity_kind随该次冻结，以后不可改。
- evidence按attempt追加：已有attempt的result语义不变、已有report_texts逐字节不变，不删除/重排旧项；当前accepted报告不因archive retry重复追加。evidence hash只能随合法append变化。
- 进入完成/运行状态时要求lease有效；所有业务转换的当前operator/CSRF/角色由withStudioWrite重验，不伪称数据库CHECK自带会话权威。

### 3.2 attempt控制文本（最多3项，8KiB）

严格数组，每项字段恰为：attemptId UUID、ordinal 1..3、fence int、ownerPid int、ownerNonce base64url43、kind validate|archive、reservationBytes=134283264、disposition held|released、mediaStop not-started|unconfirmed|confirmed。
新claim/retry追加恰一项；ordinal连续，attemptId唯一，fence严格递增且≤row.fence；current_attempt_id指最后一项，sum(held.reservationBytes)=reserved_bytes。
owner/fence/nonce/kind/reservation永不改；released不能回held。新validate attempt在claim中初始即unconfirmed，不存在先写not-started再补媒体意图的窗口或独立media-intent事务。
claim到candidate之间崩溃同样保守需维护；unconfirmed表示尚不能证明媒体停止/未启动，不等同于已经启动decoder。新archive retry在claim中固定not-started，此attempt终身不得调用candidate验证/decoder，也不得改成unconfirmed。
validate的unconfirmed只能由可核实的实际完成/停止证明解除：确有启动且已停止为confirmed；严格证明没有启动为not-started，后者只允许第4.2节的原进程收尾或已冻结A完成证据路径，不能凭status/空control/ESRCH回退。not-started/confirmed一旦形成即不再回unconfirmed，若需新媒体执行必须新attempt。
mediaStop只描述媒体，不证明后续归档文件IO已结束；即使evidence已令其confirmed，disposition仍held，直到整个attempt的IO停止/完成提交权威成立才可release。SQL检查kind对应初态、终态单向和released不可逆；SQL本身不能验证文件receipt或native停止，服务必须从受管证明读取而非HTTP参数构造。
recover增加row.fence且不追加attempt；旧attempt.fence/owner仍用于receipt比较，不能建row.fence=currentAttempt.fence的全局CHECK。
retry只能在所有旧attempt已released、无媒体未知和storage=clean时追加；3次耗尽后仍可recover核实完成/清理，不能再执行。
8KiB attempts + evidence_metadata_text UTF8字节总和≤65536；没有evidence时仅检查attempts。A已封报告按其真实attempt ordinal映射，不能每次都写attempt1。

### 3.3 evidence字节与append验证

evidence=NULL iff metadata=NULL且report_texts为空；否则strict envelope v1、1..3递增attempt，均对应控制数组中同ordinal的validate attempt。
report_texts是一维数组、下界1、0..3项、无NULL；每项1..262144 UTF8 bytes，sum≤786432；不是jsonb重序列化计数。
逐个sealed report要求 `report_text::jsonb = envelope对应value`、SHA=sha256_utf8(report_text)、canonicalBytes=octet_length(report_text)。report_texts数量必须等于sealed报告数。
metadata_text::jsonb必须等于完整envelope中每个sealed report的value替换为JSON null后的对象；元数据+attempts字节≤65536；完整envelope≤1048576。
核每次evidence.input archive/Product、bound identitySha256=行身份、报告importable/publishable=false、accepted对应candidateValid和policy通过；有限issue码/完整A strict报告主要由可信serializer负责，SQL重点核计量、关系和不可变。
P1非synthetic/未知版本预检拒绝可能report not-run，允许但不伪造failed报告。没有取得结果的崩溃attempt可以无envelope项，不能补写猜测报告。

### 3.4 三表内完整 asset-set 的 SQL 关系验证（没有第四junction）

`asset_set_text`是validation自己的冻结集合；不能把首次source_validation_id当作本次集合。
BEFORE product_asset INSERT：对source_validation_id行要求候选已冻结，该三元组正好在其asset-set，声明hash/blob相等；declaration_text::jsonb与其canonical_content_text.resources对应项完全相等。
并核声明id/productId/version/purpose/sha256与专用列一致，声明bytes/MIME/width/height与asset_blob行一致，frames=1。
绑定同Product的source FK后，再用**DEFERRABLE INITIALLY DEFERRED constraint trigger**要求source_validation最终status=ready；防止独立提交部分product_asset集合。
validation进入ready有另一延迟constraint trigger，在事务结束读取当前行（不要使用排队trigger的旧NEW快照），展开≤64项，逐项JOIN如下关系：

```sql
-- v为触发器在提交时重新读取的最终validation行；前置shape helper已证明set完整/无重复。
SELECT count(*) = v.resource_count
FROM jsonb_to_recordset((v.asset_set_text::jsonb)->'resources') AS r(
  "resourceId" text, "resourceVersion" text, "productId" text,
  "blobSha256" text, "declarationSha256" text)
JOIN qf.product_asset p
 ON p.product_id=v.product_id AND p.product_id=r."productId"
 AND p.resource_id=r."resourceId" AND p.resource_version=r."resourceVersion"
 AND p.blob_sha256=r."blobSha256" AND p.declaration_sha256=r."declarationSha256"
JOIN qf.asset_blob b ON b.sha256=p.blob_sha256;
```

还须将每项p.declaration语义与v.content.resources比较，并核blob尺寸/MIME/bytes；不能仅count相同便忽略声明不一致。
不要求Product只有这份集合：其他历史资源合法存在。约束要求该validation声明的每项恰好存在，且本次以它为source插入的项都在集合内。
所有p/b无UPDATE/DELETE权限，ready候选不可改，所以关系一旦成立不会因应用后续操作失效。DROP/TRUNCATE权限也拒绝。
canonical alias检查同样用触发器：target identity_kind=canonical、Product/包身份/archive完全相同；目标状态可以validated/archiving/ready/rejected(资源冲突)，不能改其身份。
纯技术失败不占包身份；技术成功但包身份冲突的行identity_kind=conflict/status=rejected，无alias；资源声明冲突保留已取得canonical/alias身份及原证据。

## 4. 三个关键提交边界与运行状态

validation_key规范候选：SHA256(canonicalP1Json({schemaVersion:'quizpack-validation-key.v1', productId, importId, archiveSha256, archiveBytes, identitySha256, archivePolicyVersion, archivePolicySha256}))。
archive policy包含synthetic/归档/SQL投影及预算版本；A的persistencePolicyHash只代表当前A策略，不能假称已包括B新增归档规则。
同import/key唯一；同Product相同包但不同import有各自记录，可在evidence阶段指向同canonical身份。请求deadline/PID/nonce/attempt不入key。

固定顺序：只读会话预检 → storage独占reserved连接try-lock(72461,2) → 复读enabled及双config guard → bounded scan/held rows → 同operation平台身份准备 → 短业务事务auth → Product → import → validation。
canonical冲突查找/资源锁都在Product行已锁之后；资源稳定按blob hash、再Product/resource/version排序。无持auth等storage，无auth跨文件IO。

### 4.1 preclaim readBinding 的平台 IO：新增待总控决定

总控已原则认可当前平台guard作为这一步的独立权威，不新增业务表/预留或第四业务提交；本候选整体仍未冻结。`readMediaRuntimeBinding`不是纯内存函数：Linux可执行固定Docker policy查询CLI，并写平台自己的持久guard/record；TypeScript返回binding不证明它没有外部IO。
允许的preclaim副作用仅为受审平台绑定查询/CLI控制记录；不打开原包、不创建解码container、不产生candidate/归档文件、不写uploads。若将来readBinding越过此范围，必须重新审顺序，不能沿本例外直接执行。
平台在首CLI前必须已持有自身guard/record，所有命令及控制scope正常settled后才返回可用binding；unknown保持持久阻断。若A-R的实际接口未能作出该保证，B不能仅凭bound标签继续claim。
此时无业务validation row是有意设计：没有archive/候选IO便无业务reservation可释放，平台控制文件属于独立runtime namespace，不计uploads512MiB。身份查询unknown返回有限MEDIA_UNAVAILABLE/维护提示，不创建假的validation失败报告。
storage锁在身份准备之前取得，固定storage→platform顺序，不持有auth锁等待CLI。使用同一MediaOperationContext/绝对业务期限/共用5秒收尾；平台unknown时不得为凑identity另起干净context或再读一次。
validate claim在同一提交内持久化attempt.mediaStop=unconfirmed，随后只有确认COMMIT且当前operation仍有效才可进入原包读取/candidate；不再额外提交media-intent。它保护业务任务崩溃窗口，不能由先前readBinding的CLI关闭证明替代。candidate返回identity与claim身份不同则本次不写accepted证据。
claim提交未知不进入candidate；preclaim平台查询本身已知正常settled不因claim未知倒推成媒体任务已经启动。反之平台查询未知虽无validation行，也必须由平台维护流程处理，普通validation recover不能删其guard。
备选是无CLI读取sealed身份候选形成暂定key，claim之后再核实际平台身份；需要新的候选身份/已验证身份区分和失配语义。它可以实现，但本批不默认新增接口，不把sealed文件单独当当前运行事实。推荐先验证现有guard路线的真实失败行为。

| 阶段      | 事务/IO决定                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份准备  | 有界核A identity（不读archive，但允许上述固定平台CLI/control IO）；不可用/平台停止未知不创建validation，平台guard保留维护权威。服务端身份若中途变更，本次失败关闭。                                                                                              |
| claim     | 当前operator+import:create/CSRF、Product active、received事实、20未完成/全局1024、key重放检查、quota/name headroom；首次/validate retry原子追加unconfirmed+held+完整预留，archive retry原子追加not-started+held+完整预留。确认COMMIT之前零archive/media/归档IO。 |
| 验证IO    | 私有原包一次快照hash/bytes对received；A在同budget执行。同步候选内存不交浏览器。失去storage或业务期限即停止新增工作。                                                                                                                                             |
| evidence  | 当前鉴权/lease/fence及received绑定；append有界证据；accepted冻结全部候选+asset-set、取得canonical或alias；技术/包身份拒绝写rejected。未知提交停止后续归档。                                                                                                      |
| archiving | 短事务validated→archiving，不延长同fence lease；事务外按冻结计划逐资源临时写/sync/close/no-clobber冻结。已有blob重读核真实字节及声明事实。                                                                                                                       |
| complete  | 所有文件IO/close证明齐全且物理事实已核；同事务插入blob和全部新product_asset、更新ready、release reservations、审计。deferred constraints在COMMIT验证全量集合；INSERT conflict必须读并精确比较，不能DO NOTHING后默认为成功。                                      |

complete不做文件IO；SQL无法证明磁盘字节，只证明表关系，服务事务外核文件才是物理权威。失效请求DB不得重新连接；所有read/write await套同一操作deadline和driver失效语义。
60秒业务+共用5秒收尾、120秒lease沿冻结合同；收尾不新开业务事务，只等待关闭/合格receipt。已确认COMMIT保留成功，未知COMMIT保留文件及预留。
正常每次状态/控制UPDATE都revision+1；一次操作可有多次revision增长，客户端不预测+1。ready/rejected重复POST只读重放，无新audit成功事件。
三项关键确认边界仍是claim/evidence/complete；取消收尾、失败记录、恢复和archiving状态控制写不取得新的候选或资源权威。本文取消独立media-intent写；是否将validated→archiving控制UPDATE合入同一evidence事务，由后续精确SQL统一确定，不能在evidence提交未确认时开始文件提升。

### 4.2 原子claim后的停止与UNKNOWN语义

此调整没有新增安全反例：预留与潜在媒体义务在首次可能启动之前已经原子存在，消除了“claim成功但媒体标记尚未落库”的窗口；代价是尚未启动便崩溃也占用预留并需维护。

| 已知事实                                      | 允许行为                                                                                                                       | 禁止推断/计量处理                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| preclaim身份CLI停止未知                       | 零claim；保留平台guard并返回维护错误                                                                                           | 无业务attempt可release；不能创建伪validation失败证据或绕过平台guard。                                                       |
| claim明确回滚/拒绝                            | 不进入archive/candidate；返回确定错误                                                                                          | 本次无持久业务预留/attempt；不修改任何既有attempt的占用。                                                                   |
| claim提交结果未知                             | 永不进入archive/candidate；终止失效请求client，返回WRITE_OUTCOME_UNKNOWN                                                       | 不根据本地未调用candidate就声称DB回滚或reservation已释放；不写猜测receipt，不新建key/attempt重试。                          |
| claim已提交，进入candidate前进程崩溃          | 读取既有unconfirmed/held行，普通recover返回维护所需状态                                                                        | owner ESRCH、lease过期、phase仍validating和平台control为空均不足以证明未启动。原始预留及未落地名称headroom持续计入。        |
| claim已提交，原进程确定在candidate前拒绝/取消 | 先永久封住该attempt的candidate启动门，再停止并等待全部已发出的archive reader/其他相关IO；齐全后才写not-started/settled receipt | 单纯Promise取消、设置aborted或同步catch不算settled；尚未关闭的reader/迟到callback不能在receipt之后再启动candidate或文件写。 |
| candidate已进入，结果为未启动或已确认停止     | 仅按A严格完成证据和该attempt全部相关IO核停止；符合条件的终态可写receipt                                                        | 不再允许以原服务的“尚未看到spawn”猜测未启动。A任一STOP_UNCONFIRMED/relatedIo未确认保持unconfirmed/held。                    |
| evidence/complete结果未知                     | 不提升后续文件、不启动新任务；如原执行已确实停止可保留真实receipt，fresh recover查权威行                                       | receipt只证明停止，不证明事务回滚/未提交；同一key、文件、blob和reservation保留到权威对账提交确认。                          |

已知pre-candidate拒绝的最小实现约束：持有该attempt的同进程ownerNonce/fence，并在私有执行状态中记录candidate调用尚未发出；在没有任何await的步骤内先切为不可重新启动的stopping状态，再取消/等待已发出任务。任何可能启动candidate的异步continuation都必须重新核此门及operation/lock状态。
只允许在所有相关任务真实settled、仍无媒体调用且不会再启动业务IO时写not-started receipt。它必须匹配已经确认claim的validation/attempt/owner/fence；不额外增加表、可由请求提交的“未启动”布尔值或通用恢复token。
若此时业务预算/鉴权/请求DB失效，仅在原共用5秒收尾内写合格receipt并保留held，不开新的业务连接试图release。随后fresh-auth recover在storage锁下核receipt、CAS/fence和实际文件，提交release/状态对账；确认该提交前计量不变。
若停止/receipt任一步未知，仍unconfirmed/held；若receipt已落盘但DB写结果未知，重查并幂等使用同一receipt，不删除证明重造。解除媒体未知不等于自动放弃本次全部文件预留。
claim结果未知时，fresh查询得到行则按其当前权威状态处理；得到空结果不单独证明原事务已结束。只有原事务终态可证且权威核实未提交才可按原key重新开始，否则保持未知/维护，不盲目新claim。
pre-candidate失败不是P1内容判定：没有调用A便不追加伪造report/envelope，通常回retryable-failed/cleanup-required并保留固定服务错误；已知停止且对账成功后才clean/released。原archive和received事实永不改变。
已确认claim后的早拒仍消耗这一个attempt；不能删除attempt、回退ordinal或退还执行次数。只有原claim明确未提交时，数据库本来没有该attempt可计数。

## 5. recover 与 retry 精确分工

- POST create：若同key已存在直接返回权威状态（200/replayed=true），不隐式执行retry。仅真正插入首次行返回201。
- recover：fresh auth+CAS；获取storage，核数据库权威结果和旧attempt receipt/停止事实，row fence+1但不追加attempt；只对账/清理自身temporary/证明/恢复元数据，不解码、不创建新的blob、不补齐product_asset集合。
- complete提交应答未知但实际已ready：recover返回原ready，不增revision/fence、不重复审计。未ready且只有部分blob：核完后回validated（已有候选）或retryable-failed（无候选）；以后显式retry继续业务。
- 因此已发出但未提交的complete不能由recover偷偷再次提交资源集合；新archive retry消耗一个attempt。第3次失败耗尽仍可对账/清理，但不能发起第4次业务执行。
- retry：fresh auth+CAS；全部旧attempt停止已证明、released且storage clean；validated/archiving已有候选选择kind=archive/mediaStop=not-started，retryable-failed无候选选择kind=validate/mediaStop=unconfirmed；在claim中原子写入，先确认提交再IO。
- rejected/ready不retry。validated而旧bundle不再可用返回VALIDATION_REVALIDATION_REQUIRED；UI可显式发起当前policy的新记录，不覆盖旧记录。
- mediaStop=unconfirmed且无可信stopped receipt时，owner ESRCH也不解除；平台维护必须另有受审真实停止依据，不在本批增加“强制清理”按钮或HTTP PID参数。
- receipt只在reader、decoder actual stop/stdio、所有write/sync/link/unlink/close settled且不会再启动写之后写；receipt写入本身失败保留占用。过期lease不是停止证明。

建议receipt v1：{schemaVersion:'quizpack-validation-stopped.v1',validationId,attemptId,fence,ownerPid,ownerNonce,mediaStopped:'confirmed'|'not-started',relatedIo:'settled'}；≤2048，fence匹配旧attempt不可变值。
artifact/archive重试的not-started attempt由kind=archive及禁止decoder的执行路径保证无媒体风险，可以沿B1“receipt或owner ESRCH”判断主进程IO结束。kind=validate初态永远unconfirmed；只有第4.2节的真实证明可形成not-started，不允许recover把无记录/owner退出推断为这一状态。

## 6. namespace / 字节和名称预留

固定uploads/{imports/<uuid>,validation/<uuid>,blobs/<sha256>.blob}，名称只由服务生成；只浏览这三种闭集，不递归扫描PGDATA/runtime/admin。
validation每attempt串行复用一个`attempt-<uuid>.partial`：每资源O_EXCL创建→write/hash/sync/close→link目标→删除自身partial，再处理下一项；从不覆盖final blob。
停止receipt文件为`stopped-<attemptId>.json`及单个受控原子临时名；所有attempt累计每目录≤16文件。不得把64个资源都落成64个独立temporary突破16文件合同。
imports≤1024、validation≤1024、blobs≤4096；总8192扫描目录项、5秒（含最后IO），所有related row查询limit+1。数据库记录上限也检查，空目录缺失不让新validation无限增长。
storage scan返回显式namespace，不用裸UUID混作Map key；现有receive全部改调此scanner，原import路径/receipt语义不改变。

配额公式：observed所有受管文件逻辑字节 + Σheld尚未被自己partial覆盖的reservation；同路径双名分别计，unknown/orphan均计。
validation每执行预留134283264，原包存量另计；最多3attempt但retry要求旧held已释放，不能靠恢复无限新增预留。
仅该attempt自己的已见partial可抵扣其reservation，不能拿共享final blob或其他namespace同UUID抵扣。保守重复计量允许，不冒称磁盘精确占用。
在本次已准入执行过程中，完成/recover对账允许消除这种保守重复计量，不拿新增准入quota规则阻止已完成的release；不得因此允许新的执行超512MiB。
名称headroom也预留：validate无计划时最多64个未来blob名；evidence后按冻结计划distinct hash集合核名称。held attempt即使目录/文件未出现也占其未来目录、partial、receipt、receipt.tmp和blob名容量。
跨held集合共享已知hash可按名称union计，unknown计划用64槽保守相加；不能因旧owner丢锁后尚未落地而让新操作把4096/8192槽用完。
accounted_bytes只描述该validation私有目录已见字节；blob全局一次计入scan，不把每个Product引用再计一次。SQL列不是FS事实的替代物。
新blob名占满但同hash目标已存在时可复用；任何异常字节/MIME事实冲突不覆盖。原包和final blob首批永不删除，无全局GC。

## 7. browser-safe DTO / HTTP 候选

统一所有UUID小写canonical；ID/版本/sha沿P1。日期ISO；revision int1..2147483647；strict object拒未知字段，JSON≤4KiB/5秒，整个写操作deadline仍从Handler入口开始。

```ts
type StartValidation = { expectedImportStateRevision: number };
type ValidationCas = { expectedStateRevision: number };
type ValidationListQuery = {
  page: number; // 1..1000 default1
  pageSize: number; // 1..50 default20
  status?: ValidationStatus;
  validationKey?: string; // exact lowercase sha256；响应未知查询用
};
type ValidationDto = {
  id: string;
  productId: string;
  importId: string;
  validationKey: string;
  stateRevision: number;
  status: ValidationStatus;
  storageCondition: "clean" | "cleanup-required" | "unknown";
  lastErrorCode: ValidationErrorCode | null;
  attemptCount: number;
  remainingAttempts: number;
  maintenanceRequired: boolean;
  archiveSha256: string;
  archiveBytes: number;
  identitySha256: string;
  validatorBundleSha256: string;
  packId: string | null;
  packVersion: string | null;
  containerSchemaVersion: string | null;
  contentSchemaVersion: string | null;
  identityKind: "unclaimed" | "canonical" | "alias" | "conflict";
  canonicalValidationId: string | null;
  candidateSha256: string | null;
  assetSetSha256: string | null;
  resourceCount: number | null;
  archivedResourceCount: number; // ready时=resourceCount；否则只计已确认的业务引用，非FS猜测
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  readyAt: string | null;
  platformApproval: "unverified";
  publishable: false;
};
```

DTO不含attempt owner PID/nonce/fence、路径/storage key、声明全文/原包字节、SQL/stack。metadata读取从Product归属出发；全局read-only角色可读，不虚构Product ACL。
详情可附三个有界attempt摘要（ordinal/kind/阶段/固定code/checks），完整报告另授权JSON投影且有1MiB响应上限；首批可只交摘要界面，canonical正文不渲染HTML。
archivedResourceCount不得以同SHA物理文件存在推断已授Product引用；部分FS归档界面只说“待核实/需恢复”，不显示发布成功。

| 路径（均以/api/studio/products/[productId]/imports/[importId]开头） | 方法/结果                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| /validations                                                        | POST StartValidation；201真实创建，200同key重放；受管enabled和当前import:create |
| /validations                                                        | GET分页/精确key，按created_at DESC,id DESC；studio:read                         |
| /validations/[validationId]                                         | GET当前权威详情；studio:read，跨Product一律not found                            |
| /validations/[validationId]/recover                                 | POST CAS；纯核实/对账，无业务隐式重试                                           |
| /validations/[validationId]/retry                                   | POST CAS；明确执行attempt，不接受phase/policy/PID/path                          |

服务签名沿B1 `(db, credentials/token, productId, importId, ...input, context)`；start/recover/retry的db为请求独占，context沿媒体operation和DatabaseBudget桥接，不能每段重建60秒。
列表/详情no-store；Host/Origin/CSRF沿现有HTTP层。UI读enabled是快照，所有write在storage锁内重读config和两guard。
同POST响应丢失：先GET该import已有记录，不盲重发；新identity/key意味着新验证，必须显式操作，不能把旧unknown换成新key逃逸。

错误映射候选：400 INVALID_REQUEST；401/403复用auth/CSRF；404 IMPORT_NOT_FOUND/VALIDATION_NOT_FOUND；409 STATE_CONFLICT、BUSY、IDENTITY_CHANGED、REVALIDATION_REQUIRED、ATTEMPT_LIMIT、PRODUCT_ARCHIVED；503 STORAGE_CONFLICT/SCAN_LIMIT/QUOTA_EXCEEDED/RECOVERY_REQUIRED/WRITE_OUTCOME_UNKNOWN；504 OPERATION_TIMEOUT。
确定P1/policy/包身份/资源声明拒绝是成功返回的rejected DTO（200/201），不是把内容异常伪装HTTP500；未知提交503不可标retryable:true。
数据库last_error_code冻结为上述领域固定码及A有限interruption映射；A全部issue详情留证据，不逐条扩成SQL错误码。

## 8. 迁移、权限、审计和并行所有权

建议新增0009_validation_audit_actions（仅新增enum值，独立提交迁移事务），0010_validation_assets（函数/三表/触发器/index/audit_target）；最终序号以A退出后的历史为准，不改0001..0008。
扩展audit_action：validation_started、validation_evidenced、validation_rejected、validation_interrupted、validation_completed、validation_recovered、validation_retried；target_kind='validation'、target_id UUID、target_revision当前revision。一次真实状态变化一次事件，幂等读重放不增事件。
不增加权限role/ACL。app SELECT/INSERT三表；validation仅授可变控制列、证据append列和首次候选列的UPDATE，触发器限制write-once；immutable输入/身份列无UPDATE。
blob/product_asset无UPDATE/DELETE/TRUNCATE/DDL；全部无PUBLIC grants。app仅EXECUTE所需CHECK helpers，trigger functions不可直接调用；默认invoker，避免自建绕过auth的SECURITY DEFINER写入口。
迁移runner集中重述column grants；Drizzle schema、client权限审计、管理CLI期望迁移、真实DBfixture清理和旧v1/v2受管实例升级一并更新。不能通过旧schema检查后再迟到缺表异常。
schema验证保证SQL关联和不可变，不能证明P1执行或文件真实性；信任边界仍是受测服务+固定app权限+当前会话写事务。

| 流                      | 独占范围与交接                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sol-A DB/domain/storage | 新validation领域contracts/service/repository；三表SQL及helpers/triggers；统一scanner/quota与receive接线；文件提升/receipt/recover；真实PG/FS故障测试。先交可导入DTO/服务签名和错误码。 |
| Sol-B HTTP/UI           | Studio验证路由适配、列表/详情/真实按钮、只读/禁用/未知提交流程；B1导入详情组合DTO；浏览器/HTTP测试。不得自己写SQL、读runtime.json或调用media internal。                                |
| 总控                    | 迁移/权限/共享DB schema和package/CI最终集成；A公共identity/restore/serializer接口归属协调；目标worktree build binding/seal及3100独占验收。                                             |

Sol-A可以准备迁移patch由总控单次集成，不能两流同时改migrate.ts/schema.ts。A生产模块源码发生接口变化会改runtime身份，B实施开始前先稳定bundle；不能拿fixture seal授权B真实路由。

## 9. 具体验收矩阵

| 类别                 | 必须实际证明                                                                                                                                                                                                                    | 所有者                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| pure strict/bytes    | Unicode拒绝、raw/canonical分限额、64KiB声明、三报告payload/metadata/envelope各+1、report冗余投影不一致、稳定key/asset-set排序、有限DTO                                                                                          | A领域；A-V接口配合       |
| 真实PG关系           | 跨Product import/source/alias失败；alias链/环、同身份异hash；同资源声明改license也冲突；缺一项/重复集合/额外source资源/伪blob尺寸不能ready；完整集合与审计同提交                                                                | Sol-A                    |
| 真实PG权限/状态      | INSERT ready被拒；validate claim媒体未知/预留/attempt同提交，archive claim固定not-started；immutable事实修改、旧attempt改写/released复活/同fence续租被拒；recover不增attempt；第4attempt失败；row fence可高于old attempt        | Sol-A                    |
| 三提交未知           | claim明确回滚零IO零本次预留；实际提交但断响应零candidate且预留仍held；空查询不当回滚证明；evidence未知不提升；complete已提交断响应返回原ready，未提交保留文件且需显式retry；无重复资源/审计                                     | Sol-A故障钩子+真实PG连接 |
| claim到candidate窗口 | claim后立即杀原合成owner，ESRCH/control空仍保留媒体未知；已知pre-candidate拒绝但reader.close迟到时不得写receipt；迟到continuation不能在stopping后启动candidate；合格not-started receipt经fresh recover才release且总配额只扣一次 | Sol-A真实进程/FS/PG故障  |
| 身份竞争             | preflight后降权/退出、Product归档在evidence/complete前均阻止业务写；不因旧actor通过；auth锁不跨延迟文件IO                                                                                                                       | Sol-A真实PG并发          |
| 实际文件             | no-clobber/已有同异字节/symlink/非普通对象；write/sync/link/unlink/close失败；原包不删；partial serial16文件上限；late IO不伪造receipt                                                                                          | Sol-A独立私有fixture     |
| 配额/名称            | 原包+blob+孤儿+旧held跨receive/validation共同512MiB；相同UUID跨namespace不抵扣；1024/4096/8192及最后扫描IO超5s；未落地held64blob槽；超额recover仍能安全对账                                                                     | Sol-A                    |
| 实际媒体停止         | 普通三格式/坏图拒绝；runtime异常不永久rejected；取消/超时共用5秒；media未知+主进程ESRCH不释放；archive retry确认不调用decoder                                                                                                   | A平台实证+Sol-A集成      |
| HTTP/浏览器          | start真201/replay200、详情列表真实分页；read-only/开关关闭/归档/陈旧CAS；响应未知先读；recover与retry按钮分离、无假发布/草稿；移动截图                                                                                          | Sol-B，生产3100总控串行  |
| 部署                 | B真实业务路由实际Next构建artifact/runtime identity匹配、重新record/sealed、私有trace0违规；不能继承A隔离fixture能力                                                                                                             | 总控                     |

总控在预研中选定 identity_kind、报告 text 冗余投影和第 3 次归档失败后仅可对账的有限重试方案；validate claim 原子写 mediaStop=unconfirmed，archive claim 固定 not-started，取消独立 media-intent 事务。三个关键提交边界指 claim/evidence/complete，允许合同明确列出的短状态事务；每次未知提交仍停止后续 IO，不以名称弱化其权威。以上仍是待 A 技术退出后冻结的精确候选，尚未创建迁移、业务表、DTO、服务或后台按钮。普通工程取舍已属托管范围，不重复向作者请求启动许可。
