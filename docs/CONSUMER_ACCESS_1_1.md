# P4 访问入口 1.0.1 契约

2026-10-20。主控采纳 Astra 的 `access-gateway-versioning-contract-proposal.json`，冻结以下最小范围。原 P4 内容、评分、保存、完成、报告和来源校验协议不变；本文件只澄清认证前入口与认证后固定实现的选择边界，并修复同文档换 Key 的 P2。作者的同一内容与视觉内测批准继续有效，不增加发布授权。

## 问题与阶段出口

冻结的 `ConsumerAccessV1` 只在首次挂载读取 fragment。真实组件已独立复现：空 `/access` 后加入 Key B，按钮不会出现且 fragment 留存；已读取 Key A 后同文档换成 B，点击验证仍会提交 A。完整文档导航能成功，不能抵消这个入口行为缺陷。P4/P5 不得在 P2 未关闭时无条件验收。

旧 `consumer-folio-cabinet@1.0.0` 的 descriptor、entry `193b48c92352d731c9c2e41de05316471a2c46f58d8e2f2596995ee531d974a1`、全部闭包文件及已有 play/Key/report 保留原样。不原地修补旧 Access、重算旧 entry、重绑旧 play，或清理失败现场来取得通过。

## 两个明确的选择边界

认证前 `/access` 是全局平台入口，不能在读取未验证 Key 前选择它所属商品的代码。保留现有 `/access#key=...` 地址和全部 HTTP 路由，以代码中明确的完整 `consumer-folio-cabinet@1.0.1` identity 和静态 Access export 绑定新入口。不得按 descriptor 顺序挑 latest、从 URL/Key/商品元数据选择模块或动态导入源码。

入口继续使用既有 `CONSUMER_PROTOCOLS_V1.access` 和 exchange 输入、响应。响应仍只给会话引用及 play/report 目的地，不增加 renderer 选择。导航后的 entry/report 必须以已验证的 `renderer + mapping + font` 精确解析：旧 Key 对应旧 session/play 和旧 `193b...` runtime，新 play 对应新 tuple；无 nearby/latest/default 回退，不重新评分或解释历史报告。

旧 descriptor 记录其历史 Access 根文件，不表示未验证 Key 可以选择全局入口，也不表示旧 Access 源码已被修复。新平台入口可服务旧 Key，但认证后的旧实现与旧报告快照保持不变。

## 新实现与登记

- B 新增 `src/features/theme/consumer-v1-1/access.tsx`，静态导出 `ConsumerAccessV1_1`；需要的生命周期辅助模块也仅放在新目录。可以复用未改的 v1 fragment codec、client、styles 和其他纯函数，不编辑旧闭包文件。
- 新 `consumer-folio-cabinet@1.0.1` descriptor 以该 Access 为 browser entrypoint，复用原 host、client renderer、server projection、六个视图、mapping、font、engine 的原字节。包版本与视图组件版本分开；未修改的 runtime component tuple 仍为 1.0.0。
- root 追加新 descriptor、独立 closure/implementation/entry SHA，以及两个明确的编译 identity 白名单。保留旧 metadata 和旧 tuple 的能力；不得只放开任意 `d.version`。
- root 建立独立的全局 gateway binding，记录完整 identity、静态模块/export 与既有 access 协议。官方 gate 和测试核对它属于新 descriptor 的 browser entrypoint，实际页面用非可见元数据记录 gateway identity；产品界面不显示工程标识。
- 新 P5 play 和本批新消费者 E2E 明确选择 1.0.1，仍使用原批准 parent、内容和八张素材。旧 play/Key/report 不改。数据库现有通用版本字段及约束已支持该增量，0018、catalog 指纹和业务 DDL 不变。

## 入口行为

1. 首次完整文档落地及真实同文档 fragment 导航都必须先同步取值、擦除地址中的 fragment/query，再允许人工验证。无效、重复、空或带 query 的输入不能保留旧 Key 的可用状态。擦除失败应关闭验证入口，不能继续使用旧 Key。
2. 每次有效或无效的新输入都使旧授权代次失效。中止原 transport，旧响应、重定向、错误状态和 `finally` 不得修改新代次。中止不等于服务端事务回滚；保留原链接重新核实的语义，不自动交换或重试。
3. 必须考虑 URL 已改变而 `hashchange` 回调尚未执行的窗口：旧异步成功不能越过已变化的地址跳转。连续 hash 事件、擦除导致的地址变化和重复挂载不能重新启用旧 Key，也不能丢弃刚完成的有效捕获。
4. raw Key 仅在必要的私有内存中存活，不进入 React 状态、DOM、浏览器存储、日志、query/path。事件和测试记录不导出 raw URL、事件 old/new URL 或请求正文。
5. 不清除其他业务 pending，不自动重新发放、转向另一 play 或修改已有报告。既有服务期限、token/CSRF/source 规则不变。

