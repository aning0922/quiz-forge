# P2-B：测评工作区、资源与导入预案

2026-10-12，Astra high 只读预研、总控收敛。状态：下一里程碑预案，尚未建表或实施；P2-A 技术门槛通过后逐批冻结 DTO、迁移和服务接口。普通工程已获 P1–P5 托管授权，无需重复启动确认。

## 后台组织与交付顺序

一个 Product 就是一个独立测评工作区，稳定 ID 使用 P1 已有受限字符串合同；内部 draft/import 等使用 UUID。工作区内展示题目、规则、结果、版本和私有资源。运营分类不决定视觉 Theme 或评分规则。包内 product 标题、slug、categoryId、最多 12 个 tags 是版本声明；后台 Product 元数据、主类目和最多 8 个运营标签独立维护，导入不创建类目、不覆盖目录。

| 子里程碑              | 交付                                                                              | 退出证据                                                               |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| B1 目录工作区         | Product/category/tag/product_tag，真实创建、编辑、归档、分配和筛选                | 元数据 CAS/no-op、标签限额、归档与分配竞争、只读拒写、真实 UI          |
| B2 隔离导入与首个草稿 | 原包接收与冻结、服务端 P1 复验、私有资源、包身份、首个不可变 revision、导入状态页 | 同键异输入、同版本异 hash、跨 Product、实际限额、重复应用及文件/DB故障 |
| B3 编辑与恢复收口     | 有限文案编辑、持久化 CAS、冲突处理、显式恢复/reconcile                            | 编辑与导入竞争、旧证据失效、未知提交、失效 worker、清理不删成功引用    |

P2-B 继续精确 loopback 和单运营空间。上传由私有配置显式开启，默认关闭；只接收 synthetic 包验证工具链，不将作者选定的四卡内容自动改成合成夹具。authored 首款包在后续内容、引擎和资源门槛通过后接入。

## 表与不变量

新增九表，分 B1 四表、B2 五表。迁移仍单写者，先合同后代码，不一次建立未来发布/消费者实体。

| 表              | 身份和关键约束                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| product         | 稳定字符串 PK，slug 唯一，title、主类目 nullable FK、metadata_revision≥1、archived_at；P2 无发布指针                                                        |
| category / tag  | UUID PK，slug 唯一，name、revision、archived_at；归档后不能新分配，不硬删除已有引用                                                                         |
| product_tag     | product/tag 联合 PK 与 FK；锁 Product 后事务检查最多 8 个                                                                                                   |
| product_draft   | UUID，Product FK，每 Product 唯一当前草稿；当前 revision/contentHash/assetSetHash                                                                           |
| draft_revision  | Product/draft/revision 联合唯一，严格有界版本化 content JSON、canonical hash、asset-set hash、来源及创建人；只插入                                          |
| quizpack_import | Product、幂等身份/指纹、声明与实际原包 hash/bytes、受管 storage key、包身份、状态、不可变报告/文件事实、目标和实际草稿结果、lease/fencing、失败码和恢复进度 |
| asset_blob      | SHA-256 PK，真实 bytes/MIME/尺寸、受管 storage key、pending/ready/failed；ready 只证明字节事实                                                              |
| product_asset   | Product/resourceId/resourceVersion 联合 PK，blob FK、完整资源声明及 hash、用途和来源 import；只插入，平台审核状态固定 unverified                            |

Product/draft/import/source 的引用使用包含 Product 的复合 FK，不能只凭内部 UUID 跨工作区关联。当前草稿指针只指向同一 Product/draft 的 revision，首次草稿和 revision 一次事务建立，不出现假 revision 0 或空内容草稿。JSON 内引用仍由严格服务校验，不声称都具有 SQL FK。

物理 blob 可以按 hash 去重，使用权仍属于 product_asset。相同 Product/resourceId/version 的完整声明 hash 一旦固定不可更换，哪怕字节相同，只改许可或来源声明也要新资源版本。包内 commercialUse/redistribution/approval 都是输入 claim，不构成平台商用批准。

应用角色不获得 draft_revision/product_asset 的 UPDATE/DELETE。import 请求身份、成功包身份/hash、完成报告、staged 结果不可改写；状态和 lease 只按明确状态机变化。审计扩展有限 action/reason 与对象 ID，不写任意 JSON、文件名、内容或秘密。

## 元数据与文案编辑

元数据更新先锁 Product，再比较 expectedMetadataRevision；检查新分类/标签 active，去重并限额，一次事务更新。无实质变化保持 revision。目录归档与分配按统一锁顺序（Product→稳定排序的目录记录）验证，防止查完 active 后并发归档。已有归档引用可显示或移除，不能新增。

内容编辑第一版仅开放题干、选项文案、结果标题与完整基线报告的明确字段；结构、规则和资源更换先通过新包导入。DTO 以稳定 ID 定位字段，不提供任意 JSON Patch path。服务端修改后重跑内容 Schema/引用检查并计算 canonical hash。

保存时锁 draft、比较 expected revision；同内容 no-op 返回原 revision，变更则插入 revision+1 并移动指针。新内容不能继承旧包的“当前验证通过”状态。冲突返回 409 与当前 revision 摘要，不能自动覆盖。完整派生包重建与当前候选再验证在 P2-C 接入。

