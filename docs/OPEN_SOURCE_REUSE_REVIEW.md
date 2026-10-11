# OSS-R 独立审查记录

> 审查日期：2026-10-11（Asia/Shanghai）
>
> 审查范围：`codex/oss-r-evaluation` 上的 OSS-R 研究交付（`docs/OPEN_SOURCE_REUSE_EVALUATION.md`、自编隔离复现夹具 `docs/oss-r/`，以及本审查记录）；基线 `de6b2e9301b858d395c394fa0f88c72cb6610b06`。
>
> 审查结论：未发现阻止本次**研究文档**交付的未修复关键问题。本文不批准安装、集成或发布任何候选依赖。

## 独立核验的范围与证据

- 仓库定位：工作树根目录为 QuizForge，`origin` 为 `https://github.com/aning0922/quiz-forge.git`。研究交付新增评估文档及不含第三方代码、仅按传入已审 tarball 解压目录运行的自编隔离夹具；未改动 `src/`、依赖清单或锁文件。
- 版本和来源链：使用 npm registry 元数据、GitHub tag refs/release，以及本地以 `npm pack --ignore-scripts` 取得的 tarball 核验。`survey-core@3.2.0` 的 `gitHead` 为 `c1b935e8dc0a8eaeac334dc2bdbb83bd0734bd09`；`inkjs@2.4.0` 为 `edccead8700e9f21be9825d87d8645d8c82a9936`；`@puckeditor/core@0.23.0` 为 `b4204f09fde3f4b286294567fce53fafa7136858`。本地重新计算的三份 tarball SHA-512 均与报告列出的 npm `dist.integrity` 相同。
- 许可和包表面：本地 `package.json` 显示三个目标包均为 MIT；SurveyJS/inkjs 未声明运行时或 peer 依赖，Puck 声明 Node `>=20`、React `^18 || ^19` 并有其报告中所列直接依赖。此项是目标包级别检查，不替代未来锁定依赖树的许可证或漏洞扫描。
- inkjs 最小隔离复现：直接从已解压 tarball 的 `dist/ink-full.mjs` 导入 `Compiler` 与 `Story`，编译含两个隐藏文本选择的合成故事；确认获得两个选择、保存后重建状态并选择第二项，两次输出都是 `B result\n`，终态 JSON 相等。没有执行候选安装、构建或发布脚本。
- 兼容范围：确认当前仓库固定 Next 16.4.0、React 19.3.0、TypeScript strict，CI 使用 Node 24；报告没有将包声明误称为 Next/RSC、移动端或完整 TypeScript 兼容实测。

## 已修复的审查发现

首轮发现的错误版本锚点已修正：此前将 inkjs 与 Puck 的 tag commit 写为不对应的 SHA，会破坏来源、许可和安全复核。现在报告使用与 npm `gitHead` 和 GitHub tag ref 一致的 `edccead…` 与 `b4204f…`，并增列 tarball integrity。此前缺少的维护活动抽样也已增加，且明确说明它不是 SLA 或全量 issue/PR 审计。

## 后续 Quizcraft 身份核验附录

用户提供精确仓库后，我复核 `bensblueprints/quiz-builder-mvp` 的 `main` 仍指向固定 commit `2641887297205828f15a3bd87c1d4f0c69e250de`。其固定 checkout 的 `package.json` 标识为 `quizcraft@1.0.0`，LICENSE 为 MIT；因此原先的“身份未证实、待定”结论已失效，现行结论为**仅借鉴实现思路**。

我实际运行了自编 `docs/oss-r/quizcraft-logic-audit.mjs`，只加载审阅过的 `server/logic.js` 纯函数并静态读取 Runner。输出确认缺答静默接受、`-1` 与 `99.5` rating 参与计分、平分取决于结果顺序、answer-map 不绑定题目 option，且 self-loop 返回自身。该夹具不启动 Express、SQLite、Electron、安装脚本或候选应用。随后复读报告对 HTTP 层的限定：未知题 ID 和基础类型/长度限制由服务端处理；报告没有把纯函数表面直接误称为已证实的 HTTP 绕过漏洞。

该仓库是 React 18/Vite/CommonJS/Express/SQLite/Electron 应用，含 native `postinstall`，没有提供针对 QuizForge Next 16.4、React 19.3、TypeScript strict、PostgreSQL 或 QuizPack 边界的直接适配/实测。其 lockfile 改善自身快照复现，不足以抵消将应用栈、可变 SQL 模型和未版本化业务语义引入 QuizForge 的成本。公开 DTO 剥离分数/结果规则、服务端计算及其 smoke 覆盖维度可以作为设计参考；不应依赖、移植或运行其运行时/数据模型。

## 验证

独立审查于约 2026-10-11 15:55（Asia/Shanghai）在本工作树实际执行以下命令，均成功：

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`：2 files、6 tests 通过
- `pnpm build`
- `pnpm test:e2e`：34 通过、10 按既有视觉证据条件跳过；该命令使用其配置的独占 3100 端口生产构建服务。

这些检查确认工作树当时处于可构建、可测试状态；它们不构成第三方候选的生产集成验证。夹具与文档的后续修改必须重新执行格式检查，不能把上述结果延用为更新后文件的通过结论。

## 剩余限制与后续门槛

- Quizcraft 的身份与 MIT 许可已固定核验，但其短维护历史、未证实关联 npm 引擎库发行、运行时供应链及规则/会话完整性不足仍不允许采用；保持“仅借鉴、无依赖/移植”。
- inkjs 的推荐只是未来候选，不等于作者对安装或采用的批准。实际引入前仍须完成独立 PR、锁定依赖树的许可/漏洞审计、Node 20/24 matrix、输入与执行配额、DoS/随机/外部函数限制、升级回放兼容及 MIT 随分发履行。
- SurveyJS 与 Puck 均未进入生产范围；它们的动态 Next/RSC、消费者 bundle 与移动端行为尚未验证。
- GitHub 安全公告、仓库策略和维护抽样是点时证据，不能推导供应链无风险或维护 SLA。
