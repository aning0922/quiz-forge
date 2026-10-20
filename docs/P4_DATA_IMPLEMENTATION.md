# P4 数据实施记录

状态：0018 结构底座已实现并完成首批定向检查，**P4 数据业务尚未验收**。日期：2026-10-18。设计与接口冻结依据见 [数据设计](P4_DATA_DESIGN.md) 和 [消费者合同](CONSUMER_P4.md)。

## 第一笔：结构、权限与开库 guard

- 新增 0018 六表、精确引用、正文/hash 校验、单向状态 trigger 和最小 ACL；0001–0017 未修改。
- session 首次 INSERT 在 Key 锁后检查 void 全组为空；反向 void 在同 Key 锁下检查永久 session/report。实际直接写入、反向竞争和最终报告阻写仍待下一笔 PG 证明。
- report 最终八列 FK 为非 deferrable、ON UPDATE/DELETE RESTRICT；session 状态/last 更新必须 revision+1。
- 新增三个有限运营 audit action：`internal_play_created`、`access_key_issued`、`access_key_voided`。保持旧目标规则，并限制新目标、actor/session、成功 outcome 和有限 revision。
- Drizzle 声明与 SQL 列/复合引用配套；复杂规则以不可变 SQL 迁移为准。

第一笔 guard 的 catalog 指纹包括全部22个普通表的列、约束、索引、trigger、qf helper、enum及表/列/函数ACL；不只检查6个新表。角色以 owner/app/public 归一化，内部trigger不使用含OID的动态名字，并按完整归一化结构排序。关闭RLS、有效索引、helper源码及安全属性等均进入指纹。预算singleton实际缺行也拒绝开库，不自动修复。**50bb7ec 的关系集合只枚举 r/p，未覆盖 view 等 namespace 对象，不能称为整个 qf namespace 的冻结；该 P2 见下文补正。**

0018 前置比较完整旧17结构。新装的权限授予发生在所有DDL完成后，因此前置结构指纹不包含ACL；18完成后的开库guard仍严格检查全部ACL。owner可完成迁移，app不能打开部分能力。

持久结构规则从已审v1机器Schema固定到SQL中，拒绝多余键、必需NULL、错类型及预算/深度越界；另有行值、摘要与来源/FK检查。它不是JS执行入口，也不能替代可信评分、展示来源和服务授权。完整service仍须使用机器Schema的语义核验。

## 实际验证与限制

- 最终新鲜purpose=test实例实际完成1→18迁移、应用开库及7项定向真实PG测试。
- 实测包括canonical字节与play/report结构正例、JSON null/缺键/多字段拒绝、同名弱化CHECK、额外列授权/PUBLIC读取、helper安全属性、预算行缺失及FK/trigger定义保护。
- 当前代码全量1766单元测试通过；格式、lint、TypeScript通过。单元测试不代替数据库事务验证。
- 最初独立17→18结构迁移可运行；第一次全新1→18暴露了前置指纹包含尚未授予ACL的问题。修订为结构前置后新装通过。一次开发期生成脚本产出空指纹，迁移前置检查拒绝，随后改为直接读取真实17结构并校验摘要后重验。此前过程实例均停止保留，最终自有实例留作后续验证；不用后一轮成功抹去失败记录。
- 本笔尚未完成真实旧17业务谱系逐行无损升级、最终版本跨fresh/升级指纹一致性、完整PG回归、driver、build、HTTP/E2E或视觉验收，不能记为这些检查已通过。

## 后续实施

下一笔补claim/void与报告最终FK的直接SQL/并发反例、旧17谱系升级和完整retain/fixture首次删除前保护。随后实现独立8格SQL owner、早开库observer、真实关闭故障矩阵和领域服务，再交主控集成及独审。

原88项加12项owner故障计划仍按实际完成逐项核验；本页的7项定向检查不代表100项计划完成。正式首款现场、旧UNKNOWN实例、生产部署及发布不在本笔操作范围。

## P2 补正：关闭 qf namespace 漏检

独审确认：50bb7ec 中 owner 可创建 `qf` 可更新 view 并授予 app 列 UPDATE，使 app 经 view 更新原本不能直接更新的 operator credential digest。原 catalog SHA 不变化，原开库 guard 可通过。独立自有合成实例已复现该写入；没有使用首款或其他聊天的数据库。

补正增加同一 `assertConsumerNamespace`，由 `createDatabase` 的 schema 校验及所有正式 `migrateDatabase` 路径调用。迁移先取得连接级迁移锁，再在任何 DDL、历史写入或重授权限之前检查；每个 migration 前及最终重授权限前再次检查。缺失 qf 仅允许 bootstrap，应用仍必须通过完整18能力检查。检查失败不自动删对象、不修复授权、不重写历史。

精确范围：

