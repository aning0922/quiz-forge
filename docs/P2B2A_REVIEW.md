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

Astra实际构造约50KiB合成ZIP，102题且索引101的prompt类型错误；真实P1返回14项失败issues（媒体未运行），原报告path数值max100拒绝该真实证据，而索引100正常。登记P2，已派A-V按原始JSON字节预算定有限索引上界并补真实validator回归，尚待整改复核。非法内容的错误位置不能受合法题数上限代替约束。

原626f64f→rootbf3f8ff追加完整CandidateResult/私有句柄/envelope合同，独立审查进行中。MediaFact只保存原content资源索引及完整LaunchResult，避免重复路径/hash；候选/报告身份另绑定资源声明。三attempt×64最长正常decoded的实际metadata61,625 bytes/envelope64,640；unknown场景48,323/51,338。64KiB仍硬限，B的控制字段与开销须另冻，不声称任意未来envelope都可容纳。

## 平台核心和构建进度

原d3a4313→root493fdf8使脚本与生产共享同一图片precheck/output实现；原6dfe735→9d549c1分离仅身份查询的mac生产helper，与离线probe复用query实现。31项共享/平台纯控制通过；尚未跑迁移后的真实mac/Linux完整矩阵，不沿用旧seal。

总控隔离Next构建定位probe已成功，精确证据和接线决定见合同第5节。独立小代理正实施有界源码/产物manifest工具；A-R负责平台component/seal，A-V负责同字节可信validator，实际完整生产执行和能力重封存均待后续集成。当前相关8文件95单测通过，格式/lint/type检查已在首批集成运行；最终阶段全套工程、平台与独立审查仍未完成。
