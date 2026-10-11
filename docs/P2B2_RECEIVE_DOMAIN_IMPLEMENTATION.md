# B2-1 原包接收 A 流实施证据

2026-10-12，基线 `5f2f8e5da3e9a6cc32dc65949a213973fa9e0938`，独立受管工作树与分支 `codex/p2b2-receive-domain`。本文件仅记录 A 流实际证据；总控承担整合构建、生产浏览器、CI、PR 与最终阶段验收。

首个合同里程碑提供 browser-safe `contracts.ts`、固定限额、server-only `service-contract.ts` 与 `context.ts`。冻结合同实际定义六个方法，派发文本称七个；按冻结六签名实现，不自行增加业务接口。服务对象最终名为 `importReceiveService`。收到原包只代表原字节冻结，DTO 固定 `not-run` 与 `publishable:false`。

runtime 文件严格分派 v1/v2；内部 v1 规范模型增加关闭开关，写文件时剥离该内部字段，二次数据库验证使用同一规范转换。新实例为 v2/false，旧文件不升级。CLI启停及普通guard/恢复guard已实现，真实故障证据继续补齐。

合同检查：format:check、相关 ESLint、typecheck通过；全仓单元36文件537用例通过，增加runtime兼容断言后相关4文件20用例通过；真实 PostgreSQL purpose=test/55421 的既有 p2a-database 41用例通过。配置留私有路径。没有浏览器服务器、3100占用、build/E2E 或 CI 成功声明。

第二个实现里程碑：追加0006枚举/0007单表、有限权限/不可变触发器、六方法服务、独立storage锁/有界计量/私有文件/no-clobber、停止receipt/ESRCH与显式恢复、CLI文件guard与恢复guard、明确八表reset和按停止证据清理uploads已实现。format:check、相关lint/typecheck通过；实际PG/文件12用例及既有数据库41用例通过；合同/文件单元7用例通过。驱动JSON数组以显式text→jsonb绑定，避免默认序列化错误。

补充真实PG8用例通过：v1显式升级保持凭据、CLI丢锁晚到rename和旧guard晚到unlink的互斥、损坏/链接/超限与残留恢复guard、原子替换失败、精确列权限和触发器、有限审计no-op。

剩余证据：更多连接/限额/停止/身份边界与真实60秒期限。全套检查与阶段验收仍未完成。未创建 draft/blob/asset 或发布功能。
