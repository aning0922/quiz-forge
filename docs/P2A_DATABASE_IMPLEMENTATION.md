# P2-A 数据库实现与公共接口

2026-10-12。范围限定于三张业务表、私有运行配置、纯 token 工具、隔离实例管理和真实数据库验证。认证/HTTP/UI 由 Auth 流拥有。公共接口交接提交为 `1991271bd98f71985ed4612cd2734809c99b5059`；本流实现与验收证据如下，不代替完整 P2-A 集成验收。

`src/lib/db/schema.ts` 导出 `operators`、`operatorSessions`、`auditEvents` 及 `$inferSelect` 类型 `Operator`、`OperatorSession`、`AuditEvent`。字段 camelCase 映射冻结合同的 snake_case SQL；时间类型为 Date。明确 `qf` schema，身份 UUID 由调用者生成。

`loadRuntimeConfig(): Promise<P2aRuntimeConfig>` 只读取 `QUIZFORGE_P2A_CONFIG`。文件必须是当前工作树 `.cache/p2a/<instanceId>/runtime.json` 的绝对路径，私有真实目录0700/文件0600，拒绝 symlink、额外字段、非 loopback 连接及错误 profile。错误统一 `StudioUnavailableError`，其 message/code 均为 `STUDIO_UNAVAILABLE`。

运行配置结构：`version:1`、`profile:"local-http-p2a"`、`purpose:"test"|"demo"|"ci"`、`origin:"http://127.0.0.1:<explicit-port>"`、32位hex `instanceId`；`database:{host:"127.0.0.1",port,name,user,password}`；`server:{version:180004,address,port}`。数据库名/应用角色分别是 `qf_db_<instanceId>` / `qf_app_<instanceId>`。连接端点总是loopback；仅CI允许记录独立的容器内部server地址/端口，必须与连接实际事实一致。marker为 `quizforge.p2a.v1:<instanceId>:<purpose>`。

早审后总控将origin显式端口收敛为1024..65535，避免URL规范化默认80端口与Host合同不一致。私有文件使用O_NOFOLLOW/O_NONBLOCK打开后fd.stat拒绝FIFO/非普通文件，并限制实际读取最多16KiB，避免先open FIFO阻塞或stat后文件增长。

postgres3.4.9对未显式固定的driver默认选项读取PG环境变量，早审因此发现ssl/debug污染风险。本流统一openSql用于app/owner/CI service，显式固定该版本完整defaults表及connection application_name/search_path，回归测试同时污染所有PG入口但不建立连接。没有为解决问题而修改生产进程的全局环境。

`getDatabase(): Promise<P2aDatabase>` 加载私有配置并验证实际数据库；`createDatabase(config)` 允许已加载的严格配置。返回 `{sql:postgres.Sql,db:PostgresJsDatabase<typeof schema>,config,close:()=>Promise<void>}`。调用者在 `finally` 中 `await close()`；事务用 `sql.begin(async tx=>...)` 或 `db.transaction(...)`。没有模块导入/构建时连接或全局缓存。数据库不可用及身份不匹配都关闭连接并抛统一错误。raw SQL须显式schema。

**时间返回形状不可混用**：drizzle(sql)会修改同一个postgres.js client的时间解析器。`db.select().from(operators)` 等Drizzle schema查询的timestamptz按Schema映射为Date；该P2aDatabase的 `app.sql` raw SQL相同字段实际返回string。原始postgres client（例如未经Drizzle的管理连接）还可能返回Date。应用服务必须用显式SQL `::text` 固定形状，并验证/解析成需要的时间类型；给tagged SQL加泛型不能改变真实返回值。真实数据库回归同时验证Drizzle Date、app.sql string及二者时间一致。

`src/lib/security/p2a-tokens.ts` 导出合同规定的 `issueToken(kind)`、`parseToken(raw,kind)`、`digestToken(raw,kind)`、`csrfForToken(raw,kind)`、`verifyCsrf(raw,kind,csrf)`。TokenKind为credential/preauth/session；CSRF仅preauth/session。32随机bytes/canonical base64url、摘要域和CSRF域按合同冻结；数据库及日志不能保存raw。

`openSql(connection)` 与 `verifyDatabaseIdentity(sql,config,role?)` 为管理/数据库测试的底层接口；应用服务应使用 `getDatabase/createDatabase`，不能绕过身份验证。管理配置不由Next加载。

## 管理与测试接口

所有命令从本工作树根执行。`pnpm p2a:db init --port 55421 --origin http://127.0.0.1:3100 --purpose test` 新建随机实例，启动并迁移；只接受test/demo，不得使用5432。`start/status/migrate/stop --instance <32位hex>` 核验私有manifest/PGDATA/server/marker/角色，仅管理自己实例。已停止status仅核验本地身份；无法连接数据库时不会声称数据库事实已验证。没有reset/drop或全局服务操作。

