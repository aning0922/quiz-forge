# P4 数据、事务与资源生命周期设计

状态：**设计经独审闭合，冻结为实施基线／尚未实现**。日期：2026-10-18。原设计提交 a85914b 已集成为 6ae499a；本次冻结包含 §3.3 void/claim 双向保护、§5 Key 页 RR、完整 ports 与八格 owner 条件，不把 planned 测试记为通过。

本文是 A 数据线拥有的实施设计，与 [消费者合同](CONSUMER_P4.md)、`lib/consumer-contract/v1` 和各领域机器 Schema 配套。共享凭证 codec、消费者及运营 resolve 联合、entry/资源选择器、URL 和公共 service 接口已经成型；具体行为以配对后的严格机器合同为准。本文不新增错误码、凭证域或另一套完成状态。主控已据独审意见启动 0018、数据库业务和 owner 实施；实现、真实故障与并发另行验收。

本阶段仅本地 test/demo/ci 内测。旧内容、八图、P3E 版本及其实现身份保持固定；不包含生产迁移、main 合并、部署或商品发布。

## 1. 所有权与事务边界

| 领域或协调层                | 拥有的数据与职责                                                     |
| --------------------------- | -------------------------------------------------------------------- |
| product/internal-play       | 固定 play、精确父版本、Product 写锁及固定执行事实                    |
| fulfillment/access          | Key、当前 grant 槽、独立 exchange 预算及消费者凭证服务               |
| quiz/session                | 永久领取会话、完整答案与进度、revision CAS；复用既有确定性纯评分引擎 |
| report/persisted            | 不可变完整报告、选中展示快照、读取投影和回执                         |
| quizpack 既有来源与资源端口 | 固定来源证据、归档资源元数据、受限私有文件读取                       |
| fulfillment/consumer-flow   | 同一实际事务内协调显式 ports，判断完成、授权和操作结果               |
| theme/consumer 与 HTTP      | 受控展示及服务器投影、UI 和传输；不取得任意 SQL 或文件系统入口       |

领域仓储只查自己拥有的表。应用服务通过 ports 取得跨域事实，不临时直接 SQL 联查其他仓储。数据库的明确复合 FK 和保护 trigger 可以跨表保证引用完整性；这不授予应用仓储任意跨域查询权。

每个事务将**同一个实际 `postgres.TransactionSql`**、初始 `DatabaseBudget` 和 checkpoint 传给所有参与 port。仓储不嵌套 `BEGIN`、不另开连接、不重置 deadline。消费者不取 Studio 全局身份写锁。

消费者写入统一先 Key、后 Session；grant 轮换、claim 和未领取作废同样先锁 Key。过期判定使用等锁后、实际业务写入前的新鲜 DB clock，不能沿用事务开始时的 `now()`。SQL 新引用先取得同事务非等待 storage SHARE，再取领域行锁；trigger 保留非等待后盾，但不声称能为恶意直接 SQL 强制所有行锁的获取顺序。

## 2. 0018 的增量边界

- 新增 0018，不改 0001–0017 的任何字节或 checksum，不更新旧业务行，不回填 play、Key、session 或 report。
- 旧 `product_version` 只追加精确父引用所需的非延迟 UNIQUE；对应当前 schema guard 同步增加该事实，不重写旧 helper 或原约束。
- 沿既有固定连接的迁移锁执行。0018 还需非等待 storage EXCLUSIVE、相关旧表的 `SHARE ROW EXCLUSIVE NOWAIT`，以及真实旧 app 连接、读写者和 IO 已退出的证明。
- 先验证 17 的完整 schema 与迁移历史。有活跃旧连接、资源 guard、未知 IO 或旧定义弱化即拒绝，不用配置开关冒充静止。
- 应用 capability 要求完整 0018。部分建表、enum-only staging 或漏授权限均 fail closed；owner 仍可完成受控迁移。
- 只在新建、标记核验过的独立合成实例验证 17→18。旧未知现场和首款实例保持原样，实际首款升级由主控另行明确执行。

如需扩展 audit，只增加有限运营动作及严格 target/actor 关系，最终枚举与约束随机器合同冻结。匿名报告本身是完成权威；不伪造 operator，不为每次 save、grant 或预算尝试新增无界历史。

## 3. 六实体与精确引用链

