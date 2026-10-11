# QuizPack 媒体隔离：独立 launcher 可行性合同

日期：2026-10-12。审阅基线：`codex/quizpack-receipt` / `f070428`。状态：**实验范围、共享接口和所有权已冻结；平台策略尚待实测，未实施验收通过**。B2-1最终文档head `5caef260e0f17e3db02df911e3a4f1014012e081` 的CI38175221128已核实checks/database均success，总控接续本独立里程碑。仅允许本合同的有限可行性实验；B2-2业务接入须本里程碑通过后才开始，普通工程推进仍在既有托管授权内。

依据：[B2-2 提案与已选 Option B](STUDIO_P2B2_VALIDATION_PROPOSAL.md)、[B2-1 合同](STUDIO_P2B2.md)、[P1 媒体检查](../src/features/quizpack/v1/media.ts)及[可信 worker](../src/features/quizpack/v1/media-worker.mjs)。Option A 不作为回退。本里程碑只回答：在明确的平台组合上，可信媒体 worker 能否在真实权限边界内解码，并被可靠停止。

## 1. 范围、交付物与实施所有权

只实现两个独立平台的 probe/launcher 候选及相同语义的验收驱动。每次只处理一份内存图片，主进程唯一持有控制权；不接收任意命令、代码、路径、环境变量、挂载或镜像参数。不接 HTTP/Studio/P1 正式调用链，不改原包接收行为，不新增 validation/blob/product_asset 表、迁移、队列、常驻服务或自动重试。

| 所有者             | 独占交付                                                                                           | 不得越界                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| macOS 流，Sol/high | 严格 profile 候选、mac launcher、共享类型/P1父端预检/POSIX探针、mac扩展与实测报告                  | 不修改 Linux 实现、共享依赖、P1 业务入口或主机全局设置                               |
| Linux 流，Sol/high | 固定 Docker worker 候选、seccomp/运行参数、容器生命周期核验、真实 CI 探针报告                      | 不复用 PG 镜像冒称能解码，不修改数据库 job，不挂载整个仓库或 Docker socket 给 worker |
| 总控               | 冻结统一合同/断言；整合mac流先交的共享里程碑；分配worktree；管理根package/lock与workflow、独立审查 | 不以某端成功代替另一端；未通过不启动 B2-2 业务实现                                   |

代码归属冻结为 `scripts/quizpack-media-preflight/{shared,macos,linux}/`。macOS流独占shared并先交类型、父端预检、共同POSIX探针及结果协议；Linux流在总控指定该共享提交后复用，之前可独立准备镜像与容器机制。Linux特有clone/seccomp/namespace探针仅在linux目录，mac特有Mach/路径别名/包装器探针仅在macos目录。无新增运行依赖为优先目标；确需依赖由总控固定版本和锁文件，不安装全局工具或修改 sysctl。

每流交付：可复现命令、源码/profile 或容器构建定义、严格输入输出检查、正常及故障测试、安全摘要。原始合成产物只在本 worktree 专属 `.cache/quizpack-media-preflight/<platform>/<runId>/`，0700 目录/0600 文件，无链接、只操作本次拥有的对象。Git 只收源码、固定政策和脱敏结果摘要，不提交原始日志、二进制、镜像层或缓存。

## 2. 最小内部接口与结果语义

以下仅为受信任、进程内合同，不是浏览器 DTO；名称在本批冻结。复用 P1 的 `ImageDeclaration`、`ImageFacts` 字段，不另造图片 Schema；declaration.path 只作受限包内标识，不能映射本地文件。调用方不能选择平台策略；已审适配器按受支持平台选择，未知组合在启动前拒绝。

```ts
type LaunchContext = {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
};
type LaunchResult =
  | {
      outcome: "decoded";
      runId: string;
      profileId: string;
      facts: ImageFacts;
      stopped: "confirmed";
    }
  | {
      outcome: "failed";
      runId: string;
      profileId: string | null;
      code: LaunchFailureCode;
      stopped: "not-started" | "confirmed" | "unknown";
    };

runIsolatedImage(
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
): Promise<LaunchResult>;
```

