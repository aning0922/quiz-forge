# B2-2B 验证落库与私有资源归档合同

2026-10-12；基线为 B2-2A 最终 `844054c89b5587ed6cd41dd52c9c8fffd289f9e4`，其普通 CI 38195851289 与媒体 CI 38195851290 已实际通过。
状态：**合同已冻结，放行本批分流实现**。SQL/事务/适配器及新增not-started边界的独立Astra前置审查均已闭合，UI pending另经Astra子代理复验；记录见P2B2B_REVIEW。本文取代STORAGE_PROPOSAL的候选决定，旧提案保留为历史。技术实现与实际验收尚未完成。

范围仅 received 原包复验、私有资源归档及后台状态界面；三张新表，无 draft/revision/发布/第四关联表。本批只接受 synthetic/v1 验证样本，不把作者已选择的四卡 authored 草案改标为 synthetic。
依据 STUDIO_P2B2_VALIDATION 第 7 节和已交付 A 公共接口；三个适配器的补充合同见 [B2B_VALIDATION_ADAPTERS.md](B2B_VALIDATION_ADAPTERS.md)。前台正式答题、报告、内容 v2 与内测闭环仍属后续路线。

## 1. 本批先交付的公共适配器

1. **claim 前取得身份。** 现有 `validateArchiveCandidate` 内部才调用私有 `runtimeIdentity(binding)`。validation_key 必须在任何 archive IO 前确定，B 不能复制其 hash 算法。A-V 提供固定 `prepareValidationIdentity(context)` 的受审接口，返回严格 ValidationIdentity/不含路径的身份；执行结果必须重新核 identitySha256 相同，否则无候选可提交。不要允许 HTTP 选择 identity/policy。
2. **已有 validated 候选归档重试。** PrivateArchiveCandidate 只有内存 WeakMap issuance；当前公开接口没有从已冻结 DB 证据和原包重建的入口。新增 server-only `restoreValidatedCandidate(archive, {prepared, frozenEvidence, expectedFacts}, context)`，严格复用原 parser/受限 ZIP，核全部 raw/canonical/asset-set/candidate hash，不能再解码或生成新的 P1 报告。输入仅由权威 repository 读取，不是浏览器 JSON 导入 API；旧 bundle 不可用则要求新验证。
3. **停止证明不能照搬 receive。** 当前 import `stopped()` 在无 receipt 时只靠 ownerExited/ESRCH；validation 对 media-stop-unconfirmed 必须禁止此回退。A 的 completion 可以证明正常返回的停止，但不是跨重启 invocation 权威。
4. **统一 namespace。** 当前 scanner 只认识 imports、attempt reservation 最大67174400，heldRows 只查 import。B 必须统一升级 scanner/quota/admission 和 receive 调用，不能各建512MiB账本。
5. **DTO 旧常量。** ImportDto 的 validationStatus 固定 not-run。B 改为独立 summary 投影/详情组合，不将 received 改为“已验证”。
6. **证据存储投影。** A 有 sealEvidenceEnvelope，但未导出供 SQL text 边界使用的 report canonical texts 与 metadata 投影。固定 serializer 返回下述字段，避免 B 复制 A 内部 enforceBudgets。

这些接口与 DB/DTO 合同先交付可编译公共里程碑；归档与 HTTP/UI 按指定提交接入。不扩展评分、草稿或发布。

## 2. 数据形状与精确 DDL 合同

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
 CHECK(((evidence_text IS NULL AND evidence_sha256 IS NULL)
    OR (evidence_text IS NOT NULL AND evidence_sha256 IS NOT NULL
        AND evidence_sha256=qf.sha256_utf8(evidence_text))) IS TRUE)
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

整行shape、状态转换、包身份和immutable规则必须由BEFORE INSERT OR UPDATE trigger调用shape helper实现；不把whole-row CHECK当作已验证语法。另两个延迟constraint trigger的函数体见第3节语义，实施时编写真实迁移并独立审查。
不为 blob 建 pending 行；物理冻结和重新核验之后才在 complete 中插入。孤儿/部分提升由文件、冻结计划和 reservation 表示。
content/manifest/domain版本全部保留在完整文本内，专用列只保留查询所需项；不另复制五个领域版本字段，DTO从严格 parser 投影。

### 2.1 为什么有 identity_kind 和三份 report text 冗余