以下为拟用列名。最终 DDL、Drizzle、guard facts 和机器 Schema 必须在冻结后一次对齐。所有 SHA 均为精确 64 位小写 hex；所有持久时刻均有限、毫秒精度且可表达为四位年份的 UTC ISO 文本。

### 3.1 internal_play_version

所有列 NOT NULL：

`id`、`product_id`、`slot`、`parent_version_id`、`parent_snapshot_sha256`、`operation_key`、`binding_text`、`binding_sha256`、`snapshot_text`、`snapshot_sha256`、`created_by`、`created_at`。

- `id` 为 UUID PK，`created_by` 引用 operator；`slot` 为 1..100。
- UNIQUE：`(product_id,slot)`、`(product_id,operation_key)`、`(product_id,snapshot_sha256)`。
- 下游支持 UNIQUE：`(id,product_id,snapshot_sha256)`，非 deferrable。
- 精确父 FK：`(parent_version_id,product_id,parent_snapshot_sha256)` → `product_version(id,product_id,snapshot_sha256)`，非 deferrable，ON UPDATE/DELETE RESTRICT。
- binding ≤8KiB，snapshot ≤64KiB；正文与摘要分别核验，不以 JSON 等值替代规范文本相同。

创建输入只能选择精确 parent 和已登记 consumer renderer，不能另选 engine、来源 target、review 或 baseline。snapshot 嵌入实际父 snapshot，固定原 target、review、baseline、三 hash、engine、字体及 source components。资源集合等于父修订的规范 asset-set，并核父 asset-set SHA；consumer 六状态 mapping、mapping SHA 和访问/保存/完成/报告协议另行固定。

新建在 Product 锁内重核未归档、父来源仍为当前 head。原 operation key 成功回放先返回历史事实，不因后续 head 或归档否定原回执。精确 compiled 实现、字体与文件闭包的可用性由服务实际核验，SQL 元数据不能冒充可运行能力。

app 只有 SELECT/INSERT；无 UPDATE/DELETE/TRUNCATE，保护 trigger 也拒绝 UPDATE。

### 3.2 access_key

永久 NOT NULL 列：

`id`、`product_id`、`play_version_id`、`play_snapshot_sha256`、`credential_digest`、`issue_operation_key`、`issue_binding_text`、`issue_binding_sha256`、`valid_for_seconds`、`issued_by`、`issued_at`、`expires_at`。

可空单向组：`revoked_at`、`void_operation_key`、`void_binding_text`、`void_binding_sha256`、`voided_by`；必须五列全 NULL 或全非 NULL。

- UUID PK；issuer/void actor 引用 operator。
- UNIQUE：永久 `credential_digest`、`(product_id,issue_operation_key)`、非空事实的 `(product_id,void_operation_key)`。
- 下游支持 UNIQUE：`(id,product_id,play_version_id,play_snapshot_sha256)`，非 deferrable。
- play FK 逐列引用 play 的 ID/Product/SHA，非 deferrable，ON UPDATE/DELETE RESTRICT。
- issue/void binding 各≤4KiB，包含完整原操作绑定。raw、恢复链接、Cookie 和 CSRF 不入表、回执、列表或 audit。

`valid_for_seconds` 为 3600..2592000。首次实际 INSERT 用一次 DB clock 毫秒采样确定 issuedAt，expiresAt 精确等于 issuedAt 加固定秒数。不能分别采样两个时间；期限、摘要及 issue 身份永久不改，回放不续期。数据库校验时刻与差值，服务封存实际首次采样事实。

void 只允许五字段从全空一次转为全有；Key 锁内重核从未存在 session、无 report。没有答案或有效 grant 不等于未领取。五字段清空、部分写入、二次改变、已领取后作废均拒绝。归档不移除旧 Key 的恢复权利，也不阻止按当前运营权限处理未领取作废。

app SELECT/INSERT，仅授五个 void 字段 UPDATE；无 issue 身份、期限或摘要 UPDATE，无 DELETE/TRUNCATE。跨 Key 的操作键冲突依严格合同报有限错误，不能凭该错误清除 UNKNOWN 或造永久未发生证明。

### 3.3 consumer_session

永久 NOT NULL 列：`id`、`key_id`、`product_id`、`play_version_id`、`play_snapshot_sha256`、`created_at`。UUID PK，`key_id` 单独 UNIQUE；存在即永久 claim。