- qf schema 必须属于预期 owner；schema ACL 仅允许 owner 和无 grant option 的 app USAGE，拒绝 PUBLIC、其他角色和 app CREATE。
- qf 的全部 `pg_class` 对象只允许已登记的22个普通表（旧阶段允许其子集）及普通索引，且属于预期 owner。拒绝 view、materialized view、sequence、foreign table、partitioned relation等其他 relkind；表定义、实际索引集合仍由原结构/运行时指纹检查。
- qf 的全部类型只允许这22表的实际 row composite、6个登记 enum 及其自动 array，且属于预期 owner；拒绝 domain、独立 composite、额外 enum 等。实际 enum 标签由原指纹检查。
- qf 表不允许 rewrite rule 或 policy；qf 不允许自定义 collation、operator、opclass/opfamily、schema default ACL、conversion、extended statistics 或 text-search config/dictionary/parser/template。qf 的实际函数集合、源码、安全属性、约束、trigger 等继续由原精确指纹检查。

0018 SQL 字节及 SHA256 **`a723d409df2dc1225f4504ff14bc13b18824c93adac28b7f10058c3e586c060a`** 保持不变；0001–0017 也未修改，没有 DDL 因而不新增虚构0019。完整安全迁移入口是 migration runner：裸0018 SQL中旧17结构指纹仍只覆盖原查询集合，不能单独承担新增 namespace 检查。已有干净18直接由新 guard 接纳，含未登记对象的旧17/18拒绝并留给维护者审查；不自动清理。开库检查不是持续撤销已有连接的机制；迁移仍要求停旧写者，owner 任意并发 DDL 不属于在线授权模型。

本笔实际验证：自有新鲜 test 实例1→18成功；`p4-namespace.test.ts` 4项与原 schema 7项共 **11项真实PG通过**。namespace 4项内覆盖：干净18重复迁移零变化；updatable view 的合成正向攻击、原摘要不变、无直接列权限及新开库/迁移拒绝；14组 namespace/schema/default ACL 变体拒绝；旧17加 view 迁移拒绝且全部旧表行/完整 history/表列函数及schema/database ACL前后一致，移除本测试创建的 view 后17→18成功，旧行和旧17历史不变，新旧18指纹一致。最终 catalog SHA 仍为 `906ca3748d7991b3a2095cb4a603465c5abb776e2df0213f2ee84ff7b2f98ab6`。foreign table等未逐项创建的种类依据有限 relkind 检查拒绝，不冒称其独立实测。

本笔全量157文件/1766单元、format、lint、typecheck及生产build通过，build trace为80条且0违规；没有运行生产E2E或完整PG回归，3100未启动或占用。本工作树同时保留下一笔未提交的core/retain准备，未混入本笔提交。

fixture 中一次检查发现存储空目录路径遗漏 `uploads`，在提交前已修正为正式 storage helper 返回路径并重跑上述11项通过；没有在该实例写入导入文件。旧 `P4_TEST_GRAPH_CHANGED`、日期解析及23001断言过程实例继续停止保留。本笔独审仍待主控复验，不能提前登记“无P1/P2”；core/retain及完整业务验收留待下一笔。

## 下一笔：直接 SQL、retain 与真实升级

- 新增7项 core 真实PG测试：实际发行时刻与固定时长、app禁止延期、void后直接合法claim拒绝、claim后void拒绝、相反事务锁竞争只一方提交、等值save也revision+1及last单独更新拒绝、真实答案→受信纯评分→report封存及最终FK阻止后续合法save、只读report删除权限，以及首次删除前未知旧行保护。实际最终FK错误为PG `23001`（RESTRICT），不是原测试误写的 `23503`。
- consumer引用检查接入两个原有internal-version维护入口，在任何旧review/version自有豁免前执行。实际exclusive lock与fresh READ COMMITTED下检查完整play来源；revision/import/validation/shared blob或精确parent版本命中即拒绝，未宣称void/expiry可释放来源。旧17测试阶段仅在新表确实不存在时跳过新层；正式应用仍要求完整18。
- fixture先验证全部旧16表的原始数据库行文本、全部5类已观察新行文本和无文件条件，才首次DELETE；每条新行的原始文本从实际INSERT/UPDATE RETURNING取得，不通过Date转换比较、不截掉时间戳精度。未知行/不符事实直接保留；只删除已观察的精确子行与review/version，随后才运行旧的有限合成reset。
- 真实旧17 fixture包含r1/r2、r1审批/封存版本和实际共享blob。升级前测试拒绝仍活跃的app writer、真实storage reader和同名弱化旧CHECK；升级后逐行比较全部旧16表和旧17完整migration历史，最终catalog与fresh18一致，原r1 binding仍解析为原封存版本，head已为r2。重复迁移为空。旧16→17→18的既有谱系回归同步适配最新迁移集合，不修改旧SQL。
- 测试清理入口增加5类consumer行的非空拒绝；预算永久行不TRUNCATE。旧P2-A表清单改为22表。旧授权漂移测试明确先拒绝schema CREATE且全部权限保持，再由该测试显式撤销自己授予的CREATE后继续既有有限grant replay。

实际结果：7项core、1项真实17升级、1项旧16升级分别通过；namespace测试配置前置适配后，namespace4+core7+17升级1合计12项再次通过。格式、TypeScript、lint通过。普通完整PG第一轮发现旧表清单/授权修复预期，第二轮59文件/484断言通过、namespace4项beforeAll跳过，整体失败：旧suite短暂设置 `imports.enabled=true`。namespace现仅移除此非必要开关前置；重建schema仍要求标记验证、purpose=test/ci、22表全空且预算仅1行、实际uploads目录为空。完整回归待重跑最终结果，不能把484通过当488通过。

