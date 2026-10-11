# B2-1 原包接收 A 流实施证据

2026-10-12，基线 `5f2f8e5da3e9a6cc32dc65949a213973fa9e0938`，独立受管工作树与分支 `codex/p2b2-receive-domain`。本文件仅记录 A 流实际证据；总控承担整合构建、生产浏览器、CI、PR 与最终阶段验收。

首个合同里程碑提供 browser-safe `contracts.ts`、固定限额、server-only `service-contract.ts` 与 `context.ts`。冻结合同实际定义六个方法，派发文本称七个；按冻结六签名实现，不自行增加业务接口。服务对象最终名为 `importReceiveService`。收到原包只代表原字节冻结，DTO 固定 `not-run` 与 `publishable:false`。

runtime 文件严格分派 v1/v2；内部 v1 规范模型增加关闭开关，写文件时剥离该内部字段，二次数据库验证使用同一规范转换。新实例为 v2/false，旧文件不升级。CLI启停尚待实现。

合同检查：format:check、相关 ESLint、typecheck通过；全仓单元36文件537用例通过，增加runtime兼容断言后相关4文件20用例通过；真实 PostgreSQL purpose=test/55421 的既有 p2a-database 41用例通过。配置留私有路径。没有浏览器服务器、3100占用、build/E2E 或 CI 成功声明。

后续待实现：追加迁移/权限/审计，原字节存储/锁/配额/停止证明/恢复，CLI guard 与恢复 guard，真实 PG/文件故障测试及受控夹具清理。未创建 draft/blob/asset 或发布功能。
