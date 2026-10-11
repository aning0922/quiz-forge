# macOS 媒体隔离候选与实测

2026-10-12。基于 `6066c3b`，独立 `codex/media-isolation-macos` 工作树。只拥有 `scripts/quizpack-media-preflight/shared/`、`macos/` 和本文。**mac候选61项本流合成实测通过，待总控与Astra独立复核；不是B2-2接入或生产隔离批准。** 未修改P1/HTTP/Studio/DB，未启动数据库/3100、部署或合并main。Linux实际CI及整体退出结论由总控记录，不能用本机结果替代。

## 共享交接

- `eb3c437`：LaunchContext / LaunchResult / 有限错误码与限额、同步父端快照预检、严格P1输出协议、共同POSIX C探针；本机9项测试通过。
- `b9060ae`：完整有界FD枚举、FD300实际对照、网络前置阶段、UTF-8 BOM拒绝；本机11项测试通过。
- `68c3700`：未知FD的有限元数据诊断；本机12项测试通过，不放宽任何安全断言。
- `e21afd9`：plain Node / tsx / node:test / 两者组合四对照。macOS Node20.20.1均extraCount=0；Linux第三轮CI38177881397曾发现两只非CLOEXEC管道（一读一写）；总控后续第五轮head3ee9326四个Node24.21.0对照均见同一有限形状，不能归因tsx或node:test，仍由总控窄查。root后续诊断修订344513a/固定编译PATH归总控，本流不重复修改。
- 总控的安全祖先权限修复 `4f3959b` 已按指令接入为本分支 `db95013`；不重复修改根workflow或Linux代码。

父端复用P1实际ImageDeclaration/ImageFacts和path/MIME/hash Schema，不另建图片解码器。严格解析声明，同步取得独立bytes与声明快照；实际bytes/hash、magic/扩展名、PNG/WebP动画标志、8MiB/8192/16MP限额均在首次await/平台启动前核实。SharedArrayBuffer、未知字段和异常getter拒绝。正常执行唯一固定原P1 `src/features/quizpack/v1/media-worker.mjs`，完整原尺寸像素解码。stdout严格UTF-8/单份原worker JSON/字段/尺寸/frames与声明；BOM、重复字段、额外JSON和尾随内容拒绝。

`shared/posix-probe.c`是闭集合成harness工具，不接受包选择的命令。EPERM/EACCES才认定拒绝，ENOENT/连接失败不能算通过。网络协议区分socket-denied、operation-denied、prerequisite-denied、allowed、failed；listen因bind拒绝未执行时明示阶段。文件探针实际测试open读/写/创建、link、rename、unlink；不把open拒绝说成已执行read/write数据调用。mac扩展对不存在FD3实际执行pread/pwrite，均EBADF；正常launcher的全部额外FD枚举另行证实。

FD枚举：mac libproc当前进程列表，Linux自身/proc/self/fd；最多65536项，最多12项诊断摘要，无路径/内容/环境值/errno。无法完整枚举或fstat/fcntl异常则不输出安全true。FD300实际注入只读合成regular后检测为额外能力，不能忽略pipe或高位FD。四上下文诊断只用于定位，不是验收通过。

## 固定平台与权限

实测macOS26.6.2 / build25G83 / arm64，Node20.20.1，sharp0.35.5 / libvips8.18.7；系统sandbox-exec、Apple clang17.0.0。冻结安装pnpm10.32.1 / pnpm-lock。普通入口无platform、command、path、argv、env或policy选择参数。

`sandbox-exec`使用deny-default模板，未启用Mach lookup、Unix/POSIX委托IPC、network、文件写、process-fork或主机进程signal权限。实测必要例外：

| 权限               | 固定范围与目的                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| process-exec       | 仅初始固定可执行文件literal；正常为实际Node；C探针仅其自身初始身份                                                              |
| file-read*         | Node/原worker或闭集fault脚本literal，sharp与实际五个直接/native依赖目录，只读/usr/lib和/System/Library，/dev/null与/dev/urandom |
| 根目录读取         | literal `/` 本身；不允许其后代，解决该组合dyld/Node启动SIGABRT                                                                  |
| file-read-metadata | 固定代码/Node/依赖路径的祖先literal及本工作树node_modules；不开放home/repo数据读取或控制根内容                                  |
| sysctl-read        | hw.*硬件事实；kern.ostype/osrelease/version/hostname四项为Node uname必要读取。没有kern.*通配或进程表例外                        |

