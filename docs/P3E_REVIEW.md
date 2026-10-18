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

主控15文件127项相关单元、类型、定向lint/format通过。Astra在独审副本复制准确8文件，实际16文件128项通过，包括5776例旧版解析器与新版逐路径差分（成功数据及失败issues完全一致）；浏览器独立打包仅包含中性合同及Zod，没有feature/server-only/Node依赖。旧字段顺序、完整封套预算、Product绑定、资源/结果/海报关系均保留，无剩余P1/P2，可冻结第十节并交B解耦。

B后续transport/媒体收口、私有评分句柄、六状态DOM和实际PNG尚未实施/验收；不能把本段Schema审查外推为这些运行链路通过。素材来源依据和首款离线映射另行核验，不用代理检查代替作者新内容或发布批准。

## 首款来源与离线映射

Astra已实际读取ROW/Europe Terms、Services Agreement和官方商业输出FAQ，认为来源文稿准确，可结合具体生成记录作为八图commercialUse/redistribution的供应方输出使用依据；不等于独占版权鉴证或作者商业发布批准。正式声明须绑定最终来源文稿SHA、单图SHA和精确生成记录，原资源pending/平台unverified及独立内测账本边界保留。

独审核19离线产物摘要、36实际输入摘要、来源公开文稿和OFL摘要；三张新原始PNG及李白原PNG核验通过。1971叶映射与outline逐项一致，168 reviewed-exact及1364可寻址评分转录逐源一致；四个witness.status沿既有declared-not-executed常量。九条alt只移除历史待审二字并记录批准来源，其他文本不改；category、空tags及列明的heading/ID/template属于受控技术映射，无新P1/P2。此时45来源/许可null和三权威hash为空的状态仍真实，最终规范包须完成声明后重新核验，不能据草案提前记准入成功。

## 审核与版本机器合同

主控新增internal-versions的strict请求、三类identity、review批准事实、不可变snapshot、分域指纹、永久核实终态、有限列表、完整封套预算和async integrity。独审发现一项P2：直接复用server canonical引入node:util/Buffer，浏览器无法bundle；仅新协议改为Schema解析后可在浏览器运行的canonical，原通用安全canonical不改。新实现明确不提供JS Proxy鉴别能力，不替代服务器通用不可信对象入口。

修复后主控12合同单测、类型/lint和真实Chromium156的5项完整性/4身份家族逐字SHA对照通过。Astra独立重跑12测试、实际browser bundle/file页面（Buffer/require均不存在）及4家族对照；另256组Unicode/转义/数值/顺序差分、512次字节边界、14类非JSON/accessor零执行/深度拒绝均通过，P2关闭。独审最坏完整100列表129221B、detail5171B、8renderer state5367B均在预算；无剩余机器合同P1/P2，可冻结交两实现流。权限、DB、真正same-RR/当前授权、资源收口和维护并发仍须实际实施验证。

A的每请求owner闭包设计已前置复核：同步transfer和一次性runNew、精确db/budget/clock身份、实际FS及SQL/关闭收口归actual callback；保留原数据库取消关闭机制、UNKNOWN与晚成功核实。独审18项既有task/storage回归通过只说明现有基础，不冒称新owner已验收。
