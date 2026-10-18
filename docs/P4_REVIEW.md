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

B b476f37（root d3150ea）实现六纯视图、独立样式、精确组件映射、server projection 和 Canvas PNG；该批独审无 P1/P2。主控实际 14 专项与完整 1783 单元、format/lint/typecheck 通过。B 独立 Chromium 合成验证 45 图全部实看；15 阻塞组合无编辑入口、减少动态效果及 PNG 资源 hash/字体/失效代次反例通过。root 实看其中 4 个原图。Astra 另跑 45 图矩阵及 14 原测试/2 独立反例，验证两引擎六见证、36 映射字段篡改、字体输入修改隔离与 Canvas 编码后失效；object URL 创建/撤销各一次、FontFace 数量恢复原值，临时服务实际退出。

root 另核精确批准 ZIP/content/全部 9 路径 8 独立素材，实际固定引擎跑四个作者评分见证，经新 server projection 生成 12 题和四份选中 display。entry 14623B，四 display 为 5136/5194/5179/5226B；真实 Chromium156.0.8078.4 四宽 30 图的溢出/正文字号/交互目标检查通过，页面错误0，四 PNG 均1080×1920，临时 browser/server 已关闭。root 实看 6 页面原图及全部4PNG，文字与图像完整；其他24截图仅自动几何断言，未声称全部人工看完。保留两项P3：320暂歇操作按钮碎行、已含姓名/副标题的报告标题下重复同一文本，B在controller接入时做局部修正。

这些实际首款图片和投影仍仅本地私有；Git 只收 [预检安全记录](qa/p4-first-product-display-preflight.json)。离线 harness 的已完成视图输入来自作者见证，显式标记无持久化，不能冒充最终用户报告、grant 授权、P4/P5 或商业发布验收。

两项显示 P3 已由 6c63bd1（B 47c3242）修正，并经独审关闭：暂歇操作以 flex 换行保持目标宽度；只有完全相同的姓名/副标题才省略重复次标题，源正文不改。root 实际首款补拍四宽暂歇和 320 报告共五张，实看其中三张；Astra 核五文件完整性并逐张实看，浏览器/服务实际关闭。原 30 图和四 PNG 保留不覆盖，补验见 [安全记录](qa/p4-first-product-display-refinement.json)。

## HTTP 基础整改已复验

05647fe（B 3c2357d）的来源/Cookie/JSON/有限响应工具原7测试通过，但独审发现以下两项 P2；修复 3ac7d91（B 244833b）及 Cookie 消歧 d4dfb70（B b087118）已独立复验关闭：

1. JSON read/yield 循环反复与同一个 pending interruption Promise race，快路径结束不移除旧 reaction。独立合成2字节正文加128/8192/32768空chunk，保留reaction为134/8450/33794，均远未到5秒；固定buffer和timer不足以保证等待状态常数。B须改单一外层race或可清理的有界机制，保留原deadline/取消/让出事件循环并补随chunk增长的反例。
2. 私有固定headers之后展开extra，运行时宽对象可覆盖Cache-Control/Referrer-Policy/nosniff并增加CORS。独立实际响应已复现。B须只显式提取Set-Cookie或严格拒绝未知extra，不能依赖TypeScript窄类型。

原反例保存在独审 ignored http-boundary-probe-result.json，不覆盖。相同输入复验最大 reaction 均为 1；宽 extra 不能覆盖私有缓存/Referrer-Policy/nosniff 或开启 CORS，只读取 own Set-Cookie 并验证 ASCII/4096 字节边界。原9测试加独立4测试全部通过，证据 http-boundary-fixed-result.json；仅合成内存 Request，无 DB/真实 token。后续 handler 的原 token 隔离、授权、单次 owner body 交接和完整业务仍另验。

4229cc6（B a4c94d1）的 pending/authority 基础亦独审无 P1/P2：原5测试和真实 Chromium sessionStorage 补验通过。覆盖刷新保留原 binding/发送标志、克隆深冻结、伪造/跨 authority ticket 拒绝、revoke 后旧票据不复活、异步存储变化/失权不删 pending、敏感字段拒绝、存储异常及无 opener 新标签隔离。110 浏览器输入无 DB/评分执行依赖，服务和浏览器实际关闭。证据 pending-browser-probe-result.json；调用方仍须验证终态或显式动作后才可 remove，不将基础测试扩大为 host 通过。