开发过程的初次timestamp类型假设、原23503预期、整图比较解析差异及一次RETURNING复合行限定语法错误均已修正；有实际partial graph的过程实例停止保留，不复用重置。此笔没有实现grant轮转服务、8格SQL owner、业务HTTP服务或真实首款链路，仍待后续实现与独审。

后续完整回归又实际暴露namespace与普通fixture隔离：旧认证suite留下6条合成audit行，namespace的严格空库证明在DROP前拒绝（230通过/1失败后bail）。这些行未被namespace清理，实例停止保留。该组四项现在使用独立 `vitest.p4-namespace.config.ts` 和新鲜marker-verified空实例，不再混在普通 `vitest.db.config.ts`；不降低空行/无文件证明、不借reset清除前suite行。独立命令为 `pnpm exec vitest run --config vitest.p4-namespace.config.ts`，应由CI在另一个新隔离service执行。新自有实例该4项通过；普通PG回归仍待最终结果。实例隔离修订不影响runtime gate或任何migration字节。

## SQL admission 与工厂早期生命周期观察

新增纯SQL阶段 primitive（尚未接三类public业务服务）：process-global固定Symbol registry最多8个当前owner，opening/running/closing/quarantine全计数；在factory前同步占格，第9个有限BUSY且零factory调用，无排队和TTL回收。一个phase仅一个既有max5 pool，因此仅此P4入口每进程池容量上界40；不声称整个应用或多进程总连接上限。

只有实际factory及顶层callback都settled、真实verification也settled、所有实际end fulfilled且终态不再发起新工作/关闭时才归还。factory明确证明从未分配client时可无资源归还；裸factory rejection不是证明。关闭拒绝永久隔离，实际close迟到fulfilled可按全部条件归还；业务OUTCOME_UNKNOWN与资源归还分开。每owner只保留当前opening/work/verification及最多3条既有factory真实end观察，无历史/无限Promise数组，无reset API。

`createObservedDatabase` 与既有 `createDatabase` 共用完整配置、身份、schema验证和既有driver策略。内部observer在verify首次await前同步拿到实际client，并观察actual verification与normal/abort/catch各end Promise；原catch对外有限错误不变，其吞掉的close rejection仍被owner保留。未观察的旧入口行为不变，不提供弱化schema或任意数据库来源的应用接口。

当前实测：5项故障注入单元通过，涵盖8格/第9号、取消/超时后保持占位、close已fulfilled但实际work或verification仍pending、模块重载共用registry、迟到正向证明精确归还、显式无client证明、业务UNKNOWN且资源真关闭可归还，以及拒绝close后100次请求零新增open。另1项真实PG父测试运行4个独立真实driver子进程（normal、late-close、early-failure、rejected-close）通过：实际pool/client建立，end的迟到/拒绝观察由测试在真实资源上注入，额外请求被挡；cleanup调用捕获的原生end，父进程等待子进程actual close后再查询真实app backend数为0，才记为结束。不是声称driver自然发生了这些错误。

早期失败夹具第一次用了本地配置不允许的server port，故在分配client前被配置校验拒绝，父测试记录失败但也确认0后端；修正为仅在内存使用CI-profile的错误预期server身份（连接参数仍是同一个自有test库），真实verification失败分配路径后四场景重验通过。没有修改实例配置/marker、业务行或旧SQL，永久故障registry随该独立测试进程实际结束；没有在运行进程清registry假装恢复。完整driver46项、普通PG全套、HTTP服务与FS资源body生命周期仍待后续验证。

本笔当前158文件/1771单元、format、lint、typecheck和生产build通过；implementation校验3项可用，build trace80项/0违规。普通PG整套在此固定生产源继续运行，尚无通过结论。未运行3100/E2E，不把primitive当三类完整service或request/resource owner已交付。

随后同一固定e08b78c生产源的普通PG已完成：**60文件/485项通过，无skip**（285.10s），fresh namespace另4通过。485包含真实SQL owner父1项/4子场景；不包含之后新增的request owner测试。主控已转告Astra对core与SQL primitive独审无P1/P2，该结论不扩展到下文新owner或尚未接通的服务。

## 单请求与资源 body owner

新增 `createConsumerRequestOwner(config, clock)`：构建时不打开SQL/FS；每请求只接一个public方法、固定原budget，顺序阶段不并行，exchange最多两段SQL；其他方法最多一段SQL，再按需进入一段FS任务。pure SQL不占4个FS槽。IO路径持有真实storage guard、同一完整guard的observed app DB及实际callback；实际关闭未知/拒绝时继续隔离guard/task，不拿HTTP返回、dispose或stream回调作为资源关闭证明。

