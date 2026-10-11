# P2-A 数据库实现与公共接口

2026-10-12。范围限定于三张业务表、私有运行配置、纯 token 工具、隔离实例管理和真实数据库验证。认证/HTTP/UI 由 Auth 流拥有。当前公共接口已实现，生命周期、迁移和数据库验收继续推进，尚不声称完成 P2-A。

`src/lib/db/schema.ts` 导出 `operators`、`operatorSessions`、`auditEvents` 及 `$inferSelect` 类型 `Operator`、`OperatorSession`、`AuditEvent`。字段 camelCase 映射冻结合同的 snake_case SQL；时间类型为 Date。明确 `qf` schema，身份 UUID 由调用者生成。

`loadRuntimeConfig(): Promise<P2aRuntimeConfig>` 只读取 `QUIZFORGE_P2A_CONFIG`。文件必须是当前工作树 `.cache/p2a/<instanceId>/runtime.json` 的绝对路径，私有真实目录0700/文件0600，拒绝 symlink、额外字段、非 loopback 连接及错误 profile。错误统一 `StudioUnavailableError`，其 message/code 均为 `STUDIO_UNAVAILABLE`。

运行配置结构：`version:1`、`profile:"local-http-p2a"`、`purpose:"test"|"demo"|"ci"`、`origin:"http://127.0.0.1:<explicit-port>"`、32位hex `instanceId`；`database:{host:"127.0.0.1",port,name,user,password}`；`server:{version:180004,address,port}`。数据库名/应用角色分别是 `qf_db_<instanceId>` / `qf_app_<instanceId>`。连接端点总是loopback；仅CI允许记录独立的容器内部server地址/端口，必须与连接实际事实一致。marker为 `quizforge.p2a.v1:<instanceId>:<purpose>`。

`getDatabase(): Promise<P2aDatabase>` 加载私有配置并验证实际数据库；`createDatabase(config)` 允许已加载的严格配置。返回 `{sql:postgres.Sql,db:PostgresJsDatabase<typeof schema>,config,close:()=>Promise<void>}`。调用者在 `finally` 中 `await close()`；事务用 `sql.begin(async tx=>...)` 或 `db.transaction(...)`。没有模块导入/构建时连接或全局缓存。数据库不可用及身份不匹配都关闭连接并抛统一错误。raw SQL须显式schema。

`src/lib/security/p2a-tokens.ts` 导出合同规定的 `issueToken(kind)`、`parseToken(raw,kind)`、`digestToken(raw,kind)`、`csrfForToken(raw,kind)`、`verifyCsrf(raw,kind,csrf)`。TokenKind为credential/preauth/session；CSRF仅preauth/session。32随机bytes/canonical base64url、摘要域和CSRF域按合同冻结；数据库及日志不能保存raw。

`openSql(connection)` 与 `verifyDatabaseIdentity(sql,config,role?)` 为管理/数据库测试的底层接口；应用服务应使用 `getDatabase/createDatabase`，不能绕过身份验证。管理配置不由Next加载，后续生命周期实现会补充管理与测试接口。
