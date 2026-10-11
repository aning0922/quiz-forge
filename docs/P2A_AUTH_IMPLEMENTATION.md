# P2-A Auth / Studio 实施记录

日期：2026-10-12（Asia/Shanghai）。工作树 `p2a-auth-studio/quiz-forge`，分支 `codex/p2a-auth-studio`，基线 `01e63bf0799ca856b17b9bed3a00d59db79abf26`。正式 origin 为 `aning0922/quiz-forge`；原工作树没有修改。

## 独立 HTTP 里程碑

已实现严格本地 profile / Host / 写 Origin / API Fetch Metadata 校验、实际 4096 bytes 和 5 秒总读取期限、UTF-8 与 JSON 格式拒绝、严格空对象和登录 DTO、稳定错误响应（code/requestId、no-store、无原始异常、限流 Retry-After）。来源校验不读取代理头。

服务端能力函数只接受经过服务验证的 actor；operator/read-only 都能 studio:read，其余冻结的五项写能力仅 operator 可用。无 publish/key 能力。客户端 DTO 不包含 cookie 原文或数据库配置。

最小后台组件有独立样式、masked 输入、等待/错误/不可用、身份/角色/期限与真实 API 退出交互。正文 16px 起、输入/按钮 48px；没有未来业务按钮。最初里程碑没有路由或数据库交付，完整接入证据见下方。

读取期限修正：使用 performance.now() 的绝对截止时间，在每次读取前后、解码/解析前后及最终返回点校验；每 32 次读取让出事件循环。固定 4096-byte 缓冲区替代 chunk 数组，空 chunk 不累积。取消不等待不受控 stream，cleanup 不泄漏原始异常。

验证：13 项针对性单测通过，新增到期 read、解析耗时跨期限、连续空 chunk 微任务及不结束 cancel 回归；format/lint/typecheck/test 通过（全库 398 项）。全套检查、数据库测试与浏览器图检待真实接口接入后执行。HTTP 测试只验证纯边界，不替代真实 Postgres 事务或浏览器验收。

## 真实认证接入

公共 DB 接口依赖 `1991271bd98f71985ed4612cd2734809c99b5059`，生命周期/公共锁/共享 fixture 依赖 `d57eac52cc26aceae0da6794b62369f469b1b8b4`。本工作树分别 cherry-pick 为 `3f22dc2` / `46d8b7c`；Auth 提交仅包含自有文件，总控集成已有 DB 实现后只需挑选 Auth 提交。

四个冻结 API 已接入真实 Postgres：preauth、login、session、logout；两页 `/studio/login` 与 `/studio` 使用独立后台 layout，RSC 只读取会话，不写 Cookie。缺配置、错误来源或 DB 不可用时页面不显示已登录身份。Route Handler 在服务事务提交后才设置/清理 Cookie；响应只有冻结 DTO 或稳定 code/requestId，无原始 token/DB 配置。

Auth 写事务统一调用 `acquireAuthWriteLock`，锁先于计数、状态/行读取和写入；登录另外锁 preauth 行，消费旧挑战并插入独立的新 session。失败计数和审计提交后才返回认证失败，5 次撤销。预认证最多每滚动 60 秒 20 个、100 个未到期；凭证失败每 60 秒最多 10 个，达到限额不追加无限审计。read-only 可登录/读取/退出，冻结写能力在数据源拒绝；角色从 operator 每次读取。

会话读取使用带未撤销、idle/absolute 有效和 operator active 的条件 UPDATE。管理停用与认证使用同一事务锁，停用/撤销后不能 touch 复活。到期及审计使用实际 DB `clock_timestamp()`，避免锁等待前的事务 now() 进入限流窗口或延长到期。HTTP 端口严格 canonical 1024..65535。

首轮真实测试发现 raw SQL 的时间字段被 Drizzle transparent parser 返回为字符串，而 `$inferSelect` Date 类型适用于 Drizzle 查询。本流为 raw SQL 显式声明 string/Date 并转换有效 Date，修复后全部真实用例通过；不修改共享 DB 层，也不输出异常正文。

## 实际验证

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。普通单测 **27 文件 / 424 项**；build 时未提供 DB 配置，既有研究路由继续构建，Studio/API 为动态路由。
- `pnpm test:db` 使用新建专属 PostgreSQL18.4 实例，**2 文件 / 55 项**通过：DB 流 39 项 + Auth 16 项。
- Auth 真实用例覆盖两独立连接消费同一 preauth 只成功一次、挑战 5 次失败及到期/撤销、idle/absolute/disabled/revoked、即时角色变化与只读拒写、旧挑战与跨会话 CSRF、停用对 login/touch 和 revoke 对 touch、审计等待锁后时刻、预认证和失败限流竞争及审计上限、100 个未到期 cap、实际 HTTP Cookie/DTO/Host/Origin/CSRF、实际 4096 bytes 和 5 秒停滞 body。
- 缺配置和实例停止后的 Auth DB suite 均实际 **exit 1**；停止实例后的真实 Handler 返回 **503 STUDIO_UNAVAILABLE**，没有假成功。
- 私有 E2E helper 已实际 prepare/cleanup 成功；错误 runId cleanup 实际 exit 1。只允许本轮 runId 对应新建私有文件的清理；文件0600、创建 O_EXCL/O_NOFOLLOW，stdout/stderr 只固定状态，credential 文件已清理。fixture 只接受 test/ci。

本任务实例 `3e9d2fbc262e3716fe6e7b793fd6fdd5` 使用专属端口 **55422**，purpose=test、origin=http://127.0.0.1:3100。已通过受管 CLI 停止，保留私有可恢复 manifest/config/PGDATA；没有操作其他集群。

## 总控待验收与限制

3100 与生产 E2E 由总控独占，本聊天没有启动 3100、运行 E2E 或拍摄浏览器截图。`studio-auth.spec.ts` 为单独 studio-auth 项目准备 operator/read-only 真实登录退出，320/375/390/430 空输入和已登录非敏感截图；trace/video/自动失败截图关闭，无 HAR。通过独立 react-server helper 生成私有合成凭证，Playwright 不导入 server-only 模块；输入避开可在失败 call log 打印 secret 的 locator.fill。总控应串行执行 DB suite 和 E2E，检查真实截图与移动约束，程序通过不代替视觉或作者批准。

尚未执行本阶段独立审查或远端 CI，不创建 PR、不合并 main、不部署。没有 Product/导入/审核/发布/Key 功能；普通消费者身份与本地运营身份隔离。P2-A 整体验收仍由总控六项检查、实际浏览器图检、独立审查和 CI 决定。