资源仅能由该owner的read-resource路径发行一个非空有界bytes对象。body adapter要求同一对象、只能交接一次，直接返回原 `ResourceReadTask.body`，没有额外ReadableStream预取队列；body在实际Task.run结束前建立，所以最后queued chunk仍占4槽。`onBodySettled`为旧body API增加可选回调，仅清理请求clock；原task的actual settlement、unconfirmed IO、bodyEnded等释放条件未改变。请求finally不会取消已交接body的原abort传播；drain/cancel/deadline清理clock，未交接body明确cancel。actual IO callback尚未开始即取消也回收clock，不假造任何关闭证明。

当前新6项owner单元+旧6项resource任务共12通过，覆盖exact bytes、单次交接、4个小图最后chunk回压、lazy/单public call/两SQL阶段、取消、原deadline、尚未进入IO就取消、DB close pending时guard与名额保留和迟到成功。另2项真实PG通过：真实guard/app DB关闭后4个合成内存body仍占IO名额，独立SQL可运行；隔离子进程在4个真实pool上注入end拒绝，实际4把维护SHARE锁保持、第五IO被拒、SQL仍可运行，后续原生end也不清掉隔离状态，直到该进程真实SIGTERM退出，父进程再确认自有app backend为0。没有使用真实业务行/图片文件，合成内存body测试不代表私有资产授权和读取已经接通。

此owner尚未接三类业务服务或生产HTTP；完整实际资产闭包、FS源端口与P4专属r1-head物理fixture继续实施。旧process/fixture未知现场与首款39eb保持不动。

本笔最终159文件/1777单元、format、lint、typecheck、生产build及上述2项真实PG再次通过；build trace80/0违规。没有重跑完整普通487PG、46driver或3100/E2E，不沿用上一笔485给新owner冒称整套已验收。下一步正常合入主控已封存最终consumer实现闭包，再接服务和物理fixture。

## Request owner 前序失败 P2 整改（2026-10-19）

独审在aeb8f51复现：上层callback捕获第一段SQL close拒绝后，原owner只清 `phasePending` 并计次数，允许exchange第二SQL或complete进入IO；前一个SQL primitive仍隔离占格，但不能以此代替请求阶段禁止后继。因此此前owner通过范围不代表其阶段安全已通过，该P2原证据由独审保留。

修复加入请求级 `phaseFailed` 和 `confirmedSqlPhases`。SQL只有完整工作、实际关闭和原checkpoint都成功返回才计为confirmed；任何SQL失败后永久禁止此request再sql/io。调用方catch、迟到close成功和handler返回均不重置状态，不释放先前隔离槽、不换budget。服务也不得catch失败后继续，但阶段门禁由owner自己执行。

原6项owner加4项新反例和5项SQL primitive共15单元通过：正常exchange两段仍可运行；callback拒绝、end拒绝、pending close取消及迟到fulfilled后，后继factory/guard/IO callback均0。真实PG子进程新增两个实际前序close拒绝（exchange/complete），捕获后第二SQL与IO都被拒；仍保留原4个真实FS拒绝guard，直到专有进程实际退出及父观察0 backend。仓储与transaction服务准备仍未提交，不混入本P2修复。独审复验待主控安排，不提前记为关闭。

本笔实际173文件/1844单元、format、lint、typecheck、production build和2项真实PG通过；consumer精确实现门禁1/1、77源文件/268锁记录，旧实现仍3/3、51/280；build trace80/0违规。已正常合入最终主控闭包，未运行完整普通PG或E2E来冒称整阶段完成。

## 同事务领域 ports（2026-10-19，服务接线准备）

新增lib DB事务上下文与per-transaction WeakMap锁见证，事务callback结束即失效；克隆或跨事务对象不授权写。product/internal-play只读自己及同product模块的父版本，access只查Key/grant，consumer-session只查状态，report只查报告；claim/completion元数据由应用层在同一RR中组合。每个持久正文先限字节、按机器合同核canonical/hash和实际列绑定；列表只读有界元数据，不拉取50份完整报告正文。

应用事务适配沿用原withStudioWrite的auth lock、前后运营鉴权和真实COMMIT判断；已确认rollback的ConsumerError用唯一sentinel保留原有限业务错误，未知提交仍OUTCOME_UNKNOWN。运营读取先RR一致快照，结束后在独立READ COMMITTED事务重新观察授权；没有在原RR里做无效的“再查”。匿名写包装也仅在真实原callback错误+成功rollback可证明时标为rolled-back，late COMMIT/连接失效不翻译成未执行。新增有限运营audit接口只接受既有3个动作，不记录原token、答案或匿名历史。

真实PG5项通过：实际play/parent/issue读取、同事务product/Key/session见证和克隆/逃逸拒绝、真实答案→报告行的完整JS/hash重验及有界元数据、ConsumerError/primitive失败后的已确认rollback，以及RR内仍可见active但另一事务已disable时返回前的新鲜鉴权拒绝。fixture完成首次删除前精确整图proof后成功清理。测试使用DB-only合成来源，不是资源IO或P4物理fixture。grant轮转、新仓储写函数与三类public service仍需后续实际用例覆盖。

本笔173文件/1844单元、format/lint/typecheck及production build通过，implementation门禁与trace无违规；5PG为定向结果，未重跑完整普通PG/E2E。Key service草稿未混入本笔交付，后续另交业务验证。