- `identity_kind=conflict` 让“P1技术成功、同包身份异字节冲突”保留候选和报告，又不占 canonical 唯一键。仅 nullable canonical_validation_id 的部分唯一索引不能表达这种拒绝行。
- canonical/alias/conflict 在首次 accepted evidence 事务确定后不可再改；alias 必须直接指向同 Product、packId/version、archive bytes/hash 的 canonical 行，不允许链/环，也不要求 canonical 已 ready。
- evidence_text 是 A 的完整 canonical envelope。report_texts 是其中 sealed report 的原始 canonical text（按 attempt 排序），evidence_metadata_text 是 A 已有 value:null 投影。
- 这两个冗余字段用于SQL精确检查256KiB单报告/768KiB净payload/64KiB外围，以及 report hash/bytes；避免另实现一套 SQL canonical serializer 或误用 jsonb::text。冗余不创建第四表。
- 冗余使物理 DB 行可大于1MiB；1MiB是单一 evidence envelope 合同，不是整行/WAL/磁盘上限。本批接受此冗余，不得退回声明长度计量。

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
- 每次UPDATE revision恰+1、updated_at不倒退；immutable请求/身份/创建字段不变；fence不降且至多+1；同fence不可设置新的非空lease或改变既有非空lease，允许终态/释放时清为NULL；新的非空lease只随新fence产生，且≤clock_timestamp()+120s。
- 首次accepted候选组可从全空变完整一次，之后逐列IS NOT DISTINCT FROM；canonical目标/identity_kind随该次冻结，以后不可改。
- evidence按attempt追加：已有attempt的result语义不变、已有report_texts逐字节不变，不删除/重排旧项；当前accepted报告不因archive retry重复追加。evidence hash只能随合法append变化。
- 进入完成/运行状态时要求lease有效；所有业务转换的当前operator/CSRF/角色由withStudioWrite重验，不伪称数据库CHECK自带会话权威。

### 3.2 attempt控制文本（最多3项，8KiB）

新v2严格数组，每项字段恰为：attemptId UUID、ordinal 1..3、fence int、ownerPid int、ownerNonce base64url43、kind validate|archive、reservationBytes=134283264、disposition held|released、mediaStop not-started|unconfirmed|confirmed、fileStopProof null|严格对象。旧v1九字段数组只用于历史查询/精确重放，不自动补proof；兼容规则见第8节。
新claim/retry追加恰一项；ordinal连续，attemptId唯一，fence严格递增且≤row.fence；current_attempt_id指最后一项，sum(held.reservationBytes)=reserved_bytes。
owner/fence/nonce/kind/reservation永不改；released不能回held。新validate attempt在claim中初始即unconfirmed，不存在先写not-started再补媒体意图的窗口或独立media-intent事务。
claim到candidate之间崩溃同样保守需维护；unconfirmed表示尚不能证明媒体停止/未启动，不等同于已经启动decoder。新archive retry在claim中固定not-started，此attempt终身不得调用candidate验证/decoder，也不得改成unconfirmed。
validate的unconfirmed只能由可核实的实际完成/停止证明解除：确有启动且已停止为confirmed；严格证明没有启动为not-started，后者只允许第4.2节的原进程收尾或已冻结A完成证据路径，不能凭status/空control/ESRCH回退。not-started/confirmed一旦形成即不再回unconfirmed，若需新媒体执行必须新attempt。
mediaStop只描述媒体，不证明后续归档文件IO已结束；即使evidence已令其confirmed，disposition仍held，直到整个attempt的IO停止/完成提交权威成立才可release。SQL检查kind对应初态、终态单向和released不可逆；SQL本身不能验证文件或native停止，服务必须从同请求已settled发布产生的私有资格取得ACK，不能从HTTP参数或文件存在构造。held→released要求上一次已提交行中已有匹配fileStopProof，同次新增proof并release/ready拒绝。
recover增加row.fence且不追加attempt；旧attempt.fence/owner仍用于receipt比较，不能建row.fence=currentAttempt.fence的全局CHECK。
retry只能在所有旧attempt已released、无媒体未知和storage=clean时追加；3次耗尽后仍可recover核实完成/清理，不能再执行。
attempts_text实际UTF8≤8192，且与evidence_metadata_text实际字节之和≤65536。v2从首次evidence起额外限制metadata≤57344，为三attempt最终proof和controls预留完整8192空间；不是只给本次实际controls留余量。没有evidence时只计controls。A报告/envelope算法不变，不截断证据。A已封报告按真实attempt ordinal映射。

fileStopProof固定字段：schemaVersion=quizpack-validation-file-stop-proof.v1、protocol=candidate-receipt-db-ack.v1、validationId、attemptId、fence、ownerPid、ownerNonce、receiptSha256、scope=files-and-media、mediaStopped=confirmed|not-started、relatedIo=settled；canonical UTF8≤1024，原身份及mediaStopped必须与所属attempt/行匹配。绑定所属行不可变archive policy，不重复存路径、时间、完整receipt或报告。新claim/retry明确null；仅当前held attempt在独立ACK中null→对象一次，旧proof不可删除或替换，不进入HTTP输入/公开DTO。

### 3.3 evidence字节与append验证

