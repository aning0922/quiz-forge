# P4 内部消费者闭环合同草案

2026-10-18，从 P3-E 交付 c83788b 接续。作者已批准首款既有内容与视觉作为内测基线；本阶段无需重复批准同一材料。目标为本机 test/demo/ci 的真实 Key → 可恢复答题 → 一次完成 → 固定报告/PNG，随后接首款 P5。main 合并、生产迁移、部署和商品发布均不包含在此授权内。

**当前状态：合同与共享 Schema 准备中。** 共享基础/凭证 codec、A 的 play/Key/report 数据合同和 B 的纯视图接口已分别通过独审（准确基线 62be5e9、064c4be，无 P1/P2）；新 errors/resolve 联合待独审，当前合并后 49 项合同边界测试、定向 lint 和完整 TypeScript 通过。消费者组件正在独立开发；尚无新增 0018、消费者表、业务服务或页面。具体 Schema/服务接口完整冻结后才进入数据业务实现。

## 1. 模块与实现归属

- product/internal-play：固定内部执行版本、父版本及精确实现身份。
- fulfillment/access：Key、当前 grant、交换预算与消费者凭证；fulfillment/consumer-flow 仅作跨领域应用服务协调。
- quiz/session：唯一领取会话、答案/游标状态和 CAS；纯评分继续选取既有精确确定性引擎。
- report：不可变最终快照、读取投影和固定报告/海报数据。
- theme/consumer：真正消费者 host/views/PNG 及服务器展示投影，旧 preview 闭包保留。
- app 仅做路由组合；仓储不任意互查其他领域表，同一实际事务通过显式 port 共享。

主控维护 `lib/consumer-contract/v1` 的纯共享基础、协议决策、登记与集成；A 起草领域合同并接后续迁移/数据/事务/留存，B 接受控显示与 UI/HTTP。领域合同及 root 基础经独审对齐后才作为两线共同业务基线；不把占位类型当已冻结 API。3100、最终生产构建/native 与真实首款现场由主控唯一管理。

## 2. 不可变 play 与展示身份

新增独立 internal_play_version，不改 P3-E product_version。play 固定父 versionId/完整 snapshot SHA、Product、源修订/三 hash、review/baseline、logicHash、精确 engine、真实 consumer renderer/server projection、font/resources/components 与访问/保存/完成/报告协议。

每 Product 最多 100 个不可删除槽位；唯一完整 play snapshot SHA，不以父 ID 单独唯一限制不同受控实现的新快照。新建仍 head-only，原成功 operation key 优先；存在后的 Key 永远固定原 play，head 推进不改变旧答题。Product 归档阻止新 play/新 issue，不撤销已发 Key 的恢复/完成/报告权利。

新 consumer-folio-cabinet@1.0.0 descriptor 直接包含六个受控映射：source layout tuple（现 id、version 2.0.0、props 1.0.0）→精确 runtime component tuple。旧 content/parent/sourceComponents 不变；PlaySnapshot 分别记录 source/runtime/mapping 身份，并与 descriptor 逐字段一致。来源 DisplayEntryBodyV1/ResultDisplaySnapshotV1 的 layout 仍描述来源配方，新 host 严格映射到自己的真实组件，不索引旧 PREVIEW_COMPONENTS 冒充消费者实现。

旧预览硬编码的临时体验/刷新重置文案不能照用。新身份覆盖真实 controller/views/PNG、服务器投影和复用的稳定闭包；不改旧 renderer 字节，不按商品 ID 硬编码，不动态导入包代码/HTML/远程模块，不 fallback latest。基线题目、四报告、八图及原 hash 保持。

## 3. 计划中的六实体与最后防线

以下是 0018 的迁移决策，**不是已经建立的表**。不改 0001–0017 原字节，真实 17→18 升级先在独立合成实例验证，39eb 首款原现场继续停止保留。

