# Linux 媒体隔离候选与真实 CI 入口

2026-10-12。实施基线 `6066c3b`，独立分支 `codex/media-isolation-linux`。本交付只属于 [隔离预检合同](QUIZPACK_MEDIA_ISOLATION_PREFLIGHT.md)，没有改 P1 调用链、HTTP、业务表、Studio、DB、3100、部署或 main。**初始候选，未获 Linux 实测验收。** 总控可先接入独立 Ubuntu 24.04 workflow，后续追加完整生命周期矩阵。入口返回 candidate-smoke-passed 也不是合同全部通过。

从仓库根执行：

```sh
pnpm install --frozen-lockfile
bash scripts/quizpack-media-preflight/linux/ci.sh
```

总控负责 workflow；Linux 流不编辑现有 workflow。要求原生 linux/x64、现有 `/usr/bin/docker` 和 `/usr/bin/cc`、可信本机 `unix:///var/run/docker.sock`。不安装工具、不启动 daemon、不修改系统或全局设置。任何 Docker 端点环境覆盖均关闭处理。Docker CLI 使用空私有 config 和明确本机 socket，worker 没有 socket、host 挂载、秘密或仓库。可变 runner 标签不是实测证明；报告记录实际 kernel、daemon 版本/安全与资源能力、镜像和 seccomp 身份。

## 固定构建与政策

