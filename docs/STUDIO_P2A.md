# P2-A：本地数据库与运营认证合同

2026-10-12，先文档后实施。基于 P1 最终 e63df6439fc48f61f2011ddb3516b9b88d67988f，CI 38159199724 已实际 success。Astra high 前置决策，普通实现分独立 Sol high 聊天，总控集成。状态：合同冻结，尚无数据库/认证实现。

## 范围与交付

实现隔离 PostgreSQL 生命周期、可重复迁移、独立运营身份/会话/审计、登录退出及最小 Studio 两页。新增真实数据库集成检查，不用空表或假成功 UI 冒称后台。Product/目录/草稿/导入留 P2-B，结构预览/送审留 P2-C；本里程碑没有消费者授权、发布、Key、第三方身份或远端开放。

唯一 profile 为 local-http-p2a；仅精确 http://127.0.0.1:<显式端口>，绑定 loopback。拒绝 localhost 别名、通配符、代理推导和非本地 profile。Next 构建与模块导入不连接 DB；缺失/错误配置时 Studio 明确不可用，研究页面照常构建。

## 固定认证政策

| 项目                | 值                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 运营角色            | operator / read-only，全局单运营空间；不声称逐 Product 人员 ACL                                                                |
| 登录凭证            | 32 随机 bytes，canonical base64url，前缀 qfo_p2a_；仅程序生成，不接用户自选密码                                                |
| preauth token       | 独立 32 bytes，前缀 qfp_p2a_，5 分钟、最多 5 次失败、不续期                                                                    |
| authenticated token | 独立 32 bytes，前缀 qfs_p2a_，idle 30 分钟、absolute 8 小时；每次登录换新                                                      |
| Cookie              | qf_local_p2a_preauth / qf_local_p2a_session，HttpOnly、SameSite=Strict、Path=/、无 Domain；本地 HTTP profile 显式 Secure=false |
| Cookie Max-Age      | preauth 300 秒，session 28800 秒；数据库到期是权威                                                                             |
| 请求 JSON           | 实际 4 KiB / 5 秒，strict DTO，未知字段拒绝，不信 Content-Length                                                               |
| 限流                | 全局每滚动60秒最多20 preauth创建、10凭证失败；最多100未撤销且未到期preauth                                                     |

token digest = SHA256(UTF8("quizforge.p2a.token.v1:" + kind + ":") || decoded32bytes)，kind 为 credential/preauth/session。原始 token 不落库/日志。CSRF = base64url(HMAC-SHA256(decodedCookieTokenBytes, UTF8("quizforge.p2a.csrf.v1:" + kind)))，kind 仅 preauth/session，不从数据库摘要派生。严格解码、重编码一致，CSRF constant-time 比较；只通过 X-CSRF-Token 提交。

共享纯 token 工具由 DB 流先交付 src/lib/security/p2a-tokens.ts，供 bootstrap 和 Auth 复用：issueToken(kind) 返回 {raw,digest}；parseToken(raw,kind) 返回 Buffer|null；digestToken(raw,kind) 返回 string|null；csrfForToken(raw,kind) 返回 string|null；verifyCsrf(raw,kind,csrf) 返回 boolean。不引入 JWT/密码库，不将高熵 token 摘要方案挪用到人类密码。

## 三张业务表与数据库约束

专用 qf schema，UUID 由 Node 生成，时间 timestamptz。所有 digest 必须64位小写hex；不存姓名/邮箱/任意 metadata。迁移元数据另放 qf_meta.schema_migrations(version,checksum,applied_at)，不是业务能力。

- operator：id uuid PK；label varchar(64) UNIQUE NOT NULL，限定合成本地标识（小写字母/数字/连字符）；credential_digest char(64) UNIQUE NOT NULL；role、status NOT NULL（active/disabled）；created_at NOT NULL DEFAULT now()；disabled_at nullable。active 时 disabled_at null，disabled 时不为 null。不硬删除。
- operator_session：id uuid PK；token_digest char(64) UNIQUE NOT NULL；kind(preauth/authenticated)；operator_id nullable FK operator ON DELETE RESTRICT；created_at/last_seen_at/idle_expires_at/absolute_expires_at NOT NULL；revoked_at nullable；failed_attempts smallint default0。preauth无operator，authenticated必有operator且failed_attempts=0；失败次数0..5。created_at≤last_seen_at<absolute，created_at<idle≤absolute；preauth absolute=created+5m、idle=absolute；authenticated absolute=created+8h、idle≤last_seen+30m；revoked_at≥created_at。索引(operator_id,revoked_at)、absolute_expires_at。
- audit_event：id uuid PK；occurred_at NOT NULL DEFAULT now()；action/outcome NOT NULL；reason_code nullable；actor_id nullable FK operator RESTRICT；session_id nullable uuid（刻意无session FK，避免清理会话改动审计）；request_id uuid NOT NULL。action限bootstrap/operator_disabled/preauth_created/login_succeeded/login_failed/logout/session_revoked；outcome限success/rejected；reason限AUTHENTICATION_FAILED/PREAUTH_EXPIRED/PREAUTH_REVOKED/RATE_LIMITED/SESSION_EXPIRED/SESSION_REVOKED/OPERATOR_DISABLED/MANUAL或null。无自由文本、JSON或secret。索引(action,occurred_at)。