`LaunchFailureCode` 固定为 `UNSUPPORTED_PLATFORM`、`ISOLATION_UNAVAILABLE`、`BUSY`、`INVALID_INPUT`、`INPUT_LIMIT`、`DECODE_REJECTED`、`WORKER_FAILED`、`OUTPUT_INVALID`、`CANCELLED`、`DEADLINE_EXCEEDED`、`STOP_UNCONFIRMED`。不得把原始 stdout/stderr、系统异常、路径或容器诊断塞进 code。启动与停止无法判定时优先 `STOP_UNCONFIRMED/unknown`，不能降格成“未启动”。

- 在任何 await/启动前生成本次随机 runId，复核输入限额并取得私有字节快照。TypeScript readonly 不等于 Buffer 不可变。父端核实际 bytes/hash、允许格式及声明；worker 仍完整解码，父端严格复核输出尺寸/格式/frames 与原声明。
- 一个调用只启动一次，不重连重放、不换后端、不回退裸 spawn。并发第二次调用返回 `BUSY/not-started`；本批无需队列。
- `decoded` 必须同时满足：真实完整解码、退出成功、严格有界输出、声明相符、期限内完成、实际停止及 stdio settled。先收到合格 JSON 而进程未停不算成功。
- `not-started` 只用于能确定从未发出平台启动操作的拒绝。启动命令已发出后失败，必须核实执行实体是否存在；不能以没有拿到 PID/cid 推断未启动。
- abort 幂等地停止输入、发起本次拥有对象的终止，并观察所有迟到 Promise 拒绝。输入写入、stdout/stderr、控制命令均须有界；不能只设置布尔变量就宣告停止。
- 正常结束、取消、异常都走同一停止核验。清理预算耗尽可以返回 `unknown`，但不得写 stopped receipt、释放未来业务预留、删除身份记录或宣称清理成功；本候选实例暂停新的解码，等待针对本次身份的显式核验。

原生进程句柄、PID/启动事实、容器 ID/nonce 留在 launcher 私有控制记录，runId 仅用作查证关联，不是权限凭证。此次不设计通用查询/任务 API；探针 harness 可以读取自己创建的记录以验证异常路径。

## 3. 权限与平台停止证明

共同硬边界：worker 的代码和 native 依赖只读；图片只通过 stdin 输入；仅 stdout 返回有限事实，stderr 不作控制协议。私有 runtime/admin/PGDATA/uploads **不可读写**；无继承归档写 FD、凭据环境、主服务 socket、可委托写入的 IPC。网络连接/监听及额外进程创建必须由实际机制拒绝，同时保留 Node/libvips 正常线程。可信 launcher 控制进程与受限 worker 分开评价，不能将 launcher 所需权限误授 worker。

### macOS 候选

