# P4 独立审查记录

本阶段沿独立 A 数据聊天、B 体验聊天和 Astra 非实施审查聊天。以下为具体提交的局部审查，**不是整个 P4/P5 已通过**。实际 HTTP、数据库、生产浏览器、精确实现登记和首款现场仍需后续验收。作者 2026-10-18 已批准的内容与视觉内测基线继续有效。

| 准确提交                                                        | 审查范围                                                                 | 独立结果与实际证据                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6b5b4ef（含 5916516）                                           | 规范 JSON、状态/答案/游标摘要、六角色 source/runtime 映射                | 无 P1/P2。15 测试通过；最大 100 题规范数据与 8 类篡改拒绝。Chromium 156 真执行，104 输入 browser bundle 无 Node/DB/业务实现依赖；Node/browser 摘要一致，ASCII 排序与安全 own map、getter 零调用、宽 session 拒绝、pageErrors=0。                                                                                                 |
| 62be5e9                                                         | AccessKey/grant 独立 codec 与 CSRF                                       | 无 P1/P2。21 相关测试通过；8 固定合成向量在 Node oracle 和真实 Chromium 156 交叉核验。每端 16 token 摘要、1024 token 尾位、512 CSRF 尾位、456 跨 kind/grant/旧 Studio 反例符合。无 crypto 时 4 入口明确不可用，Math.random 调用 0；旧 Studio 也反向拒绝 consumer 凭证。                                                          |
| 064c4be（含 b3c84c7、bff9eda；原 A 7515406/c5c6934、B 52cd7a4） | play/access/report 领域合同与六纯视图/PNG 接口                           | 无 P1/P2。15 领域测试及 4 独立反例通过。局部自洽 hash 的伪父反例被真实 parent 比较拒绝；报告 8 类交叉字段篡改拒绝。100 play 列表 103401B、64 长资源行集合 26592B、50 Key 示例页 45123B 在预算内。Chromium 156 真实 browser bundle 115 输入，无评分执行、server snapshot、server-only、DB；5 类篡改拒绝、pageErrors=0。           |
| cdb5cbf                                                         | 有限错误、save/complete 与运营原请求核实联合                             | 无 P1/P2。49 相关测试及 5 独立测试通过。40 组 base/current/hash 矩阵分别做 120 save 与 120 complete 分类；有 report 的 48 complete/4 save 分类正确；运营 10 分支 34 改标分类互斥。真实 Chromium 156，119 输入纯 browser bundle，20 有效分支通过、20 迟到原 binding 与 20 嵌套篡改拒绝、23 有限错误不反射异常哨兵，pageErrors=0。 |
| 50a35a6                                                         | 中性 entry、URLs、三组 public service 签名、bootstrap 固定 route session | 审查进行中。主控 53 项 P4 合同测试、完整 1763 单元及 format/lint/typecheck 通过；A 已只读确认可接其惰性 requestOwner/同事务 ports。不得提前记无剩余问题或完整冻结。                                                                                                                                                              |

独审证据保存于独立审查检出的 ignored `.cache/p4-review/`：foundation/credential/domain/resolution/operator 的安全 JSON 结果与 browser 探针；只使用未登记合成值，不包含真实 Key 或首款私有结果。审查未使用主控/A/B 数据库、native、Next 或 3100。这里记录实测范围，browser bundle 自洽不代替真实服务授权、源文案真实性或完整报告服务端字节验证。

## 冻结前待办与边界

- A 的私有 ports 草稿需补齐 selector 读 play、有界 play/Key 列表、独立 exchange budget port、按可信父 revision/三 hash 读取来源及实际有界资源 IO，不能让应用服务临时直接跨领域 SQL/FS。
- 纯 SQL owner 使用独立每进程 8 槽、真实关闭确认后释放的方案待独审；尤其开库早失败不能吞 close 失败后释放租约。四个 FS 任务槽继续独立，不能以不占 FS 槽为由无限保留 SQL pool。
- cdb5cbf 的 bootstrap helper 只核字节自洽；50a35a6 已追加 expectedSessionId，后续 controller 仍须统一授权代次，拒绝迟到旧 grant/旧页面响应。
- 未报告分支的“无 report”由授权的一致事务证明，Schema/hash 不授予此权威。窄 resolve 没有覆盖的 UNKNOWN 保留，不从空读、普通错误、到期或用户取消推断服务器从未执行。
- report view 的完整 snapshot SHA 是服务端字节标识；浏览器只验证实际拿到的 display/binding/mapping 字节。精确实际评分与正文来源必须由可信服务及固定实现建立。
- HTTP/Cookie/实际 stream 预算、0018/guard/并发/保留图、consumer 实现闭包、四宽视觉、真实 PNG 和 P5 首款现场均尚未验收；不使用这些合同测试替代。