evidence=NULL iff metadata=NULL且report_texts为空；否则strict envelope v1、1..3递增attempt，均对应控制数组中同ordinal的validate attempt。
report_texts允许合法空数组；仅非空时要求一维且下界1，0..3项、无NULL；每项1..262144 UTF8 bytes，sum≤786432；不是jsonb重序列化计数。
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

## 4. 提交边界与运行状态

validation_key规范：SHA256(canonicalP1Json({schemaVersion:'quizpack-validation-key.v1', productId, importId, archiveSha256, archiveBytes, identitySha256, archivePolicyVersion, archivePolicySha256}))。
archive policy包含synthetic/归档/SQL投影及预算版本；A的persistencePolicyHash只代表当前A策略，不能假称已包括B新增归档规则。
同import/key唯一；同Product相同包但不同import有各自记录，可在evidence阶段指向同canonical身份。请求deadline/PID/nonce/attempt不入key。

固定顺序：只读会话/CSRF预检 → storage独占reserved连接try-lock(72461,2) → 复读enabled及双config guard → **当前授权下按Product/import/expectedValidationKey精确查询已有记录**。命中任何状态均直接重放，不做当前平台身份查询、capacity/配额准入或新attempt；陈旧expectedImportStateRevision不阻止已有key的精确重放，但必须仍为同Product/import的原received事实。
仅未命中的新执行路径才进行 bounded scan/held rows、同operation平台身份准备、重算key/核expectedKey及revision，再进入短业务事务auth → Product → import → validation；claim事务必须再次查询同key，覆盖前次查询后才提交的记录。现有key重放仍受当前会话、CSRF、import:create及enabled策略约束；产品归档禁止新执行，但不隐藏已存在记录的权威状态。当前平台失效、bundle已变更或平台guard未知不能阻止已有key查证。
canonical冲突查找/资源锁都在Product行已锁之后；资源稳定按blob hash、再Product/resource/version排序。无持auth等storage，无auth跨文件IO。

### 4.1 preclaim readBinding 的平台 IO

采用平台guard作为这一步的独立权威，不新增业务表/预留或第四业务提交。`readMediaRuntimeBinding`不是纯内存函数：Linux可执行固定Docker policy查询CLI，并写平台自己的持久guard/record；TypeScript返回binding不证明它没有外部IO。
允许的preclaim副作用仅为受审平台绑定查询/CLI控制记录；不打开原包、不创建解码container、不产生candidate/归档文件、不写uploads。若将来readBinding越过此范围，必须重新审顺序，不能沿本例外直接执行。
平台在首CLI前必须已持有自身guard/record，所有命令及控制scope正常settled后才返回可用binding；unknown保持持久阻断。若A-R的实际接口未能作出该保证，B不能仅凭bound标签继续claim。
此时无业务validation row是有意设计：没有archive/候选IO便无业务reservation可释放，平台控制文件属于独立runtime namespace，不计uploads512MiB。身份查询unknown返回有限MEDIA_UNAVAILABLE/维护提示，不创建假的validation失败报告。
storage锁在身份准备之前取得，固定storage→platform顺序，不持有auth锁等待CLI。使用同一MediaOperationContext/绝对业务期限/共用5秒收尾；平台unknown时不得为凑identity另起干净context或再读一次。
validate claim在同一提交内持久化attempt.mediaStop=unconfirmed，随后只有确认COMMIT且当前operation仍有效才可进入原包读取/candidate；不再额外提交media-intent。它保护业务任务崩溃窗口，不能由先前readBinding的CLI关闭证明替代。candidate返回identity与claim身份不同则本次不写accepted证据。
claim提交未知不进入candidate；preclaim平台查询本身已知正常settled不因claim未知倒推成媒体任务已经启动。反之平台查询未知虽无validation行，也必须由平台维护流程处理，普通validation recover不能删其guard。
本批不采用无CLI的sealed候选暂定key方案；sealed文件不能单独代表当前运行事实。

| 阶段      | 事务/IO决定                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份准备  | 有界核A identity（不读archive，但允许上述固定平台CLI/control IO）；不可用/平台停止未知不创建validation，平台guard保留维护权威。服务端身份若中途变更，本次失败关闭。                                                                                              |
| claim     | 当前operator+import:create/CSRF、Product active、received事实、20未完成/全局1024、key重放检查、quota/name headroom；首次/validate retry原子追加unconfirmed+held+完整预留，archive retry原子追加not-started+held+完整预留。确认COMMIT之前零archive/media/归档IO。 |
| 验证IO    | 私有原包一次快照hash/bytes对received；A在同budget执行。同步候选内存不交浏览器。失去storage或业务期限即停止新增工作。                                                                                                                                             |
| evidence  | 当前鉴权/lease/fence及received绑定；append有界证据；accepted冻结全部候选+asset-set、取得canonical或alias；技术/包身份拒绝写rejected。未知提交停止后续归档。                                                                                                      |
| archiving | 短事务validated→archiving，不延长同fence lease；事务外按冻结计划逐资源临时写/sync/close/no-clobber冻结。已有blob重读核真实字节及声明事实。                                                                                                                       |
| ACK       | 候选receipt自身全部IO已settled且永久封门，原ctx仍active；独立短事务持久化当前attempt.fileStopProof及审计，不release。提交未知停止原请求。                                                                                                                        |
| complete  | ACK提交成功已确认、所有文件IO/close证明齐全且物理事实已核；同事务插入blob和全部新product_asset、更新ready、release reservations、审计。deferred constraints在COMMIT验证全量集合；INSERT conflict必须读并精确比较，不能DO NOTHING后默认为成功。                   |