## P4 独立 test/ci 合成基线（2026-10-19）

经主控明确协调文件所有权，新增独立Product `consumer-flow-fixture`、固定测试输入和 `synthetic-consumer-flow-v1.json` 静态baseline。仅allowedInstancePurposes test/ci；approval仍synthetic-test、sourceEvidence仍synthetic-definition，不是作者批准、商用授权、真实媒体验证或首款39eb。旧synthetic/historical descriptor、原三hash与输入文件无diff，原两个entries顺序不变，只追加一项登记；baseline registry不在已封存renderer闭包。

测试派生helper只读旧合成输入，递归改独立Product引用并重算全部declaration/asset-set/content/manifest与纯评分逻辑。五张48×48合成PNG逐字节沿用，两独立Node派生的文件与descriptor摘要全部相等后才写新目录，不覆盖既有目录。新规范content SHA为 `d2a2ccf9be34c2485f71080e73337e43a159132650f2d9f36e71e49bdc33fae6`，asset-set为 `19f6cfe15c3eb4364a8f64a1b1f9f13ec5ddba6f0549bee11f3c8175f30e39d3`，manifest为 `2d196b5fb1a36cb267e73ba28b8d37e167cd7c3d847d0d3c93c32c138a24485a`。canonical JSON保持无换行，`.prettierignore`仅追加这4个精确输入。

新增3项与原5项baseline单元共8通过：实际静态bytes与独立派生相等、所有图片原字节、全引用属于新Product、三hash/Product篡改与demo拒绝、静态entry/hash及synthetic资格。implementation:check仍旧3/3、51源/280锁，consumer1/1、77源/268锁，均通过。本笔不打开DB、不创建parent/play/Key或运行任何native媒体验证；P4专属prepare/finish/清理和实际资产服务随后接此固定基线。

本笔174文件/1847单元、format/lint/typecheck和production build通过，trace80/0违规；未运行PG/E2E来替代合成登记审查。

## P4 专属物理 fixture 观察合同（2026-10-19）

`tests/db/p4-consumer-fixture-contract.ts` 与同目录 `P4_FIXTURE_CONTRACT.md` 固定私有文件名、字段、数量/总量和观察来源。实现入口仍在准备，此笔不是已可运行CLI或真实完成：prepare/read/finish/cleanup将用独立r1/head父版本和实际私有文件；CLI仅prepare/finish+runId，observations只读同run的0600固定文件，不通过参数/stdout传raw或报告正文。

明确分离 mode=`operator-services` 与正式 `consumer-e2e`。`finished`仅为fixture图封存；顶层 `completed` 必须等价于finished+正式模式+有限suiteCompletion+实际report，运营子测不能算完整E2E。完成摘要固定8类case、每类恰一次、status/expectedStatus皆passed、retry/repeatEachIndex皆0，B须沿实际testInfo形成，部分筛选/skip/expected fail/retry均不允许finish full E2E。固定case列表及具体字段见合同。

play/Key/state/report来源是已核验HTTP事实，彼此ID/hash/终态必须一致；每个current grant都须来自bootstrap和对应HttpOnly cookie的私下digest，禁止收养Product扫描结果，不保存raw cookie/Key/CSRF。未知图、错run/actor/关联、重复行和伪造serverExited字段拒绝。cleanup仍须真实ServerExitProof与首次删除前完整图/文件/跨引用证明，按P4先于共享blob的P3-E顺序。合同没有签发数据库、FD或server退出能力。

4项合同单元通过，覆盖准备态/两模式、full模式不完整拒绝、raw/扫描来源/跨Product/未绑定grant拒绝、错run/重复row/actor/未知authority字段拒绝，以及8类完成摘要缺项/重复/未知/skip/fail/retry/repeat反例。lint/typecheck通过；没有运行fixture实现/PG或E2E来冒称此合同已交付完整流程。

## 运营服务与P4专属物理fixture（2026-10-19）

新增真实 `createInternalPlayService(owner)` 与 `createAccessKeyService(owner)`，使用已审request owner、同事务ports和既有运营授权。新play要求active Product、当前head的固定sealed parent、精确consumer/engine/font/mapping与实际私有图片/字体读取；IO不持领域写锁，最终事务重新检查来源、head和授权。原operation成功在archive/head/新依赖判断前返回。Key签发/作废只走SQL；同Key锁与原issue/void绑定控制幂等，读取/列表在RR一致观察后另做新鲜运营授权。没有持久化raw Key或把列表当原操作未发生证明。

固定SQL来源端口只读父版本绑定的import/validation/candidate/三hash，重新核完整固定证据和content.v2。执行适配只解析登记过的精确版本，真实读封存字体/图片并等待实际FD关闭；未知关闭留在现有owner隔离规则。旧0018、旧renderer/engine与已封存consumer闭包未改。

