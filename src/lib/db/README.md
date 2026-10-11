# db

PostgreSQL + Drizzle ORM 为选定方案；ORM 和 postgres 驱动已安装。D0 无连接、Schema、迁移、数据库业务或本机 PostgreSQL 前置条件检查。

后续数据库代码必须 server-only，不从 Client Components 导入。迁移与事务应通过独立数据库集成测试验证；连接字符串不能进入浏览器 bundle。
