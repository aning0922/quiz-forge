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

## 501e9e6 / b31aae0 真实流水线检查点

501e9e6交付闭集Next driver与Linux CI接线。独立Astra对driver公共入口/同字节断言/owned进程退出及workflow固定target调用均未发现P1/P2；另用实际公共类型对生成路由做纯内存语义检查，0诊断。该提交普通CI38191966212的checks/database均实际success；本地835单元、42离线脚本、214真实DB、46驱动、206生产E2E/10既有跳过、格式/lint/类型/构建通过。main构建53trace/8614路径/0违规；自有测试数据库与3100服务已停止。

目标流水线首轮在两平台matrixCodeHash遇到已跟踪linux/common.d.mts而IO_UNSAFE，capability/record均未提交。b31aae0显式允许这一个固定声明文件并将完整字节纳入hash，不开放其他.mts/.d.mts；新增真实字节改变及未知扩展拒绝回归，8项runtime测试通过，root实际库存只读核验成功。声明规则是离线矩阵代码变化，不改已绑定生产source/artifact；后续矩阵必须核新的matrixCodeHash。

b31aae0的Linux媒体CI38192275991实际success：新的固定fixture构建、未封存关闭检查、target31smoke/11lifecycle、opaque receipt与capability封存、实际Next verify-sealed全部通过。CI检出PR合并树001b702238989ee3283896263b1e87bd7e28fa24；实际source/artifact 1027/74、读取28125566 bytes；deploymentId=d4db1427a132b7d84c24bc4b360b4316fdd8622210492999c71a877cd49323cc，runtimeBundleHash=cc34468ae514d0c73600b234db84444d33c85ecc1f8abe025345fd62aaf7a6c6，profileId=569c7a434f9fe7663ec9bbcc1c62156ae621c821125358b4b4c1ed1ff71af73c。实际公共image解码confirmed，两种P1合成包各4资源accepted且复制字节/归属/报告匹配；错Product/authored/未知schema/坏ZIP/JSON/media均拒绝；取消/过期零媒体；自有Next进程和端口均退出。该证据只属于该Linux目标构建，不授予Mac或B应用能力。

Mac在501e9e6构建与未封存三检查通过；deploymentId=8d0b5e69f5d536d61436dab6b8dbc6a848df2606ffc02830d74cb9b9b6142f10、source/artifact1027/74、27503632 bytes。b31aae0首轮实际target矩阵执行64项后HARNESS_FAILED：issued fsync deadline/abort、unknown stop late close、parent crash restart四项失败；控制记录保留两项，provision返回MATRIX_STOP_UNCONFIRMED且capability/record均未提交。未删除guard或假定停止，已交A-R诊断具体owned进程事实与target脚本适配，Mac矩阵与封存后入口仍未验收。当前B2-2A继续实施，未进入B业务表。

上述Mac失败轮已完成一次性离线合成夹具隔离维护：A-R与独立Astra分别用当轮固定production identity-helper查询原owner/worker，两者均严格kernel present:false；helper/active摘要、模式和inode均稳定，capability不存在。总控准备的单次固定脚本经Astra只读复核后执行成功：先O_EXCL保存原active字节和有限before审计并fsync，最后再次核身份，再整体rename原control（active+空guard同inode单元）到private maintenance目录，双父fsync后重建空0700 control并写retired审计。没有kill/删除原对象、没有receipt/capability/业务quota写入；原轮永久failed、原时限与stdio证明仍unconfirmed。审计仅记录原provision命令已经结束，不伪称补获内部历史close证明。本维护不是普通recover或新的生产API，所有producer在窗口中停止；后续必须修复脚本并跑全新矩阵。

428b62a修订issued-host：target原绝对5秒期限不重置，实际issued fsync屏障后才跨原截止点或同步abort。独立18纯测试与内存语义审查通过；root已实际分别执行deadline/abort，两者均命中issued、平台启动0、not-started、controlEmpty，返回准确DEADLINE_EXCEEDED/CANCELLED。该局部实测不能代替后续整轮。

bdd5c51整合剩余Mac离线用例修复：精确owned spawn屏障、UNKNOWN记录可保留spawned但完整身份不变、同一lateClose监督期限、parent单行JSON+LF就绪与任意分片、失败drain后停止依赖用例。生产执行/cleanup预算不变；仅closed fault worker自然退出延至12秒以覆盖原5+5窗口。独立草稿审查发现控制读取跨deadline后仍返回spawned的P2，修后重跑原探针已拒绝；新增20纯测试独立全部通过，限定五文件无剩余P1/P2。root两组38项及离线库存8项通过。6420019的普通CI38193682641与Linux目标媒体CI38193682534也已实际success；最新Mac完整三轮及重新封存尚待执行，A仍未退出。
