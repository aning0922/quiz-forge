# P3-A 内容合同与确定性评分技术验收

日期：2026-10-16。最终运行代码 `ce190cd50c3515cc0e3254a7ba1a8b4bee484711`；独立Astra复核最终证据，全部已登记P1/P2关闭，本批技术出口通过。首款端到端内测尚未完成，内容、素材和发布批准仍待人工。

## 已实现能力

纯评分模块支持 dimensions/archetype@1.0.0，真实重算上下界、BigInt精确归一化和距离、确定性平分顺序，固定逻辑/答案hash；答案不完整或引用非法不返回结果。Prepared由私有WeakMap签发，内部数据不可变，整体输入与返回封套有固定预算。见证实际执行，dimensions覆盖在固定工作量内给proven/uncovered/inconclusive，反例经过真实评分复验。

有限content.v2包含封面、四厅题目框架、场景引用、图片替代文本与结果卡表现字段；v1/v2明确分派，内容内部资源图严格闭合。真实评分/见证/覆盖适配器固定完整内容hash与报告引用，调用后输入改变不能篡改结果。CLI仅新增显式v2内容Schema导出，旧默认全包工具保持原行为。

四卡李白、苏轼、陶渊明、白居易的12题/48向量/四目标/四完整见证已从准确Git原文转写并实际执行。主控与独审分别复算；四见证胜者均符合原声明，Python Fraction独立核16距离，来源与输出见[执行工件](qa/p3a-scoring/README.md)。这仍是明确authored-pending逻辑审阅，不是完整QuizPack、内容批准或科学效度证据。

## 实际验证

| 检查               | 实际结果                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| 格式 / lint / 类型 | 最终修订后全部通过                                                                               |
| 单元测试           | 103文件、1316项通过                                                                              |
| PostgreSQL         | fresh实例34文件、335项通过；此后无DB实现改动                                                     |
| 真实驱动           | ESM/CJS共46项通过；此后无驱动改动                                                                |
| 生产构建           | 零warning；65trace / 12955路径 / 0私有违规                                                       |
| macOS媒体隔离      | 最终main目标66项连续三轮全部通过，实际sealed                                                     |
| 生产Chromium E2E   | 最终freshDB 222通过、10既有跳过，2.2分钟                                                         |
| 兼容差分           | 默认Schema stdout、两旧ZIP逐字节相同；主控30组、独审44组旧完整issues顺序/内容相同                |
| 算术及边界         | 独审541组Fraction golden、30小模型独立穷举；四卡实际执行与来源核验；输出封套/大分母/工作预算通过 |
| 独立审查           | 已登记P1/P2全部关闭，最终部署/源码探针/媒体/浏览器/清理/CI证据复核通过                           |

本批没有新UI。生产E2E回归覆盖已有前台和Studio；沿用B3已验收的24图，不把旧合成体验或新评分纯模块当作已接通的消费者真实六状态。后续固定revision预览须另做真实浏览器图检。

默认Schema stdout SHA256仍为1142db3b63f7ec5ea5ed90b8b630f324ae948c626e82e93f7c7c6f909d61f38d；两个旧包分别15352/15266字节，摘要见[P3A_REVIEW](P3A_REVIEW.md)。纯核心及adapter均不会读取文件、网络、数据库或在运行结果中引入时钟。

## 源码闭包与真实部署

P3-A提取的四个v1运行依赖与根tsconfig纳入main/fixture source inventory，五个固定media package入口在tsx加载前固定根配置，矩阵子进程再次固定绝对路径。真实外部alias负对照可执行自有marker，固定入口不会；五个真实源/配置文件逐一变更均返回MANIFEST_MISMATCH，精确恢复后验证成功。最终绑定1039个source文件、740个artifact文件。

最终deployment为31257f256851648045c83d5d125908ab7352d5e3cf13f96a8cbd84fc64724bfd，runtimeBundle为8e634193a61e0f4fcbaa50226975c22228ee15e5247e0fef8ddbbd01bb3ee4b2。三轮各66/66，停止已确认、残留control为0；封存两个提交标志均true。[有限集成记录](qa/p3a-integration.json)只保存摘要与结果，不保存私有运行配置。

中途旧build生成cache单文件超16MiB时，仅迁出生成cache到私有目录并核1313个非cache运行条目一致，没有放宽限制。最终修订后build直接在原限额内绑定，无需额外迁出。

## CI与保留问题历史

ce190cd的[普通CI38771885883](https://github.com/aning0922/quiz-forge/actions/runs/38771885883)和[媒体CI38771886058](https://github.com/aning0922/quiz-forge/actions/runs/38771886058)均实际completed/success。媒体CI覆盖Linux的smoke、生命周期、离线封存及真实Next入口；本地macOS final seal单独记录，不混作同平台结果。

过程中实际发现并关闭：共享见证/覆盖Schema内部矛盾、Compiled可变Map别名、仅计value漏掉20byte成功封套、提取依赖/tsx配置漏出源码绑定。最后一项在完成新build/bind、五文件真实失败探针、重新66×3封存和fresh E2E后才由独审关闭；旧54f80b部署与其seal不当最终证据。driver初次误用环境变量在场景开始前失败，正确QF_DRIVER_TEST_INSTANCE后的46项才记通过。详细修订和独立复验见[P3A_REVIEW](P3A_REVIEW.md)。

fresh普通DB d15c6efaa13b856040bf672ecaa15a18已停。预备浏览器实例1f1e3633d1e630fb820804cf816eee96与最终c1eb544465f3aafd2f8b63c74ccadbd9均在Next退出后B3→B2精确清理成功并停止；独审确认3100/55423无监听，历史失败/UNKNOWN现场保留。

## 下一批与限制

[Draft PR #15](https://github.com/aning0922/quiz-forge/pull/15)堆叠于#14，未合并main。接续P3-B authored/v2包级准入：显式完整包验证、受控候选、资源归档和首稿事务；之后固定revision真实预览、重新导入追加修订、人工审核/版本封存、Key/会话/不可变报告及P5内测。网页内编辑后置，不删除首稿或改Product绕过返修。

当前P2仍仅支持synthetic/content.v1；本批未扩大持久化准入、实现组件renderer或批准任何正式素材。四卡文案、权重/目标、报告和图片须提交具体材料供作者审读。main合并、生产迁移、部署与商业发布仍须作者批准。
