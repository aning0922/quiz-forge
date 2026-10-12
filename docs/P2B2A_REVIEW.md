# B2-2A 独立审查与集成记录

2026-10-12。状态：实施中，未验收。合同见[STUDIO_P2B2_VALIDATION](STUDIO_P2B2_VALIDATION.md)，[Draft PR #12](https://github.com/aning0922/quiz-forge/pull/12)堆叠于已验收媒体预检#11；不以旧平台矩阵代替生产迁移后的验收。

## 合同与第一次接口交付

合同fce1246已经独立Astra确认：A-R单写统一上下文和全部原shared/macOS/Linux迁移；A-V单写P1/validation。首次停止固定共用5秒收尾，运行失败中断整包；A隔离Next fixture与B真实业务构建分别取得身份及封存。无DB/HTTP业务/UI。

A-R原08ea691→root6d4b09b交公共opaque context、strict LaunchResult/RuntimeBinding及有限解析。当前runner/binding明确failclosed，没有成功stub或媒体迁移完成声明。作者23定向通过，独立Astra实测发现三项P2：

| 问题                                                             | 修订                                                               | 独立结果                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| business/image计时器早到不重排，只能API轮询补停止                | 原37a85e3→2b13cf7，同绝对期限ceil/min1重排                         | 已关闭；不用API轮询即可abort，原deadline/cleanup保持 |
| 首次更短cleanup在同步abort广播后才发布，listener读到5200而非1200 | 原022ddbf→5ff4d86，在广播前原子发布最终状态，含observe发现过期路径 | 已关闭；两条实际同步listener时序通过                 |
| STOP_UNCONFIRMED的public返回not-started，不能通过自身Schema      | 同022ddbf，保留unknown组合，不放宽Schema                           | 已关闭；七种停止原因实际自身parser回归通过           |

修后34媒体契约测试通过，Astra另执行4个受控时钟场景/7种停止原因。平台真实执行尚未接入，这些只证明上下文和接口边界。

## P1 canonical 与报告合同

A-V原9d2a8da→root7fb2b5e交独立P1 canonical预算、Unicode policy及strict最终报告。F1仍1MiB；P1显式content2MiB/manifest512KiB。报告只存value/bytes/hash，避免重复canonicalText；parser原始issues不作为最终报告。

root发现预算索引可接受继承键constructor等，非数字maximum会绕过上限；原141367b→36d9d46先严格限定content/manifest，补继承键/depth/unknown回归，定向通过。

Astra实际构造约50KiB合成ZIP，102题且索引101的prompt类型错误；真实P1返回14项失败issues（媒体未运行），原报告path数值max100拒绝该真实证据，而索引100正常。原40b8ba6→root313ff69按原始JSON字节预算限定错误路径数值，并补真实validator回归，独立复核已关闭。非法内容的错误位置不能受合法题数上限代替约束。

原626f64f→rootbf3f8ff追加完整CandidateResult/私有句柄/envelope合同。独立审查发现两项P2：私有签发接受与原文件不同的解析对象；未知停止错误可以搭配已停止/IO结束证据。原0c890cc→root33db24a只从被报告hash绑定的原始文件提取事实，并严格要求未知组合需要维护；独立复核已关闭。MediaFact只保存原content资源索引及完整LaunchResult，避免重复路径/hash；候选/报告身份另绑定资源声明。三attempt×64最长正常decoded的实际metadata61,625 bytes/envelope64,640；修订后unknown场景48,335/51,350。64KiB仍硬限，B的控制字段与开销须另冻，不声称任意未来envelope都可容纳。

## 同字节可信桥接

原6aae0d1→rootbf20e0e将完整P1和ZIP核心复用到后台可信入口，先固定输入快照，再注入固定隔离inspector；不先裸解码。相关17文件287单测通过，使用受控媒体替身，不能代替真实平台验收。独立Astra另测65项及异常时序，确认四项P2待整改：binding未知停止被前置checkpoint丢弃；binding意外异常/畸形返回误判整体IO已结束；cleanup超时与任务结束竞态生成矛盾证据；等待IO未响应收尾期限进一步收紧。已交原开发流修复。

## 平台核心和构建进度

原d3a4313→root493fdf8使脚本与生产共享同一图片precheck/output实现；原6dfe735→9d549c1分离仅身份查询的mac生产helper，与离线probe复用query实现。31项共享/平台纯控制通过；尚未跑迁移后的真实mac/Linux完整矩阵，不沿用旧seal。

原27c46b8/ae8ff29/5b9df19→root2e1749f/937a94d/b643358迁入macOS/Linux生命周期、控制与命令核心，脚本复用相同实现；50媒体单测通过，独立审查进行中。普通入口的平台身份接线及实际完整矩阵仍未完成。

总控隔离Next构建定位probe已成功，精确证据和接线决定见合同第5节。源码/产物manifest工具已实现，29边界单测通过；独立审查复现依赖入口或内部加载非标准扩展名文件未入hash的P2，总控已改为两个固定包根的全部普通文件，并增加实际require行为变化回归。Astra重跑29项及原入口/内部加载探针，均正确拒绝字节变化，该P2已关闭，限定构建工具范围无剩余P1/P2。A-R负责平台component/seal，A-V负责同字节可信validator，实际完整生产执行和能力重封存仍待集成。迁移后31项脚本控制回归通过；格式/lint/type已在首批接口集成运行，不代表后续完整改动通过；最终阶段全套工程、平台与独立审查尚未完成。
