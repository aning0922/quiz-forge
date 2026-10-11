# 媒体隔离可行性独立审查记录

2026-10-12。状态：实施与实测中，尚未验收平台能力。总控集成，普通实现为两条GPT-6.1 Sol/high流，独立审查为GPT-6 Astra/high。不要把共享测试、候选smoke或文档CI当作操作系统隔离通过。

## 合同预审

6066c3b冻结五项派发前修订：成功profile绑定实际环境与受审代码、失败无policy为null；正常worker与闭集故障探针分开；保留P1父端预检；固定控制记录/guard跨重启阻断；5秒运行/5秒收尾/2048 stdout/4096 stderr与日志none。没有业务表、HTTP/Studio或P1正式接入。最终平台profile/镜像/支持组合仍需实验，mac硬RSS没有被虚构为已有能力。

## 共享实现

首交eb3c437→rootf6ea4c9：9项node:test、定向lint/类型/格式通过；CI0874ea6的[38176496353](https://github.com/aning0922/quiz-forge/actions/runs/38176496353)已成功，含真实POSIX编译与非沙箱对照。没有平台权限结论。

独立Astra在此基线上登记2项P2：FD只扫3–255却报告全部无继承（真实注入自有FD300仍true）；socket创建被拒直接exit70，无法区分Linux前置能力拒绝与探针失败。另有非阻断BOM被TextDecoder剥离的问题。A修复b9060ae→rootddf9286：实际FD枚举上限65536/scanComplete，未完整即不安全true；网络返回socket/operation/prerequisite拒绝阶段；显式拒BOM。总控及独立复验11项node:test通过，两项P2与BOM缺口均闭合。独立FD300实际注入得到scanComplete:true/安全false；受控C syscall替身验证socket拒绝、bind前置拒绝、listen直接拒绝与EIO故障分支，未进行真实网络或平台沙箱。Linux枚举分支此轮仅静态复核，不冒充实测。原生文件open对照不冒充全部数据read/write系统调用，平台专用矩阵仍须补齐。

## Linux候选

首交2475279→root5489265，仅交可运行CI候选，文档明确accepted:false及未完成生命周期矩阵。独立Astra登记2项P2：loadPolicy多次Docker调用各自重起5秒而不传总deadline/abort；readPrivate在fstat前打开FIFO可永久阻塞，须O_NONBLOCK并核普通文件。整改中；未因“尚无完整矩阵”笼统记缺陷。

首轮实际[Linux CI38176902587](https://github.com/aning0922/quiz-forge/actions/runs/38176902587)，head1490d7b，结果failure，安全输出仅ISOLATION_UNAVAILABLE/exit1。无法由此确定唯一根因，不能宣称平台通过。Linux流静态发现私有context0600随COPY进入镜像，非root无法读取脚本；修复33840d22→root8ad519a显式授只读/目录执行权限，尚待重跑。有限stage诊断、总期限及FIFO整改交付后再验证。

## macOS候选

早期严格读取政策使Node启动前SIGABRT；扩大Mach lookup未解决，不把宽读取诊断当合格策略。开发流已报告收窄到必要系统/依赖读取和元数据，但尚未交完整launcher/停止矩阵供总控验收。正式结论以后续实际源码、平台探针和独立复审为准。

## 第二轮真实 Linux 证据

整改f29d5b6→root96000be后，本机11共享+7控制/真实FIFO共18测试通过，lint/格式通过。独立Astra正在复验Linux总deadline/abort、FIFO及新增生命周期代码，未计为已关闭。

[容器CI38177356944](https://github.com/aning0922/quiz-forge/actions/runs/38177356944)在head96000be仍failure；固定stage为native-identity，前面的镜像构建/记录已走过，尚不能确定是政策预检、配置匹配还是worker启动。已派Linux流补有限code/布尔诊断，不输出原始异常、环境或完整inspect，不猜测放宽策略。

同head[普通CI38177356922](https://github.com/aning0922/quiz-forge/actions/runs/38177356922)的shared POSIX基线失败：真实Linux的FD枚举为scanComplete:true、noInheritedFileOrSocket:false，不能以Mac对照通过代替。已派shared所有者查明额外FD来源/枚举差异，仅记录FD编号/类型/权限等有限元数据；未核清前不忽略该FD或改断言为通过。上节独立修复结论只覆盖其明确注明的Mac实测及Linux静态范围。

## 第三轮真实 Linux 证据与审查整改

独立Astra已复验并关闭f29d5b6的总deadline/abort与FIFO两项P2：实际源码的四种预算/中止对照及七项控制进程/FIFO测试通过。新增P2为早期create留下的localBarrier会在start仍未close时允许显式恢复释放控制记录；28fee369→root3508c4e引入执行/恢复互斥和全部控制命令的pending/unsettled状态，七项本地控制测试通过。独立Astra使用实际controller、隔离Docker/文件桩完成八项时序复验，原pending-start复现及create/start/inspect/rm未settled、双恢复/新执行互斥、跨模块重启均保持阻断；该P2已关闭。这些是纯控制证据，不是容器实测或平台验收。

head1de6c4c的[容器CI38177881396](https://github.com/aning0922/quiz-forge/actions/runs/38177881396)仍failure。有限诊断已证实镜像/daemon能力预检与全部容器配置核对为true，create成功且已close；start-attach实际exit1并已close，容器exit255。清理确认停止，结果WORKER_FAILED；原生身份阶段未通过。不能据此猜测放宽seccomp，f119b69→root7c69834只追加有限OCI阶段与已知syscall分类，等待下一轮真实证据。

同head[普通CI38177881397](https://github.com/aning0922/quiz-forge/actions/runs/38177881397)的FD基线仍失败：完整扫描找到两只非CLOEXEC管道，一读一写，未记录路径、内容或环境。共享所有者正在补plain Node、tsx和node:test等有限对照定位来源，原断言保留。Mac作者报告扩展矩阵60/60通过，但完整提交、总控重跑和独立审查尚未完成，不计为macOS验收。

## 第四轮真实 Linux 证据

head4f3959b的[容器CI38179010996](https://github.com/aning0922/quiz-forge/actions/runs/38179010996)仍failure，有限分类明确为OCI exec FIFO启动阶段；镜像/能力/配置检查仍全部true，停止confirmed。日志的knownSyscall=mount仅表示有限词表命中，可能来自路径/描述，不能当实际系统调用证据或据此允许mount。Linux流继续核对运行时源码并修复。

同head[普通CI38179011025](https://github.com/aning0922/quiz-forge/actions/runs/38179011025)的database实际success；checks失败于新FD四对照的首个plain Node24.21.0，只有FD_CONTROL_FAILED，未获得管道元数据。root补固定paths/build/probe/parse阶段、数值exitcode与四对照失败汇总，并为可信探针编译器给定固定/usr/bin:/bin搜索路径；未改变解码worker权限或忽略额外FD，也未将编译环境假设当原根因。本机四对照均无额外FD、19共享/控制测试通过，612应用单测、类型、lint与格式通过。第五轮准确head证据另记，尚未验收平台。

## 第五轮、共享对照修订与平台候选预审

head3ee9326的[普通CI38179321373](https://github.com/aning0922/quiz-forge/actions/runs/38179321373) database实际success、checks失败：四个Node24.21.0上下文全部成功执行诊断，均完整发现两只非CLOEXEC pipe，原零FD host断言仍失败。不能据此归因tsx、node:test或spawnSync；[容器CI38179321422](https://github.com/aning0922/quiz-forge/actions/runs/38179321422)仍failure，未验收Linux。

独立Astra裁决共享host对照应验证扫描器正确性，未知无沙箱host不能天然假定零FD。root cc51623据此新增闭集fd-control，同次扫描同时返回完整性/数量/安全结论及精确FD300只读regular命中；host有任何额外FD仍明确unsafe，注入对照不依赖诊断顺序/未截断列表。实际平台fd模式及零额外FD断言完全保留。新增async对照与sync使用同一C探针/参数；有界输出、5秒操作加1秒收尾、真实close才成功。独立Sol实测启动失败的null stdio后补空句柄和有效正PID保护；初次null对照曾exit137，整改后三种真实失败均有限返回，不掩盖首次失败。Mac本机13共享测试、22项集成控制（新增Linux诊断2项另通过）、类型/lint/格式及async两对照通过，Linux新对照待下一准确head。

源码调查仅支持待核假设：[Node24.21.0 sync实现](https://github.com/nodejs/node/blob/v24.21.0/src/spawn_sync.cc)仍使用uv_spawn，[libuv pipe](https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/unix/pipe.c)使用O_CLOEXEC；[Linux/mac process路径](https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/unix/process.c)对既存non-CLOEXEC FD继承有平台差异。不能把可能的host继承当已确定根因，也不能将新host测试通过计为隔离通过。

mac完整候选c54dd80→root3d7237b已集成。作者61项实测不等于验收；Astra只读预审登记3项P2：issued持久化后未重查deadline即spawn、身份查询错误被当成不存在并清除harness阻断、最后API检查前就写能力记录。另须补同初始允许可执行身份的spawn实际拒绝证据。均已派回，待修复与最终复核，不启用业务入口。

Linux扩展15761ed→root36474f5的created-only崩溃恢复经独立实际源码六项内存对照通过，未见旧互斥回归；新P2是kill父进程后无界await close，独立有限后代持stdio复现实测6546ms，超5秒清理预算，已派回修复。991d893→root67f8a89只补有限FIFO/errno/明确syscall文本与setup组件版本，2项分类测试通过、无新增P1/P2；runtimeVersions目前不是每次运行的runc/containerd/init核验，正式支持组合仍须补实际绑定。

## 第六轮准确 head 证据

head e2adf40的[普通CI38180296236](https://github.com/aning0922/quiz-forge/actions/runs/38180296236) checks/database均实际success，构建53trace/8614路径/0私有违规。Linux Node24.21.0的四sync上下文与两async对照都完整报告两只额外pipe；host同次control明确unsafe/count2，扫描器正确性测试及FD300注入通过，不证明host隔离，不归因某个loader/测试框架/启动方式。

同head[平台CI38180296216](https://github.com/aning0922/quiz-forge/actions/runs/38180296216)仍failure：真实setup组件版本为Engine28.0.4/containerd v2.3.6/runc1.5.1/init0.19.0；start-attach settled/exit1，有限分类为FIFO reopen、EPERM、mount-namespace-description，未获得确定syscall；后续容器created/exit255，最终WORKER_FAILED/stoppedconfirmed。Linux流正在按精确版本源码定位最小修复，平台验收仍未通过。

两条独立源码调查定位runc1.5.1默认pure-Go链：[seccomp后Reopen](https://github.com/opencontainers/runc/blob/v1.5.1/libcontainer/standard_init_linux.go#L219-L249)经pathrs-lite的[procfs安全核验](https://github.com/opencontainers/runc/blob/v1.5.1/vendor/github.com/cyphar/filepath-securejoin/pathrs-lite/internal/procfs/procfs_linux.go#L42-L67)调用[unix.Fstatfs](https://github.com/opencontainers/runc/blob/v1.5.1/vendor/github.com/cyphar/filepath-securejoin/pathrs-lite/internal/fd/fd_linux.go#L51-L55)。当前policy缺这一只读文件系统类型查询；mount API和openat2失败已有安全回退，未找到同时增加statfs/mount/open_tree的必要证据。root05eaf48只加fstatfs，已和Linux作者明确单文件交接，其余权限不变；下一真实CI验证前仍是最小候选，不声称唯一根因或能力已通过，CI也未提供runc构建tag。

共享cc51623独立Astra复核无P1/P2，13项native/shared测试及6项async helper失败边界通过；后代持stdio在6005ms返回close-unconfirmed，未误认停止。root另以本批全新purpose=test实例完成214真实DB（137.95秒）与46驱动场景、生产构建53trace/0私有违规，生产E2E进行中；这些是既有应用回归，不关闭mac三项P2或Linux崩溃harness期限P2。
