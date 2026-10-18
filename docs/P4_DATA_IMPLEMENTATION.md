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