| 实体                     | 主要不变量                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| internal_play_version    | 不可变；Product/slot 1..100 唯一；精确父 ID/Product/SHA FK；operation key 与 snapshot SHA 唯一            |
| access_key               | 永久固定 play ID/SHA、凭证摘要、原发放 binding、duration/issuedAt/expiresAt；只有未领取作废字段可一次写入 |
| consumer_session         | 每 Key 唯一、不可删除/改绑；存在即永久领取事实；stateRevision 单调递增，答案/游标/last receipt 同一次更新 |
| consumer_grant           | 每 Key 最多 16 个当前槽；授权内容受控轮换，不是历史 ledger；业务身份/报告不依赖槽位历史                   |
| quiz_report              | 每 Key、每 session 分别唯一；一次 INSERT 完整 DETERMINISTIC 快照；无 UPDATE/DELETE，存在即唯一完成权威    |
| consumer_exchange_budget | 迁移种一条 true 主键行；只允许受限预算字段 UPDATE，无请求历史或 raw                                       |

report 的精确复合 FK 指向 session 的 session/key/product/play/SHA/最终 stateRevision/两个 state hash，所有列 NOT NULL，引用 UNIQUE 与 FK 非 deferrable、ON UPDATE/DELETE RESTRICT。session 每个被接受的 state/last UPDATE 必须整组 revision+1，canonical/hash CHECK 不允许 NULL 绕过。report 存在由此在 DB 最后防线封住答案/游标，不增设可不一致的 completed 字段。触发器、权限、定义 guard 和实际并发证明一起实现。

## 4. Key 发放与未领取作废

运营浏览器用 CSPRNG 生成 32 字节 raw，独立域摘要发给服务器。先将本标签秘密 pending 保存、完整回读并校验 raw→digest，再同步标记可能已发送并回读，随后才 POST；失败/损坏均零 POST。sessionStorage 不是跨标签唯一保管或 XSS 隔离，服务端仍按完整 binding/唯一约束裁决。

issue binding 固定 operationKey、keyId、digest、play ID/SHA 和 validForSeconds（整数 3600..2592000，UI 默认 604800）。首次实际 INSERT 一次 DB clock 采样毫秒 UTC issuedAt，expiresAt=issuedAt+duration；三个字段永久不改。响应到达、用户领取或同 key 重放均不重起算。原 issue absent 仍 unresolved，不能因相对期限宣布未执行。

凭证 codec 初稿为 32 字节规范 base64url，无填充：AccessKey 前缀 `qfk_p4_`，grant 前缀 `qfg_p4_`（完整 token 均 50 字符）；摘要按 UTF-8 `quizforge.p4.token.v1:<access-key|grant>:` 加原始 32 字节做 SHA-256。grant CSRF 为以原始 grant 字节作密钥、对 `quizforge.p4.csrf.v1:consumer-grant` 做 HMAC-SHA256 的规范 43 字符 base64url，拒绝非规范尾位及旧 Studio 域。它们只定义编码，不授予授权；实际 Key/grant 查验由数据库服务负责。

服务器不保存可恢复 raw；receipt、resolve、audit、列表及普通 DOM 只有安全事实。复制/下载私密 fragment 链接是显式动作，并先核当前 issuer 身份；不能把上个运营员的秘密桶交给下一次登录者。原文丢失不能靠 metadata 重建。相同发放只产生一个凭证，不声称网络/复制 exactly-once。

首版只有独立 void-unused：Key 行锁内重核从未存在 session、无 report，原子单向作废并封存自身 binding/receipt。claim 与 void 同锁序，只能一方成功。确认原 issue 和已作废事实后，可另显式发新 Key；这不是原子换发。原发放/作废未知先核实，不凭空查造新 Key。已领取/完成不能用此动作重置资格；安全撤销已领取访问另立未来动作。

旧 issue 重放只返回历史事实和独立当前状态，不把 revoked/expired 改回有效。Key 总量不人为增加本轮业务上限；运营列表每页最多 50，按 Product 与 issuedAt/id 有界游标，不承诺跨页不变上界，空页不能证明 Key 不存在。运营 API 默认不提供消费者答案/报告正文。

## 5. 匿名交换、授权与期限

`/access#key=…` 落地立即擦除地址栏 fragment，raw 只在内存用于同源 exchange。禁止 query/path、被动日志、截图、报告或海报包含 raw/恢复链接。消费者不要求注册；资源 selector ID/hash 本身不授权。

