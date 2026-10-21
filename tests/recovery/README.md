# R1 独立合成恢复演练

`synthetic-pack.ts` 从固定 `p4-baseline` 的真实文件构建 ZIP，验证已登记的 content、manifest、asset-set 三项摘要及五张 PNG，保留原 manifest 字节。基线实际为两题、三结果、五资源。构建只证明包检查通过；不签发私有候选、媒体停止证明、数据库历史或批准记录。

后续实际演练须在 B 独占的新 test 实例运行，不能调用 `prepareP4ConsumerSource` / `seedReadyP2b3Source` 的 no-file 快捷种子：

1. 创建独立 operator 和空 `consumer-flow-fixture` Product；通过真实 `createIntent` 与 `receiveArchive` 接收 helper 产生的完整字节，核原包 SHA、长度和 durable stopped 回执。
2. 在匹配当前工作树的已配置媒体运行时上，通过真实编译 Next HTTP 路由调用 `prepareValidation` / `startValidation`。原生运行根由 Next 编译固定，不能从 raw TS 导入执行或注入 globals 来替代。`runtime-recovery-drill-source.ts` 只创建新的合成 test 实例，独占 55422/55428，启动自身 HTTP，结束后验证实际退出。不 mock native media，不直接落账 ready，不伪造 fileStopProof。要求 ready、五资源、全部尝试真实停止并释放；真实 apply、审核及版本封存。
3. 通过业务接口创建一个已完成报告、一个进行中答题和一个未使用 Key。原始合成凭证仅留在自有私有演练状态，不写 Git、截图或公开输出。
4. 源 HTTP、worker 和请求连接由其 owner 实际关闭；禁用导入并关闭 fixture 连接。调用正式备份工具，由 A 检查数据库和文件完整闭合；不能为演练放宽准入。
5. 新受管工作树使用相同逻辑 ID、新数据库密码、新端口恢复。先比较完整数据库指纹和文件清单；目标首次恢复结果必须为 verified-stopped。
6. 独立 browser context 与显式目标配置启动自有目标 HTTP。检查旧报告及资源、继续原进度、完成未使用 Key，遵循真实时钟。源 HTTP 保持停止。新端口本身不隔离 Cookie。
7. HTTP 与目标数据库实际退出后保留现场，记录有限摘要和关闭证明。未知 IO/子进程结果保留且失败，不删除、不覆盖重试。不以 HTTP 验证替代备份时的源/目标指纹相等证明，因为业务验收会产生新的合法目标记录。

B 的文件/能力/CLI 边界测试使用 `vitest.recovery-tools.config.ts`；A 的数据库测试独立位于 `tests/recovery-data/`。原 39eb、原私有资源和 3100 不属于本 fixture。

2026-10-21 B 本地来源前置已实际执行：run `47031d8b-c1e6-4b10-b605-d95c1c5c3d2e`、新 test 实例 `77ff081dd5e79fa80f814fdec4a19ee3`，sourceRecord SHA `fc544097a39db0703274947d848fac9012ee5e78f3c7d31d449341e2275cbb7e`。真实 media main build/setup/provision 已封存，receive/原生验证/应用/审核/版本/play/Key/消费者保存与完成链通过。独立 owner SQL 复核精确 import 1、validation 1、draft 1、revision 1、review 1、version 1、play 1、Key 3、session 2、report 1、blob 5、Product asset 5；SQL 连接实际关闭，HTTP 55428 无监听，源 PG 55422 保留运行且 imports disabled。初选 HTTP 55423 已有未知 PG listener，脚本在新建任何实例前拒绝，未操作该 listener，随后改用确认空闲的 55428。这仅证明来源准备，不是备份、恢复或目标 HTTP 演练通过；完整恢复证据由阶段验收记录。
