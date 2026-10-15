# B2-3 首个持久草稿预案

本页是 B2-2B 集成期间的下一批设计准备，不是已实现功能或阶段放行。B2-2B 的服务、媒体、数据库、浏览器和独立审查证据仍以 PROGRESS、P2B2B_REVIEW 为准。当前作者已授权常规工程推进至首款端到端内测；以下技术取舍由总控冻结，不新增内容、商业或发布批准。

## 首批范围

将一个已 ready 的候选应用为所属 Product 的首个持久草稿，生成不可变 revision 1，提供真实只读草稿工作区。首批只支持既有 new-draft 目标；编辑、追加 revision、替换、送审、正式评分和发布分别由后续合同实施。

沿用当前已支持的 private-archive.v2、synthetic、content.v1 来源。旧 v1 归档仍只读；未知协议不能借“无需重新解码”获得应用资格。应用为独立关系，不修改原包 received 或验证 ready 的终态。

## 内容与资源归属

保存 B 固定的 canonical content 原文与 SHA，保留内容、视觉、报告、资源、组件和引擎版本。草稿 revision 与包内容版本是不同编号；raw content SHA 不能替代 canonical SHA。

每个 revision 保存完整 asset-set，固定 Product、resourceId、resourceVersion、blob SHA 和 declaration SHA。事务逐项核对不可变 product_asset 及完整集合，不只核 blob 存在。共享 blob 不改变资源的 Product 归属；同包 alias 的首次来源可能在其他 validation，不能要求所有资源的首次 validation 都等于当前来源。授权声明和 unverified 状态保持不变。

F1 draft.ts 只提供 CAS、固定身份和 no-op 语义参考，不能直接充当持久化入口：其 1 MiB、宽 ID 和 JS safe integer 与 B 的 2 MiB、P1 ID、PostgreSQL int32 不同。不把真实 content.v1 强行转为 foundation.v1。

## 最小数据模型候选

| 表                | 范围与约束                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| product_draft     | UUID、Product、当前 revision、创建人/时间；每 Product 唯一，原子建立并指向 revision 1，不暴露 revision 0。                                              |
| draft_revision    | 同 Product/draft/revision 唯一；canonical content text/hash、完整 asset-set text/hash、schema、来源 validation、创建人/时间；业务角色只 INSERT/SELECT。 |
| draft_application | 仅记录成功应用：Product、UUID 幂等 key、固定 fingerprint、source import/validation、目标、实际 draft/revision、创建人/时间；业务角色只 INSERT/SELECT。  |

指针使用含 Product/draft 的复合 FK；首次建立可使用延迟约束。应用账本同时唯一约束 Product/key 和 Product/source import。不同 import 的 alias 不冒充同请求重放；已有草稿且没有匹配账本时明确冲突。

新表、审计 enum、权限和迁移顺序必须在实现前独立核定；不修改已应用的 0011/0012。当前没有新增或执行这些迁移。

## 应用与未知结果

应用只使用数据库中已冻结的内容与资源关系，不读 ZIP、不解码、不复制资源、不查询当前媒体部署。因此不新增 storage 锁、扫描、预留、租约或 ACK 周期。

固定输入为 source validation、预期 validation revision/candidate SHA、new-draft 目标和幂等 key。其余事实从权威行取得。短事务顺序为当前会话/CSRF 与写权限 → Product → import → validation → draft。同 key 先在当前授权下核实成功账本；相同 fingerprint 返回原结果，异输入冲突。只有新应用检查 Product active、来源可用和仍无草稿。

内容/资源核实、draft/revision、成功账本和审计在同一事务完成；失败全部回滚。响应使用确认 COMMIT 的事务结果，不再追加读取来决定成败。提交未知时保留完整原请求，按原 key 查询；空 GET 不构成回滚证明，不自动生成新 key。

## 服务与后台

候选接口为 applyReadyValidation、readDraft、readDraftRevision、readDraftApplicationByKey。沿用当前鉴权、有限错误、数据库 deadline 和 4 KiB 写请求限制。列表不带 2 MiB 正文；完整内容读取另设有界响应。

ready 详情提供“应用为首个草稿”及来源摘要；Product 工作区提供真实空状态、草稿内容/资源摘要、未知提交核实和已有草稿冲突说明。只读角色只查看。完成归档或创建草稿均不能显示“已批准”“可发布”或“评分通过”。

P2-C 从指定 draft/revision 取得结构预览和派生验证；P3 从冻结 revision 取得评分输入，分别绑定完整内容、逻辑 projection 和报告版本。消费者 Key/结果快照仍由后续阶段实现。

## 验收与分工

- 数据线：合同、三表、权限、短事务和查询 DTO；先交公共接口。界面线：HTTP、pending 和只读工作区，不另造 SQL 或资源解析器。
- 两连接竞争首稿只能一个成功，无孤立 revision、账本或审计。同 key 同输入重放、异输入冲突；不同 key/alias 不重复创建。
- 跨 Product、资源遗漏/声明不符、非 ready、旧协议、已有草稿拒绝；同 Product 资源别名能按真实冻结集合核对。
- 撤权、审计失败、回滚、COMMIT 响应丢失覆盖真实数据库故障；未知结果不能伪装失败或重复成功。
- 超过 F1 1 MiB 但仍在 B 限制内的合法候选完整保存，版本/原文 SHA/资源绑定不丢失。
- 生产构建浏览器验证空状态、首稿、只读、冲突和刷新恢复，四宽截图实际检查；再完成工程检查与独立审查。

下一步先完成 B2-2B 验收记录，再将本候选收敛为冻结合同、建立独立工作树和 Draft PR；不在当前归档 PR 中实现草稿业务。
