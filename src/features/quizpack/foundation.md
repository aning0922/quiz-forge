# foundation.v1 局部合同

本入口独立于 `contracts.ts` 中尚未实现的完整 QuizPack 提案，也未接入消费者研究代码。F1 合同从 strict Zod Schema 推导 TypeScript 和 Draft 2020-12 JSON Schema；没有 transform/refine 或可执行扩展字段。

- `foundationBundleSchema` 仅检查结构、有限集合/长度、固定枚举、整数及路径形状。
- `getFoundationJsonSchema()` 返回结构 Schema；不能据此判断归属、引用、ID 唯一性或见证完整性。
- `validateFoundationBundle(input, targetProductId)` 先检查结构，再检查调用者目标、归属、命名空间内 ID 唯一性、固定版本、引用、资源路径/媒体声明及见证答案完整性。结构失败不会进入引用检查；所有结果始终 `publishable: false`。

产品身份路径为 `product.productId`。`contentVersion` 固定维度、题目、选项、结果、模板及组件声明版本；资源具有独立版本，引用必须精确固定到清单声明版本。选项 ID 在所有题目间唯一。六个页面状态为 cover/question/resume/result/report/poster；每个状态必须有已声明组件与至少一个资源引用。所有资源仅归属本 Product，不接受根据输入自行声明的共享资源例外。

规则只有 archetype、result-order 平局策略、有限维度贡献和三结果目标声明。没有评分器、规则执行或见证可达性判断。见证只证明每个声明题目出现一次且选项属于对应题目。每个结果必须携带 title/summary/strengths/tensions/reflection/disclaimer 完整基线，结果/模板引用均固定版本；报告模式声明不创建 QuizReport。

`fixtures/historical.foundation.json` 固定 `historical-synthetic`，包含三个人物方向的合成结果、两道合成题及每结果完整声明见证。所有资源都是 pending 清单占位，没有文件字节、真实人物、实际素材或授权批准；零值 hash 与一字节长度是显式合成占位，不是文件核验结果。消费者页面和真实 PNG 导出保持原样。

未知字段（包括代码/HTML/module URL/任意 props 扩展）被拒绝。文本字段只接受有界纯文本，不渲染 HTML，不执行其中内容；本合同不进行自然语言事实审核。错误消息不返回 Zod 原始消息、输入值或未知键正文。

调用者另需通过有界 JSON 解析与草稿 revision/hash 逻辑。这里不读取文件、不解压 ZIP、不核验文件 hash/魔数、不查询真实组件注册表、不核验来源/商用授权/人工审批，不提供数据库、权限或发布能力；这些责任显式保留在每次返回的 `unverified` 中。自报 approved 也不能改变发布资格。