初始严格白名单、增加sysctl/metadata/Mach等多次候选仍SIGABRT；有限对照找到literal `/` 后成功。宽file-read仅作失败定位对照，未作为候选。无全局设置、额外安装、权限放宽回退或裸worker spawn。所有原始合成产物仅本工作树 `.cache/quizpack-media-preflight/macos/`；目录0700、记录/日志0600，原生可执行文件因需执行为0700。真实runtime/admin/PGDATA/凭据未读取。

Apple明确说明SBPL不属于受支持的第三方接口；因此本候选仍有平台维护限制，见[Apple DTS讨论](https://developer.apple.com/forums/thread/661939)。不同OS/build/架构/Node组合拒绝，不能自动放宽profile。

## 身份与停止

固定控制根只有guard、active.json及原子更新期间active.next；有界枚举、有界16KiB记录读取。目录/文件owner、mode、nlink、无链接、inode与读前后事实核对；所有可能遇非普通文件的open有O_NONBLOCK后fstat拒绝，FIFO/超量/损坏/链接/未核清记录失败关闭。启动前持久化runId、政策ID、owner与issued事实；spawn后保存实际PID，libproc核本次子进程ppid、启动sec/usec与实际可执行身份。跨重启只阻断，不猜PID、不杀未知实体、不自动恢复。

执行期限min(调用方单调绝对期限,入口+5000ms)，含同步快照、政策绑定、控制记录、启动、输入和解码；不能按chunk重置。stdout2048/stderr4096，超额终止并丢弃后续字节。只有ChildProcess真实exit与所有stdio的close完成，且最终期限检查成立，才可decoded/confirmed与移除本次记录。kill调用、收到JSON、包装器退出或发出逻辑abort都不足以成功。

终止只使用仍属本次的活子进程句柄，并核ppid/出生事实/实际固定Node或sandbox身份；不按猜测PID终止。重复abort幂等；输入销毁，stdout/stderr持续有界排空，所有迟到回调受观察。清理独立5000ms，到期返回STOP_UNCONFIRMED/unknown，保留record/guard；迟到真实close不自动清记录或改写已返回结果。没有业务stopped receipt/API、资源预留释放或通用恢复队列。

harness实际临时移走本次私有helper使停止核验失联：约5817ms返回unknown，后继调用BUSY；迟到原ChildProcess close/stdio后记录仍保留。只有该harness针对确属自己runId的真实close证据才存档并显式删除合成控制对象。父端SIGKILL实测保留worker启动身份，重启BUSY；本次合成worker自行退出后由harness核原kernel身份消失、父端stdio已settle且额外进程策略被拒绝，显式清自己的对象，不捏造原launcher receipt。执行过程中不存在并发恢复入口。

实际fault worker PID/ppid与libproc证明sandbox-exec替换为同一PID的固定Node。正常入口仅三个stdio管道和NODE_ENV=production，无归档FD/凭据环境。另一个宿主实际持有继承FD300（确认存在且可读合成内容），调用同一固定launcher后受限原生worker完整枚举无额外FD；这不是只检测一个正常父端上下文。

## 稳定政策与失败关闭

本工作树实测worker profileId：`b419191e292ec846acea99877da5ec78235660eeb50941eb7b1a25a47c22b221`。

封存componentId：`c376f502f63147514ec27cfeacfd930f4a8b6a8c2bcbcd92cf9f9431bec7cf21`。普通 `runIsolatedImage` 必须匹配 `supported-policy.json`，否则ISOLATION_UNAVAILABLE/not-started。真实helper缺失、权限错误、同版本binary附加字节均拒绝且不启动worker；另有精确OS product/build纯边界测试及合成Node版本覆盖（不冒充第二个真实Node平台）。

component绑定OS/arch/Node版本及实际Node、sandbox-exec、worker、launcher/control/policy/protocol/共享预检代码、P1 manifest/limits、zod及sharp/native/直接依赖树摘要、限额。固定代码与依赖角色映射可随受管工作树整体迁移；实际literal读取范围始终另绑定完整profileId，不因保持component稳定而漏掉权限变化。runId、scratch/fixture路径、剩余期限不进入稳定摘要。程序不能由包或普通调用方选择映射。

闭集harness原生/故障政策的最小执行身份差异分别绑定ID：posix=`b04daefd443f319d77b3631bd4b22ebe9b183de8b954f6d3b177401b748286ee`，mac=`6889bc46af84f5f40a5039f31680f6234267afb358bc3c3f4cdaf6899a9bd1ad`，fault=`ffda834e43762cbebe85d63fa57ff4b8da97643c80f53ef1fcfa1e3239178ca8`。其余权限同一模板；不使用更严格探针替代更宽正常政策。harness图片试验入口仅固定原P1worker/同一政策，允许在本批取得封存能力前做矩阵；普通入口始终要求封存身份。--record-capability只供受信任本地setup与完整矩阵，不存在业务请求触发setup。

## 实际矩阵与资源

61项当前harness断言全通过；14项node:test（12 shared、2 mac policy/protocol）通过。逐项结果、固定profile、身份与原始有界合成测量在私有runs/<runId>/，不提交Git。完整涵盖：三格式正常及16MP、8192边长、实际合法8MiB PNG、+1 bytes/dimension/pixel-height、坏像素完整解码失败；四私有合成区域×四路径写法/别名共16组文件拒绝与哨兵不变；原生线程允许、fork/vfork及posix_spawn `/usr/bin/true`拒绝；真实TCP/Unix监听同伴、connect/bind拒绝、bind失败后listen not-run另有直接listen拒绝；合成Mach服务/共享内存/peer信号对照；全部FD与宿主FD300、最小环境；输出/坏JSON/BOM/非零/native crash/先成功后挂起/背压；取消/绝对超时/定时器晚调度/BUSY；FIFO/损坏/超量/链接/partial/guard阻断；unknown、父端崩溃、缺helper/版本变化。

| 16MP格式 | launcher端到端实测     | 两个新worker的内核峰值RSS bytes |
| -------- | ---------------------- | ------------------------------- |
| PNG      | 269ms，224440输入bytes | 131710976 / 131104768           |
| JPEG     | 247ms，94016输入bytes  | 130482176 / 131121152           |
| WebP     | 301ms，28520输入bytes  | 372588544 / 371621888           |

峰值由受信任 `/usr/bin/time -l` 对同政策、同PID exec的真实完整解码采集；每次新进程，两次连续运行，未清理系统缓存，不能假称冷文件缓存或常驻热池。**mac没有native RSS硬上限**；特别是WebP约355MiB，不能只报告小PNG峰值或把JS heap当native上限。这些合成颜色样本不是所有合法图的峰值保证。固定字节/像素/期限/并发仍适用。

矩阵结束active控制根为空；TCP/Unix同伴关闭、合成Mach服务进程退出/stdio settle、共享内存已unlink、合成哨兵验证后删除。runs保留有界证据及tools为显式setup产物；不扫删其他缓存或真实私有目录。

## 复现与交接边界

从本工作树根执行：

```sh
pnpm install --frozen-lockfile
node --import tsx --test scripts/quizpack-media-preflight/shared/*.test.ts scripts/quizpack-media-preflight/macos/policy.test.ts
node --import tsx scripts/quizpack-media-preflight/macos/harness.ts --record-capability
node --import tsx scripts/quizpack-media-preflight/macos/harness.ts
```

首次完整setup会编译两个固定C工具，正常请求不会编译或安装。任何已有未核清control/fixture对象阻断harness，不绕过guard。工作树迁移/编译器或依赖变化应重新运行完整矩阵并由总控审核封存摘要。

本流实际执行并通过pnpm format:check、pnpm lint、pnpm typecheck、pnpm test（45文件/612项）及pnpm build（含BUILD_TRACE_OK，53条trace/0违例）。E2E/3100、DB和远端CI不在本流授权；总控统一集成与串行验收。已知待独立复核：SBPL长期维护、所有硬权限/停止论证、同初始可执行身份的spawn对照（当前C posix_spawn目标是/usr/bin/true，不能把exec allowlist拒绝独自当成完整进程创建证明）、业务接入时的同快照/总体预算/证据键、真实应用父端FD上下文。未声明完成B2-2、导入、归档、发布或Linux实测。Root要求先交当前候选供独立审查，不在本流继续扩大平台研究。