exchange 仅 JSON POST，精确配置 Host/Origin、必需 Sec-Fetch-Site=same-origin 和固定 `x-quizforge-consumer-exchange: 1` header；缺失/null/same-site/cross-site/form/GET 均拒绝，不开放跨源 CORS，不复用 Studio preauth。后续 Cookie 写使用独立域且绑定当前 grant 的 CSRF。所有 API 核 Key/session/play/report/resource 归属；同名歧义 Cookie 拒绝。

Cookie 名为 `qf_local_consumer_grant_v1`；host-only、HttpOnly、SameSite=Strict、Path=/play/:sessionId、不设 Domain；本轮仅 local-http-p2a，Path 是发送范围而非授权边界，不声称 __Host 或生产 HTTPS 能力。各 session 的页面/API/资源/报告位于同一路径前缀，不让多 Key 互相覆盖。

同 Key 总是恢复同一 session。每次 exchange 由服务器生成新的 grantId/raw/digest，当前行的 grantId/digest 唯一；CSPRNG 不刻意重用，不声称数学上没有历史碰撞证明。每 Key 16 固定槽，优先过期/已撤槽，满时按 issuedAt/slot 替换最早，8 小时不滑动续期。第 17 次授权可使最早设备需用原链接重新进入；UNKNOWN 显式再次交换是一次新授权，不是恢复原 raw，不自动重试风暴。

exchange 应用服务通过 report port 读取完成事实；rotateGrant 只返回授权/传输信息，不越界查 report。已有 report 时忽略正常答题期限，只授予同一报告只读能力；grant 自身仍有期限和精确退出。持锁后新鲜核 grantId/digest/期限，logout 不得按 slot 撤销后来的新 grant。迟到 Set-Cookie/退出删除可能使浏览器暂失授权，必须重新验证/进入原链接，不能接纳旧 token 或清业务 pending。

## 6. 固定窗口预算

true singleton 主键+CHECK、used 0..60、DB 分钟 bucket。app 无 INSERT/DELETE/TRUNCATE/id UPDATE；缺行或定义失真 fail-closed，不能自行补行。使用 DB clock 取得锁后的真实窗口，同窗口只加 1、到新窗口才从 1 开始，回拨不补额度。

每固定窗口最多 60 次被放行进入 Key 检查的尝试，包含格式合法但无效 Key；廉价源/JSON 拒绝不计，锁竞争 429 不保证已记账。窗口边界可短时间跨两窗口，不称任意滚动 60 秒均 ≤60。

独立短预算 TX 的 COMMIT 和实际 close 确认后才进 Key TX，共用首次 15 秒；未知 fail-closed，不退款，不持预算锁再拿 Key 锁，不睡眠/自动重试。限额/非等待锁竞争为有界 429，其他故障不可用。合法 grant 的已有报告读取不经 exchange 预算。此为本地内测公平性取舍，不是公网抗攻击承诺。

## 7. stateRevision 槽 CAS

答案为最多 100 个 questionId/optionId 对，重复题号拒绝、ASCII 顺序规范化；服务端再核固定源题目与选项。progress 严格为 `{questionId: id|null}`，非 null 必须属于源；null 表示封面/概览，可保留已有答案，不重置资格。UI 转 map 必须为安全 own-property 映射。

revision 初始 0；每个被接受的答案/游标保存，包括同值保存，都加 1，永不回退。上限 2147483647，达到上限只拒新 save，当前完整答案仍可 complete。操作槽位为 sessionId+expectedStateRevision，完整 binding 固定 play/session 及两个新 state hash；不设全历史 mutation UUID/保存 ledger/逐 save audit。

只保留 last binding/receipt：精确 last 且 current=base+1 为 applied-current；current=base 且无 report 为 unresolved（可能晚提交）；current>base 且不是精确 last 为 superseded，只证明旧窗口已关闭，原请求可能曾成功后被覆盖。未来 base 拒绝；report 存在由应用服务返回 completed，session 仓储不反查 report。

UNKNOWN 冻结新编辑和完成，保留原候选。superseded 须显式采用服务器当前答案后再编辑，不自动合并或抬 revision 重发。迟到旧成功不能降低当前状态或授权代次。consumerStateAnswersSha256/progressSha256 与既有 engine score.answersHash 是不同定义，报告同时固定，不修改旧引擎 hash 求相等。

## 8. 唯一完成与历史报告

