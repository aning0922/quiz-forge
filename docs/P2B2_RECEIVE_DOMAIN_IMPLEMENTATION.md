# B2-1 原包接收 A 流实施证据

2026-10-12，基线 `5f2f8e5da3e9a6cc32dc65949a213973fa9e0938`，独立受管工作树与分支 `codex/p2b2-receive-domain`。本文件仅记录 A 流实际证据；总控承担整合构建、生产浏览器、CI、PR 与最终阶段验收。

首个合同里程碑提供 browser-safe `contracts.ts`、固定限额、server-only `service-contract.ts` 与 `context.ts`。冻结合同实际定义六个方法，派发文本称七个；按冻结六签名实现，不自行增加业务接口。服务对象最终名为 `importReceiveService`。收到原包只代表原字节冻结，DTO 固定 `not-run` 与 `publishable:false`。

runtime 文件严格分派 v1/v2；内部 v1 规范模型增加关闭开关，写文件时剥离该内部字段，二次数据库验证使用同一规范转换。新实例为 v2/false，旧文件不升级。CLI启停及普通guard/恢复guard已实现，真实故障证据继续补齐。

合同检查：format:check、相关 ESLint、typecheck通过；全仓单元36文件537用例通过，增加runtime兼容断言后相关4文件20用例通过；真实 PostgreSQL purpose=test/55421 的既有 p2a-database 41用例通过。配置留私有路径。没有浏览器服务器、3100占用、build/E2E 或 CI 成功声明。

第二个实现里程碑：追加0006枚举/0007单表、有限权限/不可变触发器、六方法服务、独立storage锁/有界计量/私有文件/no-clobber、停止receipt/ESRCH与显式恢复、CLI文件guard与恢复guard、明确八表reset和按停止证据清理uploads已实现。format:check、相关lint/typecheck通过；实际PG/文件12用例及既有数据库41用例通过；合同/文件单元7用例通过。驱动JSON数组以显式text→jsonb绑定，避免默认序列化错误。

补充真实PG8用例通过：v1显式升级保持凭据、CLI丢锁晚到rename和旧guard晚到unlink的互斥、损坏/链接/超限与残留恢复guard、原子替换失败、精确列权限和触发器、有限审计no-op。

剩余证据：更多连接/限额/停止/身份边界与真实60秒期限。全套检查与阶段验收仍未完成。未创建 draft/blob/asset 或发布功能。

独立审查后的增量修复：扫描子deadline从入口建立（含ensureStorage），在各IO settle、目录迭代结束及返回前复核；claim前预留新增目录和partial/archive/stopped/tmp名称容量（目录1024、目录文件16、总项8192）；storage所有reserve/SET/try-lock/check/unlock加客户端≤2秒墙钟截止，失效永久abort并end(0)，不替换驱动onclose。追加0008保护120秒lease不在同fence续期，旧迁移保持不变。

request DB黑洞修复：client/createDatabase及getDatabase支持可选`DatabaseBudget {signal,deadlineMonotonicMs}`，在首个身份查询前持有client，同绝对期限/取消可关闭它。receive/recover服务合同明确DB必须属于本次独占操作；每段read/write DB await同deadline，读超时RECEIVE_TIMEOUT，开始潜在写入后的未确认回执WRITE_OUTCOME_UNKNOWN，所有迟到reject受观察。这里只race数据库等待，文件IO继续等待实际settle再释放storage。正常B1调用不传budget仍保留既有行为。测试长操作改为fresh createDatabase；受控TCP转发器只作故障注入，不记录协议字节。

增量针对性检查：类型/相关lint通过；扫描/锁/request预算9单元通过；真实PG+文件+TCP黑洞3文件29用例通过（包括目录1024/+1、目录12+4/13+4、总项8192峰值/+1的真实接收前拒绝）。storage黑洞3例和首次验证/请求读取/潜在写入黑洞3例均实际运行。纯不settle探针与受控clock分别记录为单元级证据。

此前全仓test:db实际15文件183用例通过（包含单独90秒timeout配置的真实60秒流期限）；该全仓结果发生在四项修复之前，修复后须再跑完整域回归。更多租约/权限溢出与完整检查仍在进行；build、生产E2E、CI、PR由总控整合执行，不在此宣称阶段退出。

修复后完整检查：format:check、全仓lint/typecheck及test通过（40文件552单元）；完整test:db16文件192用例通过，包含新的独占request DB与真实60秒期限。test:driver最初因缺专用QF_DRIVER_TEST_INSTANCE入口明确拒绝，随后指定A专属test实例重跑，结果待本轮结尾记录。

后续账目边界修复：recover不创建任何归档/临时字节，仍有界扫描并验证全部held账目、停止证据及CAS；不因保守held headroom暂时超新接收准入额阻断停止后清理/对账。receive仍严格执行512MiB与新attempt峰值限制。真实“原存量+新峰值恰好512MiB→冻结DBunknown→显式恢复释放held”通过，避免合法接收后的恢复死锁。新尝试身份不变、同fence不续lease、released不可回held的真实触发器用例通过。包含此修复的两文件16域用例通过；最终整仓域复验待结尾记录。

配额修复提交 `d67e6a22fb490a894405d10a6cb3a803bfccb289` 已推送。此处理已获得总控明确确认：不新增文件/attempt的恢复可安全减少占用，但新receive仍严格准入，不放宽扫描或文件限制，也不删除archive。

