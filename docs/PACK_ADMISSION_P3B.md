# P3-B authored/content.v2 包准入合同

2026-10-16。P3-A ce190cd已完成最终媒体/浏览器验收及Astra技术退出，交付文档0059175。本合同经Astra修订复审通过，现冻结。共享机器合同及DDL/guard先交，依赖实现随后分派。本批接续P3-A，保持两条可见Sol/high开发聊天和Astra/high独审；主控负责共享身份、迁移、guard和集成。仅常规工程授权；不要求作者重选四位人物，不产生内容/素材/发布批准。

## 范围和出口

让已支持的内容经真实ZIP验证、隔离图片解码、可信候选、资源归档与DB事务进入首个不可变revision 1。新受控准入矩阵为 quizpack.v1 × {quizpack-content.v1, quizpack-content.v2} × {synthetic, authored}，完整四组合。v1六组件1.0.0/props1.0.0，v2六组件2.0.0/props1.0.0；混代、未知schema/kind、manifest/content不一致拒绝。authored-pending逻辑审阅封套不进入此矩阵。

本批不实现追加revision、编辑、预览renderer、审批、ProductVersion、Key、答案或报告。schema/kind为authored仅保留作者内容事实，platformApproval仍unverified、publishable=false。实际评分/见证/渲染/版权均仍未在包级执行或批准，旧未验证清单不能因P3-A纯模块存在而删项。四卡正式包所缺图片/许可不得伪造；本批技术验证用明确的合成夹具，即使测试authored枚举也不冒充正式作者批准。

## 显式包入口与兼容

新增 features/quizpack/package 模块，静态受控版本选择，提供parseSupportedManifest、validateSupportedPackReferences、validateSupportedQuizPack和buildSupportedQuizPack。旧v1 parser/manifest/validate/build/API默认及CLI无参数路径语义、issues顺序、默认Schema stdout和两基准ZIP字节保持；旧入口继续拒绝v2。不得让旧API返回伪称v1的新报告。

可以提取旧validate-core执行骨架，旧入口固定原配置，新入口固定新配置；不把parser、回调或policy来自包/HTTP。新入口期望内容版本只取v1或v2，未匹配即拒绝，不自动猜测修复；后台固定supported矩阵可明确分派两版本。新builder保留输入快照、no-clobber、固定排序/ZIP字节确定性、真实输出归档再验证。

CLI build/check新增显式 --content-version v1|v2：零参数版本选项仍旧v1路径；有该选项走新入口并要求实际版本相符。显式v1的ZIP字节应与旧builder相同，但验证报告使用新身份。现有quizpack:schema --content-version v2继续只输出content Schema；如需包manifest Schema使用明确新 --manifest-content-version v1|v2，不允许与--content-version同时指定。精确参数及输出合同主控脚本实现前审查。

完整包检查复用基础引用图并组合v2表现图；基础检查只执行一次。用共享manifest结构类型，不将v2 cast成旧v1。真实ZIP路径/类型/CRC/重复项/压缩边界、精确文件集合、每文件hash/bytes、资源路径/MIME/声明/用途、真实解码及停止证明全部保留。未声明文件拒绝；alt不能为未使用资源授予使用资格。

预算沿既有值：ZIP32MiB、原content1MiB、manifest256KiB、总解压64MiB、64资源/66entry、单图8MiB，时间/像素/帧数/证据上限不放宽。canonical2MiB不放宽原content上限。

## 冻结身份

保留完整旧严格reader：identity quizpack-validation-identity.v1 / validator1.0.0 / policy quizpack-local-p1.v1 / report quizpack-validation.v1，原Schema hash和语义不变。

新受控包报告：quizpack-validation.v2 / validatorVersion2.0.0 / policyId quizpack-local-supported.v1。字段形状沿旧报告，严格schemaVersion及validator/policy关联，新有限issues注册表只增加实际v2错误码/固定message；保留完整未验证项及issuesTruncated。公共报告类型以版本联合表达，不放宽旧P1严格Schema。

