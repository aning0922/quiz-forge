# P3-D 同 Product 追加不可变修订

2026-10-18，基于P3-C交付922937fbfd4672e6b15038a99f8b4316aed9cd2c，主控分支codex/draft-revisions。作者内测内容与视觉确认见FIRST_PRODUCT_BASELINE；商业权利/发布资格不由此授予。本合同经两实现线只读预研及Astra前置独审，现按2026-10-18结论冻结；不是已实现或验收证据。

## 范围与旧协议

同Product接收完整新包、验证归档后，显式追加到现有同一draft，不覆盖旧revision/正文/asset-set/来源/回执/审计。网页编辑、部分合并、回滚/删除、审核事务、ProductVersion、Key、正式报告与发布不在本批；接续批次沿持续托管授权推进。

首次POST、请求target new-draft、quizpack-draft-application.v1指纹字段/规范字节/SQL函数、首稿revision1回执及旧pending v1保持。通用草稿摘要/固定正文读取可支持正int32 revision，首稿回执独立固定revision1。原首稿POST在已有draft时仍拒绝，绝不自动变追加。新操作使用独立服务/HTTP端点/DTO和pending桶。

原包接收的target_kind='new-draft'保留其历史值及原指纹，不扩写或重签旧意图。P3-D只消费经当前准入/归档的完整候选：追加是一笔新的、显式授权和确认的应用操作，目标从本次append tuple取得，不能从旧接收target推导追加授权。运营员先选择该候选与精确当前草稿，再确认追加。旧source读取仍核原接收字段，旧首稿流程不变；不接受其他未知接收target。

## 公共机器合同

新增features/product/draft-revisions/contracts.ts与service-contract.ts，由主控单写。旧features/product/drafts/contracts.ts仅拆通用summary修订与首稿回执revision1。所有请求严格拒绝未知字段。

append scope复用 `{productId,sourceImportId,sourceValidationId}`。POST input为：

```ts
{
  idempotencyKey: UUID,
  expectedValidationStateRevision: PositiveInt32,
  expectedCandidateSha256: SHA256,
  target: {
    kind: "append-revision",
    draftId: UUID,
    expectedRevision: Integer1To100,
    expectedCanonicalContentSha256: SHA256,
    expectedAssetSetSha256: SHA256
  }
}
```

完整binding=scope+input。独立fingerprint schemaVersion为quizpack-draft-revision-application.v1，纳入scope、expectedValidationStateRevision、expectedCandidateSha256和完整target；不纳入idempotencyKey/requestId/time。规范JSON使用既定canonical排序，浏览器显式同序列，Node/浏览器/SQL对中文、边界及完整tuple逐字节相等。旧first-draft fingerprint不重写。

请求expectedRevision允许100以便明确报告容量已满；成功receipt的base仅1..99，不得生成revision101。append receipt包含通用immutable summary、idempotencyKey、expectedValidationStateRevision、expectedCandidateSha256、fingerprint、完整target；result revision=target.expectedRevision+1，draftId与target一致，candidateSha等于expectedCandidateSha，platformApproval仍unverified、publishable=false。POST返回 `{created,application}`；首次201，原key重放200。

同Product key命名空间统一于既有draft_application。新旧操作撞同key是IDEMPOTENCY_CONFLICT，不因查询时过滤target而当作不存在。旧first-key读取接口只返回首稿回执，读到append key明确冲突；新resolve只接受append binding。所有实际成功必须记录本key不可变账本，不把重复source当另一key的成功重放。

新增错误DRAFT_BASE_CONFLICT、DRAFT_SOURCE_ALREADY_APPLIED、DRAFT_REVISION_LIMIT均409。缺draft沿用DRAFT_NOT_FOUND，缺固定revision沿用DRAFT_REVISION_NOT_FOUND；hash/身份等异常沿用有限错误。DRAFT_BASE_CONFLICT不携带含义混淆的currentRevision字段（旧DRAFT_SOURCE_CHANGED的currentRevision只指validation state）；需要新基准时显式读current摘要，不能收到409直接改tuple。

## 事务、来源与容量

每draft最多100个修订（含首稿）。编号由服务器在锁内按原current+1分配，禁止MAX+1。版本是已验证包的版本，不增加SemVer大小或单一packId策略；旧Product同源准入和包身份冲突规则保持。