新浏览器网络 client 394908a（B 8e35863）采用总 deadline、实际字节预算、有限错误和原 binding 验证。主控发现原路径正则接受 Tab，WHATWG URL 规范化后可变成跨源地址；离线 URL 反例不发网络请求。e944363（B 21ab30c）拒绝原始控制/空白字符并核规范化 origin，同时 fetch 强制 same-origin mode。主控21项相关测试与 typecheck 通过，独审待完成。

## 数据底座 namespace 整改已复验

27a913d（A 50bb7ec）已集成六表/Drizzle/ACL/catalog guard；A 实际 fresh 新装1→18、app开库、7PG及1766单元通过，root完整typecheck通过。独审在其独立purpose=test实例另复现一项P2，当前不签底座通过：catalog仅收relkind r/p，未发现qf新增view及其ACL。添加指向operator的可更新view并给app视图列UPDATE后，原完整catalog SHA仍相同、app开库成功；app对底层credential_digest无直接UPDATE，却能经view修改一条合成记录。需覆盖或明确拒绝所有未允许qf relation kind/对象，并对旧17迁移前置使用相同完整范围。反例与失败现场单独保留，未操作首款39eb。

0018原7PG只证明所列结构反例，不能替代直接claim/void/reportFK、旧业务无损升级、完整retain、owner/服务和最终端到端。A正继续这些实施与修复，独审实例只用于独立反例。

修复 14ea22e（A c671408）已加入 qf namespace gate，在 runtime 校验及官方 migrate 的任何 DDL/ACL 重置之前拒绝未登记对象、规则、策略及 namespace 权限；不修改 0018 或旧 migration checksum。A 实际 fresh1→18、4 namespace/7 schema 共11 PG 与1766单元、format/lint/type/build通过；污染18和旧17拒绝且行/history/ACL零变化。仅删除测试自建 view 后旧17→18保持旧行。该提交初交时待独审，后续复验见下段。裸执行0018仍不是完整入口，必须使用官方runner。A后续普通PG回归发现旧16表枚举和自动修复CREATE权限的测试预期需适配，尚未宣称全量通过。Astra 独立 a536 测试库已实际停止并保留反例；root 首款39eb仍保持原样停库。

14ea22e 的原 namespace P2 已独立复验关闭。Astra 自有新实例 fresh1→18 的11 PG通过，另独立探针在旧17和当前18重建同一个可更新view：app开库和官方migrate都拒绝，业务行/历史/目录/schema OID/schema及数据库ACL前后SHA一致。仅移除探针自建view后17→18成功，16旧表行和17历史不变；0018 SHA仍a723d409df2dc1225f4504ff14bc13b18824c93adac28b7f10058c3e586c060a。证据 namespace-fixed-probe-result.json。此处关闭原遗漏对象P2，不代表在线撤销既有连接、完整PG或业务owner/服务通过。

## 本地与 CI 区域设置一致性

0018 之后的远端 database job 曾在 bootstrap 失败（例如39138415716），不能记作已跑PG。root用固定同一Docker镜像新建两套独占隔离实例，仅改变initdb locale：镜像默认en_US.utf8实例在旧17停止、0018拒绝；明确UTF8/C实例1→18和app开库成功，最终catalog SHA与本地906ca374完全一致。两个容器均已核自身label并实际停止，失败/成功卷保留，未碰首款39eb。安全记录见 [CI locale 对照](qa/p4-ci-locale-probe.json)。

CI脚本现在显式使用与本地管理器相同的 `--encoding=UTF8 --locale=C`。0018内嵌及runtime catalog排序具有locale前提，本轮不改任何既有SQL/checksum，也不对非C旧库强制升级或重写history；新CI实际结果仍需按准确head观察。消费者HTTP压力测试另修正全局Promise观测误归因：只计算reader调用栈附件，刻意加入8个无关reactions；旧生产负对照仍以134/8450/33794失败，新代码完整1804单元/166文件通过。

## 实际 host 与事务约束的局部审查

3b860f1（A64df464）的core/retain独审无P1/P2：原7core、真实旧17升级和旧16升级共9PG通过；另3独立PG实测claim先/void先两种Key锁顺序，第三个同app连接观察等待，首方提交后另一方23514且最终互斥。retain要求实际RR/maintenance锁及精确parent；插入fixture未记账但合法的Key后，cleanup首删前拒绝、旧图和五类新行SHA不变。误用owner观察app wait事件的首个独立探针失败只作为探针错误保留；纠正后的新实例全过且已正式stop。证据core-independent-probe-result.json。普通PG旧suite可留下审计行，fresh namespace探针因此独立到vitest.p4-namespace.config.ts；不删除其他suite数据凑空库，CI另建专属服务运行四项。

