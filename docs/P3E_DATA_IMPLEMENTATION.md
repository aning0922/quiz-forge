# P3-E 数据实施与验证记录

2026-10-18，实施起点 `04914205e4a4dafa7183e87ce0875e69f942ac01`，独立分支 `codex/p3e-version-data`。本文件由数据实施流维护；范围依据 `INTERNAL_VERSION_P3E.md` 与 `P3E_REVIEW.md` 的冻结协议，不扩大内容、发布或生产迁移授权。

## 范围与迁移决策

本批先实现 0017、应用连接的精确 schema/ACL 检查、quizpack 显式来源证据端口、真实 IO 生命周期 owner、维护留存接口及旧 first/append 的事务共享锁；随后接受信 registry，实现 review/version 服务与真实 PostgreSQL 验证。主控维护机器 Schema、registry、权限/HTTP 错误及集成，另一实现流维护浏览器和 HTTP 适配。

0016 及更早 SQL 的原字节和 checksum 保持不变。0017 只新增 `draft_review` / `product_version`，新增 revision 的六列精确三 hash UNIQUE，以及专用审核/封存审计类型。升级必须先停止旧写者和真实 IO，取得既有维护独占锁并检查旧 schema 定义，拒绝不完整/被削弱的前序约束；不回填审核或批准，不清理历史事实。应用必须拒绝仍停留在 0016 的库。旧 0016 真实现场由主控保留，本流不使用。

review 以 Product/key 唯一、Product/draft/revision 唯一；六列复合 FK 绑定真实 revision 三 hash，保存的 source 引用必须与同一 revision 一致。version 以 Product/key 与 Product/snapshot hash 分别唯一，NOT NULL slot + CHECK 1..100 + Product/slot UNIQUE 是固定容量权威；复合 FK 同时绑定精确 review、目标三 hash、review hash 与 internal-test 用途。规范 binding/facts/snapshot 的 SHA、行列对应及用途在数据库核验；TS 仍负责冻结 strict Schema 和受信登记语义。数据库约束不被描述为可验证外部作者权利。

新增表 app 仅 SELECT/INSERT，PUBLIC 无表/列/函数授权；没有 UPDATE/DELETE/TRUNCATE 或任意 SECURITY DEFINER 逃生入口。应用连接检查列类型/默认值/必填、约束定义/验证/执行状态、FK 内部触发器、索引有效性、函数体/属性/授权与触发器定义。

## 锁与生命周期

新 review/seal：短只读当前授权/原 key → 一次性资源名额 → outer guard → auth 写锁 → 非等待同事务 shared advisory lock `(72461,2)` → guard.check → Product → 原 key 再查 → 新申请资格/INSERT/审计/最终授权/COMMIT。文件 IO 在写事务前真实结束。旧 first/append 保留 auth → Product → 原 key；仅新申请在读源前取同事务非等待 shared 锁，不增加独立 guard 或 FS 名额。

每请求 owner 捕获实际 DB、原 budget 和 dispose clock，服务核对象身份。`runNew` 仅一次，task callback 首句同步 transfer；此前 HTTP 收口，此后 actual finally 收口。Task.run 的 HTTP race 与最多 5s 关闭观察不代表真实工作结束。原始绝对 deadline 不扩期；数据库现有预算取消 `client.end` 保持有效。真实 SQL 的成功、确认回滚和 UNKNOWN 分别记录；晚成功只能原 key 核实找回。FD/DB/guard 关闭不确认即 quarantine，不能另走 finally 补 unlock 或 TTL 释放。

维护者持独占锁，用取锁后的新快照核精确删除范围及 blob 留存，覆盖所有既存 revision、review 和 version；禁止按整个 Product 排除审核/版本。任何未识别、外部引用或读取失败均在首次 unlink 前拒绝。P3-E 自有 fixture 的精确 version/review 先核实再按依赖删除，旧 fixture 不能清理新账本。

## 交付与验收条件

分步交付独立提交及推送；实际 PG 覆盖新库/0016 升级、约束变异/ACL、原 key 优先、锁竞争/断连、容量及留存阻止物理删除。owner 专项覆盖 callback 前取消、真实 IO/COMMIT 未收口、晚成功、关闭失败隔离与双关防止。服务缺可信 registry 时明确拒绝，不造占位成功。

本次核心已实现 0017/精确 schema facts 与 ACL guard、规范文本及来源对应检查、固定 synthetic 输入准备、显式来源证据端口、owner、事务共享锁与留存前置接口。三个实际删除 blob 的旧夹具在第一次 unlink 前调用留存端口；首稿夹具及 reset 也已加入留存/空账本检查。它们的完整真实退出清理回归尚待本批后续验证，不能把代码接入称为清理验收完成。

2026-10-18 实际验证：格式、lint、类型通过；owner 加既有 task/storage 共 24 项通过；新账本 guard、源证据/规范字节对照、精确关系变异、同 Product 留存、实际维护竞争、旧 first/append 原 key 与新共享锁及 100 槽位，加旧 draft guard/追加服务，共 31 项 PostgreSQL 通过。全量单测初次因旧首稿 SQL mock 未返回新锁结果失败，已修正，最终全量 133 文件 / 1587 单元通过。第一次空 0016→0017 发生在仅本流新建测试实例；升级前置检查随后增强，保留并停止旧草稿实例，最终 SQL 又在另一 fresh test 实例运行。未改迁移历史来伪造 checksum 一致，未使用主控的旧库现场。

尚待：有谱系的真实 0016→0017/拒旧与保旧验证、review/version 应用服务及 resolver、真实 FD/SQL 关闭失败/物理留存、P3-E 自有夹具与旧夹具的完整清理回归、最终集成工程检查。缺实际受信 renderer/engine 执行条目时不提供占位 seal 成功。全阶段六项、3100 生产 E2E、媒体/浏览器验收由主控集成执行，本文件只报告本流实际结果。