既有withStudioWrite(draft:write)和真实驱动未知提交语义保持。顺序：当前身份/来源/CSRF与预算 → Product FOR UPDATE → 按Product/key查完整原账本（先校fingerprint/operation，匹配立即固定回执返回）→ 新请求核Product active/同draft/当前revision和两base hash/容量 → readReadyDraftSource核当前资格、完整正文/资源/版本和ACK → 同sourceImport或已应用canonicalManifestSha明确拒绝 → 插入revision N+1完整快照与application → CAS推进current N→N+1且恰一行 → 单条draft_applied审计指向N+1 → 授权复查/COMMIT确认直接返回事务内receipt。

原key匹配先于归档、当前修订、容量和来源策略复查；无写权限者仍只能读。新修订不继承审核或发布资格。仅数据库事务，不新增ZIP/FS操作、资源复制、StorageLock、lease、ACK、GC或守护进程。imports.enabled不控制ready应用。

保留UNIQUE(product_id,source_import_id)，新增draft_revision UNIQUE(product_id,canonical_manifest_sha256)以阻断同包alias二次应用。同manifest对应完整已验证pack身份与文件hash；新packVersion使manifest改变，按原准入处理。仅contentSHA相同不是重复证明。合法未使用alias可应用一次，保留其实际来源与资源最初归属，不把first source改成本次validation。Product的额外历史资源允许存在，只核该revision asset-set。

## 0016迁移与数据库权威

不改已应用0013/0014/0015。新增0016：product_draft新增initial_revision固定1，initial_application FK改绑该列，保持原initial_application_id与创建事实；current FK仍指同draft真实revision。current/revision界限1..100。

draft_application新增nullable expected_draft_revision、expected_base_content_sha256、expected_base_asset_set_sha256。new-draft要求三者NULL且revision1；append要求base1..99、revision=base+1，两hash格式与真实旧base匹配。append parent精确FK关联同Product/draft/base revision及两hash；必要唯一组合加在draft_revision，旧行原文字节/指纹/事实不改。新增append SQL fingerprint函数及分支CHECK，旧函数原字节保留。

root仅新增UPDATE(current_revision)列授权；revision/application仍只有SELECT/INSERT。root INSERT必须1，UPDATE窄guard只准同身份/初始事实不变的严格+1；旧行不得改写、回退或复用。source trigger保留0015当前来源闭合，append匹配当前base。DEFERRABLE提交时constraint trigger检查同draft current=已提交MAX(revision)，同时核初始行、连续父链及exact receipt；禁止插入新revision/application而遗漏current、空推进、多跳或无账本推进。可延迟NO ACTION闭环保留，owner单事务精确清理仍可操作；不授予app删除/重写权限，不用CASCADE。单次审计保持服务同事务写入、原key不新增及故障回滚验收；本批不新增audit反向FK/partial unique/历史审计补齐要求，不追补旧SQL夹具日志。obsolete证明依赖的是不可变应用账本与单调current，不依赖新增audit关系。

迁移前先实际停止自有HTTP/worker/媒体/预览IO与存储写者并取得退出事实；只在新purpose=test库及明确旧测试库升级。SQL采取NOWAIT表锁/维护锁和无其他app backend、无held/unknown/reserved/lease/未确认操作的静止检查；SQL锁不代替进程/FD退出。失败或UNKNOWN旧现场不补造ACK/收据/状态，不为升级杀未知会话。新app对0015库拒绝，旧app对新schema应拒绝。Drizzle、迁移授予、schema facts及逐项验证同时更新（列ACL、constraint/FK内部触发器、新函数体hash/属性和普通/约束触发器）。

## 未知请求的只读核实

新增resolve请求体直接是完整原append binding，URL Product必须与body相同，在一次studio:read RR READ ONLY事务中：按Product/key查ledger；存在时完整重算fingerprint并核tuple，匹配返回applied固定回执，异tuple返回冲突。不得按输入source/base/fingerprint过滤key查询后冒称不存在。