DB 流先交付 schema.ts（导出 operators/operatorSessions/auditEvents）及 runtime/client 公共接口，明确实际 TypeScript 类型后独立提交给 Auth 流。认证语义与表列按本文固定，细节不得各自改 SQL。

## 预认证、会话与权限

预认证复用 operator_session，不增加 challenge 表。/studio/login 的 Server Component 只渲染；Client 同源 POST preauth 建匿名challenge并取得CSRF。唯一不带旧CSRF的写端点是preauth，只能创建5分钟匿名挑战；仍检查Host/Origin/JSON/限额/限速。已有有效authenticated会话则409 ALREADY_AUTHENTICATED，不换cookie。

登录事务锁preauth行，重验未撤销/未到期/次数，核验随机credential对应active operator；撤销preauth，创建全新authenticated session，写成功audit，提交后才发新cookie/清preauth。旧行永不原地升级；两个连接竞争同preauth只能一个成功。失败统一AUTHENTICATION_FAILED，不暴露不存在/停用身份；失败计数达到5撤销。

touch必须在条件更新中包含未撤销、idle/absolute仍有效和operator active；idle=min(DB now+30m,absolute)，不能无条件更新复活会话。角色每次从operator读取。写请求先验证Origin/CSRF，再touch；没有定时保活。登录响应丢失时允许重新建立challenge，未知session原文不可恢复，孤立会话自动到期。

限流用数据库事务 advisory lock 串行检查计数/插入，不能无锁 count→insert。依据audit/session计数，不存IP；429 Retry-After:60，达到限制不无限追加audit。

requireCapability(actor,capability)：两角色允许studio:read；仅operator允许workspace:write/draft:write/import:create/review:submit/review:return（未来能力名，不创建业务按钮）。没有publish/key能力。actor只能来自服务端有效会话，浏览器角色/ID不得授权。

## HTTP与页面合同

| 入口                          | 行为                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/studio/auth/preauth | strict {}；201 {csrfToken,expiresAt}，写preauth cookie                                                                                |
| POST /api/studio/auth/login   | strict {credential} + preauth cookie/CSRF；200 {operator:{id,label,role},csrfToken,idleExpiresAt,absoluteExpiresAt}，换session cookie |
| GET /api/studio/auth/session  | 当前有效session摘要，同login响应字段；不泄漏token/DB记录                                                                              |
| POST /api/studio/auth/logout  | strict {} + session/CSRF；事务撤销并audit后204，清cookie                                                                              |
| /studio/login                 | masked登录输入、真实错误/等待/不可用状态，不显示secret或假成功                                                                        |
| /studio                       | 真实合成运营身份、角色、到期信息、退出、本地环境说明；无未实现工作区/导入/发布按钮                                                    |

所有Studio页面/API固定Host等于配置host；写入Origin必须精确匹配，缺失/null拒绝。不信X-Forwarded-*。认证API的Sec-Fetch-Site如存在只接受same-origin；页面正常导航可无Origin。全部no-store、不开放CORS。JSON错误稳定code/requestId，不含原始错误/SQL/路径/DSN。API格式400、未认证401、Origin/CSRF403、已登录preauth409、超量413、限流429、配置/DB不可用503。RSC页面在缺配置时可呈现明确的不可用说明，不能展示已登录身份或声称服务就绪；不为返回页面状态码引入绕过业务授权的代理。

认证服务 server-only；Route Handlers只做HTTP边界并调用服务，页面layout检查不代替数据源授权。cookie写删只在Handler，不在RSC渲染期间。客户端DTO不能引用包含raw token或DB config的内部类型。

## 私有配置与本地集群

唯一环境入口 QUIZFORGE_P2A_CONFIG=/absolute/private/runtime.json；禁止读取/fallback DATABASE_URL。私有文件0600、无symlink、项目专属忽略目录；配置strict含版本/profile/origin/instanceId/数据库名/app连接及预期server事实。管理连接单独admin配置，Next不读取。错误只STUDIO_UNAVAILABLE，不输出连接串。

实例目录 .cache/p2a/<random-instance-id>/，0700，新建且禁止覆盖。本机PG18.4，指定PGDATA/socket/显式非5432端口/127.0.0.1/scram认证/随机密码，不用brew services、不触现有DB或全局文件。database comment记录instanceId；每次CLI管理/迁移操作核对manifest、DB名、角色、comment及server事实。stop仅对匹配PGDATA执行pg_ctl，不按未知PID杀进程、不提供隐式reset/drop。

