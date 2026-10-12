# B2-2B 可信验证适配器合同

本文件是 [B2-2B 合同](STUDIO_P2B2B.md) 的组成部分，状态随主合同。以 A 最终844054c为实现基线；本批新增三个接口，不放宽原trusted candidate/media边界。现有engine/contracts/private-candidate/report/受限ZIP是算法唯一来源。

## 1. 可复用位置与最小抽取

- `server/validation/engine.ts`：`runtimeIdentity(binding)` 已含完整身份公式，唯一来源；不可由 B 重写。
- 同文件 `readBinding`：完整有限 bound/unavailable parse，先保留 STOP_UNCONFIRMED 再 checkpoint。
- 同文件 `trackIo/awaitOperationTask/settleIo/checkpoint/requestStop`：现成绝对期限、10ms cleanup 收紧观察、迟到 settled 不撤销未知。
- 只将以上执行控制抽到内部 `operation-scope.ts`，身份组装及固定绑定读取抽到内部 `identity.ts`；engine、prepare、restore 共用。
- 内部 scope 对 media 不确定事实与本层 pending IO 分开记账；未知必须 sticky，不能因集合归零或外层 Promise resolve 清除。
- `private-candidate.ts` 的同源 raw→canonical/resources/asset-set/candidate 推导是唯一算法；拆内部 prepare-state 与最终私有发行两个步骤。
- `v1/zip.ts:readRestrictedZipCore` 原样复用，注入同 context checkpoint/trackIo；不调用会另建预算的离线包装。
- `contracts.ts:enforceBudgets` 的 value:null 投影及计量需抽为一个内部公共路径，seal 与 SQL serializer 共用。
- 保留普通 validate 的首/末实际 binding、固定 decoder、P1 报告及全部既有结果；不改变离线 API/F1。

## 2. prepareValidationIdentity(ctx)

采用 server-only 导出：`prepareValidationIdentity(ctx): Promise<PreparedIdentityResult>`。
调用仅读取固定 sealed runtime 的实际身份；不接受 roots/policy/identity/执行选项，不读 archive、创建 decoder/container 或写 uploads。
平台 policy 查询可能发受控 CLI：其 guard/record/owned-close 权威仍由现有 media core 提供，prepare 不能绕过。

严格结果合同：

- prepared：`{outcome:'prepared', identity:ValidationIdentity, prepared:PreparedValidationIdentity, completion:{mediaStopped:'not-started',relatedIo:'settled',maintenanceRequired:false}, runtimeFailure:null}`。
- interrupted：`{outcome:'interrupted', code, completion, runtimeFailure:LaunchFailureCode|null}`；无可消费 identity/handle，不形成 P1 report/envelope。
- code 闭集复用 A：INVALID_CONTEXT / RUNTIME_IDENTITY_UNAVAILABLE / OPERATION_CANCELLED / OPERATION_TIMEOUT / MEDIA_RUNTIME_FAILED / MEDIA_STOP_UNCONFIRMED / RELATED_IO_UNCONFIRMED / BRIDGE_INTERNAL_FAILED。
- 对结果使用 strict object + refinement；identity 复用 `validationIdentitySchema`，不能只相信 TS 类型或 structural 标签。
- prepared 成功必须所有本次身份操作及平台 control/stdio 已知 settled，原 context 仍 active；成功不 dispose/stop caller context。
- finite unavailable/ISOLATION_UNAVAILABLE 可为 not-started+settled+无需维护；不能把所有 unavailable 一概标 unknown。
- unexpected rejection、malformed bound/unavailable、STOP_UNCONFIRMED 缺肯定平台证明：unknown+unconfirmed+maintenance=true，停止整次 prepare。
- binding 先触发 STORAGE_LOCK_LOST/CANCELLED 再返回 STOP_UNCONFIRMED 时，先存有限 unknown，才允许 checkpoint 抛出；unknown 优先。
- cleanup 超时胜出时立即冻结相关 IO unconfirmed；晚到结果/同回调 pending 归零不能撤销。
- inherited STOP_UNCONFIRMED 一样保守；不为重取 identity 新建 context/deadline，停止后不再发 binding/CLI。
- completion 是该适配器及其平台 IO 的完成事实；不能单独代替 B 整个请求的 DB/reader/writer/close 完成证明或跨重启 stopped receipt。

私有 prepared 句柄：

- WeakMap 绑定 exact ctx 对象、冻结 identity、原 deadline、单次 restore 消费状态；仅本函数在所有 IO settled+最后 checkpoint 后发行。
- handle 不进入 JSON Schema；constructor/伪造对象/JSON parse 不授予权威，toJSON 抛有限错误，资源/路径/进程句柄均不外露。
- restore 读取要求 WeakMap membership、same ctx、ctx active、未消费；同步消耗后不再复用。不得使用 browser 传回的 identity 替代。
- identity canonical text 如 B 需要由 A 同算法序列化，≤16KiB；identitySha256 是现有 payload hash，不是含自身 hash 的整对象 hash。