物理fixture实现 `prepare/read/finish/cleanup` 与受限prepare/finish CLI。prepare为独立 `consumer-flow-fixture` 建r1/head，正式调用recordBaseline/sealInternalVersion并实际读五张私有PNG与字体；资格仍synthetic/no-native-validation，没有复用首款39eb或旧P3-E r2 head。0600 manifest只存合成凭证、已知业务观察与固定18类表的完整PostgreSQL行文本SHA；prepare保存来源初始事实。finish按已观察的精确IDs重读领域ports，核actor/parent/receipt/state/report及crypto，拒绝遗漏或额外consumer行、错actor/hash和外部引用，不从Product扫描收养未知授权。schema parse只是形状检查。

cleanup先核真实不可序列化ServerExitProof、prepare writer消失、imports关闭、实际app backend为0、exclusive storage lock、完整图SHA/外部引用和真实文件，再首次DELETE/unlink；created=false文件不删除。此轮生命周期退出用例运行实际owned Node子进程并等待其真实close，不冒称已跑生产Next E2E。正式runner仍由root接真实生产server退出，P4必须先于共享五图的P3-E清理。operator-services只会finished，completed保持false；完整consumer-e2e仍要求8类真实通过摘要与至少一份报告。

开发验证已发现并修正：fixture来源端口误传额外字段被strict拒绝；完整manifest超过旧readPrivateJson 16KiB上限，改为本fixture独立2MiB有界/O_NOFOLLOW/owner+inode+长度与读后稳定性核验；两次新增用例分别错误假定相同snapshot允许第二play、void resolution叫voided，实际唯一约束/合同正确拒绝或返回applied，测试已按冻结合同修正。相关已产生图的自有55421实例9af2、6c85、3730、50d9均停止保留，不从失败图重置凑绿；一次原完整生命周期与一次actor/hash/精确集合增强生命周期已完整通过，最终扩展用例复验结果随后记录。

当前175文件/1851单元、生产build、implementation gate通过：旧3/3、51源/280锁；consumer1/1、77源/268锁；trace80/0违规。format/lint/typecheck随后最终复核。本笔没有实现消费者exchange/save/complete/resource public factory、没有跑完整普通PG/46driver或生产3100 E2E，也没有把本笔当P4技术出口或视觉通过。下一笔继续消费者服务和真实grant/保存/完成/资源测试。

最终扩展生命周期在新自有test实例0f605f（55421）通过1项真实PG用例（3.32s业务测试）：包含正式父封存和实际源IO、play幂等/重复snapshot有限冲突/resolve/list、Key签发幂等/resolve/list/作废与读取、read-only能读不能写、形状合法但遗漏actual行/错play及Key actor/错摘要拒绝、伪造退出proof和额外audit行在删除前拒绝，最后真实退出proof下精确cleanup成功。相同用例先前两轮完整通过不叠加成多个测试数。最终format/lint/typecheck通过；175文件1851单元与生产build是本笔生产源的实际结果，未重跑全普通PG与生产E2E。未知开发现场继续停止保留。

## 物理fixture清理两项P2整改（2026-10-19）

8d9f931独审复现两项真实P2，先前运营生命周期通过不覆盖这两个反例：manifest实际FD close拒绝时只保留句柄，没有阻止同进程第二次cleanup继续；owner看得到foreign app PID但backend_type/state为NULL时，client backend筛选遗漏它。独审均在首DELETE前sentinel拦截，未实际删图，原现场保留。

本笔仅整改fixture与真实故障测试，不混入下一笔consumer factory草稿。新增process-global Symbol owner，unknown后read/prepare/finish/save/cleanup和删除前检查全部fail closed；不提供reset/TTL/late-close解除接口，模块重载仍同一隔离状态。manifest读写open/写入/sync/close/rename不确定、私有图片FD/写入不确定、服务WRITE_OUTCOME_UNKNOWN、实际app close和维护lock close失败均设置sticky状态并留存资源。cleanup首次DELETE发起后任何失败也隔离owner/维护锁，避免未知DB提交或unlink后重跑。已知的首次删除前图不匹配仍只拒绝，允许测试显式移除自己已证明的extra行后重新核图；不把已知前置拒绝泛化成已删图。

backend proof改查同数据库全部非当前admin/当前exclusive维护PID，不再按不可见的backend_type或state筛选。新增真实Node故障子进程：持有真实foreign app reserved连接，实际owner视角确认type/state均NULL；cleanup拒绝后该PID仍能SELECT且0次DELETE。随后真实manifest FileHandle close注入reject并保留FD，第一次失败；同进程反复cleanup/read/finish/prepare不新增open、不进入首DELETE；调用捕获的真实native close后及动态重载owner模块后仍拒绝。父测试在子进程前关闭自身全部DB连接，避免可见owner连接掩盖NULL类型漏洞；子进程实际退出后父进程再打开同一marker实例，核原manifest/五图不变和完整行SHA，最后独立真实退出proof下精确清理。

初次故障用例及原运营生命周期合跑2项真实PG通过（77.12s，含原auth窗口协调等待），无skip；最新隔离父连接修订再定向复验中。format/lint/typecheck通过，下一笔消费者服务仍未行为验收或提交。本笔不是完整PG/E2E或独审关闭结论；须主控/Astra复验两P2。