`manifest.json` 无secret，固定version/instanceId/purpose/mode/origin/root/port/pgdata/socket/runtimeConfigPath/adminConfigPath。`admin.json` 是 `{version:1,instanceId,owner:{host,port,name,user,password}}`，角色为 `qf_owner_<instanceId>`，非超级用户、无数据库/角色创建权限。`loadManagedInstance(id)` 验证两份配置与manifest；`openManagedDatabase(id)` 返回 `{manifest,config,admin,sql,close}`，先核验数据库身份。应用模块不导入management/admin配置。

PGDATA与socket均在新实例目录。为适应macOS Unix socket路径上限，PG配置使用 `../socket`，相对于PGDATA解析到manifest记录的同一私有socket目录；实际postmaster事实检查解析后再比对。只监听127.0.0.1，socket/loopback均scram认证，实例目录0700、配置/日志0600。每个新集群先实际检查postgres/initdb18.4与端口空闲，不杀未知进程。

`pnpm p2a:operator create --instance <id> --label synthetic-admin --role operator --credential-file <absolute-new-instance-file>` 只程序生成高熵credential；文件须为该实例目录下新0600文件，不能覆盖配置/日志。原文不进入stdout/DB/Git。文件写入失败或已知DB回滚仅清理本次拥有文件；COMMIT连接异常保留凭据并报 `BOOTSTRAP_OUTCOME_UNKNOWN_CREDENTIAL_PRESERVED`，不得自动重试。`disable --instance <id> --id <uuid>` 在同一事务停用身份、撤销会话、追加审计；重复停用不追加审计。初始化失败保留新实例并尝试停止自己刚启动的PGDATA；清理失败单独报错，不删除他人文件。

`migrateDatabase(sql,config,migrations?)` 持固定连接的session advisory lock，每个版本DDL与checksum记录同事务；重复不改变applied_at，已应用checksum变更/历史缺失拒绝。只执行受管 `migrations/p2a/*.sql`；可选definitions仅内部故障测试使用，无CLI任意SQL入口。列级授权冻结为operator SELECT、session SELECT/INSERT及四列UPDATE、audit SELECT/INSERT；无DDL/TEMP/DELETE/TRUNCATE/metadata权限。

共享fixture `tests/db/p2a-fixture.ts` 导出 `openTestDatabase(): Promise<{config,app,admin,close}>`、`TestDatabase`、`resetTestDatabase(database)`。app为公共P2aDatabase，admin为openManagedDatabase结果。必须显式设置QUIZFORGE_P2A_CONFIG；test/ci之外拒绝，缺失/错误配置、连不上或marker不匹配均失败，不自动创建或skip。reset每次重验配置、角色和server身份后，仅迁移角色TRUNCATE三业务表；测试文件由总控提供的Vitest配置串行。

`src/lib/db/auth-lock.ts` 公共接口 `acquireAuthWriteLock(tx:postgres.TransactionSql):Promise<void>` 使用两int `pg_advisory_xact_lock(72461,1)`。Auth的所有写事务和管理disable须先取得同一锁，再锁session/读取active/expiry/计数；不扩大operator SQL权限。disable已在该锁下停用及撤销，真实两连接用例验证login写入先获锁时随后停用能撤销新会话，停用先获锁时后续读取看到disabled。

停用在取得锁后只取一次DB `clock_timestamp()`，以保留微秒的文本传参同时固定disabled_at/revoked_at/audit.occurred_at，避开事务now()早于等待期间新session.created_at的约束失败；bootstrap审计也显式clock_timestamp。回归专门在disable开始等待后才创建新session，并断言撤销及三处时间一致。

## CI入口

`pnpm p2a:db:ci` 仅GITHUB_ACTIONS=true，专用ENV `QUIZFORGE_P2A_CI_HOST=127.0.0.1`、`QUIZFORGE_P2A_CI_PORT=<动态loopback映射端口>`、`QUIZFORGE_P2A_CI_USER=postgres`、`QUIZFORGE_P2A_CI_PASSWORD=<该job合成service密码>`、`QUIZFORGE_P2A_CI_DATABASE=postgres`。拒绝通用PG变量/DATABASE_URL作为输入；核验PG18.4、内部5432及pristine官方service默认角色/数据库，之后仅创建随机新purpose=ci库/角色/配置/marker并迁移。运行端点总是loopback；容器内部地址独立记录并重验。stdout仅JSON含runtimeConfigPath/adminConfigPath/instanceId；有显式GITHUB_ENV时追加QUIZFORGE_P2A_CONFIG路径。CI workflow及实际远端执行由总控提供，本流不冒称已通过CI。

## 验证与限制

