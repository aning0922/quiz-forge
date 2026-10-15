# P3-B 数据准入实施记录

2026-10-16。独立数据工作区 `codex/p3b-data-admission`；共享依赖截至 root 493598f、package M1 3f3ddaa/227d5bb。只使用自有 55421 新建 purpose=test 实例，不升级旧实例，不占 3100。以下是分步工程证据，不是阶段技术退出或内容/素材批准。

## 第一步：当前准入和历史只读边界

来源读取解析明确的 content.v1/v2 × synthetic/authored，核原始冻结正文/hash、组件矩阵、独立 asset-set 和资源声明；当前申请必须精确匹配 archive policy version/hash 和 supported identity 整组。历史 revision reader 继续返回原存储正文，不依赖当前 ready 资格或媒体。

validation mutation 和服务恢复/重试在文件恢复前拒绝旧策略；DTO 标记 readOnly，页面只展示旧策略事实，不提供恢复、重试或新申请入口。原 application key 重放与 UNKNOWN tuple 协议保持；authored 标签不授予批准，platformApproval=unverified、publishable=false。

per-Product pending 仅统计当前 policy version/hash 精确匹配的原 pending 谓词；当前 clean validated/retryable-failed 仍占位。新 claim 对旧行静止事实执行有界检查，不让 policy 过滤掩盖未决 IO。1024 全历史行与跨策略磁盘/held 账本不变。canonical 查询与资源精确复用路径不变。

现有 domain/B3 无文件合成 DB 夹具使用真实 supported identity/report Schema hash；显式 legacy 参数仅供历史夹具。它们验证真实 PG 约束和事务，不能证明媒体解码、文件归档或生产停止。

验证：相关单测 203 项；现有 domain/ACK/boundaries/B3 service/SQL 五套 PG 51 项；新增数据边界 PG 3 项；lint/typecheck 与 diff 空白检查通过。

待完成：0010→0015 历史升级约束、静止旧行/旧 canonical/旧成功 application 的历史证据、全局容量及跨策略预算回归；B 的真实 supported candidate/restore 接入后验证四组合服务写入。当前 restore DTO 仍受旧桥接 v1 类型约束，未强制 cast 或制造 v2 opaque 候选。完整阶段六项/媒体/E2E/独审由主控集成后执行。
