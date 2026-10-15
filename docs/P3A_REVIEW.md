# P3-A 合同与共享底座审查

日期：2026-10-15。基线B2-3交付802585b；其最终文档head普通CI38746840789和媒体CI38746840257均实际success。P3-A合同0746ccd，独立Draft PR #15堆叠于#14。此页是实施记录，不是P3-A验收。

## 合同与分工

[CONTENT_SCORING_P3A](CONTENT_SCORING_P3A.md)经独立Astra前置审查修订：v2每布局有限64引用与override恢复场景、alt不算用途；内容内部引用不替代旧manifest/文件核验；双层DP工作量与路径存储限额；纯逻辑审阅与完整内容的不同来源绑定；精确hash域/顺序、不可变适配器；Unicode长度及固定题厅顺序。

公共机器字段另明确原序inputSha256、规范witnessesHash、NO_PROFILE_MATCH仍可规范、source声明须外层核验、coverage完整层计数。独审合同问题已闭合。主控交中立Schema/canonical/审阅封套和接口，A交quiz/scoring引擎与首款逻辑，B交quizpack/content v2/内引用/adapter。只有共享接口验收后才派依赖实施；不开放ZIP/P2/DB/消费者准入。

## 兼容提取

原P1的ID/version/SHA/engine/Ref/贡献/rules原定义提取到lib/assessment-contract，旧路径再导出。旧Schema默认stdout实际字节相同，SHA256为1142db3b63f7ec5ea5ed90b8b630f324ae948c626e82e93f7c7c6f909d61f38d。两个旧synthetic包真实重构后逐字节相同：dimensions15352字节、SHA9e377ab8f3fec0dbf28aeccdbbc092c4131b201b9f558be8f3961f759d6f23a0；archetype15266字节、SHA3380e32b52d12e223dfbceb77d5079f602ca8f14e68adb80b6fa4bc7d6088076。

中立ordinary JSON walker保持原遍历与字节规则，P1包装保留预算、错误类/message/code。独审在其隔离树验证74个v1 content/canonical测试，并用34项差分探针覆盖getter/proxy/稀疏数组/环/异常值和字节边界，一致；独立重算两个policy hash及域LF一致。新Fraction Schema拒绝前导零、非约分、非标准零及超长十进制。

主控首次typecheck因BigInt字面量受既有ES2017 target拒绝；改用BigInt构造器后通过，未改target/依赖。格式/lint/类型与92文件1167单元通过，后续再补两项证据一致性测试，7项公共合同定向及类型/定向lint/格式通过。最终完整阶段检查待引擎和v2实现集成后执行。

## 已关闭的机器Schema问题

1. 见证报告曾接受passed但expected/selected不同，或mismatch/NO_PROFILE_MATCH错误丢失全体规范hash、INVALID_ANSWERS仍保留hash。修订为passed完整Ref相等、mismatch不等；invalid原因仅INVALID_ANSWERS或NO_PROFILE_MATCH且单项一致；全体hash为null当且仅当存在非法答案。新增非法和合法对应项，独立实际复验关闭P2。
2. coverage曾接受全域结构证明processedQuestions非0。修订结构证明为0、穷举大于0；反例答案数等processedQuestions且questionId唯一。合法反例、题数矛盾与重复问题反例均实测，独审关闭P2。

错误path进一步固定字段白名单，不允许输入的任意键名进入公开错误。两项P2最后独立7/7通过，无剩余公共合同阻断。

## 实现责任

Schema只证明形状及可直接核实的字段关系。A的每个公开入口必须先有界ordinary JSON快照，再解析/语义检查/计算；准备对象用私有WeakMap签发且不暴露可变Map，返回前核整份UTF-8输出预算并深冻结。B对完整内容适配器承担同等职责，一次快照固定正文及报告映射，不接受外部Score冒充引擎输出。组合预算约束整个审阅封套/报告，不是各子对象限额相加。

见证形状或集合不合法整体失败；形状合法但缺题/重复/未知或跨题选项逐项invalid。预算/异常不能截断为成功。真实评分、见证、覆盖、四卡执行、v2兼容及全部验收仍待后续实施，不因共享类型已存在而记为完成。
