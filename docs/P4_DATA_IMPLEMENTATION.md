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
