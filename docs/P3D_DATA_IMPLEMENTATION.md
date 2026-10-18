# P3-D 数据实现记录

2026-10-18，独立数据树 `codex/p3d-draft-data`，冻结基线 f35fd8431b2a2ded01dd81c2cbbef47953c37e7a；共享证据校验修复 1e74adc 的依赖副本为 d0a5953，不是额外实现。

## 核心批

0016 保留旧迁移、首稿 v1 指纹函数原字节及旧成功事实。迁移要求停写、没有残留应用连接、维护锁空闲、旧列/完整约束/保护函数及 IO helper 原语义一致，且 import/validation 真实静止；不会补 ACK、改历史收据或终止未知进程。初始应用绑定固定 initial_revision=1，append 的父修订与两 hash 精确外键绑定；100 修订上限、manifest 唯一、来源唯一、单调列更新和提交时闭合由数据库保护。审计保持服务同事务单条，不新增历史审计关系。

独立工厂 `createProductDraftRevisionService()` 提供 append、单 RR 快照 resolve、稳定锚点分页。新旧应用共用 key 命名空间并显式冲突；原 key 先于可变资格检查重放。resolve 的 applied、obsolete、同 import 消费、严格读取 alias 后同 manifest 消费和 unresolved 遵循冻结优先级；返回前新事务核当前读权限，过程不触 session/audit。只读来源与写来源共用同一事实校验，前者没有 FOR UPDATE。资源首次来源及旧固定修订不变。

## 实际验证

- 冻结安装 pnpm install --frozen-lockfile 成功，无依赖修改。
- 自有 purpose=test、端口55421的初版实例984461f4b5e8f0d5a9c732f928a1778f迁移成功，旧34项PG回归通过；该实例已停止保留。补充旧IO helper精确预检查后，没有篡改该实例迁移收据，另建fresh实例验证最终字节。
- 最终字节在fresh实例92e374ca339b3bb3a89488335d29a1b7成功迁移；draft-schema、p2b3-service、p2b3-sql、p3d-service共47项真实PG通过（14.27秒）。包括两连接CAS和原key竞争、两次追加与r1/资源首次来源不变、稳定分页、两类source-used、RR快照隔离、只读无session/audit写、缺失指针/跳号/越权拒绝、audit失败回滚、真实COMMIT后模拟交付丢失、99→100竞争及owner同事务清理。
- pnpm typecheck 与数据范围ESLint通过。

限制：以上候选使用明确的合成无文件archive/media证据，不是native媒体验收或正式内容批准；真实0015旧库升级由主控持有的已停实例单独验证。浏览器专用P3D夹具、完整PG/driver、六项工程检查、生产E2E/视觉、远端CI与独审仍待后续集成，不能把核心批当阶段完成。没有操作主控55423旧库、3100、native或生产环境。

## 独审整改：反向账本闭合

Astra 在核心批后用真实应用角色复现 P2：合法的 append application 可以单独提交而没有对应 revision。原 guard 和 47 项回归未覆盖这一反向关系，不能据此宣称原版本已经封闭。0016 增加 application(Product/draft/revision/id) → revision(Product/draft/revision/application_id) 的精确 DEFERRABLE INITIALLY DEFERRED 外键，与原 revision → application 的来源绑定外键构成双向闭合。开库 facts 增为102约束，并核该FK四个内部触发器。新增真实 app-only 提交23503回滚及同tuple随后正常追加测试；原 first/append、owner 单事务完整删除继续覆盖。

整改没有修改已应用收据：92e374ca339b3bb3a89488335d29a1b7已停止保留，另建fresh purpose=test 2e8cc98d8096bb81760a9634cdfe9b06（55421）实际迁移新字节。前述空推进测试曾错误期待23514，实际正确由FK返回23503；只修正测试期待，未放宽业务行为。

整改后四文件48项真实PG全部通过（14.28秒），包含app-only反例、正常first/append、99→100及owner完整闭环删除；类型和定向lint通过。浏览器夹具仍独立开发，不混入本次DDL整改提交。
