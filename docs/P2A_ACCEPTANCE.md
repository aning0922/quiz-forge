# P2-A 验收记录

日期：2026-10-12（Asia/Shanghai）。状态：P2-A 技术验收通过。基线为 P1 最终 `e63df6439fc48f61f2011ddb3516b9b88d67988f`；集成分支 `codex/studio-foundation`，最终代码 `720b982ae486dbe7349dfa7034367cf8a6c76875`。[Draft PR #8](https://github.com/aning0922/quiz-forge/pull/8) 基于 P1 分支，依赖 #7/#6，未合并 main。退出标准见 [冻结合同](STUDIO_P2A.md)。

## 范围

本机隔离 PostgreSQL 生命周期、可重放事务迁移、运营身份与会话、独立权限和审计、真实登录退出及最小 Studio。普通实现由两条 GPT-6.1 Sol/high 聊天负责；架构合同与独立审查使用 GPT-6 Astra/high，总控负责集成和最终验证。

Product 工作区、目录、资源和草稿持久化、隔离导入、送审、确定性评分、消费者 Key 与报告不属于本里程碑交付。它们仍按已经授权的 P2-B 至 P5 推进；本页不将未实现能力视为完成。

## 当前证据

| 项目               | 当前结果                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 普通检查           | 最终29文件、442项单测通过，包括13项启动故障和5项CI清理回归                                   |
| 真实 PostgreSQL    | 总控新建专属PG18.4实例，2文件、57项通过（DB41、Auth16）                                      |
| 完整认证事务与路由 | 四个auth API、/studio/login、/studio已接真实DB，operator/read-only登录退出实际通过           |
| 六项工程检查       | 最终代码的format:check、lint、typecheck、test、build、test:e2e全部通过；另test:db通过        |
| 真实浏览器与截图   | 189项Chromium E2E通过、10项既有跳过；四移动宽度及加载/失败/真实停库图检见P2A_VISUAL_CHECK.md |
| 独立审查           | Astra high复核无剩余P1/P2；独立55项DB及最终57项定向单测通过，详见P2A_REVIEW.md               |
| Draft PR / CI      | #8保持Draft；代码720b982的CI38163271691两个job均实际success；后续纯文档head的Checks另核      |

## 已执行的验证与失败修复

数据库：新建专属 purpose=test 实例，验证 manifest/库 marker/版本/角色；迁移重放无变化，checksum 篡改拒绝，失败事务回滚。应用身份不能 DDL、写运营身份、改删审计或改会话身份/absolute 到期。缺配置、身份不匹配及 demo 配置不能作为测试库。

认证：两独立连接同时消费一个 preauth 只能一次成功；凭证或 CSRF 不可跨 kind/session 复用；停用、撤销、idle/absolute 到期生效；touch 不复活已失效会话。失败次数与全局限流用真实事务验证。只读角色不能调用写能力。

HTTP：错误或缺失 Host/Origin/CSRF、Fetch Metadata、实际 4 KiB/5 秒读取、未知 DTO 字段、配置或 DB 不可用均返回冻结错误。成功与失败都 no-store，不在响应、日志或浏览器产物泄漏认证原文。

浏览器：生产构建、独占 3100、真实登录退出；空输入、错误、不可用、只读/运营者和到期状态；320/375/390/430 CSS px 无横向溢出，正文至少 16px，目标至少 44px。认证项目关闭 trace/video/自动截图，仅保存空输入或非敏感会话状态图；由助手实际查看图片并记录视口、状态、浏览器和结论。助手图检不能替代作者最终视觉批准。

最终工程检查：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:db`、`pnpm test:e2e`均通过。总控日志在忽略的 `.cache/p2a-final-check.log` 和 `.cache/p2a-final-db.log`。最终E2E189通过/10既有跳过，耗时59.3秒；认证项目3项无跳过。独立审查的55项DB发生在最后两项DB接口/权限回归加入前，不冒称其已独立执行57项DB。

初次Auth联调因Drizzle改变同一raw SQL客户端的时间解析形状而失败，已显式转换并真实复测；初次全量E2E为188通过/1个测试拦截器竞争失败/10既有跳过，修正后目标3项与最终全量均通过。HTTP绝对期限、FIFO读取、端口一致性、PG环境污染、CI凭证/context/清理回执和启动未知结果均已修复；PUBLIC列权限疑点经真实PG实验排除，仅保留回归并纠正注释。

总控集成实例 `4719eca6e393bda8a14a1abbdc7d7658` 为purpose=test，端口55423；结束时受管stop/status均确认stopped，55423/3100已释放，私有manifest/config/PGDATA保留可恢复。开发线55421/55422实例也已分别停止。没有自动运行后台进程。

[代码head CI38163271691](https://github.com/aning0922/quiz-forge/actions/runs/38163271691) 的checks与database均success；数据库job实际拉起固定digest的官方镜像、完成bootstrap/迁移/真实测试并清理，不以配置文件存在代替CI成功。

## 运行与交付限制

仅支持 `local-http-p2a` 精确 loopback 环境，运营身份为本机合成身份；不作为生产认证、外部身份、远程管理或消费者授权。配置和凭据仅在私有忽略目录中，不加入 Git。数据库和浏览器进程在验收后停止，保留可恢复实例标识。

main 未合并、没有生产迁移/外部部署/商业发布。首款四卡内测草案已由作者选定，独立内容分支保存；该决定不替代正式评分、素材与视觉验收。