prepare→start 可直接使用：

- POST prepare 只取得 public identity 给 B 计算 validationKey；不 claim、不读原包，HTTP 仅投影 B 冻结的安全字段，不序列化 handle。
- 此请求结束后 handle 失效；start 在自己的同 operation fresh prepare，再由 B 重算并核 expectedKey/revision。
- identity 不匹配返回已知 identity-changed，无新 key 偷换；unknown start 只 GET 原 key。
- key 算法、授权/CAS、事务、HTTP DTO 和 UI 均由 B domain/HTTP 所有，不增加第四表。

## 3. restoreValidatedCandidate：archive claim 后绝不再碰平台

签名：`restoreValidatedCandidate(rawArchive, {prepared, frozenEvidence, expectedFacts}, ctx): Promise<RestoreResult>`。
`prepared` 是上节同 operation 句柄；frozenEvidence/expectedFacts 只能来自 B 权威 repository 的同一 validation 快照，不能接受 HTTP JSON 作为来源。
archive retry 顺序必须是 fresh prepare 完全 settled → 检查旧 frozen identity → archive claim 已确认 COMMIT → 读取原包 → restore。
prepare unknown 或旧 bundle 不匹配时零 archive claim；claim 后 restore 禁止 readBinding/readSealCandidate/media runtime/decoder/平台 CLI。
不能用旧 sealed 文件或 DB identity 冒充当前 actual runtime；当前事实由 claim 前的 prepared 句柄携带。
普通 validate 路径仍由 claim 的 mediaStop=unconfirmed 覆盖 A 再次实际 binding/decoder，不改成 archive 模式。

冻结输入的最小字段（实现先交精确类型，不改变以下绑定）：

- frozenEvidence：原 canonical envelope text + sha256、report_texts、metadata text；选择其中唯一 accepted 项，不制造新 attempt/报告。
- expectedFacts：archiveSha256/bytes、Product/packId/version、manifest/content schema/kind、raw manifest/content sha256。
- 加原 canonicalManifestText/Sha256、canonicalContentText/Sha256、assetSetText/Sha256、candidateSha256、resourceCount。
- 按字段分别检查原 UTF8/字节限额；不能将 2MiB content text+manifest text 强塞进单个 2MiB canonical 包装产生错误新上限。
- B 必须先核证据投影/hash/行归属、当前阶段与候选整组不可变；A strict parse 只证明形状与绑定，不能证明这些 JSON 曾经实际执行过。

restore 执行顺序：

1. 检查/同步消费 prepared 句柄及 same ctx；冻结 expectedFacts 和已存在 accepted evidence，核全部 strict/Unicode/预算/原 text hash。
2. 核 prepared identity 与 frozen accepted identity 完全一致（包括 runtimeBundleHash/deploymentId/component/limits）；不匹配直接 REVALIDATION_REQUIRED，不能降级为原包内容拒绝。
3. 同步校验 Uint8Array 非 Proxy/SharedArrayBuffer、≤32MiB；第一次 await 前只从原字节快照一次，核 exact archive bytes/SHA，必须等于 row 与 accepted input/report。
4. 调用同 `readRestrictedZipCore`，PACK_LIMITS 固定；同 ctx signal/checkpoint/trackIo 聚合原 inflate actual close。重解 ZIP 不等于重解码图片。
5. 用同 bounded parsePackJson、v1 manifest/content Schema、Unicode gate 推导事实；同 raw manifest/content hashes 对原 sealed report。版本必须仍 synthetic/v1。
6. 复用私有候选推导：逐资源 bytes/hash、原 content.resources 索引与 accepted decoded facts 完整一一对应、尺寸/MIME/frames；不调用 inspector 或伪造 decode 结果。
7. 同算法重建 canonical manifest/content、全部 canonical declarations、稳定排序 asset-set、candidate hash；与所有 expectedFacts 的原 text/hash/数量逐项精确相等。
8. 原 archive hash 已绑定完整原包；仍保留受限 ZIP 文件全集/manifest完整性检查。若抽 integrity 纯函数，从 validate-core 原实现抽取，不复制另一套。
9. 等待所有本次 ZIP/任务/close settled，最终 checkpoint；完成 bounded facts 比较后才发行新的 WeakMap 私有候选，副本取资源行为保持不变。

严格输出合同：