最新父连接完全关闭版quarantine用例再次通过（33.43s，含原auth预算真实等待）：foreign app为唯一额外backend、owner实际观测type/state NULL；子进程opens=1、deletes=0、late close与module reload仍blocked，实际退出后父进程整图/五图核验及cleanup通过。最终format/lint/typecheck均通过。独审是否关闭仍由Astra复验确认。

## 消费者public factory首轮实际链路（2026-10-19）

实现固定签名 `createConsumerFlowService(owner)`：exchange/readSession/readEntry/save/resolveSave/complete/resolveComplete/readReport/readResource/logout。没有修改冻结机器DTO、旧0018或任何已封存renderer/engine/consumer闭包。新增access域预算port，预算NOWAIT短事务按取得锁后的DB分钟窗口消费；该阶段真实COMMIT和实际连接关闭成功后才进入Key阶段，同一15秒owner、不退款、不自动重试。raw grant只在请求内产生，exchange的cookieGrantToken仍与JSON result分离。

匿名读取在RR中核digest selector、grant、完整Key/session绑定和有界业务事实，结束后另起READ COMMITTED核同一grantId/digest/期限；不是在旧RR里假装新鲜。写路径先核grant-bound CSRF，再取SHARE维护栅栏→Key→Session锁，锁后核精确current grant；save/complete解析完整原binding。save只查固定SQL来源和成员，不碰FS、模型或latest；同base CAS、noop+1、仅last receipt与未来revision拒绝按冻结合同返回。complete先读原report，已完成直接返原事实；新完成在锁外实际完成字体/图片IO，锁内重核source/state/grant/Key、运行固定纯引擎与装配完整确定性快照，纯装配/hash结束后再核精确grant，唯一INSERT封存报告。

历史report JSON只读完整持久快照及其摘要，不重评分/不重读图片/不调用模型。资源只选当前session中性entry或已完成selected portrait的有限allowlist；实际私有读取、FD结束及新鲜同grant观察完成后才issue原bytes body，沿已审owner直接交接。完成后Key普通到期不遮蔽原报告；grant自身失效仍拒绝。该期限规则代码已接通，真正server expiry与未知COMMIT/factory/close的更多故障矩阵仍需后续真实PG证明。

`p4-consumer-service.test.ts`实际专属物理来源用例通过并在最终源再次通过：exchange/bootstrap与真实entry字体/图片读取、授权资源stream完整drain和SHA；跨session/错CSRF/未揭晓portrait拒绝；同base两个save恰一个applied-current、另一个superseded，noop+1、不完整答案complete拒绝；并发完成唯一report与completed-other、原binding resolve applied/同key异binding conflict、完成后save返回completed；图片暂时缺失时历史JSON仍读、资源明确dependency unavailable，精确恢复自己移动的文件；第17grant替换最早slot，旧token及旧logout拒绝，最新logout只撤自身；已claim void拒绝而unused void永久。最后三Key/两个state/一份真实完整report/十八次已观察grant（含已替换旧观察）进入operator-services manifest，实际退出proof后完整图/五图cleanup成功，completed仍false，不冒称8case生产consumer-e2e。

最终该PG用例1项通过（8.36s，7.47s test含准备/服务/清理；先前34.14s一轮包含auth窗口等待，不能把32.65s test全当业务执行时长）。最终175文件1851单元、format/lint/typecheck/production build通过；旧implementation3/3、51源/280锁；consumer1/1、77源/268锁；trace80/0。没有跑全普通PG/46driver/生产3100 E2E；后续补预算/expiry、保存与完成未知结果、真正资源关闭/授权竞态矩阵，并由主控集成B routes/UI与Astra独审。fixture两P2的e1ac970独审复验仍待主控结果。

## ordinary PG caller导入开关前置修复（2026-10-19）

主控准确532/801（含0d）在全新b513/55423跑完整ordinary PG失败：65文件40fail/25pass，495项198pass/264fail/33skip，407.20s。首个实质栈是consumer-service调用cleanup时current imports.enabled=true，之后reset/prepare因保留图级联拒绝；末尾开关变false不抹除该首因。我的此前false实例单跑不能覆盖suite遗留true状态。主控已停库保留，不重置未知图。

本笔仅修三个已提交物理fixture测试caller：prepare与任何negative cleanup前，通过正式configureImports(false)建立清理前置；consumer-service先正式切true并读currentConfig证实，再正式切false并证实，随后完整业务链路和cleanup通过。fixture本身仍要求实时false，不降低开关/guard/退出证明。定向真实PG1用例8.10s通过（本地同时含待提交expiry修复的工作源，不能称旧0d全套通过），格式/类型检查通过；root后续新实例重跑完整ordinary PG才可给整套结论。期限P2源修复另笔提交。

## save/complete实际写语句期限P2（2026-10-19）

独审在0d原四反例确认P2：save/complete × Key/grant，在port入口两者均active，真实PG等待跨到目标期限后仍save+1或report1。原0018的session UPDATE与report INSERT触发器保护来源/不可变性等，但不完整检查这两个期限；不能把“进锁时检查过”或outer最后grant检查当内层摘要await之后的写入证明。原59e329独审现场停止保留，未修改旧0018或其guard摘要。

