# 媒体隔离可行性：技术验收

2026-10-12。**本里程碑技术验收通过**，范围为[独立可行性合同](QUIZPACK_MEDIA_ISOLATION_PREFLIGHT.md)，集成分支 `codex/media-isolation-preflight`，依赖已交付 B2-1 `5caef26`。[Draft PR #11](https://github.com/aning0922/quiz-forge/pull/11) 保持未合并。平台代码基线 `736d92354d2765a15ca6109c2611dfc7dde9b83e` 已完成两平台矩阵及独立审查；该准确 head 的[普通CI38183239291](https://github.com/aning0922/quiz-forge/actions/runs/38183239291) checks/database及媒体CI均已实际success。最终交付记录 head 的检查另以PR实际checks为准。

## 交付与证据

| 交付         | 实际结果                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享父端     | 首次 await 前独立快照，固定 P1 图片声明、bytes/hash、magic/格式/动画/像素边界；严格有界 UTF-8/单 JSON 输出                                                                      |
| macOS        | 总控目标工作树 66/66 完整矩阵三次通过；包括首次封存、普通 sealed 入口和最终报告修订后的重新封存；每次控制根残留 0                                                               |
| Linux        | `736d923` 的[真实媒体 CI38183239317](https://github.com/aning0922/quiz-forge/actions/runs/38183239317/job/114600066143)实际 success，31/31 smoke、11/11 生命周期                |
| 停止与恢复   | Linux stop-loss实际 running，create/start/kill/lost各一次，丢失真实204应答后 stopped:confirmed；daemon失联/身份不符保持unknown，显式同实体核验才confirmed；两项控制清理检查通过 |
| 独立审查     | Astra登记的共享FD、deadline/FIFO、执行恢复互斥、崩溃stdio预算及mac三项P2均已关闭；736d923代理修订无新增P1/P2，Linux最终出口证据已复核确认                                       |
| 本地工程回归 | format/lint/typecheck、612应用单测、214真实DB、46驱动故障、build及206生产Chromium E2E通过，10项既有跳过；最新共享/平台纯控制31/31                                               |
| 构建追踪     | 53份trace、8614路径、0私有路径违规；本批不新增业务页面，未以自动截图代替人工视觉批准                                                                                            |

失败轮次及来源提交完整保留在[独立审查记录](MEDIA_ISOLATION_REVIEW.md)。第九轮准确 head 的普通与平台检查均已核实，不以前一轮结果代替。平台程序仍输出 `accepted:false`，表示它没有业务导入或发布批准；整体技术验收由本记录结合两端实际矩阵确认。

## 实际支持组合与固定限制

macOS：26.6.2/build25G83/arm64，Node20.20.1，sharp0.35.5/libvips8.18.7。root profile为 `7475c2890e06902a0f5c5ca36c7c1f1b28173a851069ba25efe09ef063ae6a69`；component为 `b00b6251991ae94dd9ba35b7567ae4ab2937e56b85cbaf515abc59f82c0d5b73`。deny-default政策、实际依赖字节、native helper及固定worker绑定；无Mach、网络、写文件或额外进程权限。作者与root的依赖包装器实际字节不同，因此目标worktree必须重验封存，不复用作者seal。

Linux：真实ubuntu-24.04 runner的linux/x64；该run实际Engine28.0.4/containerd v2.3.6/runc1.5.1/init0.19.0，worker Node20.20.1及固定sharp原生依赖。kernel属于实际profile绑定和私有矩阵记录，不能用runner清单猜其版本。固定base manifest `sha256:450617c43da25e890a85e935526b3f6a8cfc5377155404a0074cb3116f48f06c`；第九轮本地image ID `sha256:5b084c62c1a905b84c48b1ed217516c3c1844879da6325e0661ee4b27aad3662`，profile `0d28fc34c6e36bf91b4d3f6d200c257aa1d842152f5134c4cf7a218d4432614d`。buildInputs `9fa661174f9eea00411871c82929ed87cdb3a1af5442a570e45a8dd331cd23b7`，worker `06a5775b15bc4924a8df993d31dbc77324f15eaec2deb492fead8fae81200c79`。这些不是远端发布镜像digest；每次运行实际重核四runtime组件与全部容器配置。

单图最多8MiB、8192边长、16MP，PNG/JPEG/WebP静态图；5秒总执行、5秒停止收尾，stdout2048/stderr4096，单控制根串行。Linux512MiB RAM/无额外swap/1CPU/pids64，非root、只读rootfs、无host挂载、无网络、drop全部capabilities、no-new-privileges、deny-default seccomp；真实线程、OOM、资源与权限边界均有矩阵证据。未知组合、镜像缺失、版本变化、控制残留均失败关闭，无裸spawn回退。

macOS没有native RSS硬上限。作者同政策16MP WebP合成样本约355MiB峰值只是测量，不是所有输入上界；SBPL为Apple未承诺支持的第三方接口，升级必须重验。Linux宿主的两只额外pipe仍被完整扫描如实标unsafe；实际隔离worker零额外FD严格通过，没有FD白名单或把宿主对照改成“已隔离”。

## 退出状态与下一批

root自有PG实例 `2ed89d08600b03487c9f844dbfb1fceb` 已受管停止，私有配置/PGDATA保留；3100/55421–55424无监听。mac控制根空，合成进程/Unix/TCP/Mach同伴结束；Linux每个自有容器经核停止后移除，控制目录空，镜像/私有证据留在本次临时CI runner。作者两条平台流均已结束本批开发。

本批只交脚本层受控launcher可行性，不接Studio、业务表或P1正式入口。B2-2先做可信桥接与生产模块迁移，再做证据/资源归档及后台。迁移后必须在最终目标worktree、真实生产构建路径重新核能力；不能仅因本批通过便导入任意包。四卡内测草案的内容、素材及正式发布闸门保持独立，旧D1-D聊天继续暂停。

后继核验记录：预检最终交付head `1f6f3880f1d5c920835f5cf235c2a93b28588c29` 的[普通CI38183785073](https://github.com/aning0922/quiz-forge/actions/runs/38183785073) checks/database及[媒体CI38183785046](https://github.com/aning0922/quiz-forge/actions/runs/38183785046/job/114601687474)均实际success；31+11矩阵再次通过，关键stop-loss与控制清理均通过。有限观测为OBSERVED：真实kernel6.17.0-1022-azure/x64、worker Node20.20.1/sharp0.35.5/libvips8.18.7；一项16MP PNG测量peak88,797,184 bytes，另一项16MP PNG解码536ms，不拼成同一次测量。本次本地image ID为 `sha256:0ed2a191644a75e6862036f4ca621c96753f735d14feb002734c073655396bea`、profile `7ebda72d1ace5f7f82ec8b7c6de16a6c5bab5c3af8fa792a1888e41470601ac3`；buildInputs与worker摘要保持上述值。旧第九轮身份记录仍真实有效，未被改写成新run。