a314372（B b9a145b）已集成实际consumer host/controller/resource/access，主控19项专项与typecheck通过。B真实Chromium临时合成HTTP完成四宽及恢复/失权/报告共21图、下载1080×1920 PNG，页面错误0；B逐图工程检查，root实看pending缺entry、完成确认、失权三个320原图，未见视觉阻断。此处仍为内存HTTP合成fixture，不证明真实数据库业务。独审发现合法25/30天Key的setTimeout整数溢出P2，正在修复；1/7/24天active与25/30天即时expired的真实浏览器对照见host-deadline-probe-result.json，不能将整个host记为通过。

394908a/e944363的browser client原7测试加独立3adapters测试通过，独审无P1/P2。真实Chromium对38 URL变体零fetch拒绝；同源POST实际Sec-Fetch-Mode/Site正确，跨域302及外域base均零外域请求；真实停滞响应约15004ms超时并观察连接关闭。116浏览器输入无DB/评分运行依赖，浏览器/服务实际退出。证据client-adapters-probe-result.json和client-browser-probe-result.json。结论不延伸到host、handler或持久化授权。

长Key计时器P2在e51ffbe（B2e554f8）独立复验关闭：原1/7/24/25/30天真实浏览器探针全部active，另800ms短到期实际active→expired且grant仍current、已完成且Key过期保持completed。原错误证据不覆盖。383cc7e（B2b204b0）已补到期pending提示并隐藏replay，保留resolve和原记录，P3等待定向独审。

fca21ee（Ae08b78c）的SQL admission与早期factory observer独审无P1/P2：原5fault+独立2测试、真实PG父1项的4隔离driver模式通过；12次坏配置无client分配且随后真实phase恢复，app backend0。8个未settle opening取消后仍占满，late opening必须实际close确认才仅归还一格；无分配/关闭证明的同步factory rejection不会释放，随后100请求零新factory。证据sql-owner-independent-probe-result.json和sql-observer-preallocation-probe-result.json。A在固定e08生产源的普通完整PG为60文件485断言、无skip（285.10s），fresh namespace另4项通过。仅此P4入口每进程8pool/max5，不宣称全应用40连接，也不代替request/resource owner或三service。

实际consumer登记已包含修复后host/controller、access、组件、transport、PNG与server投影；root新三项登记测试和相关旧/new gate共20项通过，真实Chromium127输入bundle无server/DB/评分运行依赖，正确身份绑定2项、身份/映射/字体16变体全部拒绝，pageErrors0，browser/server实际关闭。74源文件+3构建输入+268锁记录由build入口核验，旧3descriptor/51源文件/280锁记录仍通过。正式登记独审待完成，不把编译availability当P4/P5授权或服务完成。

本登记集成点主控完整171文件1827单元、format/lint/typecheck与implementation:check通过；[安全验证记录](qa/p4-consumer-implementation-check.json)。没有执行本集成点生产build/native/E2E，下一步接真实服务和路由后验收。

登记在任何实际play创建前随动态到期P3修复de30ef5（Baa52f2b）重算：当前entry193b48c92352d731c9c2e41de05316471a2c46f58d8e2f2596995ee531d974a1，implementation fd08554ea34f107440856644901da300950745b9d31eb0fc09c941ba51bf51ab；原9a4147b/a77 checkpoint留在Git历史和安全记录，但未用于业务。root现无consumer业务库，A尚未接登记，B无DB，39eb仍17停库。新相关3文件20项及类型/implementation门禁通过，真实浏览器同样127输入/16拒绝且无server运行依赖。当前证据见 [登记补验](qa/p4-consumer-implementation-current.json)；原1827全量只归属于9a checkpoint。

独审提醒host实参可为完整entry/report对象，组合层必须投影renderer/mapping/font三字段再调用严格resolver；不能把窄函数直接当宽对象回调。B接真实app时补实际host+registry正例，当前静态浏览器probe仅验证resolver，不冒充已接通host。24305c7（B1139c06）新增有界HTTP适配与request-owner注入，原7单元通过，真实app/owner服务接线及独审继续。

## 2026-10-19 最终登记与接线审查

