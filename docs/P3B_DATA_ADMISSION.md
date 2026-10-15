# P3-B 数据准入实施记录

2026-10-16。独立数据工作区 `codex/p3b-data-admission`；共享依赖截至 root 493598f、package M1 3f3ddaa/227d5bb。只使用自有 55421 新建 purpose=test 实例，不升级旧实例，不占 3100。以下是分步工程证据，不是阶段技术退出或内容/素材批准。

## 第一步：当前准入和历史只读边界

来源读取解析明确的 content.v1/v2 × synthetic/authored，核原始冻结正文/hash、组件矩阵、独立 asset-set 和资源声明；当前申请必须精确匹配 archive policy version/hash 和 supported identity 整组。历史 revision reader 继续返回原存储正文，不依赖当前 ready 资格或媒体。

validation mutation 和服务恢复/重试在文件恢复前拒绝旧策略；DTO 标记 readOnly，页面只展示旧策略事实，不提供恢复、重试或新申请入口。原 application key 重放与 UNKNOWN tuple 协议保持；authored 标签不授予批准，platformApproval=unverified、publishable=false。

per-Product pending 仅统计当前 policy version/hash 精确匹配的原 pending 谓词；当前 clean validated/retryable-failed 仍占位。新 claim 对旧行静止事实执行有界检查，不让 policy 过滤掩盖未决 IO。1024 全历史行与跨策略磁盘/held 账本不变。canonical 查询与资源精确复用路径不变。

现有 domain/B3 无文件合成 DB 夹具使用真实 supported identity/report Schema hash；显式 legacy 参数仅供历史夹具。它们验证真实 PG 约束和事务，不能证明媒体解码、文件归档或生产停止。

验证：相关单测 203 项；现有 domain/ACK/boundaries/B3 service/SQL 五套 PG 51 项；新增数据边界 PG 3 项；lint/typecheck 与 diff 空白检查通过。

待完成：0010→0015 历史升级约束、静止旧行/旧 canonical/旧成功 application 的历史证据、全局容量及跨策略预算回归；B 的真实 supported candidate/restore 接入后验证四组合服务写入。当前 restore DTO 仍受旧桥接 v1 类型约束，未强制 cast 或制造 v2 opaque 候选。完整阶段六项/媒体/E2E/独审由主控集成后执行。

## 第二步：历史与服务链闭合

历史夹具在隔离 purpose=test 数据库中恢复真实旧函数，只在事务内按旧约束建立显式无文件 SQL 事实，执行所有延迟约束后运行原始 0015 静止检查并恢复当前保护；不关闭 trigger/CHECK，不改历史迁移收据。覆盖旧 ready 新申请拒绝、旧成功 key 先重放及归档后回执不变、原正文/hash 只读、旧 ready/validated canonical 同字节新 alias、自行 identity/report/evidence/ACK 与资源首来源精确复用、20 条历史 clean failures 不占当前 pending、1023 历史行允许一个新行而 1024 阻断新 key、同版本异 archive SHA 冲突且不转移 canonical/资源。

0010→0014 升级回归明确从 legacyArchivePolicyDescriptor 重建 v1；仍验证原九字段 held 控制、缺 ACK 和禁止新 mutation。0015 对未决 IO 实际失败，原 tuple 完整保留；测试只在断言后删除自有已核无文件合成 fixture 以恢复空测试库，不将此清理冒充升级收口，不操作真实 UNKNOWN 现场。

当前 restore 输入支持明确四组合。fresh-service 四案例运行真实 builder/ZIP、接收、prepared/opaque candidate、文件复制/hash/归档、PG、ACK 提交后 UNKNOWN、恢复、从冻结证据 restore、归档 retry 和不可变首稿 revision 1；只 stub 两个媒体运行时边界。归档重试不重复图片执行。标签 authored 只作为枚举事实，所有案例仍明确合成、unverified/不可发布。

历史 DTO 保留原合法 semver 元数据读取语义；新来源的固定组件矩阵在 source admission 强制检查，不追溯收紧已有回执。

本地验证证据：

- 普通全 PG：37 文件、354 项通过；最后追加冲突边界后，历史/升级两文件 8 项通过（含完整 1023→1024 边界）。此处不把定向数累加冒称另一轮全量。
- fresh-service：14 项通过；独立 fresh media-UNKNOWN：3 项通过。
- 全单测 1351 项通过后，新增组件矩阵失败边界；最终数见后续记录。
- format/lint/typecheck、生产 build 及 BUILD_TRACE_OK 通过。未占 3100，未运行生产 E2E/浏览器或真实隔离媒体；最终集成由主控执行。

自有实例：普通 DB `0bfdf884e5deb6d047beddd0e2a88d94`；fresh-service `fc493e834e2f7e11bf09da7c1509ee2f`；fresh media-UNKNOWN `243164629d3372074f3a88905f240e6a`。服务失败现场保留原 tuple、文件及 held reservation，不 reset、不补 ACK。

供主控集成的既有 A 提交：1594120（数据/只读）、3ed11f3（历史/alias）、424d820（两行相关联合夹具收窄，主控已取）。3eb0cdb 是 B 3fe6e33 的本地副本，不重复 cherry-pick。root 独占 tests/db/p2b2b-e2e-fixture.ts 的新 authored/v2 媒体夹具及三处事实文案；A 未改该夹具或两处 import 页面。1594120 已有 validations/panel.tsx 的 readOnly 操作门控和四组合文案，集成时保留门控，文案由 root 统一。

最终本地收尾：107 文件 / 1352 单测、format:check、lint、typecheck、build 全部通过；build trace 为 65 traces / 12960 paths / 0 violations。上述三个自有实例均已停止，两个 fresh-service 失败现场完整保留。未运行生产 E2E、浏览器视觉、真实隔离媒体或最终 driver，均由主控串行集成验收。root 后续将 B2 媒体 fixture 从四资源 v1 改为五资源 authored/v2 时，需同步该 fixture 对应的 service/E2E 固定资源数断言；本记录的 14 项服务通过对应 A 当前分支的原 B2 fixture 加独立四组合产品。

## 独审两项 P2 整改（76537be 之后）

确认 76537be 仍存在两处问题并修正：recover/retry 先拿 StorageLock/读配置，旧策略判断发生过晚；历史静止扫描使用 SELECT *，会拉取历史正文及证据。

现在 recover/retry 首次 preflight 的当前授权事务，在 Product/import 范围核验后，仅按三元范围读 policy version/hash 与有界 identity text/hash 并判定当前完整身份；旧策略直接 REVALIDATION_REQUIRED，不获取存储锁、不读配置、不执行文件或媒体 IO。原锁后的当前授权、行状态/CAS及身份复核保留。

历史静止查询只选 status、storage_condition、reserved_bytes、lease_until、attempts_text、archive_policy_version，仍跨所有旧策略、有界 1025 行；停止/held/未知/ACK 检查与 20 当前 pending、1024 历史总量规则不变。不投影 canonical 正文、report 或 evidence。

新增有限 mock 证据：两种 mutation 在 disabled config 下先拒绝真实 legacy tuple，锁/config/full-row/scan/held/media/恢复/重试均不调用；授权失败先于元数据读取；元数据查询精确 scope、空结果失败关闭；历史查询仅元数据并保留全旧策略与 1025 上界。相关两文件 27 项通过，五个改动 TS 文件定向 ESLint 与 diff 空白检查通过。

本次遵守主控 native 矩阵窗口限制：未启动 PG、构建、媒体或 3100；本整改后的类型/全量/真实 PG 复验待主控窗口结束安排，前文完整运行证据属于 76537be，不冒称整改后重跑。