complete不做文件IO；SQL无法证明磁盘字节，只证明表关系，服务事务外核文件才是物理权威。失效请求DB不得重新连接；所有read/write await套同一操作deadline和driver失效语义。
60秒业务+共用5秒收尾、120秒lease沿冻结合同；收尾不新开业务事务，只等待关闭/合格receipt。已确认COMMIT保留成功，未知COMMIT保留文件及预留。
正常每次状态/控制UPDATE都revision+1；一次操作可有多次revision增长，客户端不预测+1。ready/rejected重复POST只读重放，无新audit成功事件。
业务内容边界为claim/evidence/complete，另有明确的独立ACK控制提交，负责将先已成立的文件/媒体停止事实持久化；不能把它隐藏进complete或收尾。取消收尾、恢复和archiving写不取得新的候选或资源权威。本文取消独立media-intent写；validated→archiving为单独短状态事务；先确认evidence，再确认archiving状态事务，才开始文件提升。任一未知提交都停止后继IO，不延长lease或操作预算。

### 4.2 原子claim后的停止与UNKNOWN语义

claim将完整预留与潜在媒体义务原子写入，确认COMMIT之前零原包/candidate IO。claim明确未提交不产生本次attempt；提交未知永不进candidate，保留原key/文件/预留，不按空GET推定回滚。

validate claim后的崩溃即使未见spawn、owner ESRCH、lease过期或平台control为空，也不能解除unconfirmed/held。已确认claim后的早拒消耗本attempt，不删除或回退ordinal。原进程只能在同步永久关闭所有启动门、实际相关任务settled后发布候选receipt；它自身不是停止权威，之后还必须在原业务期限/有效DB内确认ACK。

candidate已经进入时，只接收A严格completion；任何media/relatedIo UNKNOWN或未追踪迟到任务均拒绝ACK资格。evidence提交未知停止归档，不补猜测报告。取消、超时或DB失效以后，仅可在原5秒cleanup内尝试写非权威候选文件，不新开ACK/失败事务；没有已提交ACK便继续held，fresh recover不能从文件、PID或空记录补造证明。

原claim/ACK/complete提交未知时，fresh查询核精确权威行；空结果不证明旧事务已结束。原请求DB永久失效，不换连接重试。收到匹配已提交ACK只证明文件/媒体阶段，不能推断DB请求已settled。

### 4.3 候选receipt、独立ACK与一次完成（修订冻结）

永久非DB封门 → 候选receipt自身全部settled → 一次独立ACK → ACK确认后一次finalization。文件存在本身没有release权威；普通DB write不能绕过门，任何最终提交后零非DB IO。

1. 同步关闭archive reader、candidate/decoder、binding/平台CLI、blob写入、提升、清理等全部非DB入口，等待所有实际任务settled及严格A completion。不得存在能迟到报告媒体UNKNOWN或继续文件IO的未追踪任务；关门不stop、不续deadline。
2. 唯一文件例外为本attempt的一次候选receipt发布。调用资格、单次消费和排队实际work前均重核，只排除该receipt自己的pending。全部write/sync/link/unlink/close结束，receipt门永久关闭；仍active、锁有效且无UNKNOWN才生成不可序列化、仅原请求/原attempt有效的ACK资格。SHA来自已完成发布的精确canonical文本，不为ACK重读文件。
3. ACK仅原请求原DB原绝对业务deadline，单次消费并在实际DB work前重核资格，排除仅自身DB pending。fresh auth→Product→import→validation锁序，复核received、revision、当前attempt/owner/fence、live lease及固定v2policy。只可fileStopProof null→对象、匹配mediaStop必要单向变化、revision+1/更新时间和同事务validation_file_stop_acknowledged审计；status/fence/lease/候选/报告/占用/accounted/disposition均不变。完全相同的已提交ACK只读匹配，无重复写或审计。不得在cleanup发ACK。
4. 仅ACK提交成功已确认后，在实际启动边界消费一次finalization门，使用ACK返回的新revision，允许恰一个completeValidation或interruptValidation：前者完成accepted归档，后者收束已知拒绝/中断且原ctx仍active的结果。两者互斥且都须fresh auth/fence/lease；不能把ACK与release放在同次UPDATE/同一服务事务。ACK失败、超时、取消或提交未知后均不调用finalization，不换连接、不另开失败记录事务。任何finalization结果之后零非DB IO，不能补证或删除文件。interrupt只使用封门前冻结的计量与已知receipt开销，不在事务回调补扫描/清理；accounting不明不得伪造clean。A当前interrupted返回通常已stop，不能复活ctx以取得ACK；只有实际仍active且合格的路径可终结。