普通测试验证严格token/CSRF、私有配置与CLI拒绝边界。真实PG测试验证三表/Drizzle、迁移重放/checksum/失败回滚/并发锁、二十项权限拒绝、合法四列更新/审计插入、时间/身份/digest约束、marker/server/role失败关闭、bootstrap文件补偿和停用幂等。Auth语义、并发登录/限流/touch-revoke、HTTP/CSRF与UI/E2E由Auth流和总控验收。

本机最初探针因inet文本掩码与postgres.js reserved连接运行时不提供begin方法而失败，实例被停止保留；修复为host(inet_server_addr())与保留连接上的显式BEGIN/COMMIT/ROLLBACK后，全新实例初始化已实际成功。保留实例不包含Git内容，也不等于演示运营库。最终检查结果与停止状态在交付时补记。

最终本流检查：format:check、lint、typecheck通过；普通单测24文件/409项通过，真实PostgreSQL18.4数据库测试39项通过（包含锁等待后实际clock停用回归）。test:db缺配置与目标已停止均实际exit1；demo实际exit1且其合成operator/audit各1条保持，未被测试清理。CLI已实际验证init/migrate重放/start/status/stop、operator create及两次disable（第二次changed:false）。所有本流启动的三个实例均已停止并保留0700私有manifest/config/PGDATA，测试端口55421已释放。

可恢复test实例为 `ea22f3cd3f343b56490e27e30bb87de5`，配置位于本工作树 `.cache/p2a/<id>/runtime.json` / `admin.json`；demo实例 `886c7d5a7cb2cd1f46811f67f8e20c87` 不可用于test:db。认证UI/E2E、build和完整阶段六项检查由总控集成串行执行。本机没有Docker CI service测试证据，CI入口仅完成拒绝边界与共享连接选项测试；官方固定镜像的远端bootstrap/GITHUB_ENV/job实际通过须由总控记录。没有创建PR、合main、部署或生产迁移。

## 最终审查修复：启动未知结果

初版仅在pg_ctl成功返回后记录started，遗漏“命令超时/拒绝但PG已启动”。init与管理start现在复用同一补偿实现：先核验本工作树私有PGDATA/version/marker，拒绝既有postmaster，取得新0600排他start.lock；每次启动通过 `-c cluster_name=<随机operation-tag>` 标记本次进程。失败后核对postmaster.pid的PGDATA/端口/socket/listen/PID/启动时间以及postmaster.opts中的本次唯一tag，确认才用匹配PGDATA的pg_ctl停止，并核验PID文件消失。确认与本次启动无关的进程不会停止；PID/事实/本次tag缺失或停止失败统一CLEANUP_REQUIRED，不能把瞬时无PID解释为没有延迟启动。未实际spawn且无PID的已知失败可明确NOT_STARTED。后续DB身份/初始化失败也仅补偿已记录相同PID/启动时间/tag的本次进程。

排他guard不覆盖或删除既有文件，释放前核对本次文件inode；并行/旧guard要求检查，不能通过隐式reset解决。生命周期函数的可选PgCommandRunner仅用于内部受控故障回归，CLI仍固定本机Homebrew路径，没有自定义二进制或任意执行入口。真实PG手工探针在实际pg_ctl start成功后注入失败，验证manage start和init均调用stop且PID消失；已运行实例拒绝时零启动/停止命令。受控用例另覆盖没有确认事实的超时、未spawn、foreign/old/replacement postmaster、缺失/错误operation tag及stop失败，不需等待真实长超时。

PUBLIC列授权疑点经真实PostgreSQL18.4实验未复现：分别向三表PUBLIC授予role/absolute_expires_at/outcome列UPDATE，app先可执行，再重放原迁移后全部拒绝，原合法四列UPDATE仍可用。PG18表级REVOKE同时撤销相关列权限；修正原错误注释，保留回归，未增加PUBLIC重复撤销SQL，也未修改已冻结迁移文件/checksum。

本次修复验证：format:check/lint/typecheck通过；25文件/422项普通单测通过（含13项受控启动失败回归），真实PostgreSQL18.4测试41项通过。缺QUIZFORGE_P2A_CONFIG实际exit1。真实启动成功后注入失败的探针分别证明管理start返回START_FAILED_INSTANCE_STOPPED、init返回已确认停止的INIT_FAILED_INSTANCE_PRESERVED，二者start/stop各一次；既有运行实例拒绝时零命令。加入operation tag后再次重复探针亦通过，健康start/数据库验证/stop也通过。测试实例最终已停止，55421无监听；两个本次真实init故障探针的新私有目录保留供检查，均确认postmaster.pid消失，未盲删目录。完整集成/Auth/CI由总控继续核验，本流没有修改CI或冻结迁移SQL。
