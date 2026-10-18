# P4 数据实施记录

状态：0018 结构底座已实现并完成首批定向检查，**P4 数据业务尚未验收**。日期：2026-10-18。设计与接口冻结依据见 [数据设计](P4_DATA_DESIGN.md) 和 [消费者合同](CONSUMER_P4.md)。

## 第一笔：结构、权限与开库 guard

- 新增 0018 六表、精确引用、正文/hash 校验、单向状态 trigger 和最小 ACL；0001–0017 未修改。
- session 首次 INSERT 在 Key 锁后检查 void 全组为空；反向 void 在同 Key 锁下检查永久 session/report。实际直接写入、反向竞争和最终报告阻写仍待下一笔 PG 证明。
- report 最终八列 FK 为非 deferrable、ON UPDATE/DELETE RESTRICT；session 状态/last 更新必须 revision+1。
- 新增三个有限运营 audit action：`internal_play_created`、`access_key_issued`、`access_key_voided`。保持旧目标规则，并限制新目标、actor/session、成功 outcome 和有限 revision。
- Drizzle 声明与 SQL 列/复合引用配套；复杂规则以不可变 SQL 迁移为准。

新 guard **刻意精确冻结整个 qf catalog**，包括全部22表的列、约束、索引、trigger、helper、enum及表/列/函数ACL；不只检查6个新表。角色以 owner/app/public 归一化，内部trigger不使用含OID的动态名字，并按完整归一化结构排序。关闭RLS、有效索引、helper源码及安全属性等均进入指纹。预算singleton实际缺行也拒绝开库，不自动修复。

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
