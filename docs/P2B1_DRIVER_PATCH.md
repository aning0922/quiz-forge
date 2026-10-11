# P2-B1 postgres 3.4.9 断连补丁

日期：2026-10-12。专项基线：`47f5f0e60ddbf52fa08a49ae1011215d24cc786d`；分支：`codex/postgres-disconnect`。本交付仅修改固定依赖补丁、依赖清单/锁文件、独立驱动故障测试及本文档，由总控集成。没有修改业务/Auth、创建 PR、合并 main、生产迁移或部署。

## 证据与方案

`postgres@3.4.9` 的 `begin()` 使用 `Promise.race` 等待用户回调或连接关闭；Promise 失败不能取消已执行的 JavaScript 回调。事务句柄持有可复用的 Connection 对象，关闭后的回调可能把查询或自动 COMMIT/ROLLBACK 写到替代连接。`nextWrite()` 另有延迟写入空 socket 的未捕获异常。这两层需要一起修复，单纯 socket guard 不足。

已核对官方固定版本源码 [index.js](https://github.com/porsager/postgres/blob/v3.4.9/src/index.js)、[connection.js](https://github.com/porsager/postgres/blob/v3.4.9/src/connection.js)，以及 [#1133](https://github.com/porsager/postgres/issues/1133)、[#1208](https://github.com/porsager/postgres/issues/1208)、[#1248](https://github.com/porsager/postgres/issues/1248)。[#1209](https://github.com/porsager/postgres/pull/1209/files) 和 [#1215](https://github.com/porsager/postgres/pull/1215/files) 是相关上游修复讨论，不作为已发布修复或本项目验收。补丁根据本地固定包独立审查和实现，未直接照搬 PR。

补丁行为：

- `begin` 在 BEGIN 实际执行时安装关闭处理。关闭/socket error/FATAL/PANIC 使整个事务作用域永久失效，并拒绝该作用域的私有排队查询。`savepoint` 继承相同失效状态，回调即使不再发查询、仅返回值，也不能报告成功。
- 旧事务后续查询直接 reject，回调的自动 COMMIT/ROLLBACK 被封锁；完成后的逃逸事务句柄也拒绝使用。失效状态在闭包中，替代 socket、其他事务或池重连不会把它恢复为有效。
- `reserve` 关闭或 release 后永久失效，清空私有队列。旧句柄的重复/晚到 release 不会释放替代 reservation。
- `execute` 与 `nextWrite` 检查 socket；延迟写入失败通过现有错误路径拒绝在途/已发送及私有排队工作。close/terminate 清空缓冲和计时器，防止旧字节留到新 socket。没有仅 return 后保留悬挂 Promise 的路径。
- FATAL/PANIC 立即进入错误路径，避免等待 socket close 的窗口继续处理事务。普通 SQL 错误仍保留正常回滚与 savepoint 行为。
- cursor 的异步回调捕获原查询和 socket；等待后及 catch 中检查身份，禁止写入替代连接。
- 健康事务可以在 `sql.end()` 开始后完成。只有实际失效使它永久拒绝；`end({timeout:0})` 的强制关闭也覆盖在专项测试中。

## 固定版本与入口

使用 [pnpm patch](https://pnpm.io/cli/patch) / [patch-commit](https://pnpm.io/cli/patch-commit) 生成 `patches/postgres@3.4.9.patch`，持久化为 `package.json` 的 `pnpm.patchedDependencies`，锁文件记录补丁 hash，安装使用 `pnpm install --frozen-lockfile`。依赖版本仍为 3.4.9，不修改全局 pnpm 设置；未开启忽略补丁失败。

该 npm 包 `exports.import`/`bun` 指向 `src/index.js`，`default` 指向 `cjs/src/index.js`。两套 `index.js` / `connection.js` 的增删内容逐项一致，专项测试分别通过原生 ESM import 和 Node createRequire 使用实际安装入口。Deno 不是本项目运行时，npm 发布文件也不包含 Deno 源码；不声明 Deno 验证。`workerd` 的 `cf` 入口未修改，本项目 Next.js Node 运行时不使用它。

上游许可为 [Unlicense](https://github.com/porsager/postgres/blob/v3.4.9/UNLICENSE)，固定包 package.json 同样标明 Unlicense。采用方式是已固定 npm 依赖上的受追踪差异补丁，不引入其他驱动或 DB 栈。

## 独立真实数据库故障测试

运行入口：`pnpm test:driver`，要求显式设置 `QF_DRIVER_TEST_INSTANCE` 为当前 worktree 管理的隔离 test/ci 实例 ID。缺配置立即退出 1，输出 `DRIVER_TEST_CONFIG_REQUIRED`，不 skip、不创建替代数据库、不读取其他 worktree 配置。

本次实例通过当前根目录 CLI 创建：

```sh
pnpm p2a:db init --port 55424 --origin http://127.0.0.1:3100 --purpose test
QF_DRIVER_TEST_INSTANCE=<本步骤返回的instanceId> pnpm test:driver
pnpm p2a:db stop --instance <同一instanceId>
pnpm p2a:db status --instance <同一instanceId>
```

先检查 55424 空闲；仅使用该实例。origin 是身份配置，未启动 HTTP、未占用 3100。每个场景是独立 Node 子进程，父进程设置 12 秒上限并拒绝非零退出、stderr 或不匹配成功标签。没有 `uncaughtException` / `unhandledRejection` 处理器；未捕获错误使子进程失败，超时强制终止也判失败，不吞错。

测试使用随机专属 schema/table 和合成标签。owner 创建并授予 app 最小 USAGE/SELECT/INSERT，app 控制连接只能终止同角色的测试后端，无超级用户、无 pg_signal_backend 授权。每次验证数据库身份，结束时删除本场景 schema。不 truncate 业务 fixture，不与 `test:db` 共用清理逻辑。父进程不转发原始错误/查询/参数，仅输出固定场景及成功/失败标签。配置、凭据、DSN 不进入输出或 Git。

初次交付为 ESM/CJS 各 15 场景、共 30 个。失效标记补充后各 23 场景，共 46 个通过（原 30 个全部保留）：

| 场景                                                | 验收证据                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| terminate-query/commit/rollback                     | 真实 `pg_terminate_backend` 成功并观察后端消失；旧回调在替代事务已打开时恢复；旧查询拒绝、无晚到自动提交/回滚、无旧行重放                                                                                  |
| terminate-savepoint                                 | 断连后新建 savepoint 及查询拒绝                                                                                                                                                                            |
| terminate-nested-commit/rollback                    | 已打开嵌套 savepoint 回调断连后返回/抛错，保留的 savepoint Promise 也必须拒绝                                                                                                                              |
| queued                                              | 在途、pipeline 和私有队列四个 Promise 全部拒绝；相关标签均未写入                                                                                                                                           |
| reserve                                             | 在途/pipeline/队列拒绝；旧查询拒绝；旧 release 无法释放替代 reservation，普通池查询保持排队直至新 reservation release                                                                                      |
| client-end                                          | 主动强制 client.end；事务失败，延迟旧查询拒绝，无晚到写入                                                                                                                                                  |
| timeout-active/idle                                 | 服务器真实 `transaction_timeout=150ms`，禁用 statement_timeout；活动和闲置回调均收到带失效标记的 `CONNECTION_CLOSED`，其原始 cause 必须为 FATAL / SQLSTATE `25P04`，后端消失、原事务回滚                   |
| cursor                                              | cursor 回调暂停期间后端终止；在替代事务打开后恢复，替代事务仍可查询和提交                                                                                                                                  |
| socket-write                                        | 真实 TCP socket 在 buffered execute 与 setImmediate 写入之间销毁，Promise 拒绝且无 buffered 写入；后续池查询可重连                                                                                         |
| destroy-transaction/reserve                         | 真实 socket 已销毁但 close 事件尚未触发时，首次查询检测即产生稳定失效包装；旧查询与事务 Promise 使用同一实例，无晚到回滚                                                                                   |
| inject-reset/no-code/frozen/primitive/fatal/reserve | 向真实 socket error 路径注入 ECONNRESET、无 code Error、frozen Error、primitive、未知 FATAL code 和 reserve 故障，再实际销毁 socket；在途/pipeline/队列/后续查询使用相同包装与原始 cause，原错误属性不改变 |
| graceful-end/compatibility                          | 无超时参数的 graceful end 有限时间完成且健康事务提交；普通事务、多层 savepoint、savepoint 回滚、reserve/release 正常                                                                                       |

每个可重连场景还验证新普通查询成功提交。替代事务保持开放时，旧回调恢复前后驱动 debug 构建计数不增加，证明旧查询/自动 COMMIT/ROLLBACK 没有进入发送构建路径；再回滚替代事务并验证旧行/晚到行/替代行均无落库。整个回调只执行一次，不重试原事务。

未补丁对照使用官方原始 3.4.9 包、相同场景临时副本（仅 `.cache`，不作为交付源码）：terminate-query、terminate-commit、cursor 失败，timeout-active 再现空 socket `write` 未捕获异常。补丁的通过不是应用临时 `end` workaround 的结果；测试直接使用驱动，清理 end 在故障与延迟回调验收之后执行。

## 实际检查与退出条件

- `pnpm install --frozen-lockfile`：通过；强制重新安装固定锁文件验证受追踪补丁可重新应用。
- `pnpm test:driver`：46/46 通过；无配置运行按预期失败，无静默 skip。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`：通过；单测 30 文件、452 测试。
- ESM/CJS 补丁增删内容一致；普通文件 `git diff --check` 通过。pnpm 生成的补丁 context 空行带一个协议空格，默认 diff 检查将这些空行报告为 trailing whitespace；对补丁仅关闭 blank-at-eol 后检查通过，实际补丁源文件无尾部空白，保留官方生成格式。
- 独立 Astra 静态审查指出的 graceful end、cursor 身份及 savepoint 关闭后错误报告成功问题已修复并加入回归。
- `pnpm test:db` / `pnpm test:e2e`：专项分支不运行，按总控指令在集成后执行；不以本地专项结果冒称全局 DB/Auth/domain/E2E、CI、视觉、商业或发布通过。
- 55424 专属实例交付前停止并通过 status 确认 stopped；不占用 3100。

## 维护代价与剩余风险

这是本项目自行维护的固定版本补丁。升级 postgres、改变 exports、切换运行时前，需要重新审查补丁并重跑真实断连及兼容场景；上游存在相关讨论，不代表本地实现已被上游接受。测试集中于 Node ESM/CJS、单连接池强制复用和 PostgreSQL 18.4，不是整个驱动测试套件或多主机/TLS/复制协议的完整认证。

JavaScript 回调本身不会被强制取消。它仍能执行非数据库副作用，本补丁封锁的是失效事务/reserve/savepoint 查询和相关自动事务控制。COPY/stream/largeObject 的独立协议回调没有被本轮扩展和验证；应用不得将本验收推广成这些接口的断连安全承诺，未来使用前需专门审查。两阶段 prepared transaction 未配置/验收，本轮不改变其接口。

连接中断恰好发生在 COMMIT 后、客户端确认前时，提交结果仍可能未知。此补丁不提供“所有失败都确定未提交”保证，不授权业务层盲重试；业务仍需事务、唯一约束、幂等和结果核实策略。

总控接入后移除临时故障规避，重新运行 DB/Auth/domain 与全套工程验收，再安排独立整体验收。本分支提交/推送后停止，不创建 PR 或推进其他业务工作。

## 失效错误标记补充（基于 ec531518）

总控独立复审指出：只按错误 identity 判断“与 callback 原错误相同，所以已成功 ROLLBACK”不成立。断连时旧实现可能重新抛出原始 callback/socket 错误，而 ROLLBACK 实际没有发出；ECONNRESET、无 code Error 或未知 FATAL SQLSTATE 也无法靠错误码穷举可靠分类。本补充仅改补丁、锁哈希、独立测试及本文档，不改 package 脚本、CI 或业务文件。

`begin` / `reserve` 首次 invalidate 时创建一个新的 `Errors.connection('CONNECTION_CLOSED', options)`，增加以下本地扩展：

```ts
// 属性均由 Object.defineProperties 设置为 non-enumerable / readonly / non-configurable。
error.quizforgeConnectionInvalidated === true;
error.code === "CONNECTION_CLOSED";
error.cause === originalError;
```

每个失效作用域后续复用同一 Error 实例；包装不修改原始错误，支持 frozen Error 与 primitive。原始 SQLSTATE 保留在 `cause.code`，不保留到顶层 code；顶层固定分类为 CONNECTION_CLOSED。没有从原错误复制 query/parameters；驱动随后附加到包装上的 query/parameters/args/types 即使 debug 打开也非枚举，cause 与 marker 同样不会进入 JSON 枚举输出。cause 仍可能包含诊断数据，业务日志继续使用安全固定分类，不能直接记录完整 cause。

socket error/FATAL/延迟写入失败使 invalidate 返回该包装，现有在途/已发送查询也使用它；私有排队查询与旧句柄查询使用相同实例。`execute` 对已销毁 socket 的首次检测同样走这一错误路径，即使 close 事件尚未派发也可识别。显式池 destroy 调用 `terminate(true)`，使尚无在途查询的 reservation 同步失效；正常 ReadyForQuery 后的 terminate 不强制失效，避免把已成功 COMMIT 的 graceful end 报成失败。cursor 同查询/同 socket 的首次关闭检测也使用包装，遇到替代查询/socket 时不触发替代作用域的 invalidate。

业务整合应先识别 marker / connection code，再判断普通 callback 原错误的 identity。正常 callback 抛错且 ROLLBACK 成功的路径仍抛出同一个原错误，不附加失效 marker；兼容测试验证这一点。标记代表作用域已失效，不代表“已确定未提交”，也不改变 COMMIT 确认丢失时的未知结果边界。

新增 16 个 ESM/CJS 子进程验收：两类 destroy-before-close 场景以及六类原始错误注入。注入只用于覆盖真实 socket 的 error 分支，随后真实销毁连接；它不代替原有 pg_terminate_backend 和服务器 transaction_timeout 故障。事务 callback 故意重新抛出与 cause 完全相同的原错误，外层必须收到不同的稳定包装；查询队列和晚到查询必须收到同一包装，驱动构建计数证明恢复 callback 后没有 ROLLBACK/COMMIT 发送。错误对象前后 own property descriptors 完全一致；服务端 FATAL 25P04 在真实超时场景中通过 cause 精确验证。

`quizforgeConnectionInvalidated` 是 QuizForge 自行维护的驱动扩展，上游类型声明不提供该属性。消费者应从 unknown 做属性检查，不能依赖 Error 文案、具体 SQLSTATE 列表或完整 cause DTO；未来升级驱动时必须审查这个合同、两入口一致性及首次检测路径。其他运行时和 COPY/stream 的限制沿用上文。

补充交付验证：46/46 专项、冻结安装、格式、lint、类型、452 单测和构建通过；独立 Astra 复核确认 marker、首次检测和 graceful end 的整改均已落实。55424 同一专属实例停止，status 确认 stopped；本补充未运行全局 DB/Auth/domain/E2E 或声明 CI 通过。