独审已确认3ff3d1d准确entry193b48c92352d731c9c2e41de05316471a2c46f58d8e2f2596995ee531d974a1及implfd08554ea34f107440856644901da300950745b9d31eb0fc09c941ba51bf51ab，无P1/P2。逐个核74源文件/3构建输入字节与SHA，20原测试及2独立边界通过；36tuple字段篡改拒绝、深冻结、重算自洽hash后遗漏controller依赖仍被门禁拒绝。实际host配合真实resolver、显式三字段投影的浏览器151输入正例显示封面，身份/字体/映射漂移拒绝，无server/DB/评分运行依赖。证据registration-final-independent-probe-result.json和registry-host-final-probe-result.json；无业务引用是主控确认，非独审查过业务库。

aa52（root de30ef5）动态到期P3亦关闭：三真实320场景的刷新已到期/停留500ms到期都隐藏replay并解释仍可resolve，规范pending全文不变；未到期明确重放一次保持原binding/completionKey。动态修后原图已实看，临时服务/浏览器实际退出。仅关闭此P3，不宣称项目所有P3清零。

24305c7（B1139c06）HTTP adapter独审原7+独立4测试通过、无P1/P2：跨grant CSRF/错token域/重复编码selector/已abort入口零owner；坏read有限503，write成功后abort为UNKNOWN且无成功cookie；exact bytes交同owner，重复idempotent close不提前dispose原stream，原request abort仍传播。全为合成DI，真实服务与app route还未交付。

新request/resource owner f40947a（Aaeb8f51）已集成，主控17相关测试、typecheck和implementation门禁通过；独审正在进行。确认一个P2：若调用方捕获第一段SQL关闭失败，owner当前只清phasePending、未记录前序成功，会允许exchange第二SQL或转IO。独审真实owner/SQL owner注入close拒绝后，隔离槽保留但第二factory/work仍进入。需在该request前序失败后禁止所有后继SQL/IO，不以服务的catch约定替代owner准入，也不释放隔离资源或重置时钟。证据request-owner-failed-predecessor-probe-result.json，A正在独立修复。

9ebcf6e（B35cc40f）集成Studio client及本标签原请求/秘密保管基础，主控8测试和typecheck通过，独审待完成。实际页面、复制/下载前fresh issuer核验、运营HTTP和生产E2E仍需接线。A/B均已正常合并最终共享3ff基线，未替换独立聊天或重置其成果。

Studio基础9ebcf6e（B35cc40f）已独审无P1/P2：原8+独立3测试、真实Chromium124输入通过，完整原记录刷新恢复、四维scope、异步失权保护和raw缺失只核实均符合。issue实际请求仅含六binding字段及digest，URL/headers/body均无raw，存储无CSRF/grant/Cookie；独立新标签为空。尚未包含实际页面或复制下载前fresh issuer授权。证据studio-pending-browser-probe-result.json、studio-independent-probe-result.json。

193c6aa（A0edad79）已合入request owner P2修复：phaseFailed锁存，只有前序工作、实际close和checkpoint均成功才累计confirmedSqlPhases；已捕获错误或迟到成功不使同request恢复后继准入。A15专项、2真实PG和完整1844单元通过；主控相关21测试/typecheck通过，独立原反例复验待回执。

准确9ebcf6ea839c637fe471ffab3d963159529688c0的远端CI39143180437已actual success：175文件1848单元、61文件487PG、46driver、fresh服务14、namespace4、媒体UNKNOWN3，以及format/lint/type/生产build通过；数据库job于2026-10-18 16:11:29 UTC完成。该head早于后续app页面组合和phaseFailed修复，不能扩大为当前head、native或生产E2E通过。后续467ce2d页面组合只完成主控typecheck和implementation门禁；页面真实安全响应头仍待B补。

0edad（root193c6aa）前序phase P2已独立关闭：原failed-predecessor探针exchange/complete各只open一次，捕获close未知后所有后继SQL/IO为INVALID_REQUEST、callback/guard open均0。16定向测试及修后真实PG2通过，原隔离子进程真实退出且父backend0；未重复此前已通过原流/15秒组合。证据request-owner-failed-predecessor-fixed-probe-result.json。aeb+0edad本批owner无剩余P1/P2，不扩为完整业务或资产授权。

