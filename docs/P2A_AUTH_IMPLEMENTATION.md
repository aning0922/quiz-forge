# P2-A Auth / Studio 实施记录

日期：2026-10-12（Asia/Shanghai）。工作树 `p2a-auth-studio/quiz-forge`，分支 `codex/p2a-auth-studio`，基线 `01e63bf0799ca856b17b9bed3a00d59db79abf26`。正式 origin 为 `aning0922/quiz-forge`；原工作树没有修改。

## 独立 HTTP 里程碑

已实现严格本地 profile / Host / 写 Origin / API Fetch Metadata 校验、实际 4096 bytes 和 5 秒总读取期限、UTF-8 与 JSON 格式拒绝、严格空对象和登录 DTO、稳定错误响应（code/requestId、no-store、无原始异常、限流 Retry-After）。来源校验不读取代理头。

服务端能力函数只接受经过服务验证的 actor；operator/read-only 都能 studio:read，其余冻结的五项写能力仅 operator 可用。无 publish/key 能力。客户端 DTO 不包含 cookie 原文或数据库配置。

最小后台组件有独立样式、masked 输入、等待/错误/不可用、身份/角色/期限与真实 API 退出交互。正文 16px 起、输入/按钮 48px；没有未来业务按钮。组件尚未接入路由，不能作为数据库或登录交付证据。

读取期限修正：使用 performance.now() 的绝对截止时间，在每次读取前后、解码/解析前后及最终返回点校验；每 32 次读取让出事件循环。固定 4096-byte 缓冲区替代 chunk 数组，空 chunk 不累积。取消不等待不受控 stream，cleanup 不泄漏原始异常。

验证：13 项针对性单测通过，新增到期 read、解析耗时跨期限、连续空 chunk 微任务及不结束 cancel 回归；format/lint/typecheck/test 通过（全库 398 项）。全套检查、数据库测试与浏览器图检待真实接口接入后执行。HTTP 测试只验证纯边界，不替代真实 Postgres 事务或浏览器验收。

## 待接入与限制

等待 DB 流的精确 schema/runtime/client/crypto exports 后实现四个 Handler、服务事务和两页组合。尚无认证持久化、真实登录/退出、会话撤销/到期、并发限流或数据库测试结果。不得以组件或纯逻辑冒称 P2-A 完成。

3100 与生产 E2E 由总控独占。本聊天不运行 E2E，不创建 PR、不合并 main、不部署；真实 DB 测试只使用新建 purpose=test 的本任务隔离实例（预留端口 55422），结束后停止自己的集群。