complete binding 固定 session/play、expectedStateRevision、两个 state hash、completionKey。Key→Session 统一锁序，持锁后重核当前 grant/Key/期限和真实服务器状态；原成功 key 优先，相同 key 异 binding 冲突，另一 key 已完成返回独立 completed-other，不伪称本请求成功。

固定源/必要依赖 IO 在写事务前有界结束；锁内执行固定纯引擎和报告装配，一次 INSERT 完整不可变报告，FK 同时封住 session 更新。事务不跨 PNG、网络或慢 FS。权限和期限按实际业务写入前的新鲜 DB clock 判定，不声称网络 COMMIT 回包必须赶在期限前。

完成 UNKNOWN 只核原完整 binding。原 key 成功、另一个唯一 report、不可逆 revision 推进等才支持严格终态；空读/404/超时/可变禁用/普通到期不是“从未完成”证明。report 若曾成功，最终 tuple FK 不允许之后无 report 却提升 revision。

最终快照包含规范答案/进度、确定分数/选中结果、最终文案/display、parent/play/engine/renderer/font/resource 身份。历史访问从快照投影，不重评分、不调用模型；浏览器只获得授权的有限投影，不提前下发权重、候选报告或人物资源。PNG 从锁定报告和固定资源按需有界绘制，无持久 PNG 表；不承诺不同浏览器编码字节完全相同，缺精确实现/字体/资源时明确不可用，不 fallback latest。

## 9. 预算与资源留存

机器预算见 `lib/consumer-contract/v1/limits.ts` 初稿。HTTP/规范文本/输出分别有界，最终 Schema 仍须验证最坏输入以及首款实际产物。所有阶段共享初始 15 秒，不因第二个 TX 或文件关闭重新起算。

纯 SQL owner 独立设置每 Node 进程 8 个固定租约槽，跨本进程 route bundle/HMR 共用 Symbol.for 单例。开库前同步占槽，满即有界 busy，不排队；每格最多一个 pool、一个实际业务任务及常数个合并 close promise，覆盖 opening/running/closing/quarantine。沿当前每 pool max=5，此范围最多 8 pools/40 sockets；四个 FS 槽、旧路由和其他进程另计，不能声称全机或全应用总上限。只有实际 opening/work 已 settled 且所有实际 close 正向确认后归还；超时、abort、请求结束、被拒绝 promise 均不是关闭证明，无 TTL 或自动重试释放。开库时一旦 openSql 得到 client 即交 owner 观察，verification 早失败也不能吞 close 失败而释放槽。exchange 第一阶段真实关闭后才归还并申请第二槽；第二槽满不开始 Key 事务，已扣预算不退。实现/故障注入证据仍待 A。

createPlay/资源读取的实际 IO 走 outer owner 和现有实际关闭隔离；纯 SQL save/logout/报告后授权恢复不占四个 FS 任务名额。纯 SQL 新引用在域锁前持同 TX 非等待 storage SHARE。维护在首次 unlink 甚至自有 ledger 删除前核完整 play/Key/session/report/当前 grant 留存图；过期/作废不释放业务来源引用。

## 10. 验收与明确非目标

先严格 Schema/有限服务接口独审，再 0018/完整 guard/17→18 原数据不变及 FK/权限实测，然后数据服务和 UI 集成，最后全套 format/lint/type/unit/build/真实 PG/生产 E2E/四宽原图与真实 PNG。首款 P5 在已保留的实际材料上进行，不能用合成测试替代。

实际矩阵包含：发放响应丢失/双标签/本地 raw 丢失；claim 对 void；同 Key 多设备；第 17 grant/迟到 Set-Cookie/旧 CSRF；60 次预算/并发/回拨/预算未知；两 save 同 base、已成功后又 superseded、save 对 complete；同/异 completionKey 与 COMMIT 未知；report FK 防改；过期已完成原链接；资源越权/DTO泄露/关闭 quarantine/旧谱系升级/引用留存。

E2E 不将 raw 放 page.goto、locator.fill、APIRequest/route.fetch 或失败日志；使用有界安全传输与合成哨兵核 stdout/JSON/HTML ZIP/附件。真实首款原图、答案、凭证、浏览器状态和实际截图继续本地私有，Git 仅保存合成 QA 与安全汇总。