状态 NOT NULL 列：`state_revision`、`answers_text`、`consumer_state_answers_sha256`、`progress_text`、`progress_sha256`。

last 四列：`last_binding_text`、`last_binding_sha256`、`last_receipt_text`、`last_receipt_sha256`。revision=0 时全空；revision>0 时全非空。

- Key FK 固定 Key/Product/play ID/SHA，非 deferrable，ON UPDATE/DELETE RESTRICT。
- `UNIQUE(key_id,id)` 支持 grant 引用。
- 最终 tuple 的非 deferrable UNIQUE：`(id,key_id,product_id,play_version_id,play_snapshot_sha256,state_revision,consumer_state_answers_sha256,progress_sha256)`。
- answers fact ≤64KiB，progress fact ≤4KiB，last binding ≤4KiB，last receipt ≤8KiB。

answers 正文保存 `quizforge.consumer-state-answers.v1` 包装及规范数组；progress 保存 `quizforge.consumer-state-progress.v1` 包装及严格 `{questionId:null|id}`。它们与既有 engine `answersHash` 是不同摘要域。

初始 INSERT 必须 revision0、空答案、null 进度、无 last。每次接受的状态更新，包括同值 save，都整体 revision+1；不可跳步、回退或绕回。上限 2147483647，到顶仅拒绝新 save，当前完整答案仍可 complete。

**claim 与 void 必须有数据库双向保护。** session 首次 INSERT 的 BEFORE trigger 自行对对应 Key `FOR UPDATE`，在持锁后重新核验五字段 void 组全 NULL，才允许写入初始会话。void trigger 同样先锁该 Key，再检查永久 session 不存在。精确 FK 不含 revoked 字段，不能用 FK 或服务前置检查代替此项：即使是直接 app SQL、合法 revision0 和完整匹配的 FK，先 void 成功后再 INSERT session 也必须拒绝；反向先 claim 后 void 同样拒绝。该首次写入规则不把正常到期当成撤销已有 session/report 历史恢复的依据。

每个 UPDATE 必须同时核九列状态组：revision、两份正文及 hash、last 四列。last binding 的 base 等于新 revision−1；receipt 的 applied revision 等于新 revision；session ref 与两个状态 hash 严格对应。不能仅改正文、进度或 last 而保留 revision。

app SELECT/INSERT，仅授上述九列 UPDATE；无身份/createdAt UPDATE，无 DELETE/TRUNCATE。不另存 claimed/completed flag。

### 3.4 consumer_grant

永久 NOT NULL：`key_id`、`slot`、`session_id`；PK `(key_id,slot)`，slot 为 1..16。FK `(key_id,session_id)` → `consumer_session(key_id,id)`，非 deferrable，ON UPDATE/DELETE RESTRICT。

受控可变 NOT NULL：`grant_id`、`credential_digest`、`issued_at`、`expires_at`；`revoked_at` 可空。当前表内 grant ID、digest 各自 UNIQUE。expiresAt−issuedAt 精确为 28800 秒。

槽位归属不可改变。轮换整体替换 ID、digest、时刻并将 revokedAt 置空；新身份与旧身份不同，不能以原身份续期或解除撤销。没有全部历史 UUID 账本，也不声称随机碰撞数学上不可能。

Key 锁后优先复用过期/已撤槽，稳定按 slot 选择；尚有空槽时用最小空槽；否则替换 issuedAt/slot 最早者。事务与 SQL 后盾重核合法选择，不允许任意驱逐。fresh raw/UUID 来自服务器 CSPRNG，数据库只存独立域 digest。

logout 只将当前精确 grant ID/digest/Key/session 的 revokedAt 从空置为时间，不能只按 slot 撤销后来的新身份。延迟旧 Cookie、save 或 logout 必须重新核验当前身份。

app SELECT/INSERT，仅授身份/时间/revoked 组 UPDATE；无归属 UPDATE 或 DELETE/TRUNCATE。

### 3.5 quiz_report

所有列 NOT NULL：

`id`、`key_id`、`session_id`、`product_id`、`play_version_id`、`play_snapshot_sha256`、`state_revision`、`consumer_state_answers_sha256`、`progress_sha256`、`completion_key`、`binding_text`、`binding_sha256`、`snapshot_text`、`snapshot_sha256`、`display_sha256`、`completed_at`。