ACK只持久化其发出前已成立的files-and-media停止事实。ACK/query/COMMIT/sql.end仍属于原请求pending；DB取消/未知不会使文件重新运行，但禁止原请求继续complete。ArchiveOperation.completion()不能因ACK存在改成整个请求settled。fixture销毁还须观察原请求/DB实际结束，预核全部成功后才删自身合成文件。

### 4.4 候选文件与权威proof

候选receipt固定schemaVersion=quizpack-validation-stop-candidate.v2，其余严格字段为validationId/attemptId/fence/ownerPid/ownerNonce/scope=files-and-media/mediaStopped=confirmed|not-started/relatedIo=settled，canonical UTF8≤2048。路径沿固定stopped-<attemptId>.json及单个受控临时名，但旧quizpack-validation-stopped.v1文件不获得新权威。

fileStopProof将候选精确文本SHA及原attempt身份持久化在attempts_text；其协议和字节界见第3.2节。发布期间文件可提前可读，reader必须把它当candidate，不能仅据nlink或文件内容返回“已停止”。无ACK、旧协议、文件缺失/损坏/不匹配均保持held/维护。

## 5. recover 与 retry 精确分工

- POST create命中既有key只返回权威状态，不隐式retry。仅新插入返回201；ready/rejected重复POST只读重放。
- recover持storage锁，先读精确行/不可变attempt，同时核已提交fileStopProof与候选文件canonical SHA、协议、validation/attempt/fence/owner/mediaStop；所有自身read/close结束后fresh auth事务重核revision/fence/proof。不能为旧attempt补发ACK。
- 已ready只读返回，无重复complete/audit。ACK和文件均匹配才可按实际文件对账、row fence+1且不追加attempt；对账提交确认后release相应预留，不补资源集合。无ACK、空查询、文件/身份不符继续held，不能以owner ESRCH替代任一种attempt的ACK。
- 原ACK/complete与recover都锁同一validation并核fence：complete先提交则recover见ready；recover先接管则迟到ACK/complete失败。对账未知仍保留占用，空GET不当回滚。
- 未ready且只存在部分blob，经合格对账后回validated（有候选）或retryable-failed（无候选）；继续归档必须显式retry并消耗attempt。第三次耗尽只允许合格对账，不发起第四次。
- retry需fresh auth+CAS，所有旧attempt released、无媒体未知且storage clean。已冻结候选则kind=archive/mediaStop=not-started，否则validate/unconfirmed；新proof=null，原子claim确认后才IO。ready/rejected不retry，旧v1不retry。
- archive retry必须在claim前完成本次实际prepare/platform CLI且all settled、同ctx active、身份与冻结一致；失败零claim。claim后restore仅消费同请求私有prepared，零binding/CLI/decoder/新报告；浏览器DTO不是私有句柄。
- 合格ACK只能来自原发布请求，取消/超时cleanup候选不保证普通recover可解除占用。这是明确的可用性限制；本批不加force cleanup或HTTP PID/证明参数。正式原包/final blob仍不删除。

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

## 7. browser-safe DTO / HTTP 合同

统一所有UUID小写canonical；ID/版本/sha沿P1。日期ISO；revision int1..2147483647；strict object拒未知字段，JSON≤4KiB/5秒，整个写操作deadline仍从Handler入口开始。

