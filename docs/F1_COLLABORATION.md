# F1 并行开发合同

用户明确要求正常开发使用 GPT-6.1 Sol/high，架构决策与独立审查使用 GPT-6 Astra/high；当前总控负责总体架构与集成。旧 QuizForge 开发聊天保持暂停。

## 任务拆分

| 工作流              | 模型             | 文件所有权                                                                                                             | 交付                                                             |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A 合同/资源/参考包  | GPT-6.1 Sol/high | `src/features/quizpack/foundation*`、`src/features/quizpack/fixtures/`、必要的 `src/features/theme/resource-contract*` | strict Zod合同、归属/引用验证、三结果synthetic JSON、失败单测    |
| B 草稿/JSON边界/CLI | GPT-6.1 Sol/high | `src/features/product/draft*`、`src/lib/foundation-json*`、`scripts/foundation*`                                       | canonical hash、revision与证据匹配纯逻辑、有界JSON/CLI、失败单测 |
| 架构与独立审查      | GPT-6 Astra/high | 只读代码；`docs/F1_REVIEW.md` 由审查任务独立维护                                                                       | 对实际差异与测试复核，问题标位置/原因/复现                       |
| 总控集成            | 当前聊天         | package/锁文件、共享文档、集成修复                                                                                     | 冻结依赖、集成两个提交、六项检查、PR与CI                         |

A/B 从同一文档基线的独立worktree分支实施。可并行开发不依赖部分；B 的CLI在A稳定导出后接入。只读检查其他工作流代码可以，跨所有权写入须先由总控调整分工。各自提交，不强推、不合并main、不部署；由总控读取回报并集成。3100只由总控运行。

## 共享接口

A 提供 `src/features/quizpack/foundation.ts`：

- `foundationBundleSchema`：Zod strict结构，版本`foundation.v1`，kind固定`synthetic`；产品身份、内容版本、有限 archetype 规则声明、题/选项/维度/三结果、基线报告、六状态布局引用、资源声明与见证答案。
- `validateFoundationBundle(input: unknown, targetProductId: string)`：返回 `{ structurallyValid, referenceValid, publishable: false, issues: [{code,path,message}], unverified: string[] }`。错误信息不回显输入正文；targetProductId由调用者提供，不从输入自动信任。
- `getFoundationJsonSchema()`：返回 JSON Schema Draft 2020-12（结构层），交叉引用和归属需另调用validator。
- fixture：`src/features/quizpack/fixtures/historical.foundation.json`；不使用真实素材、Key或用户数据；声明见证不执行评分。

B 的草稿函数接收有界普通JSON内容，稳定productId/draftId；内容hash是canonical JSON SHA-256，不含revision/时间。create/update返回新对象，冲突/篡改hash/错误身份拒绝，实际内容变化使旧revision/hash审核证据失效；省略内容或canonical内容相同为no-op，返回独立副本并保留revision/hash/证据。它是本地纯逻辑，调用方必须以草稿封装productId作为targetProductId通过A的领域validator后才能创建/更新领域草稿（组合测试必须拒绝外层Product A搭配内容Product B），通用B函数单独成功不构成领域有效性，不是数据库/权限/发布服务。

CLI：`pnpm --silent foundation:check <file> --product <id>`（stdin使用`-`），`pnpm --silent foundation:schema`输出结构Schema。输入限1MiB、JSON深度32；拒绝重复JSON对象键，非JSON值/原型污染键/非法参数；错误非零、JSON响应，无堆栈/源文/绝对本机路径。合法结构引用退出0也只表示局部校验，输出始终publishable=false和未验证项。脚本用固定tsx依赖；package/锁文件由总控修改。

## 阶段检查

各开发聊天只运行单测、lint/typecheck等不占端口检查；最终由总控运行format/lint/typecheck/test/build/E2E（独占3100），审查聊天在非实施上下文复核。Schema、资源claim、fixture和本地草稿逻辑不能授予发布权威。真正ZIP、文件字节、规则可达性、组件注册、授权真实性与数据库事务均为未验证项。

## 已建立的独立聊天

- A「QuizForge F1 · 契约与资源归属」：GPT-6.1 Sol/high；聊天 `01a12b96-7351-73f0-9d8b-8cf655a7a0f2`。
- B「QuizForge F1 · 草稿版本与校验工具」：GPT-6.1 Sol/high；聊天 `01a12b96-76b6-7d71-970d-cf9178122c1a`。
- 「QuizForge F1 · 架构决策与独立审查」：GPT-6 Astra/high；聊天 `01a12b96-7cf0-72d0-8e20-e9c0a57b09a0`。
- 文档基线 `4eedd0d` 已先于实现提交；固定依赖基线为 `3165e42`。总控不修改原主工作区或已暂停 D1-D worktree。

F1补充边界：foundationBundle只承载内容；draft另封装身份/revision/hash。跨product资源一律拒绝，不信任包内共享/批准声明；共享资源能力留后续受信注册表。F1仅editing草稿，不提供审核/发布状态迁移。

## 托管边界与检查点

用户追加希望托管开发。总控在已授权F1内负责分派、等待、审查整改、集成、验证与交付，常规步骤不重复要求确认；范围扩展另等用户选择。没有创建会话结束后定时续跑或宣称后台自动开发。阶段完成停在Draft PR/作者验收，不自动合并或进入包工具/数据库。旧开发聊天的暂停持续有效。

A/B实现已分别提交推送并由总控按所有权集成；CLI审查问题已派回B修复。总控不把各聊天单测通过替代集成检查。最终记录见 `FOUNDATION_F1.md` 与 `F1_REVIEW.md`。