以系统已有 `/usr/bin/sandbox-exec` 为调查入口，不承诺其是受支持的长期接口。Apple DTS 明确说明 SBPL 不属于受支持的第三方接口，见[官方讨论](https://developer.apple.com/forums/thread/661939)。当前记录仅证明 macOS 26.6.2/arm64、Node 20.20.1、sharp 0.35.5 的宽 profile 局部探针成功；deny-default 读取白名单候选曾 SIGABRT。**两者都不是本合同通过证据。**

从最小读取/执行需求收敛 profile，明确每项系统例外及用途；不能为使 Node 启动而放开整个 home/repo、私有文件或通用委托 IPC。probe 使用合成镜像目录与哨兵，不读取真实凭据。测试还须覆盖路径别名、链接和 FD，避免仅封禁一个路径拼写。若必要系统 IPC 无法与委托风险区分，保留失败结果并停止该平台接入。

须确认 sandbox-exec 与实际 worker 的执行/父子关系及沙箱继承，防止只限制包装命令。已核验的禁止额外进程策略加上实际 worker 退出、stdio settled 才支持 `confirmed`；仅 kill 调用成功、包装器 close 或父 PID 消失都不够。故障 harness 持有自己创建的进程身份，验证 launcher 崩溃窗口；不杀猜测 PID 或无关进程。

能力记录绑定 OS build/arch、Node 实际版本/可执行身份、sharp/libvips、worker/profile 摘要。组合变化使既有能力结论失效，重新跑相同矩阵；不自动放宽 profile。若无法收敛，结论为该组合不支持 Option B，而非切回 A。

### Linux Docker 候选

真实 CI 为必验环境；`ubuntu-24.04` 标签或 runner inventory 不能代替该 run 的 kernel、Docker、架构、seccomp 与资源限制能力记录。镜像必须有实际 worker/native 依赖和不可变身份；仓库/digest、platform、取得/构建方式待总控冻结，不伪造 digest。优先将依赖与 worker 放入受审镜像，避免 host 挂载；若仅 CI 本地构建，由总控先确定固定 base digest、构建输入摘要及实际 image ID 的绑定方案，不能把本地 ID 冒称远端发布 digest。

候选固定非 root 用户、只读 rootfs、drop capabilities、no-new-privileges、独立 PID/IPC namespace、无重启策略、无 healthcheck、无网络及受审 seccomp；不使用 privileged/host namespace。worker 不获得整个 repo、私有根、设备或 Docker daemon socket。若 native 确需临时空间，只能另列有界私有 tmpfs 例外，不能扩大 host 写入面。

`--read-only` 不封禁额外可写挂载；`--network none` 仍有内部 loopback；默认 seccomp 不保证拒绝所有 fork/clone 路径。因此要同时实测正常线程与额外进程拒绝，不用 pids=1 或连接到无人监听端口来冒充隔离通过。参见 [run](https://docs.docker.com/reference/cli/docker/container/run/)、[none 网络](https://docs.docker.com/engine/network/drivers/none/)、[seccomp](https://docs.docker.com/engine/security/seccomp/)。

父端在发出创建操作前保存随机执行名称/nonce、预期 image/profile 身份；只允许操作逐项匹配的本次容器。Docker CLI 失联、退出、被 SIGKILL 或父 PID 死亡，均不证明容器停止。实际控制通过可信本机 daemon，启动前检查端点，拒绝被环境覆盖到未知远端。取消必须对已核身份的容器执行停止并通过 wait/inspect 核停止事实，再等待本地 stdio settle；[docker wait](https://docs.docker.com/reference/cli/docker/container/wait/) 等待的是容器停止。

容器创建应答丢失时先按预分配身份核实，不盲目再 run；daemon 不可达或身份未知则保留记录、返回 unknown，不删除未知容器。单次“未找到”若仍有在途创建命令，不能证明永远不会晚到。原创建命令及相关控制 IO 未 settle 前不得宣告安全结束。候选阶段不依赖自动删除来替代停止证据，最终仅移除已证停止且确属本次的对象。

镜像准备/拉取在受控 setup 步骤进行；解码运行禁止拉取（使用等价于 `--pull=never` 的固定行为），缺镜像即关闭。后台业务请求不能触发镜像下载或构建。

## 4. 身份、输出与资源预算

`profileId` 由冻结策略及依赖身份派生，父端从实际启动事实核对，不能相信 worker 自报版本。stdout 只允许一个严格 JSON 事实/固定拒绝对象；UTF-8、额外字段、尾随数据、超限、非零退出均不能成为成功。子进程异常细节仅在合成探针私有产物内有界保存，正常控制台/CI 只输出固定断言、版本摘要和安全错误码。

| 项目       | 本草案建议；未注明实测通过                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 输入与图片 | 继承 P1：单资源最多 8MiB、边长最多8192、最多1600万像素，静态 PNG/JPEG/WebP；+1/动画/坏像素须拒绝                                            |
| 输出       | stdout实际累计最多2048 bytes；stderr最多4096 bytes后终止并丢弃额外字节；Docker日志驱动固定none，不写daemon日志                              |
| 运行期限   | `min(调用方绝对 deadline, 本次入口 performance.now()+5000)`；包含启动、输入及解码，不按 chunk/worker 入口重置；所有成功阶段检查实际剩余时间 |
| 收尾       | 独立清理预算固定5秒，仅用于stop/wait/stdio settle，不允许迟到成功；超时unknown并保留控制记录                                                |
| 并发       | 每个worktree的平台控制根最多一份活跃执行；持久化未核清身份阻断重启后的后继执行；无排队/常驻池                                               |
| Linux 资源 | 试验起点可用512MiB内存、1 CPU、pids64、memory-swap与memory相等；全部为未测候选值，核必要线程/峰值后冻结，不承诺最大合法图一定可用           |
| macOS 资源 | 先固定字节/像素/时间/并发，记录实际峰值；本批不要求尚不存在的native RSS硬限；明确记录该限制与实测峰值，不以JS heap参数冒充native限额        |

Docker 默认无资源上限，限制能力和 OOM/超限行为须记录真实结果，见[官方资源约束](https://docs.docker.com/engine/containers/resource_constraints/)。未满足总控冻结的资源门槛即不通过；不得把 macOS 的测量值写成跨平台硬保证。

稳定 policy limits/profile 身份与本次绝对 deadline 分离；剩余毫秒、排队耗时、runId 不进入未来 validation_key。P1 的 deadline 桥接、完整 validateQuizPack 必经 launcher 及证据绑定属于后续 B2-2 接入验收，本次只交接口约束，不修改 P1 公共入口。

## 5. 必须实际执行的验收矩阵

所有输入/哨兵为独立合成数据。拒绝探针必须证明预期对象确实存在/本应可访问，再证明受限执行不可访问；容器未挂载路径可通过外部身份/挂载核验及合成对照证明隔离，不能把任意拼错路径的 ENOENT 当作通过。哨兵只由受信任 harness 核内容/身份未变，不输出正文。攻击性探针跑完也必须通过停止核验。

| 组            | 每个平台必须留下的证据                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常解码      | 真实 PNG/JPEG/WebP 原尺寸完整像素解码，正常 native 线程；边界尺寸/字节、多个资源连续执行，记录冷/热启动与峰值，不仅2×2 happy path                                     |
| 文件权限      | native open/read/write/create/unlink/link/rename 尝试访问合成私有 runtime/admin/PGDATA/uploads 均被隔离；路径别名/symlink与继承 FD 检查；外部哨兵不变                 |
| 网络/IPC/进程 | native connect/bind/listen、额外 fork/vfork/clone或spawn 被拒绝；必要线程成功；无 Unix/Mach/daemon 委托写渠道及主机进程控制通道。平台不适用项明确注明，不能假装执行过 |
| 输出与失败    | 超2048 stdout、超限 stderr、坏/多份 JSON、提前输出成功后挂起、非零退出、native crash；全部不能误报 decoded                                                            |
| 期限/取消     | 启动前取消、输入背压、解码中超时、timer未及时调度、重复abort、close迟到；成功阶段不越期，停止未证不报 confirmed                                                       |
| 平台生命周期  | mac 包装器/worker关系；Linux CLI丢失、创建应答丢失、停止应答丢失、daemon不可达、身份不匹配；父进程崩溃用自有 harness 测试，无裸spawn回退或盲重试                      |
| 失败关闭      | 未知OS/架构/profile、缺工具/镜像、能力探针失败、版本变化、资源限制不可用均拒绝；不修改全局设置使失败探针勉强通过                                                      |
| 回收          | 证实实际停止及stdio settled后才清理自有临时物/容器；unknown保留有界身份记录。测试完成汇报自有残留，不能以退出码0掩盖未回收对象                                        |

每项报告包含：源码 commit、实测平台/依赖/profile或image身份、执行命令（无秘密）、断言结果、实际停止方式、已知限制。Linux 另提供 CI run/job URL 和真实结果；排队/权限阻断/未运行均不是通过。不能使用 mock、本机 mac 结果或 PG 容器成功代替 Linux native worker 的真实证明。

## 6. 冻结、退出及后续条件

总控已冻结共同输入/输出字段、有限错误码、文件所有权和探针边界。允许两流在候选目录内迭代机制与试验值；每次变更记录失败原因，不扩散到业务代码。

以下尚待实际试验后由总控冻结，本文不填虚构值：mac 最终 profile/系统读取及必要 IPC 例外/支持组合；Linux 实际镜像身份、获取方式、daemon端点与 seccomp；Linux候选资源值、mac实测峰值和平台停止证据细节（共同期限/输出/清理预算已按本合同冻结）。平台流回报具体不可行项，由总控作普通技术取舍，不重复询问作者，不自行削弱硬边界。

退出要求为两平台矩阵实际通过、独立审查无未关闭 P1/P2、命令和有界残留可复核。若任一平台未通过，交付失败证据并保持对应处理关闭；**本里程碑不算成功，不启动 B2-2 业务接入**。只通过 launcher 不意味着 ZIP/P1 复验、私有归档、导入或发布已通过。

之后另冻 B2-2：同快照可信 P1 适配及稳定证据键 → 三表/完整证据 → 统一配额、资源归档与显式恢复 → HTTP/UI/生产浏览器。其他平台、worker池、通用容器平台、GC、下载/预览、draft/apply/publish 均留后。当前 B2-1 的验收和生产端口不被此草案占用。

本次文档交付只检查本文件格式；没有执行本矩阵、服务、构建、DB、容器或迁移，也没有安装依赖或创建提交。

## 7. 派发前复审修订（2026-10-12）

- 成功 `profileId` 由父端绑定真实worker摘要、平台/架构、Node/sharp/libvips和profile/启动政策；Linux还绑定实际image ID及固定base digest/构建输入。失败尚无可用政策时为null，不能伪造成功身份。runId、剩余毫秒不进入稳定摘要。
- 正常入口仅启动固定受审P1 worker，固定8MiB/8192/16MP/5秒。私有harness只允许闭集探针场景；所有测试路径/参数均由可信harness在本次合成目录内派生，不向包或普通调用方开放command/path/argv/env/mount。探针使用与正常worker相同权限政策；因测试可执行身份导致的最小差异必须记录，不能用更严探针替代更宽正常政策。
- 共享父端预检由macOS流实现并先交：strict声明、独立字节快照、bytes/hash、magic/扩展名、PNG/WebP动画标志、维度/像素/字节限额，语义与P1当前media.ts一致。不能只复用worker就称等价P1；本批不改P1入口、不引入第二解码器。
- 每个平台控制根只有一个固定有界执行记录及独占guard（记录实际读取最多16KiB；0700/0600、无链接）。启动前持久化身份，重启仍对未核清记录失败关闭，不靠内存busy布尔值、不以新runId或删目录绕过。平台私有固定核验/清理只处理身份匹配的本次对象，无通用任务API。损坏/不完整控制记录保守阻断，不猜测或杀无关PID/容器。
- stdout2048/stderr4096、运行5秒、清理5秒是冻结的实验限额；到期unknown即结束该轮并保留阻断。Linux daemon日志固定none，镜像准备在setup阶段；运行前记录不可变实际镜像身份且禁止pull。Linux流可拥有linux子目录内单独锁定的worker package/lock（只用既有sharp固定版本），根依赖与workflow由总控管理。
- mac硬RSS不作为虚构能力或未定义退出条件。Linux从512MiB/1CPU/pids64/无额外swap起试，实际正常/边界/线程及OOM行为后再冻结支持值。不能为了通过而削弱文件、网络、IPC、额外进程或实际停止边界。

独立Astra预审认为以上小合同点补齐后可并行开展有限探针。mac先交共享合同以供Linux对齐；完整平台能力仍须实际矩阵和独立复验。最终记录必须区分通过、拒绝、未实现及不可行。