本期没有账号、支付、平台交易/API、AI 增强、公开分享、发布指针、生产 HTTPS/部署、服务端可恢复 raw、自动原子换发或已领取 Key 撤销。新内容/素材或发布仍另请作者批准，已批准同一基线不重复请批。

## 11. 原请求核实的机器分支（独审前草案）

`fulfillment/consumer-flow/contracts.ts` 与 `operator-resolutions.ts` 用严格联合描述核实结果。每个结果都携带完整原 binding 和其 SHA；异步验证函数还要求调用方交入自己保存的原 binding，拒绝迟到其他请求的自洽响应。验证字节自洽不等于查询权威；服务仍须在授权事务内观察永久事实并在返回前复核当前权限。

| 动作                    | 可以返回的分支及依据                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| save                    | applied-current：current=base+1 且 last 完整绑定相同；unresolved：current=base；superseded：current>base 且不是精确 last；completed：同 session 已有最终 report receipt。superseded 不断言原 save 从未成功。未来 base 不接受。                                                                                                                               |
| complete                | applied：receipt 与原完整 binding 相同；completed-other：同 session、另一 completionKey 已完成；operation-conflict：同 completionKey、不同 binding 已落账；unresolved：无 report 且 revision/双 hash 原样；superseded：无 report 且 revision 已永久推进；state-conflict：无 report、同 revision 但 hash 不同。后三项的无 report 由服务在同一一致事务内确认。 |
| create play / issue Key | applied：原完整 binding；operation-conflict：同 Product、同永久唯一 operationKey 的不同 binding 已落账；unresolved：未取得上述事实。首版没有基于 head、容量、普通错误、到期或空列表的永久缺席证明。                                                                                                                                                          |
| void-unused             | applied：原 void receipt；voided-other：同 Key/原 issue 的另一 operationKey 已作废；claimed：同 Key/原 issue 已有永久 session；unresolved：尚未领取或作废。同 operationKey 在另一 Key 上冲突只报有限错误，不返回越权事实，也不清原 pending。                                                                                                                 |

原成功记录优先于当前可变状态。issue applied 可以同时带当前过期或作废状态，不能解释为续期；完成后原 Key 到期仍可在有效 grant 下只读报告，grant 自身到期不能继续访问。session bootstrap 严格区分 editable、expired、completed，包含当前 grant 的安全标识、固定有效期和独立 CSRF；这些字段不记录到日志或浏览器业务 pending。

`lib/consumer-contract/v1/errors.ts` 只允许有限 code 和合成 requestId，不反射 SQL、异常原文、请求体或凭证；错误不是旧请求未提交的证据，不携带自动重试许可。未取得定义中的永久证明时，pending 会持续保留；本期不承诺所有 UNKNOWN 都能自动清理。用户取消本地动作也不能被描述成撤销服务器写入。

本批边界覆盖两种域摘要、规范编码、源/报告一致性、已成功后又被覆盖、同/异完成 key、未来 revision、跨 session/Key、迟到响应、嵌套摘要篡改、原 issue 已作废及到期报告只读。服务并发、真实数据库与 HTTP 行为仍需后续实际证明，本批单测不代表这些能力已实现。

## 12. 服务与 HTTP 配对（独审前草案）

`consumer-flow/service-contract.ts` 明确三组应用接口：InternalPlayService、AccessKeyService、ConsumerFlowService。A 的 factory 绑定本请求 owner、同一 config 和初始 15 秒 budget；HTTP 不传任意既有连接，不重新起钟。owner 惰性开库，纯 SQL 不取四个文件任务槽；exchange 的预算 COMMIT 和第一连接实际 close 均确认后，才开第二个独立连接。未知不继续、不退额度、不自动重试。首次 complete 先纯 SQL 查原报告；仅确实需要新完成时准备精确来源/依赖 IO，期间不持业务写锁，最终事务重新取得 Key→Session→当前 grant 并优先查 report，再纯评分、投影、插入。

领域内部 ports 共享同一个实际 TransactionSql。Product/play、access/grant、quiz/session、report、quizpack source 各自只查自己领域；report 存在判断由应用服务经 report port 取得。grant digest 初次查询只定位；锁后重核完整 grantId/digest/归属/期限，不能把槽位当授权。普通 save 的固定题目校验经 quizpack 的不可变 SQL source port，不为校题读取文件。实际资源/字体读取才进入 guarded IO；owner 负责真实关闭和 quarantine，HTTP finally 始终调用 closeIfNotTransferred。