UUID PK；Key、session 分别 UNIQUE。操作 namespace 为 session+completionKey；同 key 异 binding 冲突，另一 key 已完成返回 completed-other，不伪称本请求成功。

关键最终 FK 是以下八列：

```text
(session_id,key_id,product_id,play_version_id,play_snapshot_sha256,
 state_revision,consumer_state_answers_sha256,progress_sha256)
  → consumer_session 的精确最终 tuple
NOT DEFERRABLE, ON UPDATE RESTRICT, ON DELETE RESTRICT
```

所有引用列 NOT NULL、父 UNIQUE 非延迟，配合 session 每次 state/last 更新必须 revision+1，在数据库最后防线上即时封住报告后的答案修改；不能在同一事务临时改动后再补回。报告不引用可轮换 grant。

binding ≤4KiB，完整 snapshot ≤512KiB。snapshot 的 binding、精确 play、完整答案/进度及两个 state hash 必须对应最终 session；不能只比较摘要列而让正文不同。完整 ContentScore、最终文案/展示及固定 engine/renderer/font/resource 身份均封存。

`snapshot.view` 的 reportId、completedAt 和 completion binding SHA 对应行事实；`display_sha256` 独立固定规范 view，无需重复保存 view_text。历史读取只从固定 snapshot 投影，不重评分、不调用 AI、不用 latest 实现回退。

浏览器只验证收到的 display SHA 与绑定；完整 report SHA 是服务器字节标识，未收到完整快照的浏览器不能声称验证了它。SQL 与 hash 校验也不能替代实际可信 engine 执行或固定来源文案验证。

app 仅 SELECT/INSERT；无 UPDATE/DELETE/TRUNCATE，保护 trigger 拒绝 UPDATE。

### 3.6 consumer_exchange_budget

`singleton boolean PRIMARY KEY CHECK(singleton IS TRUE)`；`window_index bigint NOT NULL` 且非负；`used smallint NOT NULL`，范围0..60。迁移只种一行 true/当前 DB 分钟/used0。

app 只能 SELECT、UPDATE window/used；无 INSERT/DELETE/TRUNCATE/id UPDATE。guard 也检查唯一 true 行实际存在，缺行不自动补。

持预算行锁后采样当前 DB 分钟。同窗仅允许 used+1 且≤60；进入更晚的实际当前窗时只允许从1开始；时钟回拨、未来 bucket、减计数、同窗 reset 或 used61 均拒绝。固定窗口边界可短时跨两窗，不称滚动60秒限额。

格式合法但无效 Key 也收费，廉价源/JSON 拒绝在预算前完成。预算独立短事务的实际 COMMIT 与关闭确认后才进入 Key 事务；共用初始15秒，不退款、不睡眠、不持预算锁等待 Key。收费行事实本身不是 COMMIT 证明。

## 4. Canonical、JSON 与 NULL 防线

新建独立 SQL consumer canonical helper，不修改 0017 的固定 helper。对象键按 C 排序、数组保序、字符串不 normalize；协议数值均为有界整数。数字分支先检查范围与整数性，再规范化整数文本，防止 `1.0`、指数或负零的原文借 jsonb 等值通过。每份原始正文都必须等于重建后的 canonical 文本，并核 UTF8 SHA。

验证顺序为字节预算、解析、深度与类型、严格 keys/内容、canonical/hash、列和跨事实对应。不得依赖 SQL AND 的求值顺序保护不安全 cast 或数组访问。

- 每个必需字段显式核 key 存在、确切类型与值；额外字段拒绝。对象重建不能替代非空类型检查。
- 必需 JSON null、缺键和 SQL NULL 均不能成功。只有明确声明的进度 null、last/void 全组空和 revokedAt 可空分支允许为空。
- row helper 必须返回 true/false；解析/转换异常在 validator 内返回 false，不吞业务写入事务错误。
- 所有 CHECK 使用 `helper(row) IS TRUE`；trigger 用 `IS DISTINCT FROM` 或 `IS NOT TRUE`。STRICT helper 返回 NULL 不能绕过约束。
- malformed/重复 key/非规范空白顺序、非法 Unicode、超深或超预算正文拒绝；合法中文、换行和 emoji 保持原字节定义。
- 时间从 typed 列以 UTC 毫秒格式重建，有限且年份可表达，不依赖连接的 TimeZone/DateStyle。
- 纯 shape/canonical helper 为 IMMUTABLE STRICT、security invoker、固定 `search_path=pg_catalog`。查来源、锁或 clock 的 trigger 不误标 IMMUTABLE。
- PUBLIC 权限全部撤销；仅授必要 helper EXECUTE。不引入 SECURITY DEFINER 逃生函数、动态 SQL 执行入口或包内代码。

