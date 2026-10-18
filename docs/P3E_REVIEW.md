# P3-E 独立审查记录

2026-10-18，承接P3-D交付a66c456。当前只完成范围和共享显示合同前置审查，不是review/version、迁移或P5完成结论。

## 范围与锁协议

Astra认可首款有限精确登记路径：离线核完整批准语义及技术映射，受信registry登记实际canonicalContent/assetSet/manifest三hash，运行时精确匹配同一产物，不新增通用语义等价引擎。baseline/renderer/engine分域，descriptor留存独立于代码执行可用性，临时preview能力不能用于P4持久Key。

首稿设计出现两项P2，已在[合同](INTERNAL_VERSION_P3E.md)修订并完成设计复核：

- 仅独立连接StorageReadGuard可能在连接中断后留下物理删除与业务提交窗口；新增同一业务事务的同键非等待shared advisory锁，取得后重验原guard，事务锁保持到COMMIT/ROLLBACK。review新增引用也执行，文件IO仍在事务前并确认收口。
- 同review多版本加100硬上限可能使无key、未被消费的请求永久unresolved；新增仅seal的capacity-exhausted终态，单RR原key优先、精确目标/head和100不可删除slot事实，依数据库NOT NULL/CHECK/UNIQUE硬约束。普通VERSION_LIMIT不充当证明。未来不得原地放宽旧协议，推翻已发永久未应用证据。

以上为设计P2关闭，实现须真实PG维护竞争/断连/容量竞态验收。

## 共享显示机器合同

主控提取lib/assessment-contract/display-v1、display-shapes-v1和display-limits-v1；旧Studio合同按原字段顺序组合并继续以binding.productId检查引用，显示正文不带draft/requestId或消费者权威。字体descriptor和resource transport仅供项目内受控adapter构造，无动态URL或代码能力。

主控15文件127项相关单元、类型、定向lint/format通过。Astra在独审副本复制准确8文件，实际16文件128项通过，包括独立旧版解析器与新版逐路径差分；浏览器独立打包仅包含中性合同及Zod，没有feature/server-only/Node依赖。旧字段顺序、完整封套预算、Product绑定、资源/结果/海报关系均保留，无剩余P1/P2，可冻结第十节并交B解耦。

B后续transport/媒体收口、私有评分句柄、六状态DOM和实际PNG尚未实施/验收；不能把本段Schema审查外推为这些运行链路通过。素材来源依据和首款离线映射另行核验，不用代理检查代替作者新内容或发布批准。