确无ledger才核同Product/同draft root和不可变旧base，验证两hash与target完全一致。仅root.currentRevision>expectedRevision时返回not-applied-obsolete，说明在此不可回退draft谱系中原请求此前未提交、此后CAS也不可能成功。current==expected返回unresolved。base/身份缺失、hash不符、current<expected、断连、权限/解析错误均不能给终态。归档或新source不再ready不影响历史核实；不重新要求可变新应用资格。证明不覆盖数据库回滚恢复/重建/owner维护清空后的另一谱系。

resolve response为applied/unresolved/not-applied-obsolete/not-applied-source-used严格union，全部回显binding与fingerprint；applied含append receipt；unresolved含精确base摘要与同draft currentRevision=expected；not-applied-obsolete含相同base摘要及observedCurrentRevision>expected。观察当前必须1..100，不能仅拼code授权清锚点。read不得触碰session/audit；成功响应前另一次当前身份复核可拒绝输出，但不把两个业务快照拼成证明。

客户端保持prepared→may-have-been-sent，完整持久化+同步回读后才fetch；超时/COMMIT未知/空GET/普通409不清。新pending桶quizforge.studio.draft-revisions.v1，分别采用16条/单条4KiB/整桶64KiB预算，原首次v1桶不改写或升级；同Product跨两桶保留发送门和完整回读，任何相关整桶损坏/旧未知均阻止新准备；不阻止服务器current/历史读取或原请求核实。精确清除只写对应桶，共享现有Product gate，不能复制第二套门闩或声称跨tab锁权威。确认面板在进入确认时冻结tuple，发送前发现source/base改变则撤销未发送确认，已发送tuple永不改写；当前/来源/核实响应均另核绑定和代次。旧first pending仍按既有成功核实，不套用新append obsolete证明。

resolve只是展示终态证据；只有用户显式选择“移除已失效原请求并重新准备”才在Product gate内compare-and-remove完全相同锚点。迟到/错Product/错key/错base或generation不一致都不能删除新条目。之后重新读current、重新确认、新UUID；不自动换base/key重发。

### 重复来源的只读终态

仅obsolete不能解决误选已用来源、而current仍等于原base的正常纠错。增加not-applied-source-used：同一RR快照仍先原key/完整binding冲突检查，精确旧base匹配后，若原sourceImport已由另一不可变application消费，可据UNIQUE(product,sourceImport)证明原tuple不能提交；若是另一import的alias，则须先从完整scope及expectedValidationStateRevision/candidateSha严格核该source，得到实际canonicalManifestSha，再发现既有不可变revision同manifest，才可据唯一约束给终态。不能只用客户端自报hash或包名证明。源资格不可核实不影响既有applied/obsolete分支，也不产生该新增终态；读取错误保持错误。

响应回显binding/fingerprint/精确base和消费来源的固定summary；proof严格区分reason=source-import/canonical-manifest，包含consumed固定summary与consumingIdempotencyKey；必须同Product/draft、消费修订≤observedCurrentRevision、消费key不同于原key。source-import必须消费相同sourceImport；canonical-manifest另带canonicalManifestSha256，与已严格核过原scope/预期state/candidate的来源和消费summary一致。所有成功重复仍拒绝，终态不是应用成功。客户端用户显式exact compare移除后重新选来源/基准，不自动发送。此终态已通过Astra前审；仅在current==base后检查，优先级永远是原key applied/冲突→base正确→obsolete→source-used→unresolved。别import alias分支必须新建只读来源查询复用纯事实校验，不能调用当前带FOR UPDATE的readReadyDraftSource或改用写事务。

## HTTP、历史与UI

旧路由不变。新增POST `/api/studio/products/{p}/imports/{i}/validations/{v}/draft-revisions` 执行append；新增POST `/api/studio/products/{p}/draft/revision-applications/resolve`只读核实；两者均4KiB JSON、来源/CSRF，后者只要求studio:read且不借import:create。append/resolve完整成功封套均≤64KiB、完整错误封套≤4KiB，history完整封套≤128KiB；序列化后实际测UTF-8（含转义）并严格验证，不只查字段长度。新端点有独立有限error whitelist，不能套旧first-client的409名单；错误仍不是unknown清除证据。新只读HTTP不沿写UNKNOWN标记，响应发布前当前身份复核；操作方预算仍15s、锁2s/语句5s/事务10s，不加隐式重试。