## 5. 完整 ports 与公共接口配接

公共 `ConsumerFlowService`、`InternalPlayService`、`AccessKeyService` 已由共享合同定义，绑定惰性开库的 request owner。HTTP 不传任意 DB/事务。所有路径 selector、binding 与当前身份在服务内部再次核对。

| 底层 port                 | 必需能力与边界                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| InternalPlayPort          | lockProduct、readParent、findOperation；readById(Product/play ID)先核存储事实，readFixed另比较固定SHA；list≤100且slot降序；insert                         |
| AccessPort                | issue/void操作核实、lockKey、readKeyById、listIssueFacts≤50及有界cursor；grant摘要初始定位、锁后精确验证、轮换、logout；不读session/report表              |
| ExchangeBudgetPort        | 只对singleton执行admitOne，返回有限收费行事实；不查Key、不自行开下一事务；owner证明COMMIT/close                                                           |
| SessionPort               | readClaim、findOrClaim、lock、replaceNext；列表同快照读取≤50个Key的claim元数据；不返回report完成分支                                                      |
| ReportPort                | readByKey/readView、insert；按≤50个Key批量读安全完成元数据；应用层据此判断完成                                                                            |
| FixedSourceDataPort       | readFromParent无需已有play；从已核parent.validation派生scope/expected，复用quizpack固定来源证据入口并比较target/三hash；readFixedContent用于纯SQL题目校验 |
| ResourcePolicyPort        | 纯allowlist匹配：中性entry或最终选中report的授权资源，与固定来源精确ref/version/blob/declaration对应；selector本身不授权                                  |
| FixedIoScope              | preparePlay、prepareExecution、readResource；通过既有私有读取端口执行真实有界IO及关闭隔离，不开放任意路径/FD                                              |
| Clock/ReferenceLock ports | 同事务、等锁后新鲜时间；新引用在领域锁前取得非等待storage SHARE                                                                                           |

operator 按 ID 读取 play 不需要预先知道 SHA；固定消费者读取仍逐项比较已绑定的 SHA。Key 页按 `(issuedAt,id)` 降序，每页≤50；Access、Session、Report 各读自己的有界事实，在同一个 **REPEATABLE READ READ ONLY** 事务观察快照中组合最终≤256KiB DTO。仅传相同 TransactionSql 不够：READ COMMITTED 多语句之间可能发生 claim/complete，导致 claim为空而completion非空。不得退回该组合；如采用等价实现，须证明整个组合期间相关 Key 锁持续阻止状态变化。当前设计优先使用 RR 一致快照，返回前仍执行既定新鲜运营授权检查。不传答案/报告正文，不以空页证明不存在；cursor只选页，不授权或承诺跨页不变上界。

初始 grant digest 查询只定位 Key/session/grant；Key→Session 锁后重核完整 grant ID/digest/期限，不能因初始查到记录便授权。报告存在的判断仅由应用层通过 ReportPort 编排。

`readFromParent` 复用 `readFrozenDraftSourceEvidenceReadonly`；来源 scope/expected 从已核父证据派生，不能让调用方自由填写三 hash。普通 save/entry 对固定题目与选项的检查走纯 SQL 来源 port，不占文件任务槽。

资源 IO 复用 `readPrivateResource`：固定归属、O_NOFOLLOW、真实inode/大小/MIME/hash、单文件≤8MiB；所有实际FD关闭被等待或隔离。公共返回请求自有 Uint8Array 和 mediaType，不返回文件路径、FD或任意动态URL。HTTP须通过owner的body适配延续 retained-byte 所有权至响应drain/cancel/deadline，不能返回bytes后提前释放文件任务槽。

## 6. Request owner 与有界真实关闭

### 6.1 复用与必须补的缺口

既有 `createDatabase.close()` 幂等保存实际关闭 Promise，并合并 budget abort 与显式 end 的结果；P3E owner 和 ResourceReadTask 已有真实settlement/隔离模式。它们可以复用，但每pool的max5不能限制跨请求pool数量。

