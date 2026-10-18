# P4 独立审查记录

本阶段沿独立 A 数据聊天、B 体验聊天和 Astra 非实施审查聊天。以下为具体提交的局部审查，**不是整个 P4/P5 已通过**。实际 HTTP、数据库、生产浏览器、精确实现登记和首款现场仍需后续验收。作者 2026-10-18 已批准的内容与视觉内测基线继续有效。

| 准确提交                                                        | 审查范围                                                            | 独立结果与实际证据                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6b5b4ef（含 5916516）                                           | 规范 JSON、状态/答案/游标摘要、六角色 source/runtime 映射           | 无 P1/P2。15 测试通过；最大 100 题规范数据与 8 类篡改拒绝。Chromium 156 真执行，104 输入 browser bundle 无 Node/DB/业务实现依赖；Node/browser 摘要一致，ASCII 排序与安全 own map、getter 零调用、宽 session 拒绝、pageErrors=0。                                                                                                 |
| 62be5e9                                                         | AccessKey/grant 独立 codec 与 CSRF                                  | 无 P1/P2。21 相关测试通过；8 固定合成向量在 Node oracle 和真实 Chromium 156 交叉核验。每端 16 token 摘要、1024 token 尾位、512 CSRF 尾位、456 跨 kind/grant/旧 Studio 反例符合。无 crypto 时 4 入口明确不可用，Math.random 调用 0；旧 Studio 也反向拒绝 consumer 凭证。                                                          |
| 064c4be（含 b3c84c7、bff9eda；原 A 7515406/c5c6934、B 52cd7a4） | play/access/report 领域合同与六纯视图/PNG 接口                      | 无 P1/P2。15 领域测试及 4 独立反例通过。局部自洽 hash 的伪父反例被真实 parent 比较拒绝；报告 8 类交叉字段篡改拒绝。100 play 列表 103401B、64 长资源行集合 26592B、50 Key 示例页 45123B 在预算内。Chromium 156 真实 browser bundle 115 输入，无评分执行、server snapshot、server-only、DB；5 类篡改拒绝、pageErrors=0。           |
| cdb5cbf                                                         | 有限错误、save/complete 与运营原请求核实联合                        | 无 P1/P2。49 相关测试及 5 独立测试通过。40 组 base/current/hash 矩阵分别做 120 save 与 120 complete 分类；有 report 的 48 complete/4 save 分类正确；运营 10 分支 34 改标分类互斥。真实 Chromium 156，119 输入纯 browser bundle，20 有效分支通过、20 迟到原 binding 与 20 嵌套篡改拒绝、23 有限错误不反射异常哨兵，pageErrors=0。 |
| 50a35a6                                                         | 中性 entry、URLs、三组 public service、bootstrap 固定 route session | 无 P1/P2。53相关测试通过；5字段 session 预期逐项拒绝、4类敏感字段注入拒绝、40 URL边界、1263171B超限投影拒绝。Chromium156 bundle112输入，无Node/DB/server snapshot/service-contract；entry/跨scope/bootstrap/exchange kind/resource selector实测通过，pageErrors=0。                                                              |

独审证据保存于独立审查检出的 ignored `.cache/p4-review/`：foundation/credential/domain/resolution/operator 的安全 JSON 结果与 browser 探针；只使用未登记合成值，不包含真实 Key 或首款私有结果。审查未使用主控/A/B 数据库、native、Next 或 3100。这里记录实测范围，browser bundle 自洽不代替真实服务授权、源文案真实性或完整报告服务端字节验证。

## 实施设计冻结与后续验收边界