- restored：`{outcome:'restored',candidate:PrivateArchiveCandidate,completion:{mediaStopped:'not-started',relatedIo:'settled',maintenanceRequired:false}}`。
- unavailable：`{outcome:'unavailable',code:'REVALIDATION_REQUIRED'|'FROZEN_EVIDENCE_INVALID'|'FROZEN_FACTS_MISMATCH'|'ARCHIVE_BINDING_MISMATCH',completion}`；无 candidate。
- interrupted：复用 INVALID_CONTEXT / OPERATION_CANCELLED / OPERATION_TIMEOUT / RELATED_IO_UNCONFIRMED / BRIDGE_INTERNAL_FAILED；缺停止证据仍需维护。
- restore 没有新媒体调用；历史 decoded/stopped facts 仅用于候选原内容绑定，不算本次 mediaStopped=confirmed，也不解除旧 attempt unknown。
- 失败后封住后继候选发行/业务 IO；迟到 inflate/continuation 不能返回 handle。shared cleanup 不重置预算；任何 relatedIo 未确认禁止 B release/新 IO。
- 不调用 validateQuizPackCore/validateArchiveCandidate/sealP1Report，不写新 evidence；`serializeSealedReport` 校验原值不算生成新 P1 报告。
- A unavailable codes 由 B 映射固定 VALIDATION_REVALIDATION_REQUIRED/EVIDENCE_INVALID/VALIDATION_STORAGE_CONFLICT；不变成 P1 rejected 或偷偷 retry。

## 4. serializeEvidenceSqlProjection(envelope, attemptsControlText)

采用 server-only 纯函数；envelope 为 unknown|null，controls 为 B strict Schema 已生成的 exact canonical text（≤8KiB）。
A 只校验 controls 普通 JSON/canonical/Unicode/真实 UTF8 bytes，业务 owner/fence/kind/transition 仍由 B schema/SQL 负责，不复制 B 控制状态机。
不得接受调用方声明的 controlBytes 或任意 exclude 字段；直接测传入 text。null envelope 支持 claim/崩溃无证据形态，不造空 envelope/报告。

严格成功投影字段：

- evidenceText:string|null，evidenceSha256:string|null；完整 A canonical envelope 的实际 UTF8 hash。
- reportTexts:readonly string[]：按 envelope attempt 升序，仅 sealed report；每项来自 `serializeSealedReport` 原 frozen value。
- metadataText:string|null：与完整 envelope 同形，只将每个 sealed report.value 换为 null，保留原 status/hash/canonicalBytes。
- attemptsControlText:string：原 canonical B 控制文本（原字节保持）；输出用于 SQL 的同一文本，而不是重新无序 stringify。
- measuredBytes:{envelope,reportPayload,metadata,attemptControls}；均为实际 UTF8 bytes，作为可检查结果，不取代文本权威。
- 可用 `{ok:true,value:...}|{ok:false,code:EvidenceFailureCode}`；坏 accessor/proxy/Unicode/Schema/重复key/+1 不抛原始异常或正文。

唯一计量实现：

1. 从 contracts.ts 抽内部 projection+budget 函数返回 frozen envelope/text、reportTexts、metadataText 和实测 bytes；sealEvidenceEnvelope/新 serializer 都走它。
2. `sealEvidenceEnvelope` 继续使用 controlBytes=0 保持 A API；新 serializer 的 controls 参数只能从实际 validated text 算 bytes。
3. 单报告≤256KiB、净 report payload≤768KiB、envelope≤1MiB；metadataBytes + attemptsControlBytes≤64KiB，controls 自身≤8KiB。B archive policy v2额外要求metadata≤57344，为最终含3份fileStopProof的controls预留8192；此B准入在D事务及SQL中核实，A serializer原计量与报告算法不改。
4. metadata 不包含 report canonicalText；完整 envelope 中报告 payload 只出现一次，报告 hash/bytes 计外围。
5. null envelope 时 evidence/metadata/hash=NULL、reportTexts=[]，只有 controls 字节参加预算；不给未取得结果的 attempt 补猜测报告。
6. SQL 按原 report_texts UTF8字节及 hash、semantic value、value:null 投影、controls总和核冗余一致；不用 jsonb::text 重算 canonical 原字节。
7. SQL物理列冗余/WAL可大于1MiB；此处1MiB约束单 envelope，不将整 DB 行混入 A envelope，也不放宽外围64KiB。
8. serializer 不执行 IO、不产生候选、不 confer DB/历史执行权威；对 stored 原 texts 恢复时要求文本正好等于重新投影的 canonical texts。

## 5. 必需的边界验收

- prepare：finite unavailable vs malformed/reject；STORAGE_LOCK_LOST与STOP同时；deadline/cleanup同回调迟到；首次cleanup收紧；成功ctx保持active。
- prepared：同ctx可用、跨请求ctx/JSON/伪造/二次使用/stopping均拒；发行前最后IO跨deadline拒。
- restore：原raw变1byte、raw JSON语义同而字节异、canonical/asset-set/candidate任一hash或text异、索引/资源缺重复/owner异均拒。
- restore：旧bundle/部署不同需新验证；claim后所有 media/binding mocks 设为一旦调用即失败；不得生成新report或追加旧媒体facts。
- restore：late inflater close与cleanup timeout，已错失期限后pending归零仍unconfirmed，无handle；原bytes副本所有权不变。
- serializer：真实三report+192facts与B完整3attempt controls计量、各预算+1、not-run/无report、ordinal间隔、原texts/投影冗余不符、Unicode。
- 实施会改变完整 runtimeBundleHash；总控需重构建实际 B Next/seal，不能继承 A fixture或旧部署能力。