现有 createDatabase 在返回DB对象前失败时，会在catch中吞掉清理end异常。新owner必须在openSql分配client后、verification第一次await前接管资源；factory rejected不能当作“没有资源”或“已关闭”证明。

采用最小内部observer/lease接入共用开库路径，保留旧公开调用和固定driver policy。observer记录实际opening、工作和end promises；即使对外返回固定开库错误，也保留未确认client。只有factory内部明确证明从未分配client，才可无资源释放。不能另造弱化身份/guard的简化开库实现。

### 6.2 独立八格纯SQL容量

新增process-global固定8格SQL租约，覆盖opening/running/closing/quarantined。注册表使用固定Symbol单实例，防同进程route/module/HMR重复创建；shape或版本不符fail closed，不清空重建。不按用户、Key、实例或操作建立无界map，不保留历史账本。

开库factory调用前同步占格。第9请求立即有限busy，零factory调用；无排队、等待者列表或后台重试。每格≤1个pool，沿既有max5，所以本P4纯SQL每进程≤8pool、池容量/本地客户端socket上界40。四FS任务、旧routes和其他进程另计；不声称全app、整机或PG存活backend总cap，实际worker数在受管E2E记录。

归还必须有正向事实：opening及实际工作已settled，并且所有实际close成功、pool关闭确认、owner不能再发工作；或明确从未分配client。超时、abort、handler返回、Promise拒绝或观察窗口结束均不释放格。

close迟到成功且全部条件满足，才归还一格。close拒绝而无正向关闭证明则隔离占格，不用后来的end成功覆盖早先未确认资源。幂等close/abort/finally只记录常数个真实Promise，不自动循环end，不替换driver onclose，不靠无限观察连接绕过gate。

业务UNKNOWN与资源关闭分别处理：资源全关闭可以归还格，但原业务pending继续核实；资源关闭未知则继续占格。永久故障最多占满8格并fail closed，恢复需受管真实进程/旧worker退出及必要backend/维护guard证明，不能clear registry或TTL释放。

### 6.3 固定phase与IO隔离

同一request owner只接一个公共业务调用，固定phase顺序，不开放任意runSql循环；始终沿用同一个初始15秒budget。

- 普通bootstrap/save/resolve/report/logout及运营issue/void/list用一个纯SQL格，不占FS四槽。
- exchange：独立预算db1事务COMMIT及真实close确认，归还第一格后，checkpoint并重新占格才开db2。db1未知时db2调用次数必须为零；第二阶段无格不退款、不续deadline、不进入Key事务。
- createPlay/首次complete先以SQL观察原请求或已有report；预检池真实关闭归还后，确需IO才进入四槽FS owner。已有报告回执不受FS名额占用影响。
- 首次complete在写事务外有界准备固定来源、字体与实现依赖；最终写事务重新锁Key→Session、新鲜授权/期限、ReportPort优先、精确play/revision/hash重核，再纯评分、投影和一次report INSERT。锁内不做慢FS、PNG或网络。
- 资源SQL授权后，实际IO、DB/guard/FD及保留字节由FS任务持有至真实关闭/消费。四个FS quarantine不消耗SQL八格；SQL格满不能借FS或旧factory偷开纯SQL池。

## 7. 精确schema guard与权限收口

新增consumer schema guard/facts，并最小适配client、migrate和Drizzle声明；共享协议、登记与公共文档仍由主控维护。

guard逐项固定：表kind/owner/RLS、列名/type/nullability/default、表与列ACL/PUBLIC、PK/UNIQUE/FK/CHECK完整定义及validated/enforced/deferrable/actions、索引valid/ready/live。约束显式短名，避免自动长名截断歧义。新FK内部trigger按真实PG18生成事实冻结，不机械套旧表数量。

user trigger核enabled、事件、函数身份、参数、WHEN等完整属性；helper核源码SHA、语言/返回/strict/volatility/security/search_path/EXECUTE。不能只核同名对象存在。预算唯一行实际缺失同样fail closed。

migrate按最小表/列权限重新授予，清除额外列授权；owner staging可以完成，app不能半能力打开。旧测试表清单、迁移列表和fixture适配只能精确增量，不用“删除任意qf表”逃生。

## 8. 完整retain与测试维护