0953457（B81a51d1）页面边界独审3项通过：实际Next matcher的10正8负、真实NextResponse固定头和4场景React SSR唯一#main/main；冻结source/build交集为空。root进一步用准确095生产构建（84trace/17843path/0private）在独占3100实际启动Next，390/1440两宽×access/session/report/无效UUID/未知子路由共10case验证实际状态码、private/no-store/no-referrer/nosniff/无CORS、唯一main/skip target及Enter真实跳转全部通过。仅仅读旧成功测试实例f746配置，PG保持停止，无auth/业务数据/native/fixture准备；browser关闭、受管Next真实退出/进程组不存在/端口重绑定证明均通过。见 [页面HTTP证据](qa/p4-page-http-check.json)。完整P4/P5 E2E仍未运行。

429e93d（A926450a）同事务ports与四领域repository已集成，主控typecheck/implementation门禁通过；A5真实PG覆盖完整报告读回/JS摘要、同TX/跨TX克隆锁见证拒绝、RR外禁用后fresh auth拒绝，独审进行中。三类业务service和专属物理fixture继续实施。为P4独立r1-head产品，root已将新增synthetic consumer baseline单entry/import注册及独立测试源交A，仅test/ci；不得改旧两个baseline或将合成数据视作已批准首款。

6561d24（root ec1e4e3）测试专用baseline已独审无P1/P2：独立Python重算三份规范输入逐字节一致，98个Product引用无旧/外ID，五PNG原字节、48×48及声明/展示边匹配。48准入矩阵仅新旧各自test/ci四项接受，其余44拒绝；demo提升与未知身份拒绝，三个评分见证low/middle/high通过。entry2e2f54d1ad54d209686f6aac713d292266c8986469324926059638ad464fd444。未跑DB/native，不代表真实首款或物理fixture已验收。

54cc1b8（root eb7338e）fixture合同原4测试及独立34项拒绝矩阵通过，限定无P1/P2；completed严格区分operator-services和consumer-e2e。实际actor、父版本、密码学摘要、完整row manifest和来源均仍需finish实现核验，Schema只核形状与所列交叉字段。Root新4测试/typecheck通过，prepare/finish/cleanup仍待A实现，runner也尚未接虚构入口。

Studio controller 1b60d96（B79a2b70）独审发现秘密锚点竞态P2，三个合成反例曾复现：最终fresh issuer等待中换锚、改raw=null，以及expose callback等待中移除锚，旧秘密仍可经旧局部变量披露。7f116f5（B19ffd76）加最后授权await之后同步规范全锚点比较，并让延迟callback与成功提示共用此current。独立3原反例、14漂移/存储异常分支和复制/导出正例全部通过，原13+独立7测试通过，P2在controller范围关闭。原反例保留，证据studio-secret-fix-19ffd76-review-result.json；实际UI仍须在副作用前使用该current，不把memory callback测试当OS剪贴板/实际发放。主控当前三文件17项与typecheck通过。

fdef4e1（B711974c）父版本列表GET改用独立有界DTO读取，避免旧draft/Node运行图；10原测试与独立transport反例通过，浏览器目标打包无DB/Node/评分/旧draft response，独审无新增P1/P2。真实Studio页面接线仍继续。

## 真实运营服务、页面与受管 E2E 接线

cc84380（B4806ec1）运营 HTTP 适配原5+独立5测试通过：10 action 正确绑定，非法 source/token/CSRF/body/cursor 零 owner，写后 abort/关闭未知不转成功，读有限错误；held close 与实际 owner 保持原预算。8d99837（B4717ba1）8个真实 route 的10入口已独审，无新增P1/P2：实际 runtime 的三个factory引用严格等于实际 owner/play/Key实现，原Request透传，等待params前捕获startedAt，held params不续时钟。主控5项HTTP测试和typecheck通过，尚未做真实生产HTTP闭环。

2a42f62（A8d9f931）真实play/Key与物理fixture的独审覆盖实际录入/封存/五图字体、缺图拒绝、原操作幂等、只读和新鲜权限、父修订变化、COMMIT后响应丢失再resolve，以及created=false共享五图不删。发现两个清理P2：manifest真实FD close失败只被保留但后继cleanup仍可进入；owner在pg_stat_activity看到foreign PID但type/state为NULL时活连接被忽略。独审均在首DELETE前拦截，图、文件、manifest保持。bc17e6b（Ae1ac970）增加跨模块加载的进程级unknown锁存及所有同库foreign PID检查；A真实故障子进程验证晚close/module reload不解锁、零DELETE尝试，父进程只在子实际退出后重验再清。准确修复仍待独立原反例回执，禁止先运行主控真实cleanup。