新后端identity：quizpack-validation-identity.v2，validator2.0.0 / quizpack-local-supported.v1，reportSchemaVersion quizpack-validation.v2，reportSchemaHash为新严格报告Schema canonical hash；旧REPORT_SCHEMA_HASH仍表示旧Schema。compatibilityPolicyHash绑定明确内容版本→组件版本矩阵及两个1.0.0引擎，不只是无关联12组件列表。effectiveLimitsHash沿不变PACK_LIMITS。persistencePolicyVersion/hash及runtime绑定格式不变。新identitySha256仍为去自身字段后canonical payload的SHA256；validatorBundle仍精确等runtimeBundleHash。

新archive策略为quizpack-private-archive.v3，descriptor accepted包含container与两schema×两kind及组件对应矩阵；除下文明确批准的pending统计范围调整外，commit/state/storage/ACK/finalization/immutable/recovery/retry协议含义与limits数值保持。descriptor canonical hash由主控实际计算并固定至SQL新写保护/测试，不手填假hash。

candidate-receipt-db-ack.v1、quizpack-validation-stop-candidate.v2及candidate hash算法均不变。candidate hash包含A identity，不直接包含B policy；validation key包含A identity+B policy。不得把内容v2与停止协议v2混淆。新report/identity/candidatefacts共享机器Schema及错误注册先由主控交付，A/B随后接实现。

## 准入链与历史

engine从同一有界原ZIP快照用新矩阵验证；candidate只从已封存的新报告与同一原始manifest/content字节签发，资源复制/hash不省略。ExpectedCandidateFacts明确四组合，restore仍核原始与canonical hashes/asset-set/原identity精确相等；新部署不能以任意旧identity替代当前prepared匹配，失败仍REVALIDATION_REQUIRED。

旧archive.v1/v2终态事实和历史revision仍可读；不得原地升级旧行或补造ACK。旧v2 ready不能用于新的application，须按新策略在同received import准备新validation key并创建新行，经完整验证/媒体/本行ACK→ready后申请。已有draft仍DRAFT_ALREADY_EXISTS，不删除重建或换Product绕过。

canonical包唯一(Product,packId,packVersion)跨策略保持。同archive SHA/bytes的新行可为alias，但有自己的identity/policy/report/attempt/ACK且先实际全量验证；不能借canonical证据。同版本异字节冲突，要求新packVersion。blob实际读回bytes/hash；resource精确Product/id/version/blob/声明原文/hash相同才复用，不改首来源source_validation_id；新revision固定自己的asset-set。

application顺序保持当前授权→Product锁→原key账本→精确fingerprint重放→仅新申请核active/来源资格。同成功key返回原immutable receipt，不追加当前policy/修订；改validation则IDEMPOTENCY_CONFLICT。历史revision按原身份/正文/hash读，不调用当前ready资格/media，不重序列化成v2。

## 追加迁移和退出条件

主控追加0015_supported_pack_admission.sql，不改旧迁移、不增表，不动revision1/new-draft约束、三表FK/唯一/ACL/审计/账本。