| HTTP 路径（由严格 urls.ts 构造）                                           | 方法 / 输入 / 输出                                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/api/studio/products/:productId/play-versions`                            | GET 有界 play 列表；POST create binding → `{created,play}` 严格结果                                                                |
| `.../play-versions/:playId` / `.../play-version-applications/resolve`      | GET 固定详情；POST 原 binding → play resolution                                                                                    |
| `.../access-keys` / `.../access-keys/:keyId`                               | GET 有界游标页 / 精确 Key 详情；列表 POST issue binding → `{created,key}`                                                          |
| `.../access-key-applications/resolve`                                      | POST 原 issue binding → issue resolution                                                                                           |
| `.../access-keys/:keyId/void` / `.../access-key-void-applications/resolve` | POST 原 void binding → void resolution；写接口与只读核实接口分别鉴权                                                               |
| `/access/exchange`                                                         | POST 严格 `{rawKey}`，仅准 access-key codec → 有限 `{schemaVersion,session,destination}` JSON；原 grant 只能单独写 HttpOnly Cookie |
| `/play/:sessionId/api/session` / `entry`                                   | GET 授权 bootstrap / 中性投影；bootstrap 校固定 route sessionId，entry 校完整已知 session 与 facts/mapping 摘要                    |
| `.../save` / `.../save/resolve`                                            | POST saveInput / 原 save binding → save resolution                                                                                 |
| `.../complete` / `.../complete/resolve`                                    | POST 原 complete binding → complete resolution                                                                                     |
| `.../report` / `.../resources`                                             | GET 固定 report view / 严格 resourceId+resourceVersion+sha256 selector 的有界图片字节；selector 不授权                             |
| `.../logout`                                                               | POST 严格空对象，当前 grant+CSRF 精确退出，204；不清业务 pending、不重置答题                                                       |

运营 read/resolve 允许当前只读角色，写要求 operator。消费者 POST（包括只读核实）都要求精确 Host/Origin、必需 same-origin Fetch Metadata 和 JSON；exchange 用固定自定义头，其余用当前 grant 的独立 CSRF。GET API 亦要求精确 Host 和必需 same-origin Fetch Metadata；页面直接导航按 Host 与其页面策略检查。拒绝重复 selector/query、重复同名 Cookie、未知 JSON 字段、非 UTF-8/编码请求及超限实际字节。B 负责有界 HTTP 解析、Cookie/source/header 与 controller，复用 root codec 和机器 Schema；不得直接把 Zod issue/异常原文序列化。

所有响应 private/no-store、no-referrer、nosniff，不跨源开放。服务再次解析 route scope 和 binding，不能只依赖 HTTP 验证。新 create/issue 结果也必须核原完整 binding；`created` 仅说明本次 INSERT 是否新建，不授予当前可写或可恢复 raw 的额外权利。未知、失权或迟到响应由整页授权代次和精确 pending 比较拦截。

资源响应通过 `ConsumerRequestLifecycle.resourceBody(bytes)` 交接，只接受同一 owner 本次读取发出的精确 bytes 对象一次，不能把任意数组注册为已授权资源。原 IO task 和 retained bytes 持有到响应 drain/cancel/deadline，并继续观察真实 FD/guard/DB close；HTTP finally 调用 closeIfNotTransferred，不直接 `new Response(bytes)` 后丢弃 owner。该生命周期接口与处理方向已明确，具体实现与重复交接/提前关闭反例仍待验证。

display-contract 仅包含 neutral entry、受控实现/字体/映射身份和独立事实 SHA；无完整父 snapshot、权重、候选报告或人物揭晓资源。状态按 questionId 寻址，入口额外拒绝不同 source version 重用同一题号，避免版本引用可区分但保存 ID 无法区分。缺精确 renderer/font/resource 明确不可用，不能选 latest 或拿旧 preview host 充当 consumer。

API 自定义头/Fetch Metadata 与 Cookie Path 边界参考 [OWASP CSRF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)、[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#pathpath-value)（2026-10-18 实读）；16 槽、8 小时和 60/固定窗口是本项目有限内测选择，不是文档给出的普遍结论。