bcd3587（B80126b7）Studio实际React/Chromium原图与原锚点/复制下载检查由Astra复核，新增后台hidden P2：pagehide不覆盖visibilitychange，held-auth期间hidden仍可复制。ddfe162（Bc75811e）现同步监听hidden撤销，visible不自动续接/重放，卸载移除监听；B16图与原代码负对照已通过。事件为浏览器内受控合成，Clipboard为stub；独立原反例仍待回执，不称操作系统剪贴板或真实发放验收。

主控受管runner加入串行consumer-flow项目，依赖P3E，关闭trace/video/自动截图及retry，普通两项目排除该spec。四阶段runId一致；启动拒绝既有consumer manifest/observations；实际worker和Next退出后，要求completed、consumer-e2e、八场景完成记录和真实report，再先清P4后清P3E。full run缺P4直接拒绝；filtered只记filtered。Astra对五文件纯审无新增P1/P2：13原selector加21禁止控制参数负例，实际import配置核唯一项目和无环依赖，静态核退出与清理顺序。证据root-runner-pure-result.json；没有执行runner main、DB/3100/cleanup，实际验收待后续。

准确2a42f6292af01e65c4bf423733339ae029d759f1的CI39149243131实际success，179文件1873单元、63文件493PG、fresh服务14/namespace4/媒体UNKNOWN3及生产build85traces/18021paths/0违规。见[运营服务CI检查点](qa/p4-ci-operator-checkpoint.json)。这是后三修复及实际route之前的历史head，不替代当前head、native或完整consumer-e2e。

## 原反例闭合与消费者实际写入期限

bc17e6b（Ae1ac970）的两个cleanup P2现已独立原反例关闭。reviewer独占2a964中，原foreign app PID仍存活/type/state仍NULL，但首DELETE不达；真实manifest FD close拒绝后第二次cleanup、晚native close、read/finish和vi.resetModules均保持unknown拒绝，完整行/manifest/5PNG SHA不变。A原lifecycle+quarantine两PG亦独跑通过，reviewer实例官方停库保留，旧失败实例未动。证据fixture-cleanup-fix-e1ac970-review-result.json；不代替root全runner实跑。

ddfe162（Bc75811e）hidden P2原held-auth→hidden→释放auth→visible独立复验通过：同步lost且visible仍lost，clipboard/POST/issue增量0，无旧成功notice，sessionStorage原锚点SHA不变；显式refresh+resolve恢复。原15场景随同重跑共16图，0页面异常/凭证DOM/API泄漏/溢出/过小目标，320失效原图已实看。证据hidden-disclosure-fixed-probe.json；限定实际React/受控visibility事件/Clipboard stub，未认操作系统剪贴板。

5321c99（Bbc3c66b）八case/private helper独审原6+独立3通过，无新增P1/P2：8种遗漏、9种sticky失败、重复/错run均拒绝finish；Cookie按actual target/source path选取、native拒绝外部/未列入/交换路径、错误不附原cause/header。保留完成前state、仅204标记logout、final鲜读Key、仅8项首次成功才写obs/finish。4110985（B2909dee）实际10App+runtime模块复合测试通过，method/action/session/原Request/Response及params前原时钟准确，使用真实owner/service引用。两笔均未跑DB/3100，不代替实际reporter秘密扫描与生产八case。

801b856（A0d1771d）consumer factory原完整服务生命周期PG独审通过，但新增实际写入期限P2。冻结设计要求等锁后、实际业务写入前新鲜DB clock。原report/save port最后授权检查后仍做异步摘要；reviewer在独占59e329对save/complete×Key/grant四case注入真实PG等待，入口active=true、实际写入前目标期限已过，原service仍save revision+1或report1。合成临期seed在owner单事务保持Key固定秒差/grant8小时差、恢复原trigger后verifyConsumerSchema；不改0018文件、不用浏览器改时钟。四越界行完整保留，59e329官方停库。证据consumer-expiry-before-write-0d1771d-result.json；待A同SQL期限修复及四原反例复验。

root准确5321c99第一次全普通PG失败，407.20s：65文件40failed/25passed，495项198passed/264failed/33skipped。首个consumer-service stack为cleanupConsumerFixture:555 live.imports.enabled保护，调用test:547漏正式禁导入；随后reset/prepare拒绝未清图导致级联。旧单测成功只覆盖imports=false库。b513官方停库保留，未手工清图或改guard；A补三个caller正式前置，并从enabled=true证明后由root新库重跑。当前e1f0e4f薄route生产build103traces/23852paths/0违规通过，181文件1879单元只归属5321c99，不能以此替代失败PG或新native/E2E。