```ts
type PrepareValidation = { expectedImportStateRevision: number };
type PreparedValidationDto = {
  productId: string;
  importId: string;
  expectedImportStateRevision: number;
  archiveSha256: string;
  archiveBytes: number;
  identitySha256: string;
  validationKey: string;
};
type StartValidation = {
  expectedImportStateRevision: number;
  expectedValidationKey: string;
};
type PreclaimStartCode =
  | "VALIDATION_IDENTITY_CHANGED"
  | "IMPORT_STATE_CONFLICT"
  | "PRODUCT_ARCHIVED"
  | "IMPORTS_DISABLED"
  | "VALIDATION_PENDING_LIMIT"
  | "VALIDATION_QUOTA_EXCEEDED"
  | "VALIDATION_SCAN_LIMIT"
  | "VALIDATION_BUSY"
  | "VALIDATION_STORAGE_CONFLICT"
  | "MEDIA_UNAVAILABLE";
type StartValidationResult =
  | { outcome: "record"; created: boolean; validation: ValidationDto }
  | {
      outcome: "not-started";
      execution: "not-started";
      productId: string;
      importId: string;
      expectedValidationKey: string;
      expectedImportStateRevision: number;
      code: PreclaimStartCode;
    };
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

| 路径（均以/api/studio/products/[productId]/imports/[importId]开头） | 方法/结果                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| /validations/prepare                                                | POST PrepareValidation；200严格PreparedValidationDto，无业务行/attempt/预留/原包IO |
| /validations                                                        | POST StartValidation；201真实创建，200同key重放；受管enabled和当前import:create    |
| /validations                                                        | GET分页/精确key，按created_at DESC,id DESC；studio:read                            |
| /validations/[validationId]                                         | GET当前权威详情；studio:read，跨Product一律not found                               |
| /validations/[validationId]/recover                                 | POST CAS；纯核实/对账，无业务隐式重试                                              |
| /validations/[validationId]/retry                                   | POST CAS；明确执行attempt，不接受phase/policy/PID/path                             |

服务签名沿B1 `(db, credentials/token, productId, importId, ...input, context)`；prepare/start/recover/retry的db为请求独占，context沿媒体operation和DatabaseBudget桥接，不能每段重建60秒。
列表/详情no-store；Host/Origin/CSRF沿现有HTTP层。UI读enabled是快照，所有write在storage锁内重读config和两guard。
prepare/start是两个独立HTTP请求，各自从Handler入口获得60秒绝对预算、独占DB和context；不跨请求持有lease/预留/平台句柄。因此start的新预算不是重置已执行attempt。prepare在storage→platform顺序下核received与当前身份，只返回上方安全tuple；不建立validation行、业务预留、attempt或原包IO，不把opaque handle序列化。
start不得接受浏览器声明的identity/policy作为权威。已有key按第4节优先重放；未命中时fresh prepare，重算key必须等于expectedValidationKey，revision也匹配才claim。prepare取得K而start实际为K2、又没有既有K时，返回确定VALIDATION_IDENTITY_CHANGED，零claim，不能静默换key。
整个start响应丢失、无效JSON、截断或无法确认的网络异常均保留原tuple，页面只GET validationKey=原K。GET空不能证明原事务回滚；不自动重发start、不自动prepare K2。现有K响应可权威展示任何状态；需恢复与需重试分别显式按钮。GET列表/详情/exact均严格只读，不查平台、不修复、不执行candidate。未知提交不标retryable:true。

新增或沿用的错误码精确映射如下，不把表内last_error_code与HTTP缩写混用：

| HTTP    | 精确code                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400     | INVALID_REQUEST                                                                                                                                                                                                           |
| 401/403 | 既有UNAUTHENTICATED / CSRF_REJECTED / ORIGIN_REJECTED / CAPABILITY_DENIED                                                                                                                                                 |
| 404     | IMPORT_NOT_FOUND / VALIDATION_NOT_FOUND                                                                                                                                                                                   |
| 408     | VALIDATION_CANCELLED                                                                                                                                                                                                      |
| 409     | VALIDATION_STATE_CONFLICT / VALIDATION_BUSY / VALIDATION_IDENTITY_CHANGED / VALIDATION_REVALIDATION_REQUIRED / VALIDATION_ATTEMPT_LIMIT / VALIDATION_PENDING_LIMIT / PRODUCT_ARCHIVED / IMPORTS_DISABLED / REVISION_LIMIT |
| 503     | VALIDATION_STORAGE_CONFLICT / VALIDATION_SCAN_LIMIT / VALIDATION_QUOTA_EXCEEDED / VALIDATION_RECOVERY_REQUIRED / VALIDATION_LOCK_LOST / MEDIA_UNAVAILABLE / EVIDENCE_INVALID / WRITE_OUTCOME_UNKNOWN / STUDIO_UNAVAILABLE |
| 504     | VALIDATION_TIMEOUT                                                                                                                                                                                                        |

VALIDATION_REJECTED / PACK_IDENTITY_CONFLICT / RESOURCE_DECLARATION_CONFLICT是已记录rejected DTO的lastErrorCode，不作为内容检查正常结果的HTTP失败。VALIDATION_STATE_CONFLICT允许有界currentRevision字段；写重放不使用客户端预期revision覆盖权威row。
确定P1/policy/包身份/资源声明拒绝是成功返回的rejected DTO（200/201），不是把内容异常伪装HTTP500；未知提交503不可标retryable:true。
数据库last_error_code冻结为上述领域固定码及A有限interruption映射；A全部issue详情留证据，不逐条扩成SQL错误码。

### 7.1 开始结果与刷新恢复

StartValidationResult为strict闭集：record且created=true对应201，record且false对应200；not-started对应200领域结果。not-started只能由服务在**从未进入可能提交validation claim的业务分支、已永久关闭启动门、相关任务全部settled**时返回；进入claim边界后任何catch不得构造此结果。它仅证明对应这次请求未开始，不证明其他请求或原key无记录。不能用HTTP 4xx、普通错误code或Promise rejection推导它；所有通用非2xx、坏JSON、字段不符和未知响应均保留pending。preclaim code闭集只表达以上已知业务拒绝，其余错误沿既有HTTP错误合同。

页面不增加强制技术确认：一次显式“验证并归档”操作可以串行prepare→保存tuple→start；页面挂载/StrictMode/轮询不得发出任何写请求。准备后将完整tuple存为false，真正发送前在单文档同步临界段中关闭pair发送门，重读bucket/核tuple，写true并完整readback，最后才第一次fetch；中间无await。保存失败则不发送。

采用单个per-tab sessionStorage严格versioned bucket，最多16项、每项实际UTF8≤4KiB、整个bucket含外壳≤64KiB，同Product/import唯一，无TTL/自动淘汰。损坏、超限、未知版本或存储异常保留原内容并阻断新发送，不reset为空。跨刷新恢复true只GET原key；false可显式继续原准备或取消，不能自动开始。完整存储形状、同步竞争和最小浏览器验收见 [B2B_PENDING_UI.md](B2B_PENDING_UI.md)，为本合同组成部分。

权威exact row必须匹配原tuple的Product/import/key/archive hash+bytes/identity hash；import预期revision只用于首次claim CAS，不与validation stateRevision混比。匹配任意状态均可compare-and-remove该tuple并转由durable row核实；这不表示执行成功/停止或释放。GET空不解锁。严格not-started结果只在当前tuple没有更早未知发送且精确匹配本次请求时，允许显式放弃/移除；不能重发后用新拒绝抹掉旧未知。

本地保证限于同标签刷新；关闭标签、清除浏览器存储或实例变更不保证恢复原锚点。bucket空不证明服务器无记录，始终先展示服务器历史，不自动执行。仅保存ID/整数/hash，无凭据/Key/原包/报告/路径等内容；服务器每次独立授权，bucket不授予任何访问权。

## 8. 迁移、权限、审计和并行所有权

已应用0009_validation_audit_actions与0010_validation_assets保持原字节。新增0011_validation_ack_audit_action仅独立提交新enum值，0012_validation_file_stop_ack实施ACK函数/保护trigger/约束与审计target条件、明确schema协议marker；不增加表或扩大app/PUBLIC权限。应用schema guard必须识别0012协议能力及准确函数/约束/启用trigger/权限，只有旧名同签名不算通过；管理启用guard最低迁移同步0012。

迁移前停旧writer，0012替换函数后显式验证适用既有数据，不把CREATE OR REPLACE等同CHECK重验。policy升quizpack-private-archive.v2，descriptor固定candidate-receipt-db-ack.v1及56KiB metadata准入；新version/hash生成新key，A身份/候选六字段hash不变。旧v1只读查询/精确重放，禁止新ACK/complete/retry，不改旧key/policy或生成proof；旧held继续计量维护，历史ready保留原义，不能冒称通过新ACK。迁移策略与兼容回归一起验收。
扩展audit_action：validation_started、validation_evidenced、validation_rejected、validation_interrupted、validation_completed、validation_recovered、validation_retried；target_kind='validation'、target_id UUID、target_revision当前revision。一次真实状态变化一次事件，幂等读重放不增事件。
不增加权限role/ACL。app SELECT/INSERT三表；validation仅授可变控制列、证据append列和首次候选列的UPDATE，触发器限制write-once；immutable输入/身份列无UPDATE。
blob/product_asset无UPDATE/DELETE/TRUNCATE/DDL；全部无PUBLIC grants。app仅EXECUTE所需CHECK helpers，trigger functions不可直接调用；默认invoker，避免自建绕过auth的SECURITY DEFINER写入口。
迁移runner集中重述column grants；Drizzle schema、client权限审计、管理CLI期望迁移、真实DBfixture清理和旧v1/v2受管实例升级一并更新。不能通过旧schema检查后再迟到缺表异常。
schema验证保证SQL关联和不可变，不能证明P1执行或文件真实性；信任边界仍是受测服务+固定app权限+当前会话写事务。

| 流              | 独占范围与交接                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sol-V 可信适配  | `server/validation/**`及必要的P1纯函数抽取/定向测试；prepare、restore、SQL evidence serializer。不得改DB、HTTP、存储或根配置。先交三个类型/函数的可编译里程碑，再完成失败边界。                                                          |
| Sol-D 数据/事务 | `quizpack/validation/{contracts,limits,service-contract,repository,transactions}*`、0009/0010历史与0011/0012新增迁移patch和相关DB/权限适配patch、真实PG约束测试；先交DTO/service签名/内部持久化接口。迁移由总控审阅集成，测试端口55421。 |
| Sol-S 存储/服务 | `quizpack/validation`其余server模块、统一scanner/quota、旧receive接线、文件提升/receipt/recover及PG/FS故障测试；按总控指定D/V提交接入，不复制其算法。测试端口55422。                                                                     |
| Sol-U HTTP/UI   | V完成公共接口后分配空闲实现槽；Studio路由/页面/reader adapter、严格响应与pending交互、HTTP/浏览器测试。不写SQL或调用media internal。                                                                                                     |
| 总控            | 共享错误、package/lock、CI/playwright、阶段文档及集成；审核合并迁移/DB补丁，最终实际target build/seal，3100和55423串行验收。Astra独立审查。                                                                                              |

所有实现均Sol/high，架构与审查Astra/high；每流独立受管worktree，不并写同文件。公共合同/类型的变更先报总控，不能各自猜接口。实现流先检查当前root/origin/分支和状态；不修改已交付A、旧D1或主检出。最终部署身份改变，必须重新封存B真实Next，不能继承A fixture能力。

## 9. 具体验收矩阵

| 类别                 | 必须实际证明                                                                                                                                                                                                                                     | 所有者                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| pure strict/bytes    | Unicode拒绝、raw/canonical分限额、64KiB声明、三报告payload/metadata/envelope各+1、report冗余投影不一致、稳定key/asset-set排序、有限DTO                                                                                                           | A领域；A-V接口配合         |
| 真实PG关系           | 跨Product import/source/alias失败；alias链/环、同身份异hash；同资源声明改license也冲突；缺一项/重复集合/额外source资源/伪blob尺寸不能ready；完整集合与审计同提交                                                                                 | Sol-D/S                    |
| 真实PG权限/状态      | INSERT ready被拒；validate claim媒体未知/预留/attempt同提交，archive claim固定not-started；immutable事实修改、旧attempt改写/released复活/同fence续租被拒；recover不增attempt；第4attempt失败；row fence可高于old attempt                         | Sol-D/S                    |
| 提交未知             | claim明确回滚零IO零本次预留；实际提交但断响应零candidate且预留仍held；空查询不当回滚证明；evidence未知不提升；ACK未知不complete、不补ACK，匹配已提交proof才能对账；complete已提交断响应返回原ready，未提交保留文件且需显式retry；无重复资源/审计 | Sol-D/S故障钩子+真实PG连接 |
| claim到candidate窗口 | claim后立即杀原合成owner，ESRCH/control空仍保留媒体未知；已知pre-candidate拒绝但reader.close迟到时不得写receipt；迟到continuation不能在stopping后启动candidate；只有候选+已提交ACK经fresh recover才release且总配额只扣一次                       | Sol-D/S真实进程/FS/PG故障  |
| 身份竞争             | preflight后降权/退出、Product归档在evidence/complete前均阻止业务写；不因旧actor通过；auth锁不跨延迟文件IO                                                                                                                                        | Sol-D/S真实PG并发          |
| 实际文件             | no-clobber/已有同异字节/symlink/非普通对象；write/sync/link/unlink/close失败；原包不删；partial serial16文件上限；late IO/目录close迟到/共享UNKNOWN不产生ACK；单个candidate文件不release                                                         | Sol-D/S独立私有fixture     |
| 配额/名称            | 原包+blob+孤儿+旧held跨receive/validation共同512MiB；相同UUID跨namespace不抵扣；1024/4096/8192及最后扫描IO超5s；未落地held64blob槽；超额recover仍能安全对账                                                                                      | Sol-D/S                    |
| 实际媒体停止         | 普通三格式/坏图拒绝；runtime异常不永久rejected；取消/超时共用5秒；media未知+主进程ESRCH不释放；archive retry确认不调用decoder                                                                                                                    | A平台实证+Sol-D/S集成      |
| HTTP/浏览器          | start真201/replay200、详情列表真实分页；read-only/开关关闭/归档/陈旧CAS；响应未知先读；recover与retry按钮分离、无假发布/草稿；移动截图                                                                                                           | Sol-U，生产3100总控串行    |
| 部署                 | B真实业务路由实际Next构建artifact/runtime identity匹配、重新record/sealed、私有trace0违规；不能继承A隔离fixture能力                                                                                                                              | 总控                       |

技术退出条件：本节矩阵、六项工程检查、真实PG/驱动/媒体证明、浏览器实际移动截图和独立审查通过后，提交推送并保留Draft PR。它只说明本阶段技术通过，不是内容、视觉、素材商用或正式发布批准。随后依路线进入B2-3草稿和后续内测，不在阶段中间重复请求已有工程范围的许可。
