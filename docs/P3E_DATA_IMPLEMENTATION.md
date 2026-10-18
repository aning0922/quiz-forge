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

后续实际验证已补：`p3e-upgrade.test.ts` 在独占合成实例重建真实 0016，运行 r1→r2→r3，14 张既存表逐行原 JSON 文本在升级前后完全相同，5 blob/3 revisions 保留；新 app 在 0016 拒绝打开，活动旧写者/共享读取 guard/同名削弱旧约束均阻止升级，成功后新账本为空且原 key 回放仍固定。旧 0010→0014→拒绝不安全0015 升级回归与 P3-D 五源/真实进程退出清理回归也各 1 项实际通过。未修改主控保存的 0016 现场。

尚待：review/version 应用服务及 resolver、真实 FD/SQL 关闭失败/物理留存、P3-E 自有夹具与旧夹具的完整清理回归、最终集成工程检查。缺实际受信 renderer/engine 执行条目时不提供占位 seal 成功。全阶段六项、3100 生产 E2E、媒体/浏览器验收由主控集成执行，本文件只报告本流实际结果。

## 独审整改：审计 NULL 三值逻辑

Astra 指出新增 audit_target OR 分支缺少 target_kind/target_revision 非空条件，SQL CHECK 可能接受 NULL。已在应用角色真实事务复现：审核/版本两种 action 分别缺 kind 或 revision，共 4 例均插入成功；逐例显式回滚后新 action 计数保持 0，没有反例留存。原 checksum 测试实例保留并停库，没有改迁移历史。

最小修复为新增分支显式要求 target_kind、target_revision 非空，整个 audit_target 表达式以 IS TRUE 收口；对应 draft schema exact fact 同步更新。修订 SQL 在另一 fresh purpose=test 实例实际安装；4 个缺字段负例均报 23514/audit_target，2 个完整有限目标正例通过。有谱系 16→17、两套 schema guard 和数据核心共 23 项 PostgreSQL 再次通过。0001..0016 原字节保持。

## 应用服务首批

新增每请求 `createProductInternalVersionService(owner)`，公开方法保持冻结 service-contract。原 key 先在授权 RR 读取并完整核 binding/fingerprint，成功前 fresh 当前权限复核；不申请新 FS 名额、不读当前字体/图片、不要求当前执行器可用。新 review/seal 严格 outer guard → auth → try xact shared → guard.check → Product → key 再查；新申请 head、精确三 hash、受信 baseline/用途、review 与容量复核后 INSERT/单条专用审计/最终授权/COMMIT。

seal 使用主控真实固定 engine wrapper prepare/witnesses，要求 actual canonical content hash、全见证 passed 及 logicHash 与固定 baseline 一致。实际逐唯一 blob hash 顺序读取/校验/关闭并丢弃缓冲，另在同一 owner/deadline 下逐一打开并核字体、coverage、license 的固定实际字节；这些操作不读取 repo 源码来重建身份。缺素材或执行依赖明确拒绝，不给占位成功。原始 evidence 仍只在 quizpack 内部端口核验，snapshot 只放冻结身份/hash。

resolve/read 在单 RR 读取业务事实并另做 fresh 当前授权。原 key 永远优先；obsolete、精确 target-used 和 100 硬槽位证明严格分域。历史 snapshot 重建只依赖保留 descriptor、原来源事实与 baseline 的固定 logicHash，不调用当前评分器或 FS。新增历史源端口保留原 archive policy tuple，不以今日 policy 执行可用性重新批准旧来源。

实际首轮服务 PostgreSQL 10 项通过：真实五图和三字体文件封存/详情/列表/状态，quota 全满+归档+执行器停用时原 key 重放，异 binding/异 key 重复及 target-used，历史缺当前代码/字体仍可读核实，新 seal 缺字体/图片拒绝，readonly/CSRF 拒绝，fresh 授权期间失权拒绝，真实 COMMIT 后投递未知由原 key 恢复且不重复审计，业务事务内实际 pg_terminate_backend 后 UNKNOWN/unresolved，以及并发推进 head 时保持单 RR 观察。夹具只清理已返回/核实的精确自有 ledger IDs，未知或外部事实即保留；未来生产 Next 接线与持久 P3E fixture 出口仍待集成。

本服务提交的本地工程验证：format:check、lint、typecheck、138 文件 / 1612 单元、pnpm build 全部通过。实现门禁实际核 3 descriptor / 51 文件 / 280 lock records；现有 Next 构建 trace 72 / 15075 paths / 0 违规。新 HTTP/后台路由尚由另一实现流接线，不能把本轮现有路由 build 当作新生产链路或 E2E 通过。后续继续补容量证明、真实物理留存和关闭故障、P3E 持久夹具出口。

后续服务 PG 已扩至 13 项并全过：实际已封存引用在首次 unlink 前阻断，文件字节和 DB 计数不变；100 个明确 synthetic 直接 DB 约束条目占满硬槽位后，正常新 seal 给 VERSION_LIMIT，独立单 RR resolve 给严格 capacity-exhausted（这些填槽条目不注册字体或冒称真实受信封存）；外层 guard 的真实后端在服务最后 guard.check 后被终止，维护锁仍被业务事务 SHARE 拒绝，真实 COMMIT 后原请求 UNKNOWN，由原 key 找回唯一成功及单审计。该测试未修改业务锁实现。

## 独立 P3-E 夹具

私有合同位于 tests/db/p3e-internal-version-fixture-contract.ts，真实实现位于同名 fixture.ts。read/prepare/finish/cleanup 导出与旧退出 proof 协议组合；version:1 是文件格式号，实际详情字段 versionDetail。CLI prepare 可在 Next 启动后执行，先短 DB 事务、实际落五图时才持存储独占锁；无预造 review/version。baseline 来源是固定三 hash，next 仅供推进 head 的未登记结构测试，五 PNG 不重编码。已有 blob 只核原字节并记 created=false，不假定物理拥有。

finish 从实际持久事实核完整三 hash、源身份、review/snapshot 与精确登记，并封存观察到的回执；未落账拒绝完成。cleanup 先要求真实服务退出 proof、原 writer 已退出、imports 禁用、无其他 DB backend/native 控制任务、精确两 actor/source/audit 图谱。新增 assertOnlyOwnedInternalReferences 在删除自身 ledger 前用持锁后的新快照检查全局相关 review/version，逐一比较完整已观察回执；未知/额外/错 actor 的记录拒绝，绝无 Product-wide 豁免。随后仅删除已证明的 version→review，再原留存检查、只移除本次首次创建且无共享引用的文件，再删除原精确图谱。关闭不确认保留 guard/FD，不返回假清理成功。

实际 CLI/PG 生命周期首项通过：0600 私有文件、双 prepare 拒绝、未落账 finish 拒绝、假退出 proof 拒绝、实际服务 record/seal 后 finish、未登记额外同 Product version 保留原文件/全部账本、实际 child close+进程组消失+空闲端口证明后精确清理。与服务 13 项组合共 14 PG 通过。首个探针因重复 prepare 在检查文件存在前等完整认证窗口而超 20s，已把存在检查前置；该失败实例保留并停库，新 fresh 实例验证，没有清理失败现场。created=false 的真实跨 Product 共享物理拥有者正例仍待补；本生命周期是退出协议测试，不冒称实际 Next/E2E。