- A 已在正式设计 a85914b（root 6ae499a）补齐 selector 读 play、有界列表、独立预算、父来源和实际资源 IO 五处 ports；session INSERT 与 void 在同 Key 锁下双向排斥，Key 页 RR 一致快照。独审认可作为实施基线；数据库触发器和真实并发仍待实测。
- 独立每进程 8 槽和 bc1dba1 资源 body 单次交接方案经独审达到实施条件。开库分配 Sql 后同步交 owner、观察所有真实 end；opening/work settled 且全 close 成功才释放，无 TTL/队列。实际 observer、fault 和 stream drain/重复交接仍需验收。
- cdb5cbf 的 bootstrap helper 只核字节自洽；50a35a6 已追加 expectedSessionId，后续 controller 仍须统一授权代次，拒绝迟到旧 grant/旧页面响应。
- 未报告分支的“无 report”由授权的一致事务证明，Schema/hash 不授予此权威。窄 resolve 没有覆盖的 UNKNOWN 保留，不从空读、普通错误、到期或用户取消推断服务器从未执行。
- report view 的完整 snapshot SHA 是服务端字节标识；浏览器只验证实际拿到的 display/binding/mapping 字节。精确实际评分与正文来源必须由可信服务及固定实现建立。
- HTTP/Cookie/实际 stream 预算、0018/guard/并发/保留图、consumer 实现闭包、四宽视觉、真实 PNG 和 P5 首款现场均尚未验收；不使用这些合同测试替代。

实现 metadata b982bc2 两文件独审无 P1/P2：3 原测试加 2 独立测试通过；7类闭包/路径/未来协议反例及1098831B总量拒绝。不存在路径重算摘要仍只作为自洽metadata被接纳，符合明确边界，不产生available或真实文件证明。证据 metadata-probe-result.json。

860b687 只读 gate 提取独审无 P1/P2：旧 13 与新增 3 测试、另 5 独立反例通过。11 类输入新旧结果/错误/override 读取顺序一致；旧基线仍 3 descriptors/3 available/51 sourceFiles/280 lockRecords。consumer 10 类摘要/错身份/重复/数量反例在源文件读取前拒绝；未登记的虚构路径 metadata 不读其 closure，精确选中后真实 ENOENT 拒绝；font file/coverage/license/bytes 独立检查有效。证据 gate-probe-result.json。真正 consumer catalog/compiled mapping/host/closure 仍另验，未接 build 入口。

## 消费者纯显示与批准首款离线预检

B b476f37（root d3150ea）实现六纯视图、独立样式、精确组件映射、server projection 和 Canvas PNG；纯代码独审仍进行中。主控实际 14 专项与完整 1783 单元、format/lint/typecheck 通过。B 独立 Chromium 合成验证 45 图全部实看；15 阻塞组合无编辑入口、减少动态效果及 PNG 资源 hash/字体/失效代次反例通过。root 实看其中 4 个原图，未见 P1/P2。

root 另核精确批准 ZIP/content/全部 9 路径 8 独立素材，实际固定引擎跑四个作者评分见证，经新 server projection 生成 12 题和四份选中 display。entry 14623B，四 display 为 5136/5194/5179/5226B；真实 Chromium156.0.8078.4 四宽 30 图的溢出/正文字号/交互目标检查通过，页面错误0，四 PNG 均1080×1920，临时 browser/server 已关闭。root 实看 6 页面原图及全部4PNG，文字与图像完整；其他24截图仅自动几何断言，未声称全部人工看完。保留两项P3：320暂歇操作按钮碎行、已含姓名/副标题的报告标题下重复同一文本，B在controller接入时做局部修正。

这些实际首款图片和投影仍仅本地私有；Git 只收 [预检安全记录](qa/p4-first-product-display-preflight.json)。离线 harness 的已完成视图输入来自作者见证，显式标记无持久化，不能冒充最终用户报告、grant 授权、P4/P5 或商业发布验收。

## HTTP 基础当前整改项

05647fe（B 3c2357d）的来源/Cookie/JSON/有限响应工具原7测试通过，但独审发现两项 P2，尚未关闭，不签本批通过：

1. JSON read/yield 循环反复与同一个 pending interruption Promise race，快路径结束不移除旧 reaction。独立合成2字节正文加128/8192/32768空chunk，保留reaction为134/8450/33794，均远未到5秒；固定buffer和timer不足以保证等待状态常数。B须改单一外层race或可清理的有界机制，保留原deadline/取消/让出事件循环并补随chunk增长的反例。
2. 私有固定headers之后展开extra，运行时宽对象可覆盖Cache-Control/Referrer-Policy/nosniff并增加CORS。独立实际响应已复现。B须只显式提取Set-Cookie或严格拒绝未知extra，不能依赖TypeScript窄类型。

反例位于独审ignored http-boundary-probe-result.json；仅合成内存Request，无DB/真实token。后续handler的原token隔离、授权、单次owner body交接和完整业务仍另验。