## 所有权与验收

root 负责本契约、登记/目录/解析器/gate、App 全局 gateway 与新 play 的明确选择、集成、构建、运行身份、3100 和最终证据。B 负责新 Access 与相应纯逻辑/真实浏览器证明，继续完成测试入口完整导航、逐题 identity 和完成采用终态的必要就绪修复。A 负责数据侧新旧精确 tuple 的兼容验证及受管合成旧记录准备；不增加迁移或改写旧数据。Astra 负责增量独审和 P2 闭合。

必须同时满足：

- 旧 descriptor/全部原闭包字节不变；官方 gate 验证两份完整实现和明确 gateway 绑定；错误 SHA、混配 tuple、未知版本拒绝。
- 真实浏览器覆盖空→B、A ready→B 只发 B、A 在途→B 的旧迟到结果、无效/重复/query 输入、擦除失败、连续事件和重复挂载；无自动 POST/重试、无 raw DOM/存储/网络 URL 泄漏。
- 旧 v1 Key 经新 gateway 仍恢复原 session/play、原 renderer 和同一报告；完成后的过期 Key 仍仅恢复原只读报告。新 Key 精确使用新 tuple。合成准备、真实服务、浏览器和只读核验的证据范围分别记录。
- 新生产构建、实际 HTTP/browser 回归、新媒体运行绑定及完整 E2E 通过；进程实际退出、清理资格和失败现场保留继续遵守原规则。
- 历史人物首款只在 P4 技术出口后运行，内容与素材沿原批准 hash；无 main 合并、生产迁移、部署或发布。

标准完整文档导航的测试修复只证明该入口路径，不能冒称旧 Access 已支持同文档换 Key。本阶段完成前，P4/P5 仍未验收。

## 实施登记检查点（2026-10-20）

B 的生产 d7f55fd（root 758a8d8）及浏览器证明 e979250（root 7ae68ca）已集成。新增 entry 为 `dc195a2f9bdcd158ab569b01191150b44086b8c3185b8c615c2007a01251308f`，implementation SHA 为 `beaf4ba62e7c9c8546a3c0914619d83c9b4b738332ed7c6e43d6138262d12a47`，75 个源文件、3 个构建输入、268 条 lock 记录；旧 mapping/font/六视图字节保持。正式 gate 同时验证旧193b与新dc195两个完整实现及实际 App→gateway→新 Access 静态渲染关系。

Astra 独立原两反例、19 项生命周期单测及真实 SSR／hydration／StrictMode 20 场景全部通过，17 次均显式人工 POST 且匹配预期合成输入，无自动交换、页面／水合错误、HTTP URL/header 凭证泄漏；浏览器与独立 HTTP 实际关闭。最初仅统计 JSX 名称的 gate 被 Boolean 包裹反例击穿，现已限定目标 export 的实际唯一 return、直接子组件与纯 binding 元数据；原反例及 App Boolean、shadow、错误表达式均独立拒绝。当前实现范围无未结 P1/P2；此结论不代替实际业务兼容和 P4/P5 验收。

主控完整 format/lint/type、183 文件1961单元及生产构建通过（103 traces、23855 paths、0私有违规）；私有兼容与新 P5 sibling 脚本 typecheck 通过。新部署70740d8d、运行包93c09e52的main媒体66项×3轮实测全部通过，原始候选记录核对完成、操作均停止、control空。24个生成Next cache文件118037098B因超出已有隔离上限被原样移存，2290个非cache条目的bytes/mode/inode保持，未放宽限制。原632d部署与f73c运行证据单独保留。

旧Key真实兼容尚待浏览器和只读audit：root独立55426合成实例通过真实服务生成1play／2Key／2session／1report，已close并正式停库；该seed不是UI发行或gateway证明。新完整消费者八场景、自然到期后旧报告回看及首款39eb实际现场仍待完成，旧失败场景全部保留。原P5脚本未覆盖；新增live-v1-1与audit-v1-1 sibling仅补八次实际gateway采样与精确新tuple核验，静态独审通过，尚未执行。
