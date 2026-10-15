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

## 首个评分里程碑（尚待收口）

A提交cecb529集成为21885b9，prepare/identity/score三个真实入口已可调用。root29定向通过；Astra独立29/29、Python Fraction 541组golden通过，覆盖两个引擎、负贡献、精确归一化/距离/匹配/胜者及logic/answers hash。100题16维32结果长ID样本输出39054字节，未超64KiB；此为实测样本，不是所有合法输入的尺寸上界证明。getter不执行、超字节/深度、伪造handle、引用及失败冻结探针通过。

root与独审都实际复现Compiled内部访问器返回真实Map与未冻结对象：替换两个向量后，同一handle/answers从low变high且logicHash/answersHash不变。登记P2，A正在将Map留闭包、只查询冻结值并冻结Compiled；未交修复前不记关闭。witness/coverage/首款逻辑执行与B适配尚未完成。

B从同一0b60b29公共基线在codex/content-v2-adapter实施v2/分派/内容内部引用，准许仅为不复制原算法而提取v1/references.ts，其旧manifest/文件职责与语义必须保留。主控保存了30个合法结构的v1引用正反例基线，待接入后比较完整issues；两旧包及默认Schema字节基线继续保留。0b60b29普通CI38750123621与媒体CI38750123390均实际success，不代表后续评分代码已经通过阶段验收。

Compiled修复f6fc40a→e0faa64已独立实际复验关闭：无真实Map外露，Compiled/lookup/返回选项及向量冻结，字段/函数/向量突变被拒；30测试及原541个Fraction golden再次通过。B的99cf61c→c32f94f也已独审无新P1/P2：140定向、19独立边界，64资源/32portraits完整图通过；44旧引用完整issues（含顺序）与旧Schema/两包在审查工作树前后相同。root另实际30组合法结构引用差分全部相同、两包与默认stdout字节相同，core+v2合计84项定向通过。

root9f7b2da仅增加显式`quizpack:schema --content-version v2`内容Schema输出，不带manifest或任何候选/渲染资格。零参数仍原stdout，真实CLI4项、类型/lint通过。adapter、witness、coverage与四卡执行仍在两实现线接续，独立阶段及最终全套未完成。

## 完整纯模块与适配器复验

A1b1714d→0adf262实现witness/coverage/四卡转写，Bccb84cb→9be6074及d9cdde5→90531c8实现真实评分、见证及覆盖的固定完整内容绑定。Astra分别实测核心/adapter70项、内容75项，私有handle、调用后输入变异、报告循环重绑定、source/hash、全封套Unicode边界及反例/inconclusive保留均通过。独立30个小模型完整答案穷举与coverage一致，三实际压力入口保持inconclusive；无剩余对应P1/P2。

A3d9479f→9873e34保存执行工件。root从准确Git原文独立提取并核对12题、48选项身份/顺序/向量、四维/目标/order、48个见证答案，Python Fraction计算16距离与实际core全部匹配；Astra另独立重跑四score、三压力计数、verify-source.py及5个stress测试，工件语义一致。测量不作为SLA或OS隔离。

root实际发现A.output仅计value遗漏20byte成功封套（65536 payload返回65556 Result）。A d82b0bb→5ece681改计完整Result，原限额不变；64核心定向通过，Astra5边界测试及10个独立score/evidence精确上限、+1、Unicode/转义探针全部通过，P2关闭。该问题不等于已有合法score样本实际超限。旧执行工件的数学结果/hash不变。

root在9873e34时格式/lint/类型、102文件1306单元通过；5ece681核心64增量通过，正在最终构建/媒体/浏览器验收。fresh d15c6efaa13b856040bf672ecaa15a18的34文件335PG通过；driver首次误用P2A配置环境变量，在执行场景前返回DRIVER_TEST_CONFIG_REQUIRED，未当通过。已用实际QF_DRIVER_TEST_INSTANCE配置重跑，后续按真实结果记录。阶段仍未技术验收。

## 2026-10-16 源码闭包收口

5ece681已完成以下实际检查：102文件1309单元、335PG、46driver、零warning生产build（65trace/12941路径/0private）、main66×3封存和222生产E2E/10旧skip。浏览器实例1f1e3633d1e630fb820804cf816eee96在Next退出后B3→B2清理并停止；driver初次配置错误在场景开始前失败，使用QF_DRIVER_TEST_INSTANCE后的46项实际通过。

预研实际发现P3-A新增的四个v1运行依赖漏出source inventory：primitives、scoring-v1、lib/json/canonical和content/reference-graph。Astra确认compiled artifact不能替代离线tsx源码绑定，登记当前P2。主控将四文件及解析别名所需根tsconfig.json同时加入主部署固定source与fixture sourceSnapshot，新增membership和五文件改字节拒绝回归；不改tsconfig内容、限额或旧停止协议。

根tsconfig虽已绑定，外部TSX_TSCONFIG_PATH仍可能改变loader选择。五个固定media package入口在node/tsx启动前覆写为./tsconfig.json，matrix子进程再次固定根的绝对路径；CI改用固定入口，inline失败诊断也前置固定，workflow路径过滤同步五个文件与package。实际raw node负对照加载自有alias marker，固定入口不加载；preload另确认五个命令在loader启动前均正确选择根配置，不启动媒体或签发cap。独立62/62通过，代码窄审无新问题。

修订后格式/lint/类型与103文件1316单元通过；新build/bind、五文件实际变更拒绝探针及重新封存/浏览器待完成前，不以旧54f80b seal记最终P2关闭。只扩大正确的源码绑定清单，不放宽硬化限额或使用未验证部署。