官方 [Node 镜像](https://hub.docker.com/_/node) 的 `20.20.1-bookworm-slim` 在 2026-10-12 通过官方 registry 查询：index digest `sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd`；linux/amd64 manifest digest `sha256:450617c43da25e890a85e935526b3f6a8cfc5377155404a0074cb3116f48f06c`。响应 digest 与响应原始字节 SHA-256 一致。Dockerfile 固定平台 manifest，不用浮动 tag。Node20.20.1 只为本批与 macOS 组合对齐的可行性候选，不是生产版本/发布批准；outer CI 仍由总控选择 Node24。

只有 setup 拉取/构建。其输入为固定 Dockerfile、sharp0.35.5 独立 npm 锁文件、原 P1 media-worker.mjs 的实际摘要、闭集 fault/identity 探针、静态 native-probe 源及编译输出。私有构建 context 只收这些固定文件，不使用整个 repo。`npm ci --omit=dev --ignore-scripts` 从锁定 integrity 装原生 optional 包，并实际 require sharp；失败即停止。依赖代码由只读 rootfs 固定。编译器只在 host 对合成 C 源执行，编译器输出摘要、源码/二进制摘要进入构建输入。实际本地 image ID 与 base digest、全部构建输入绑定，**不冒称 remote 发布 digest**。

运行固定非 root10001:10001、read-only、cap-drop ALL、no-new-privileges、私有 PID/IPC/cgroup namespace、network none、无健康检查/重启/自动删除，daemon 日志驱动 none。候选资源为512MiB RAM、相同 memory-swap（无额外 swap）、1CPU、pids64；没有 host writable mount 或额外 tmpfs。运行固定实际 image ID 与 `--pull=never`；镜像缺失关闭，解码不下载/构建。依据 [Docker run](https://docs.docker.com/reference/cli/docker/container/run/)、[none network](https://docs.docker.com/engine/network/drivers/none/)、[资源限制](https://docs.docker.com/engine/containers/resource_constraints/)。

自定义 seccomp deny-default errno EPERM。只有 libc pthread 的 x86_64 `clone(0x3d0f00)` 允许；clone3 显式 ENOSYS 使 libc 可回退，fork/vfork/进程 clone、网络 socket/connect/bind/listen、SysV IPC 等未许可。允许 Node 必需的有限读取、mmap、信号/线程和事件 IO。`execve` 为启动固定 worker 必需；fork/vfork/非线程 clone 被拒绝以后，同 PID exec 替换不创建额外进程。不能用默认 [seccomp](https://docs.docker.com/engine/security/seccomp/) 或 network none 代替 native 拒绝证明。实际 pthread 和 libvips 是否兼容必须由 CI 决定，失败不自动扩大权限。

## 控制、停止与失败关闭

每轮先生成 runId，再作内存快照。已按总控指定共享提交 `eb3c437bc5a265ff6062194fde306f591e2268de` 复用同步 `precheckImage` 与严格 `parseWorkerOutput`。普通 `runIsolatedImage` 在第一个 await 前完成私有快照/声明/hash/magic/动画检查，并使用同一绝对期限。普通 worker 固定 P1 文件、参数、stdin 字节；测试执行器只选择代码中固定场景，不向包/业务开放 command/path/env/mount/image。normal、fault、identity 使用相同镜像/UID/seccomp/资源/namespace；native 仅把入口换为同镜像中的静态 C，测试参数仅可信本轮 host 合成根，权限政策没有加严。

平台控制根只有固定 `control/guard` 和 `control/record.json`，0700/0600、无链接、有界16KiB读取。记录在 create 发出前 sync，含本轮随机名称/nonce/image/profile/daemon 身份与固定入口；guard O_EXCL。重启、损坏/未核清记录保守 BUSY，不能另建 runId 绕过。Docker create 应答缺失后只能 inspect 核本次身份，不重发 create。没有确认实体、控制命令未 settle 或 daemon 失联都会 STOP_UNCONFIRMED/unknown 并留下阻断。

create→inspect 参数/身份→start attach stdin→统一 kill（若仍 running）/wait/inspect→stdio settled→清理本次已停容器。`created` 且从未启动由 inspect 状态证明不运行；已运行必须实际 [docker wait](https://docs.docker.com/reference/cli/docker/container/wait/) 与 inspect 退出码一致。CLI exit/父 ESRCH/kill 成功不会单独生成 confirmed。无 `--rm`、无 force rm；只按已核精确 ID 删除。正常输出2048、stderr4096、运行5秒、独立收尾5秒；迟到 JSON 不成功。原始异常/stdio不进入控制台，CLI 输出只有固定码和断言。unknown 不删记录、不盲重跑。私有 harness 显式恢复只核本次记录，不是通用任务API，后续故障矩阵需补独立父/CLI stdio barrier 证据。

## 当前可交给 CI 的范围与未完成项

已实现源码入口：实际镜像构建/identity、PNG/JPEG/WebP 原尺寸解码、8192 边长与16MP候选样本、取消/期限/+1输入/BUSY、native host合成文件读写创建删除链接改名及路径别名、socket/connect/bind/listen/IPC/fork/vfork/clone/clone3/线程/FD、输出超限/坏JSON/重复JSON/UTF8/非零/crash/hang/backpressure/OOM、停止与固定控制残留检查。每轮只写私有 `.cache/quizpack-media-preflight/linux/<runId>/summary.json`；Git 不提交原始报告、镜像、二进制、缓存或哨兵内容。

尚未完成：坏像素/动画和精确8MiB正常边界、host native对照、峰值测量及真实OOM证据、CLI丢失/create或stop应答丢失/daemon失联/身份不匹配/父崩溃/跨重启阻断/迟到控制 IO 的完整真实 Linux 矩阵。当前 smoke 结束摘要明确 accepted:false。某个断言失败会非零退出；unknown 会保留固定记录并导致后续关闭，不用清理掩盖错误。

本机实际执行冻结安装、format:check、lint、typecheck、test（45文件/612项）、build（含trace guard）均通过；共享父端8项node:test通过，shell/node语法检查通过。候选在mac运行setup按预期关闭（失败码），不据此声称Linux能力。本批明确禁止占用3100，test:e2e未运行；未启动 Docker/DB/3100，没有真实 Linux/CI run URL。Linux平台仍关闭，B2-2业务接入仍未开始。总控收到首个入口 SHA 后接入独立 workflow 并回传真实 run 结果，再按失败证据修复候选及补齐矩阵；全部通过及独立审查之前不能验收该平台。

## 首轮 CI 前追加的权限修订

私有 Docker context 使用0600文件，COPY会保留模式；镜像构建必须显式 `a+rX` 后再 `a-w`，让非root能读取受审脚本/依赖，仍维持镜像只读政策。此修订尚无Linux实测，不把代码推断写成通过。首个入口提交为 `24752795f864a2443845861e1e3df9df20cc7d4c`，本小修订只改 Dockerfile 与本说明，其他生命周期扩展仍在独立后继提交。

## 首轮远端失败与第二检查点

总控的真实 [CI38176902587](https://github.com/aning0922/quiz-forge/actions/runs/38176902587)，head `1490d7b79c7b23faaa5a105eff5b1e7131661365` 已运行并失败，日志只有 `ISOLATION_UNAVAILABLE`，不能确认失败来自0600模式。权限小修订 `33840d22f6b6fecb1fd011f5c949ba097b410e12` 已推送。后继检查点增加 setup 固定白名单 stage，仍不输出原异常/stdio/环境/完整inspect。

独立Astra首审指出 policy 预检多次更新5秒预算和FIFO读取前阻塞两项P2。已修为全部policy Docker调用传同一deadline/abort；停止恢复独立使用固定cleanupDeadline、不沿用已取消signal。`readPrivate` 先 O_NOFOLLOW|O_NONBLOCK 再fstat拒绝非普通文件，并有本轮合成FIFO实际有界拒绝测试。command以close确认stdio，实际close时再次检查绝对期限，timer延迟不能变迟到成功。后继本地格式/lint和command专项7项通过；不是Linux隔离验收。

后继候选还新增：原生host合成对照、全FD枚举、共享严格输出拒绝、16MP实际own-cgroup峰值/限制采样及OOMKilled断言；真实Docker attach CLI SIGKILL、本地Unix代理转发同一daemon后丢create/kill应答、真实daemon通道失联、真实自有容器rename身份不匹配、同一对象显式核验。代理只在私有harness使用，不能生成假的inspect/wait成功，worker权限完全相同；普通入口固定真实daemon。unknown只允许在同进程实际create/start close已观测后恢复，本候选不推断旧父PID消失等于stdio settled。以上远端仍待运行。父崩溃/跨重启完整停止证据、精确8MiB正常样本和动画/坏像素全矩阵仍未完成，accepted:false保持。

FIFO专项初次运行在目录前置检查失败：本工程已有测试建立0755 `.cache`。修为只允许当前用户拥有/无链接/其他用户不可写的缓存祖先，Linux专属私有根起仍0700，文件0600；不chmod既有缓存或共享目录。这可能解释首轮失败，但未经stage实测不能确定。修后重新运行FIFO和期限专项；实际结果随后继提交记录。

## native-identity 诊断小补丁

第二轮真实 [CI38177356944](https://github.com/aning0922/quiz-forge/actions/runs/38177356944)，head `96000be4465ab3a464f68c962a519eeb513350be`，已经失败于native-identity；base pull/image build/image record已完成。尚不能推断是worker syscall、Docker参数规范化或policy预检，也没有放宽策略。此小补丁只增加白名单诊断：policy控制命令退出/settled、资源安全能力布尔、自己的容器各项匹配布尔、launcher有限错误码与已知stderr分类、checked结果/停止状态/数值退出码。没有原始stdout/stderr、异常、路径、环境值或完整inspect进入CI输出。扩展矩阵保留在本分支stash，等实际诊断证据后继续，不掩盖此启动阻断。

## 执行与恢复互斥修订

Astra复验确认deadline/FIFO两项闭合后，复现第三项P2：create close即设localBarriers，start Promise尚在途时同进程恢复可能提前删除记录。修为执行/恢复共享互斥；执行在途时恢复保守unknown，恢复在途时新执行BUSY。每个有归属控制命令发出前撤销资格，只有该轮全部控制命令实际close且无settled:false才重新授予；settled:false保持阻断。新增真实Linux生命周期回归入口，在attach仍在途时调用恢复，须保持guard/record、不confirmed，原执行独立走最终停止核验。此回归尚待LinuxCI，不能以源码或本机测试称独立实测通过。

## 第三轮启动失败与OCI分类

真实 [CI38177881396](https://github.com/aning0922/quiz-forge/actions/runs/38177881396)，head `1de6c4c647ea664d955bf3da24f29c729ecf0878` 已失败：policy image/daemon控制均exit0/settled；平台能力及容器全部参数核验true；start attach退出1，容器退出255，停止confirmed。定位为启动阶段，仍未证明Node/sharp正常解码。

增加State.Error和CLI stderr的固定OCI阶段分类（exec/fifo/seccomp/thread/identity等）与闭集syscall名；permission/EPERM采用大小写不敏感匹配。只返回固定分类/有限syscall/状态/数值，不输出或保存原文。没有修改seccomp。查阅 [runc初始化上游源码](https://github.com/opencontainers/runc/blob/main/libcontainer/standard_init_linux.go) 与 [Go amd64线程源码](https://github.com/golang/go/blob/go1.24.1/src/runtime/sys_linux_amd64.s) 仅用于定位候选，main源码不代表本轮runtime版本，也不能由源码推断某项权限在该run必要；下一轮须依据实际分类决定最小修订。