新增GET `/api/studio/products/{p}/drafts/{d}/revisions`，仅元数据，查询仅pageSize/anchorRevision/beforeRevision三个参数，各出现一次，完整query≤4KiB，未知/重复/空值/非规范整数拒绝；pageSize默认20/最大50，anchorRevision可选，beforeRevision可选。首次anchor=当前revision，省略before时取anchor+1；后续before必须与anchor一起给出且2<=before<=anchor+1。anchor必须实际存在且<=当前。按revision DESC取小于before且<=anchor的页，last revision>1时nextBeforeRevision为该最后项，否则null；中间空页/非连续降序/缺行视为事实异常，不发伪末页；新追加不插进旧anchor分页，刷新列表才取新anchor。完整响应≤128KiB，严格校同Product/draft、降序、范围、页大小；不带正文/evidence/真实用户数据。固定正文与预览仍按原URL读取指定revision，不改成latest。

验证详情显示当前基准摘要和独立追加操作；没有draft时仍首次流程。成功回执与当前摘要分开展示，原回执可指向已不是current的修订。只读可看历史/原请求核实，无可执行写入口。原稿旧v1可读，不支持真实预览时沿有限错误；pending归档/撤权不隐去未知。

## 所有权、验证与退出

主控：本合同、授权与进度、共享contracts/service-contract/错误/纯指纹、迁移决策与最终集成管理、根配置/runner、整合验收和独占3100。本批明确委派A独占0016与lib/db（含Drizzle/权限/schema facts）的实现准备，根主树不并行改这些文件；A同时负责新product/draft-revisions服务/仓储及必要旧drafts服务显式跨操作冲突检查，真实PG并发/重放/resolve/升级历史及P3D独立fixture。迁移仅在合同批准的隔离test实例执行，最终迁移与guard必须Astra独审及主控真实升级验收。B：studio/draft-revisions与旧页面组合、pending/client/HTTP、新薄路由、历史与追加面板、生产E2E/截图。两线不双写共享文件；原三表/应用事务和DB约束形成同一A实施流，迁移由主控管理并独立验收。A/B固定独立Sol/high，Astra独立high审查。

必须覆盖真实旧0015首稿数据升级、旧key/正文/hash/资源/预览不变；同key重放、异payload冲突、两个key同base仅一胜、source/alias重复拒绝、capacity99→100竞争、任意SQL多跳/回退/遗漏root/缺ledger/触发器关闭/越权更新拒绝；确认rollback与COMMIT响应丢失；source或归档改变后原key仍固定；RR建立后并发提交不能拼新旧事实，旧请求等锁且他请求推进后obsolete与随后CAS失败、成功后再推进仍原applied；v1 pending及错/迟到resolve不删锚点。

最终主控六项检查、真实PG/driver、当前运行构建绑定/媒体封存、fresh生产E2E、四宽截图和独立审查/准确CI。新增生产路径的两次追加、两旧revision预览/实际评分/资源、锚点核实与有限历史必须真实执行；合成测试像素不替代历史首款P5或内容商用批准。代码/doc及时独立提交推送，Draft PR堆叠#17，未授权main合并或部署。

## 冻结服务签名与前审结论

ProductDraftRevisionService独立于旧ProductDraftService：appendReadyValidation(db,credentials,scope,input)→AppendDraftResult；resolveApplication(db,sessionToken,binding)→DraftRevisionResolution；readHistory(db,sessionToken,productId,draftId,query)→DraftRevisionHistory。查询参数规范解析和4KiB/128KiB等HTTP预算在B层，严格领域对象及success最终身份复核在A层。两base hash都是实际写入字段并进入指纹与parent精确FK，不是resolve临时辅助数据。

Astra确认新增重复来源终态在统一RR、完整key先查、不可变已消费唯一键及严格source/manifest校验下成立；不引入取消账本或新写状态机。简化历史audit约束避免追补旧SQL夹具。预算、稳定分页及A独占迁移/DB实现、主控合同/集成管理分工均可执行。实施必须分别提供真实PG反例与前端迟到/错绑定/explicit清除测试，不能把合同通过当程序通过。