保留图为play→父version→review→revision→validation/import→asset-set/blob；Key→play；session→Key/play；grant→session；report→最终session/Key/play。过期、void和logout不释放业务来源。

维护exclusive后用新READ COMMITTED观察，按精确revision/import/validation/blob集合求完整affected图；跨Product共享blob和嵌入固定资源也检查。任一未知或外部引用都保留，不能只等最后FK失败。

旧fixture允许删除自己的review/version，也必须在**首次自有账本DELETE及任何unlink之前**检查新play全部后代。旧fixture没有P4收据时，任何新play/Key/session/grant/report均是外部；失败后原账本、来源行和文件须完全不变。

新fixture只接受完整已观察receipt/hash/ID/actor/所有来源图。当前grant槽在exclusive下新鲜列举并核归属。测试owner可按精确自有图逆序删除report→grant→session→Key→play→P3E→来源；不授app DELETE，不用Product通配或CASCADE，不删除预算singleton。共享blob还需无剩余引用及精确inode拥有证明。真实关闭未知时不清理；超级用户测试维护不等同业务能力。

## 9. 验证计划与冻结出口

以下均为**planned，未运行**。原88项分组保留，另加12项SQL owner故障计划；合计100项计划编号，不代表100个已通过的自动测试。

| 原计划分组              | 项数 | 主要断言                                                                                            |
| ----------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| schema/权限/guard       | 13   | 完整或部分能力、表/列/PUBLIC权限、NULL/default、同名弱化、FK/索引/helper/trigger、singleton缺失     |
| canonical/JSON/hash     | 11   | JS与真实PG字节、Unicode、非规范文本、缺键/JSON null/SQL NULL、错类型、多key、摘要、时间、解析失败   |
| play                    | 7    | 精确父/来源/mapping、100槽并发、回放/head/归档、缺精确实现无fallback                                |
| Key/claim/void          | 9    | 固定期限/唯一性/无raw、归档、单向void、claim竞争及永久性、操作冲突、issue UNKNOWN                   |
| grant                   | 9    | 多设备同session、16槽/第17、合法槽选择、8h、迟到logout/Cookie、独立CSRF、过期报告、exchange UNKNOWN |
| state/complete/report   | 18   | 初始/CAS/同值/last/superseded/最大revision、同异完成key、save竞争、最终FK、固定报告/DTO、等锁后期限 |
| budget                  | 9    | 60次/无效Key/廉价拒绝、窗口/回拨/竞争、COMMIT/close未知、原deadline、已有grant读报告                |
| upgrade/retain/真实关闭 | 12   | 旧行及checksum不变、活跃/弱化拒升级、旧回执、新引用/共享blob、首次删除前无副作用、精确fixture/退出  |

新增12项SQL owner计划覆盖：

1. 恰8格且第9零factory调用；8格未知后100次请求不增加pool或记录。
2. 迟到成功恰释放一格；实际work仍pending不提前释放。
3. 开库早失败资源交接；重复abort/finally/close调用幂等且Promise数量恒定。
4. exchange两连接真实先后、db1未知时无db2；第二格不可得不退款。
5. 四FS隔离与SQL容量独立；业务UNKNOWN和资源关闭分离。
6. 多module/route共用进程8格；隔离子进程真实故障与退出后精确维护。

17→18验收须构造实际17谱系、r1→r2、review/version和共享资源，升级前后逐旧表比较规范行字节；重跑迁移不改history。真实PG负例覆盖权限、内部FK trigger、CHECK/NULL、并发与晚COMMIT；driver/关闭测试使用真实连接与受控故障，不能用mock结果代替退出证明。

claim/void计划必须包含直接SQL的先后双向及竞争：void成功后尝试合法初始session INSERT、claim成功后尝试void、两个事务并发争用同Key；只允许一方成功，失败后不能留下void与claim并存。Key分页计划另在各port读取之间实际提交claim/complete，验证RR页仍是一份一致快照、不会产生claim为空而completion非空的DTO，下一次独立读取才观察到完整新事实。

正式实施顺序：严格Schema/接口/本文独审闭合并冻结 → 0018与精确guard → 合成17→18及约束实测 → owner/领域服务/并发与UNKNOWN → 完整retain与fixture → 主控集成检查、生产Next/E2E、四宽截图和固定PNG → 首款P5。程序通过仍不代替作者视觉、内容、商业或发布批准。
