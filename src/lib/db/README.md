# db

P2-A 实现 PostgreSQL18.4 + Drizzle 三表、严格私有 runtime、实例管理、事务迁移及应用角色限权。接口、脚本和实际检查证据见 `docs/P2A_DATABASE_IMPLEMENTATION.md`。认证/HTTP/UI 由独立 Auth 流提供；后续业务表不属于本阶段。

后续数据库代码必须 server-only，不从 Client Components 导入。迁移与事务应通过独立数据库集成测试验证；连接字符串不能进入浏览器 bundle。
