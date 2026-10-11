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