- draft_revision schema/kind CHECK扩明确四组合；protect_draft_revision_source只对新INSERT要求新archive.v3精确hash+ready+ACK+原正文/hash/版本/资源，不能追溯使旧revision失效。
- validation_shape_valid分开历史策略结构与新v3矩阵，旧v1/v2保留原synthetic/v1约束；新写只允许当前v3精确hash。validation_file_stop_controls_valid保留旧v1九字段、v2/v3十字段ACK形状，新写保护不接受旧策略。
- guard固定新函数体hash、约束facts/Drizzle/迁移收据，并把validation_shape_valid函数体纳入防弱化；半迁移、新二进制旧库和旧二进制新库均失败关闭。
- 升级先用旧协议recover/interrupt/原key核对收口，再停止旧HTTP/worker/媒体/存储写者并确认受管IO退出。0015事务先对import/validation取得SHARE ROW EXCLUSIVE NOWAIT锁，拒绝残留同库应用角色连接/事务，再在同一事务内检查下述精确静止条件并切换保护。迁移advisory lock不代替停旧写者；正常业务写者在升级全过程保持停止，不自动终止未知会话。SQL不能证明孤儿进程或文件IO停止，受管运维检查另行记录。旧连接已开库不保证重跑guard，所以不能只凭新旧guard差异允许在线升级。
- 精确拒绝：import status=receiving，或storage_condition非clean、reserved_bytes非0、lease_until非NULL、旧import_attempts_valid不为true、任何attempt.disposition非released。validation status在validating/archiving，或相同storage/reservation/lease异常、旧validation_attempts_valid或validation_file_stop_controls_valid不为true、任一attempt.disposition非released或mediaStop不在confirmed/not-started。在替换旧helper前执行，先核受影响旧helper真实body/属性，JSON损坏同样失败关闭。租约过期不能替代lease清空；历史v1九字段按原停止语义，v2 released按原ACK核验，不为v1补造ACK。
- 不因accounted_bytes>0、保留的current_attempt_id/fence/attempts或历史last_error_code单独阻断。静止awaiting-upload/retryable-failed import可保留原接收协议；静止validated/retryable-failed旧validation保留原tuple为只读，禁止恢复/重试/直接apply，按新policy在同received import另建key重验。终态也必须满足静止条件。客户端UNKNOWN保留，空GET不证明回滚；迁移不改任何历史状态或伪造ACK/释放。
- perProduct20 pending改为当前archive_policy_version与sha256均精确匹配且原pending谓词成立；当前clean validated/retryable-failed仍占位。旧policy只读静止行退出active pending，运行时如发现旧行有未决IO仍拒绝，不用policy过滤掩盖。全库1024 validation行、磁盘文件目录和held reservations继续跨policy全计，不提限额、不清历史；exact key回读仍在容量检查之前。升级就绪报告总行数余量，不能容纳新key时明确容量不足。canonical唯一键始终跨policy，旧validated canonical也允许同字节新alias，不按ready/current筛选。
- 测试使用独立purpose=test新库和专门历史迁移夹具，不运行生产迁移。失败旧库保留停止，不自动等待、补ACK、强制终结、清现场或调整配额。

旧UNKNOWN客户端tuple不可自动改绑新validation，空GET不证明回滚；历史读取允许，但新binary不能把当前identity用于恢复旧现场。必须按旧协议收口后升级的限制明确展示在运维说明。

## 文件所有权

主控：本合同/共享阶段文档，server/validation/contracts.ts、report.ts、identity.ts、adapter-types.ts，新package报告/compatibility纯共享合同；validation/policy.ts与limits策略常量；所有迁移/src/lib/db；package.json/锁文件/全局配置/scripts CLI/media source inventory与fixture groups/CI；最终六项/DB/driver/main媒体/3100。

A（既有纯评分聊天改任准入数据）：features/quizpack/validation除root policy/limits外，draft-source、features/product/drafts，以及tests/db准入/历史/alias/源保护业务测试；只触及必要UI事实标签和旧策略新apply错误表达，如跨B/root边界先回报。自有55421实例，DDL等主控先交。

B（既有内容适配聊天改任包工具与可信桥接）：features/quizpack/package除root共享合同、v1构建/validate骨架必要提取、content引用图组合；server/validation除root四共享文件外的执行/candidate/restore/sql-projection及测试。不动纯scoring。对CLI给精确调用接口由主控落地。自有55422实例仅需要时启，不占3100。

Astra：合同及非实施审查，不写实现。实施流先各自干净树从最终P3-A基线建codex/分支，旧分支保留；独立提交由主控cherry-pick，不能重复依赖提交。源闭包新增package/content依赖必须同时绑定main和fixture；不把所有app源码无界纳入。

## 验收

旧默认Schema/两包字节/完整issues差分；四组合及unknown/mixed/错manifest/content/文件闭合失败；封存候选不可伪造；source及compiled闭包重建绑定、两平台真实解码/停止与最终main66×3封存；真实PG四组合首稿、旧ready重新验证alias、自有ACK/资源复用/同版本异字节、原成功key和旧正文、oldnew/半迁移/guard弱化/升级未决拒绝；格式/lint/type/unit/build/productionE2E与需要的视觉截图；独立问题关闭、准确远端CI、Draft PR。有限技术准入通过不等于四卡内容/素材批准或首款P5完成。

## 整组证据与公共接口补充（首轮审查修订）