修复让save/report仓储显式接收同事务实际锁出的grant（WeakMap见证，绑定同Key/session且非revoked），所有canonical/hash await结束后，在真正UPDATE/INSERT的同一SQL里以MATERIALIZED clock_timestamp一次样本同时判定Key和grant期限。Key锁保持到事务结束，合法logout/轮转均需同Key锁，期间不能换成另一授权。没有从report域反查Key/grant表；用已核验锁事实的两期限作为谓词。0行后只用新鲜DB时钟分类ACCESS_DENIED/KEY_NOT_ACTIVE；该分类函数不授予写权。save+report均0写入时已确认rollback，不把它当结果未知。原成功report/receipt优先和grant本身到期拒绝的合同保持。

新真实PG一项覆盖四个子场景和完成后普通Key到期：临期行是明确的synthetic owner seed，在exclusive维护下单一事务disable/update/enable原命名trigger并提交；应用无法观察已提交的弱schema，提交后重验原verifyConsumerSchema及所有实际factory guard。不是应用续期接口、自然等待8小时或修改全局/浏览器时钟。每个子场景在最后授权之后的port新receipt/snapshot摘要处确认DB now仍早于目标deadline，实际1850ms等待后确认DB now已到期；随后save/complete × Key/grant分别有限拒绝，stateRevision不变且report0。恢复访问只显式exchange新grant，不给旧token续期。另真实报告先完成，再合成Key临期seed/实际等待，原Key exchange仍destination report、读原完整report SHA不变。

最终该用例14.36s/13.45s test通过（1 test内4个拒绝子case+已完成只读正例），原完整consumer服务用例修后两轮通过8.48s与enabled=true起步8.10s。175文件1851单元、format/lint/typecheck和production build通过；旧3/3、51源/280锁；consumer1/1、77源/268锁；trace80/0。0018 SHA保持a723d409df2dc1225f4504ff14bc13b18824c93adac28b7f10058c3e586c060a。本笔待Astra用四原反例复验，不宣称P2独审已关闭、完整ordinary PG或生产E2E已通过。e1两cleanup P2主控已转告独审原反例复验关闭，仅限该scope；下一步继续预算/未知提交/fresh授权竞态矩阵与主控最终集成回归。

## 预算、真实提交后结果丢失与新鲜授权矩阵（2026-10-19）

新增独立真实PG故障用例，生产服务保持311ba15不变。测试仍创建实际完整guard的observer-issued数据库对象；只在同一SQL对象上包装捕获的native begin，在真实事务COMMIT成功后注入返回结果丢失。不是声称真实网络自然丢包，也没有假造COMMIT/FD关闭。第一次harness误用Proxy替换SQL对象，被owner身份门禁在业务前正确拒绝UNAVAILABLE；该次已准备但未finish的0f605f实例停止保留，不reset或从扫描收养图，改新eeede/55421后测试通过。

实际预算COMMIT后丢返回：OUTCOME_UNKNOWN、只有1个factory且实际close已fulfilled、Key仍无session，实际永久预算已消费1（窗口推进时从1开始）；证明没有因业务未知打开第二Key阶段或退款。真实reserved budget行锁下NOWAIT有限RATE_LIMITED，1个factory/1个实际close、预算未加。廉价格式拒绝0个factory且预算行未变。真实save/report COMMIT后分别注入结果丢失，均OUTCOME_UNKNOWN；实际close均完成，原save resolution为applied-current，原complete resolution为applied，未追加重复报告。

另在真正RR结束后先由另一实际请求logout，再让原readSession进入新RC授权，原读取ACCESS_DENIED；在真实私有资源字节读完且native FD已关闭后用另一实际请求logout，原resource最终授权拒绝，未issue body。两次logoutObserved均只在exact logout成功后记录；scope/grant/state/report全部按实际响应与私下digest封存。末尾显式发起独立格式合法无效Key尝试，实际永久fixed-window budget达到used=60并RATE_LIMITED，不reset、不退款、不写请求历史；已有报告/运营读取不经该预算。

新eeede实例1项真实PG用例9.10s（8.17s test）通过，涵盖上述多个边界，最终原图/完整row manifest与实际退出proof下cleanup成功。format/lint/typecheck通过；本笔仅加测试与日志，没有重跑未变生产源的1851单元/build，也不把定向通过计为root第二轮全ordinary PG/生产E2E或独审关闭。fixture仍mode=operator-services、completed=false。下一步等待主控对311四原期限反例、完整普通PG和B生产浏览器链路的实际结论，并处理新证据。

该故障矩阵必须使用fresh独立consumer-faults suite与CI专属实例，不加入ordinary顺序共享库。它会永久留下budget.used=60，清理不触预算行；同分钟后续exchange会RATE。auth协调等待可能偶然跨分钟，不构成不干扰证明，也不能依赖测试顺序。上述9.10s仅证明fresh eeede独立1项通过，没有ordinary组合不干扰的实证。主控负责共享vitest/CI隔离配置；A不改test源码或重置/退款预算。此前主控第二轮ordinary固定源不含本新故障测试，不将两种scope混记。