证据层级与限制：

| 边界           | A流证据                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 幂等与创建未知 | 同Product同key重放/异指纹冲突、20/+1；afterCommit故障注入后独立PG连接确认创建真实提交，exact key读取恢复原意图                                          |
| 接收未知       | claim提交后注入应答丢失，未迭代body且足额held；完成提交后注入丢失，独立连接确认received且文件不变                                                       |
| 停止证明       | 完整receipt及真实受控子进程活PID/终止后ESRCH；错误nonce/fence/2049bytes为真实文件；EPERM/PID复用/未知errno为明确纯适配器测试                            |
| 流与期限       | 32MiB与额外1byte真实流/文件，写前拒绝；cancel挂起且next不settle时无receipt、不释放；真实60秒流期限单独90秒test timeout                                  |
| 锁与网络       | PG实际terminate旧backend/旧reserved不可用；本地受控TCP转发器黑洞对storage握手/check/unlock与request DB首次verify/read/潜在write实际运行；不记录协议字节 |
| 文件失败       | write/sync/link/unlink的窄beforeIo错误注入，结合真实私有文件、inode与PG账目；不声称真实耗尽磁盘                                                         |
| 名称与配额     | 实际opendir/lstat计量、稀疏孤儿逻辑文件；1024目录、目录文件12+4/13+4、全次8192新增峰值/+1真实接收前拒绝且attempt未claim；边界clock为明确受控单元        |
| CLI晚到IO      | 真PG锁断连，受控rename/unlink迟到；普通guard与恢复guard持续互斥，后继CLI被拒，旧目标不重放；残留恢复guard不递归清理                                     |
| SQL保护        | 精确8表、列UPDATE权限、FK/唯一/有限审计；请求不变量/尝试身份/terminal事实/同fence续lease/released回held拒绝；不修改旧迁移                               |

received始终`not-run`/`publishable:false`，没有ZIP/P1/content/Product包内归属/synthetic/图片/授权验证，也没有draft/blob/asset/发布。未获停止证明的活PID、EPERM或损坏guard需受控维护；只凭lease/锁空闲不能恢复。OS文件操作不构成硬实时保证，必须实际settle。A没有启动浏览器服务器、执行build或生产E2E，没有创建独立PR或宣称远端CI；这些由总控集成验收。

最新驱动回归：指定A专属`QF_DRIVER_TEST_INSTANCE`后，ESM/CJS共46场景全部DRIVER_PASS。配额修复后format:check、全仓lint/typecheck再次通过。最终test:db正在复验，结束后记录实例停止状态。

复审残留整改：namespace容量同时预留所有held且尚未落盘的目录及partial/archive/stopped/tmp峰值，不能凭锁失效、目录缺失或已发布receipt提前撤销预留；只有DB明确released后去除。每次upload最多发起一次receipt写入尝试，成功发布后不会再产生新temp；writeStopped已有完全匹配receipt时只读幂等返回，冲突拒绝。StorageLock.query改工厂，在assert之后才开始异步查询，避免旧连接的无人观察reject。

本轮证据：19域单元、真实4文件33用例通过。新增late测试为真实PG+真实文件、窄受控mkdir/open延迟：1023目录时旧held晚到mkdir占第1024槽，后继拒绝claim/body；8184已扫描项加旧held缺文件与新attempt的总峰值超限时后继拒绝，原IO仍等实际settle。发布receipt后afterFreeze停顿、PG实际断锁、另一fresh恢复released后旧操作继续，没有新增temp写入。纯失效query工厂未调用且无unhandledRejection。配额修复后的完整test:db已通过16文件194用例，但发生在本轮三个残留修复前，完整复验须再执行。

收尾证据：三个残留修复后完整test:db通过17文件198用例（135.99s），包含真实60秒；全仓test通过40文件554单元。额外旧0007实际函数/迁移事实拒启用、重放0008后启用、operator disable阻断完成、revision/fence上限写前拒绝，通过相关真实3文件20用例。取消调用保留source对象接收者。

最后求值顺序整改：StorageLock在任何查询工厂之前固定剩余ms，Promise.resolve().then(work)立即接管其结果；acquire同样先left()再创建SET/try-lock工作，reserve/unlock亦由Promise链接管。工厂主动越过deadline或触发abort后reject均受观察；单独Node子进程验证两种情况，没有原始异常输出或PG连接。窄单元2文件9用例与真实storage网络/late两文件9用例通过；最终format:check、全仓lint/typecheck通过，A测试实例已停止。没有再重跑完整DB或新增业务方向。

最终A流交接：专属purpose=test实例 `275408bf8a01e0ef239956596379b11d` 已用受管CLI正常stop，status再次确认stopped，独占55421端口可重新bind（布尔探针true）。私有实例/配置保留可恢复；没有遗留A测试子进程、TCP转发器或浏览器服务器。storage/runtime/CLI及相关测试文件修改完成，交回总控做集成注释/构建/生产E2E/CI/PR及独立复验，不继续B2-2/后续方向。

最后窄修复的类型推断曾失败，已显式固定ReservedSql泛型与pinned句柄后再次typecheck成功；最后9单元（含独立Node）及9真实网络/late用例是在预算先算、Promise观察链调整后的实际结果。本文件将全仓198域/554单元、46driver与最终窄验证分别列明，未把较早的全仓结果冒称最后head已重跑全DB。总控按精确整合head统一复验。
