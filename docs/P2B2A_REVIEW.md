# B2-2A 独立审查与集成记录

2026-10-12。状态：实施中，未验收。合同见[STUDIO_P2B2_VALIDATION](STUDIO_P2B2_VALIDATION.md)，[Draft PR #12](https://github.com/aning0922/quiz-forge/pull/12)堆叠于已验收媒体预检#11；不以旧平台矩阵代替生产迁移后的验收。

## 合同与第一次接口交付

合同fce1246已经独立Astra确认：A-R单写统一上下文和全部原shared/macOS/Linux迁移；A-V单写P1/validation。首次停止固定共用5秒收尾，运行失败中断整包；A隔离Next fixture与B真实业务构建分别取得身份及封存。无DB/HTTP业务/UI。

A-R原08ea691→root6d4b09b交公共opaque context、strict LaunchResult/RuntimeBinding及有限解析。当时runner/binding仅明确failclosed，没有成功stub或媒体迁移完成声明。作者23定向通过，独立Astra实测发现三项P2：

| 问题                                                             | 修订                                                               | 独立结果                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| business/image计时器早到不重排，只能API轮询补停止                | 原37a85e3→2b13cf7，同绝对期限ceil/min1重排                         | 已关闭；不用API轮询即可abort，原deadline/cleanup保持 |
| 首次更短cleanup在同步abort广播后才发布，listener读到5200而非1200 | 原022ddbf→5ff4d86，在广播前原子发布最终状态，含observe发现过期路径 | 已关闭；两条实际同步listener时序通过                 |
| STOP_UNCONFIRMED的public返回not-started，不能通过自身Schema      | 同022ddbf，保留unknown组合，不放宽Schema                           | 已关闭；七种停止原因实际自身parser回归通过           |

修后34媒体契约测试通过，Astra另执行4个受控时钟场景/7种停止原因。当时平台真实执行尚未接入，这些只证明上下文和接口边界。

## P1 canonical 与报告合同

A-V原9d2a8da→root7fb2b5e交独立P1 canonical预算、Unicode policy及strict最终报告。F1仍1MiB；P1显式content2MiB/manifest512KiB。报告只存value/bytes/hash，避免重复canonicalText；parser原始issues不作为最终报告。

root发现预算索引可接受继承键constructor等，非数字maximum会绕过上限；原141367b→36d9d46先严格限定content/manifest，补继承键/depth/unknown回归，定向通过。

Astra实际构造约50KiB合成ZIP，102题且索引101的prompt类型错误；真实P1返回14项失败issues（媒体未运行），原报告path数值max100拒绝该真实证据，而索引100正常。原40b8ba6→root313ff69按原始JSON字节预算限定错误路径数值，并补真实validator回归，独立复核已关闭。非法内容的错误位置不能受合法题数上限代替约束。

原626f64f→rootbf3f8ff追加完整CandidateResult/私有句柄/envelope合同。独立审查发现两项P2：私有签发接受与原文件不同的解析对象；未知停止错误可以搭配已停止/IO结束证据。原0c890cc→root33db24a只从被报告hash绑定的原始文件提取事实，并严格要求未知组合需要维护；独立复核已关闭。MediaFact只保存原content资源索引及完整LaunchResult，避免重复路径/hash；候选/报告身份另绑定资源声明。三attempt×64最长正常decoded的实际metadata61,625 bytes/envelope64,640；修订后unknown场景48,335/51,350。64KiB仍硬限，B的控制字段与开销须另冻，不声称任意未来envelope都可容纳。

## 同字节可信桥接

原6aae0d1→rootbf20e0e将完整P1和ZIP核心复用到后台可信入口，先固定输入快照，再注入固定隔离inspector；不先裸解码。相关17文件287单测通过，使用受控媒体替身，不能代替真实平台验收。独立Astra另测65项及异常时序，确认四项P2：binding未知停止被前置checkpoint丢弃；binding意外异常/畸形返回误判整体IO已结束；cleanup超时与任务结束竞态生成矛盾证据；等待IO未响应收尾期限进一步收紧。

原634a860→root29e2b49修复四项问题：先消费严格binding权威结果再checkpoint；异常返回保留未知；超时决策固定IO未确认；停止期间至多10ms重读同一个只收紧的cleanup期限。Astra重跑原10场景全部通过，期限收紧探针在收紧后约1.2ms返回、比原期限提前约258ms；正常有限失败不被误判未知，相关6文件72项通过。四项P2已独立关闭，成功context仍由调用方拥有。

## 平台核心和构建进度

原d3a4313→root493fdf8使脚本与生产共享同一图片precheck/output实现；原6dfe735→9d549c1分离仅身份查询的mac生产helper，与离线probe复用query实现。31项共享/平台纯控制通过；尚未跑迁移后的真实mac/Linux完整矩阵，不沿用旧seal。

原27c46b8/ae8ff29/5b9df19→root2e1749f/937a94d/b643358迁入macOS/Linux生命周期、控制与命令核心，脚本复用相同实现；50媒体单测通过。该检查点独立Astra发现两项P2：共享UNKNOWN在早退/child close后被降级；mac同步control清理跨过cleanup后仍返回确认。该检查点普通入口的平台身份接线及实际完整矩阵仍未完成；后续闭合见下节。

总控隔离Next构建定位probe已成功，精确证据和接线决定见合同第5节。源码/产物manifest工具已实现，29边界单测通过；独立审查复现依赖入口或内部加载非标准扩展名文件未入hash的P2，总控已改为两个固定包根的全部普通文件，并增加实际require行为变化回归。Astra重跑29项及原入口/内部加载探针，均正确拒绝字节变化，该P2已关闭，限定构建工具范围无剩余P1/P2。A-R负责平台component/seal，A-V负责同字节可信validator，实际完整生产执行和能力重封存仍待集成。迁移后31项脚本控制回归通过；格式/lint/type已在首批接口集成运行，不代表后续完整改动通过；最终阶段全套工程、平台与独立审查尚未完成。

中间b2f702e的普通CI38187099583：database成功，checks因ES2017下BigInt字面量失败；root2e5d6b8改用BigInt()，完整本地typecheck通过。平台CI38187099677因旧离线CLI缺react-server condition、导入server-only失败，尚未进入真实平台矩阵，脚本适配由A-R修复。root实际main build通过53trace/8614路径/0违规；随后manifest构建正确拒绝Next生成的组可写0664文件。该检查点决定补仅离线构建产物的有界权限归一化，不放宽普通verify条件；该main构建还没有capability seal。

## 生产入口及离线封存增量检查点

root06fc006/3618475关闭共享UNKNOWN降级及mac/Linux收尾返回缺口；588be99固定运行角色、策略文件与strict控制记录。普通入口c153a1b接入实际部署清单和sealed平台；a3801b8关闭wrapper先返回CANCEL掩盖UNKNOWN及可信在途IO异常误报not-started。b7e7544保留经strict parser核实的owned runId/profileId，decoded或有限失败在共享context升为UNKNOWN后只改停止投影，不换身份。独立Astra重跑原场景及补充对照5项，wrapper/engine共41项通过，累计登记的普通入口P2全部关闭；这不是目标平台验收。

5d779a7修复Linux背压的绝对deadline映射及实际OOM inspect时序；3021d80使stdin EPIPE立即走CANCEL与owned kill，stopIssued与首次原因分开。独立原stdin探针已关闭。中间5d779a7的普通CI38188941135两个job实际success；媒体CI38188941100实际31smoke/11生命周期通过，背压DEADLINE且confirmed、OOM WORKER_FAILED且oomKilled、丢失stop应答确实发生于running容器并确认停止。Linux内核6.17.0-1022-azure、worker Node20.20.1/sharp0.35.5/vips8.18.7；这些是迁移核心的旧candidate矩阵，不是新固定target/actual Next seal。

954e7f0离线hardener已通过32项定向，独立Astra另5文件系统探针及46相关项通过。真实中间main构建1,133文件/225目录已归一化为0600/0700，manifest可生成并正确拒绝源码漂移；该构建早于后续源码，不作为最终交付产物。

9d05841引入固定target的离线准备/矩阵/opaque receipt封存，0f6bb24关闭rename前最后lstat和控制/代码hash后未重新核deadline两项P2。独立11项及原期限探针通过：过期receipt不改旧能力，IO中断不被签为成功。固定target适配5e72a9d调用同生产core，离线故障/探针只通过闭集角色，不向普通入口开放。仅支持总控维护期间独占串行执行；空control不是持续锁，无热封存支持。

bae2b2a将Next单个固定Sharp alias和六包实际宿主native闭包纳入部署/来源身份；完整规则见合同5节。真实Mac libvips单文件18,231,688 bytes，因此只有sharp-runtime角色提升为32MiB，其他限制不变。独立审查发现native自身另一条libvips映射未绑定、opendir后lstat异常泄漏Dir两项P2；已修复并独立重跑原探针。实际合成binary执行从1变2时verify返回DEPENDENCY_INVALID；注入EIO后Dir.read返回ERR_DIR_CLOSED；55项全部通过。Linuxnpm元数据只证明声明与文件名，不冒称ELF或运行实测。

c0da583修复target矩阵两处旧脚本假设：延迟事件循环必须先观察同owned身份的issued→spawned屏障，再卡过原绝对deadline，并严格断言真实运行/DEADLINE/confirmed；失败封存用真实新opaque接口的invalid receipt核固定能力字节或不存在状态完全保留。独立新增5项纯测试及正常/UNKNOWN/迟到成功/非法输出四组闭集模拟通过，两项P2已关闭；仍不替代实际平台矩阵。

实际Next中间fixture已完成编译、定位与三种关闭行为：未封存RUNTIME_IDENTITY_UNAVAILABLE、取消OPERATION_CANCELLED、过期OPERATION_TIMEOUT，均无候选/零媒体/not-started且IO settled；公共入口与编译宏被实际调用，3111自有服务最终close、进程组ESRCH且端口释放。此构建的source/artifact为1,027/74，读取27,495,091 bytes；后续native-edge源码变化已使旧manifest失效。新源码仍须完整重建、目标macOS 66×3及Linux31+11、离线封存、sealed公共入口两类P1候选和反例、阶段全套回归，完成前B2-2A保持未验收。