机器合同校验整组允许组合：旧archive.v1/v2只承认旧identity/report tuple与synthetic/content.v1；当前archive.v3只承认新identity/report tuple及四组合。sealed report中的schema/validator/policy/compatibility与identity一致，identity.reportSchemaHash等于所选严格报告Schema的canonical hash（报告正文不增此字段，sealed report的sha256仍是实际内容hash），存在候选时manifest/content/component矩阵一致。不能分别union后让旧identity配新report、新identity配旧report或v3配旧identity通过。历史reader不要求历史runtime等于当前部署；当前prepared/candidate/restore仍精确相等。外层evidence/stop/ACK协议不因内容版本改变而无理由升级；保留明确旧严格分支并新增当前完整分支，旧输出不变，不能靠独立字段union放宽历史语义。

root先提供package/api.ts、package/compatibility.ts公共类型/常量与新有限报告机器合同。SupportedManifest=原QuizPackManifest | SupportedManifestV2；后者仅contentSchemaVersion变为v2，容器仍v1。SupportedParsedPack为以contentSchemaVersion判别的manifest+content相关联合，不能两个互相独立的union。旧P1CoreExecution/QuizPackValidationReport精确类型不改，新SupportedCoreExecution回调parsed(pack,files)，旧适配保留beforeStructure/parsed/propagate时点及media与references检查顺序。

SupportedValidationContext只含targetProductId、signal和只可降低的limits，不提供任意compatibilityPolicy。外部validateSupportedQuizPack(source,context,expectedContentVersion)和buildSupportedQuizPack(input,context,expectedContentVersion)要求完整v1/v2字符串参数，返回固定新报告；CLI负责短字符串映射。内部validateSupportedQuizPackCore(source,context,execution,selection)，selection严格为{kind:expected-version,expectedContentVersion}或{kind:backend-matrix}，后者仅后端可信构造。validateSupportedPackReferences(pack,target)返回IssueBatch={issues,issuesTruncated}，不是丢失上游截断的数组。

新compatibility descriptor固定schemaVersion=quizpack-supported-compatibility.v1、containerSchemaVersion=quizpack.v1、两个引擎@1.0.0和两个profiles。每profile包含contentSchemaVersion、contentKinds=[synthetic,authored]、componentVersion=1.0.0或2.0.0、propsSchemaVersion=1.0.0、states={cover:folio-cover,question:folio-question,resume:folio-resume,result:cabinet-result,report:folio-report,poster:folio-poster}。匹配先选content profile再核完整组件，不引入renderer资格。

新报告有限code差集为CONTENT_INPUT_LIMIT_EXCEEDED、CONTENT_INPUT_REJECTED、DUPLICATE_PRESENTATION_REFERENCE、DUPLICATE_SECTION_ID、NONCONTIGUOUS_SECTION_ORDER、PRESENTATION_REFERENCE_COVERAGE、PRESENTATION_REFERENCE_MISMATCH、QUESTION_FRAME_COVERAGE、QUESTION_FRAME_ORDER_OR_REFERENCE、UNKNOWN_SECTION_REFERENCE、UNUSED_SECTION。新增固定message：Content must be bounded ordinary JSON. / Only explicitly supported content versions are accepted. / Value does not satisfy its declared content contract. / Content must use the exact declared presentation reference graph.；显式版本错配复用CONTENT_DECLARATION_MISMATCH和Manifest and content must match the expected content schema version.，path固定contentSchemaVersion。

旧content超过32项的ISSUES_TRUNCATED控制标记不作为业务issue；新collector消费标记并保留上游truncated，与包级/最终collector截断取OR。新严格报告允许不足100项而truncated=true以表达上游截断，不沿旧P1的“必须恰好100”断言；此变化仅新报告，candidateValid依旧要求零issue且未截断，旧Schema与hash保持。

追加guard最低固定集合为原六ACK/状态函数体+validation_shape_valid+既有draft来源与fingerprint；新helper若拆分也全部固定。属性/ACL/search_path/trigger enabled/约束精确事实及FK enforcement不减。升级验收补残留旧连接、receiving import、三次耗尽但静止旧validation可留、新policy20pending/历史1024总量/全部磁盘预算、旧canonical alias、真正UNKNOWN拒绝，以及三种错配identity/report/policy。