三种 hash 分名保存：archiveSha256 是原 ZIP 字节；报告 contentSha256 是原 content.json 字节；draft contentHash 是解析内容的 canonical hash。assetSetHash 对实际引用的 Product/resource/version/blobHash/declarationHash 固定排序后计算。内容或资源声明变化均使旧证据不再适用于当前候选。

## 接收、处理与应用

采用建立小 JSON 导入意图→接收原始 application/octet-stream→显式有界处理→显式应用。认证入口保留原 4 KiB/5 秒政策，上传有独立实际字节/期限限制，不使用无界 formData。

意图固定 expectedArchiveSha256、expectedArchiveBytes 与目标 new-draft 或 replace-draft（draftId/expectedRevision）。Product 来自授权路由；Idempotency-Key 单独校验。唯一键 Product/idempotencyKey，指纹包含完整请求身份；同键不同输入 409。同包上传已完成后重试返回现有状态，不覆盖冻结文件。客户端 hash 只固定请求，实际 bytes/hash 必须重算。

状态为 receiving→received→validating→archiving→ready→staged。rejected 保存不可重试的技术拒绝；retryable-failed 保存失败阶段与恢复信息。CAS 冲突保留 ready 候选，操作者读到最新草稿后带新 expected revision 显式应用。staged 是不可逆成功结果，重试返回已记录的 draft/revision。

仅技术验证成功的规范 import 取得 (Product,packId,packVersion) 部分唯一身份。相同身份异 archive hash 拒绝；相同 hash 可关联原 canonical import，但保留本次请求/目标/结果。失败包不能抢占身份，归档暂时失败也不能释放已取得的包 hash 供替换。

内部候选只能由服务端构造：有界冻结字节→完整 validateQuizPack→在同一快照上 readRestrictedZip→核对相同 archive hash→严格解析内容与逐项资源事实。初版允许复用 P1 进行第二次受限读取，但共享外层总 deadline，不能通过重新计时获得无界执行。禁止接受客户端报告或改用通用解压器；P1 的 importable:false/publishable:false 不改变，后台 staging 是独立服务权限。

应用候选的短事务同时完成授权/状态/CAS、资源归属核对、revision 插入、指针移动、staged 结果与审计。解码和文件复制期间不持有该业务事务。

## 存储、并发与恢复

原包、暂存和 blob 均在当前实例私有目录，不在 public；目录0700、文件0600，名称只由服务端 import/attempt/hash 生成。临时文件完整写入关闭后以不可覆盖操作冻结。已存在同名 blob 仍需验证真实字节与 hash。

预案配额为实例受管文件总量512 MiB，单次接收预留128 MiB，并按实际受管文件记账；启动/reconcile 时孤儿文件也计入。它是应用配额，不是 OS 磁盘硬隔离。P1 原单包/解码限额继续生效，不因后台接入上调。最终常量与峰值记账在 B2 合同冻结时以实际实现核验。

本机初版只允许一个接收/处理任务，专用连接 advisory lock 配合持久化 lease/fencing；连接丢失取消处理，最终写入核验当前 fencing，旧 worker 不得提交。cleanup/reconcile 取得同一实例锁，只清理本次临时对象与确认无成功引用的失败对象。全局 blob GC、成功原包自动到期留后续。

| 故障                     | 恢复要求                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| 文件成功，DB未记录       | 依据 import/受管清单恢复或计入 orphan；不能显示草稿成功          |
| 验证报告成功，归档失败   | 原报告不改写，保留原包后恢复归档；新 policy 验证产生新证据       |
| 草稿事务已提交，响应丢失 | 重连查询 import 实际 applied 结果，返回原 revision，禁止重复创建 |
| 无法确认事务结果         | 返回 OUTCOME_UNKNOWN 与 import ID；先查权威 DB，不盲目补偿删除   |

媒体子进程仍未具备 OS 沙箱/RSS 硬限制；远端接收前另有硬隔离验收，P2-B 不扩大到公开上传。

## 最小页面与验收

页面为 /studio/products、单 Product 工作区、有限 draft 编辑、单 import 状态及 /studio/taxonomy。权限复用 P2-A：两角色可读，workspace:write/draft:write/import:create 分别控制操作；每个服务及 Handler 自行验证，不以隐藏按钮或 layout 授权。资源页先展示声明与校验事实，不暴露 storage path、裸 blob 读取或公共原包下载。

实际验证覆盖两连接 CAS、归档/分配、同包身份竞争、跨 Product、真实请求限额、恶意 ZIP、媒体失败、copy/DB故障、未知提交、失效 worker、重复恢复和清理保护。阶段收口执行六项工程检查、真实 test:db、独占3100生产E2E、移动视口截图和独立审查，认证产物限制沿用 P2-A。

P2-C 才接入私有图片读取、结构预览、当前派生包验证和指定 revision 送审/退回；P3 执行评分/见证与受控组件真实预览；P4 固定发布组合、Key、消费者会话与不可变报告；P5 接入选定四卡内容、完整素材和人工内测验收。P2-B 不创建这些阶段的假按钮或通过状态。