端点地址与数据库内部server地址/端口分开验证：本机二者相同；CI Docker loopback映射端口可能不同于容器内5432。CI bootstrap只连显式本次service，记录其已确认server事实和唯一marker；不能把允许内部容器地址变成任意远端DB许可。迁移应用事务内带version/checksum，并持连接级串行锁，重复无变化，checksum改变拒绝。

脚本接口：p2a:db init --port <port> --origin <loopback-url> --purpose <test|demo>；start/status/migrate/stop --instance <id>；p2a:operator create --instance <id> --label <synthetic-label> --role <operator|read-only> --credential-file <new-private-file>；disable --instance <id> --id <uuid>。不接受用户指定credential，原文仅写新建0600文件，stdout不输出。写DB失败清理本次秘密文件；其他文件/目录不得覆盖。CI另有显式service bootstrap入口，不成为日常连接任意DB后门。

## SQL权限与测试

owner/migrator和app登录分离，app非owner/超级用户、无CREATEDB/CREATEROLE/BYPASSRLS/继承提权。撤销PUBLIC数据库CREATE/TEMP、schema CREATE；app只有CONNECT和qf USAGE。operator仅SELECT；session SELECT/INSERT，UPDATE仅last_seen_at/idle_expires_at/revoked_at/failed_attempts；audit SELECT/INSERT，禁止UPDATE/DELETE/TRUNCATE；qf_meta无app写权限。SQL使用显式schema名。

新增test:db真实PG测试，配置缺失/连不上/marker或版本不匹配必须exit1，不静默skip或内存替代。普通test仍不需要DB。CI独立database job使用固定官方postgres:18.4 digest，动态loopback映射端口及健康检查，创建本次合成role/config/marker，冻结迁移和test:db。具体脚本/测试配置由DB流先交付，根package和CI由总控接入。

必验：迁移重放/checksum/失败回滚；app DDL、operator写、audit改删、session身份或absolute修改拒绝；两连接同时消费preauth；旧token/跨session CSRF拒绝；撤销/停用/两种到期；touch与revoke竞争；缺错Host/Origin/CSRF、4KiB真实字节、并发限流；read-only不能写；无配置页面/HTTP明确不可用，build不连DB。总控六项检查+独占3100真实登录退出E2E+320/375/390/430截图和助手实际图检。

认证E2E必须关闭trace/HAR/video；自动失败截图不得捕获凭证输入。手工UI截图只拍空输入或登录后的非敏感状态。禁止日志/附件出现request body、cookie、Authorization、CSRF、Set-Cookie、DSN、credential文件原文或原始异常。合成身份不是允许泄漏认证secret的理由。

## 文件所有权和里程碑

DB流：src/lib/db/**、src/lib/security/p2a-tokens.ts及测试、migrations/p2a/**、scripts/p2a-db*与p2a-operator*、tests/db/**（DB自己的测试文件与shared fixture）、docs/P2A_DATABASE_IMPLEMENTATION.md。先提交类型/schema/runtime/crypto公共接口，再继续脚本/权限/真实DB测试。

Auth流：src/lib/auth/**、src/lib/http-security/**、src/features/studio/**、src/app/(studio)/**、src/app/api/studio/**、tests/db/p2a-auth*.test.ts、tests/e2e/studio-auth.spec.ts、docs/P2A_AUTH_IMPLEMENTATION.md。收到DB公共接口提交后接入；最终必须真实DB，开发double不计验收。

总控：package/lock、CI、环境/测试配置、阶段文档、集成实例/3100和最终验收。DB基础迁移只有DB流单写者；Auth需列/权限变更先反馈。两实现流不得修改彼此文件或共享配置，不恢复旧暂停任务。检查后各自提交push，由总控集成、Astra独立审查、Draft PR及CI；主线合并/生产迁移/部署仍不自动执行。

## 集成交接补充

runtime/manifest固定purpose=test/demo/ci；test:db只接受test/ci，拒绝demo，不能把人工演示库当测试清理目标。init必须显式origin与purpose，端口分别为数据库port和origin的HTTP port。CI purpose=ci仅由本job bootstrap生成。

CLI通过node --conditions=react-server --import tsx运行，生产server-only标记保留。总控提供vitest.config.ts和vitest.db.config.ts的Node测试专用server-only别名、tests/support/server-only.ts；DB/Auth不得自行改共享配置。test:db逐文件串行，但并发场景在测试内用真实独立连接；缺配置必须失败，不能因没有匹配测试而当验收成功。

DB流本机专属测试端口55421，Auth流如需独立测试实例使用55422；总控集成用55423，使用前各自验证空闲，冲突则报告并选新显式端口，不停止未知进程。HTTP3100仅总控最终E2E占用。目录/配置/DB只能属于本任务新建实例，测试后停止自己启动的集群并保留可恢复manifest。
