# 开源复用专项评估（OSS-R）

> 状态：D1-B 并行研究交付，**不是引入批准**。本文件仅给出 D2 前的选型依据；未向生产依赖、锁文件或 `src/` 加入任何候选项目。查询与本地检查完成于 2026-10-11（Asia/Shanghai）。

## 结论与边界

QuizForge 应继续拥有 QuizPack 的数据格式、版本固定、确定性结论、AccessKey 完成事务和消费者视觉。候选项目只能位于下列受控边界内：

| 候选          | 身份与研究版本                                                                                                                                                                                                                                                                                                                      | 结论                         | 建议边界                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Quizcraft     | 未能核实唯一的官方 GitHub 仓库、npm 包或授权版本                                                                                                                                                                                                                                                                                    | **证据不足，待定**           | 不下载、不运行、不引用；作者若有确切 URL 再做审计。                                                                |
| SurveyJS Core | [`surveyjs/survey-library`](https://github.com/surveyjs/survey-library)；npm `survey-core@3.2.0`（2026-10-06，发布元数据 `gitHead` `c1b935e8dc0a8eaeac334dc2bdbb83bd0734bd09`）；仓库 release `v2.5.46` / annotated tag object `b788aa7e10c5121fc8f34fe74d835928e2d80816`，peeled commit `be5c48400ff39fc064c4494e4b67abb2a2acc59c` | **仅借鉴实现思路**           | 可研究声明式题目/条件/校验的建模与测试方法；不采用其运行时、JSON DSL 或默认 UI。                                   |
| inkjs         | [`y-lohse/inkjs`](https://github.com/y-lohse/inkjs)，`inkjs@2.4.0` / release [`v2.4.0`](https://github.com/y-lohse/inkjs/releases/tag/v2.4.0)（2026-02-17），tag commit `edccead8700e9f21be9825d87d8645d8c82a9936`                                                                                                                  | **推荐直接依赖；待作者批准** | 仅供未来已审核、版本固定的互动剧情运行器；在 D24/25 前另做 import 限额、步数上限和状态兼容试验后才可加入生产依赖。 |
| Puck          | 提示中的 [`measuredco/puck`](https://github.com/measuredco/puck) 实际重定向到 [`puckeditor/puck`](https://github.com/puckeditor/puck)；`@puckeditor/core@0.23.0` / release [`v0.23.0`](https://github.com/puckeditor/puck/releases/tag/v0.23.0)（2026-08-07），tag commit `b4204f09fde3f4b286294567fce53fafa7136858`                | **不采用（当前生产范围）**   | 可在后台编辑器专题重新评估；消费者运行时、QuizPack、题库和报告模板一律不加载 Puck。                                |

“推荐直接依赖；待作者批准”是研究结论，**不等于本轮授权安装**。任何实际加入仍须以固定版本、依赖审计和作者批准为前置条件。

## 方法、范围与可重复性

本次只使用候选组织/仓库、GitHub Releases、LICENSE、`package.json`/已发布 npm tarball 与项目现有文档作为一手证据；没有因 README 宣传、星标数或同名搜索结果作结论。SurveyJS 的 npm 包 `3.2.0` 与仓库 release `2.5.46` 是两个独立发布标识，不能相互替代：前者以 [npm metadata](https://registry.npmjs.org/survey-core/3.2.0) 的 `gitHead` 固定并用于本地包检查，后者仅用于仓库活跃度观察。对应的 [inkjs metadata](https://registry.npmjs.org/inkjs/2.4.0) 与 [Puck metadata](https://registry.npmjs.org/@puckeditor%2fcore/0.23.0) 也固定了 tarball URL 和完整性值。仓库元数据查询显示：SurveyJS 最后推送为 2026-10-10、inkjs 为 2026-09-01、Puck 为 2026-10-09，三者均未归档；这仅证明近期活动，不能替代维护 SLA 或安全审计。

隔离检查位于已忽略的 `.cache/research/oss-r/`：用 `npm pack --ignore-scripts` 取得指定 tarball，检查其 `package.json`、exports、声明和已构建文件；没有运行候选的安装脚本、构建脚本或代码生成器。缓存不提交；自编可复现夹具作为交付的一部分提交，不含第三方代码或正式依赖。npm registry 的完整性值分别为 `survey-core@3.2.0` `sha512-51l6VNczicCmuTIzi6wS7ooM4SUYu3ahio72nApFBav/sIjqNwHjwbprOfdimr36DUFilHpWek9qOEaNoelgdQ==`、`inkjs@2.4.0` `sha512-EoPCYESIbMtfI8SqEDZCJwn+A5is0QozMLw250iic1ReJCgZpRKIezWj0VqgRUzAx0f3MmEbsUjY/ILe2815JQ==`、`@puckeditor/core@0.23.0` `sha512-sBnch+YIE3C6Bq+Z100GJs2y0rykxjcYW04m5iGJjMcBSqxQSmA3VKtDe742uPmPqQRJnKRBPrPuaiBmR2a78g==`。tarball 解压后的主要体积分别为 survey-core 约 56 MB、inkjs 约 7.5 MB、Puck 约 2.6 MB。这是包内容体积，**不是** Next 生产 bundle 测量；实际采用前必须以 QuizForge 的 production build 重新测量。

本项目的基线为 Next `16.4.0`、React `19.3.0`、TypeScript strict、Node 20 本地范围与 Node 24 CI。下文的“兼容”仅指包声明/API 表面与该基线不冲突，不代表已完成消费者 UI、RSC 或移动端验收。

### 维护活动抽样与风险

这不是全量 SLA 审计。2026-10-11 的官方 GitHub 页面抽样显示：SurveyJS 在 [2026-07-28](https://github.com/surveyjs/survey-library/commit/131ffc1) 合并了 `visibleIf` / `enableIf` / `requiredIf` 依赖跳过的修复，且 [#11588](https://github.com/surveyjs/survey-library/issues/11588) 于 2026-07-16 仍是未分配、未关联 PR 的减少动态效果问题；它有明显持续工程活动，也有较大的未完成事项面。Puck 的 [PR 列表](https://github.com/puckeditor/puck/pulls) 记录协作者在 2026-06-03 提交 #1685、#1684 等 PR，且 [0.23.0 changelog](https://github.com/puckeditor/puck/blob/main/CHANGELOG.md) 记录 2026-08-07 的修复/特性，表明近期发布活动，但编辑器依赖和变动面仍使升级成本偏高。inkjs 的 [PR 列表](https://github.com/y-lohse/inkjs/pulls) 当前显示 0 个 open PR；[issue #1123](https://github.com/y-lohse/inkjs/issues/1123) 为 2025-09-17 提出的解释器崩溃问题，仍在 open issue 列表中。故 inkjs 的“推荐直接依赖”必须保留为作者待决、固定版本并由 QuizForge 承担适配/安全配额维护；不能把最近一次推送误读为响应保证。

## 候选逐项证据与判断

### Quizcraft：身份未证实

现有研究计划只给出名称，并明确其有歧义。2026-10-11 使用 GitHub 的精确关键词检索（[`"Quizcraft" quiz scoring skip logic`](https://github.com/search?q=%22Quizcraft%22+quiz+scoring+skip+logic&type=repositories)）及 npm registry 名称检索；所得同名/近名结果没有同时提供官方归属、问卷评分/跳题实现、可追溯发行包和 LICENSE 的身份链。因此无法诚实填写 owner/repo、包名、版本/commit、维护状态、收费边界或安全结论。这个结果是“不能唯一确认”，不是声称网络上不存在名为 Quizcraft 的仓库。

结论是保持待定。禁止以搜索命中的同名项目替代目标候选，也不应在 D2 把不明来源作为实现依赖。若作者提供准确链接，下一轮应先固定 commit、读取 LICENSE/NOTICE、审查条件执行和保存语义，再决定是否做隔离试验。

### SurveyJS Core：成熟，但其表达式运行时与产品边界不匹配

**来源与许可。** 官方仓库 README 明确将无框架 `survey-core` 定义为表单模型、校验、条件逻辑、计算、导航和本地化层，并将 Form Library 标为 [MIT](https://github.com/surveyjs/survey-library/blob/c1b935e8dc0a8eaeac334dc2bdbb83bd0734bd09/LICENSE)。本地审阅的 npm `survey-core@3.2.0` `package.json` 也声明 `license: MIT`，其 metadata `gitHead` 指向上表 commit；仓库的 [release 列表](https://github.com/surveyjs/survey-library/releases) 只用于核实持续发布。项目自己的 [产品许可说明](https://github.com/surveyjs/survey-library/blob/master/README.md#licensing) 仅覆盖 Form Library。Survey Creator、Dashboard 和 PDF Generator 具有独立商业许可边界，不能因 `survey-core` 为 MIT 而一并引入。

**本地静态检查。** `survey-core@3.2.0` 的发布包为 ESM/CJS 双入口、无 runtime dependency/peer dependency 声明，未限定 Node engines；其无压缩 ESM 主文件约 3.1 MB，随包还带大量主题、locale、协作与测试资源。它的声明和构建代码包含 `visibleIf`、`requiredIf`、计算与函数注册表（`FunctionFactory` / `registerFunction`）。这验证了结构化问题、条件、校验和导航能力真实存在，但也表明其 JSON 条件语言与可扩展函数面必须被当成不可信输入表面审计。

**适配结论。** 它可以在 Node 中作为纯模型使用，且不会直接要求 React；不过它不解决 QuizForge 的服务端权威评分、QuizPack 限额、版本固定、Key 事务或古风专属交互。直接采用会引入较大的运行时及一个与本项目“显式条件数据结构、不得执行 JS 条件字符串”相冲突的表达式子系统。故只借鉴：有限 question/option ID、可达性和条件验证、缺答/显示状态测试矩阵。QuizForge 自身应保留一个小型、封闭 AST/判定器，拒绝自定义函数、异步函数、远程 choices 和未列入白名单的题型。

**退出与许可。** 该决定没有代码复制，无 NOTICE 义务。若日后复制 MIT 源码或直接依赖，应保留版权/许可文本、锁定版本并将其适配器隔离在 `features/quiz`；退出路径是继续使用 QuizForge 的数据 DTO 和自有条件判定器，不让 SurveyJS JSON 成为存档 QuizPack。

### inkjs：最接近“受控剧情运行器”的候选，仍必须有运行配额

**来源与许可。** [`LICENSE.md`](https://github.com/y-lohse/inkjs/blob/edccead8700e9f21be9825d87d8645d8c82a9936/LICENSE.md) 是 MIT，要求在软件副本或实质部分保留版权与许可文本。官方 [release v2.4.0](https://github.com/y-lohse/inkjs/releases/tag/v2.4.0) 与 npm 的 `inkjs@2.4.0` 对齐；发布包自身没有 runtime/peer dependencies、没有 engines 限制，提供 ESM 和 CJS exports。仓库未归档且有 2026-09 的推送，但维护强度、响应时间和未来大版本兼容性仍无保证。

**隔离最小实验与静态检查。** 发布包含运行时和可选 compiler：运行时 ESM `dist/ink.mjs` 约 128 KB（完整/编译器包明显更大）。用自编 [`ink-roundtrip.mjs`](oss-r/ink-roundtrip.mjs) 经命令行指定忽略目录中的 tarball 解压包，编译一个含两项选择的合成故事：推进至 choices、保存 `state.ToJson()`、重建故事并 `state.LoadJson()`、选择相同第二项；实际 JSON 输出为 `"output":"B result\\n"`，表示结果字符串以一个换行符结束，且结束 state JSON 相等。该实验验证选择和恢复 API 的基本行为，不验证版本升级兼容、恶意/大输入、随机分支或无限循环。Ink 语言同时包含变量、条件、序列、随机数和 external declaration；它不是 QuizForge 确定性评分引擎，也不是不可信内容沙箱。`bindExternalFunction` 类能力不能向商品包开放。

**适配结论。** 对 D2+ 的“古代人生/末日/异世界”分支商品，作为隔离的直接依赖是合理的候选：将审核后的、编译好的 Ink JSON 作为受限 AssetPack，不导入 `.ink` 源码或任意 JS；固定 `inkjs` 版本和故事哈希；服务端复算关键路径；只允许白名单外部函数（首版为零）；限制 JSON 字节数、节点/选择数、单次继续步数、总步数、状态大小和执行时间；保存版本化状态并在升级前进行回放兼容测试。所有正式结局仍由 QuizForge 的确定性结果模型封存。

**退出与许可。** 报告、QuizPack 和会话只存我们自己的 versioned story adapter DTO，运行器位于 `features/quiz` 的窄适配层。更换引擎需要从 DTO 导入已允许状态或保留旧 adapter 只读回放；不能把 inkjs 的内部状态格式当作长期公开契约。实际引入时随分发保留 MIT 文本，并审计该固定版本及其零依赖声明。

### Puck：技术兼容性可行，产品与风险边界不值得当前引入

**身份更正、来源与许可。** `measuredco/puck` 已重定向至 `puckeditor/puck`，故后者是审计对象。官方 [仓库 LICENSE](https://github.com/puckeditor/puck/blob/b4204f09fde3f4b286294567fce53fafa7136858/LICENSE) 为 MIT，官方 [v0.23.0 release](https://github.com/puckeditor/puck/releases/tag/v0.23.0) 和 npm `@puckeditor/core@0.23.0` 匹配。项目 CHANGELOG 已记录 [React 19 peer dependency 修复和 RSC bundle](https://github.com/puckeditor/puck/blob/main/CHANGELOG.md)，但这不代表对 Next 16.4 的端到端承诺。

**本地静态检查。** `@puckeditor/core@0.23.0` 声明 `node >=20`、`react ^18 || ^19`，与当前 Node/React 基线表面兼容；exports 包含 `./rsc`，因此 RSC 预览可以作为后续隔离试验主题。其编辑器依赖 dnd-kit、Radix、Tiptap、Zustand 等较大客户侧依赖集合，tarball 内未压缩 `index.js` 约 745 KB，另有 CSS。配置会映射到 React component registry/props，因此它的“可视化编辑”并不等于可安全接收任意商品包配置。

**适配结论。** 本阶段不采用，理由是 D1/D2 没有已授权的后台认证/审核/发布工作，且把它误放进消费者 bundle、或允许 Puck data 指向未经审核的组件/props，会违反“受控注册表、QuizPack 纯数据、不得导入 React/JS”的架构。未来若作者批准运营编辑器专项，只能在独立 Studio route、服务端鉴权和草稿审核之后运行：registry 静态编译在主项目；允许的组件/props 由 JSON Schema 验证；未知组件/props 拒绝；保存的数据只能转换成受验证的主题/报告配置；公开页面使用已发布快照，绝不加载编辑器。

**退出与许可。** 尚未复制/依赖，不产生履约动作。若未来采用，MIT 文本随分发，编辑器包必须 code-split 且通过构建统计证明不进入 consumer route；退出时已发布配置仍由 QuizForge 的 DTO/registry 解释，而非由 Puck runtime 读取。

## 兼容性、安全与试验结果

| 主题                  | 结论                                                                                                                               | 证据/限制                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Next App Router / RSC | inkjs 是无 UI ESM/CJS runtime；SurveyJS Core 是无框架模型；Puck 提供 RSC export。                                                  | 没有把任何包接入 Next，因此没有以“可 import”冒充 RSC/SSR 实测。Puck 的实际 Studio 路由仍需专门试验。                     |
| React 19.3            | SurveyJS Core/inkjs 不以 React 为前提；Puck peer range 含 React 19。                                                               | Puck peer range 是兼容声明，不是本项目 E2E 证据。                                                                        |
| TS strict             | 三者都发布类型声明。                                                                                                               | 尚未把候选类型纳入本仓库 `tsc`；后续依赖 PR 必须新增最小编译夹具。                                                       |
| Node 20 / 24          | Puck 明示 `>=20`；另外两者未声明 engines 且有 ESM/CJS。                                                                            | “未声明 engines”不能等同完整支持；必须在锁定版本的 CI matrix 执行。                                                      |
| 确定性                | SurveyJS 需要禁用函数/异步/外部 choices；inkjs 需控制随机与 external。                                                             | 三者均不能替代 QuizForge 评分权威或提交事务。                                                                            |
| 不可信输入            | 不能直接信任任何候选的 JSON/状态/配置。                                                                                            | 导入前先实施 QuizPack 字节数、文件数、类型、ID、深度、节点/边、表达式/props 白名单验证。                                 |
| GitHub 安全公告与披露 | 2026-10-11 GitHub REST `security-advisories` 对三仓库均返回 0 条；inkjs、SurveyJS 的仓库根 `SECURITY.md` 返回 404，Puck 返回 200。 | 这不是 npm/transitive dependency/CVE 的完整审计；采用 PR 仍须在锁定版本上跑依赖漏洞和 license 扫描，并阅读 Puck policy。 |
| 移动端与 bundle       | Puck 最重，SurveyJS 也带大模型/UI相关资源，inkjs 运行时相对小。                                                                    | 本次无浏览器 UI，未宣称移动端体验通过；真正采用需 Lighthouse/真实设备与 route bundle 预算。                              |

除上述 inkjs 合成状态 round-trip 外，没有执行 SurveyJS 或 Puck 的动态夹具；这是证据范围限制，不是授权限制。D2 设计冻结后应建一次性隔离 fixture，测试范围包括：固定答案的分数/平分、无答案/未知 ID、条件可达性、状态 round-trip、最大步数中断、升级前后旧状态回放、未知组件/props 拒绝，以及 consumer build 中不含 Studio editor。

## 对 D2–D30 的影响与待决策

| 时间段                 | 可以据此推进                                                                     | 必须先决定/验证                                                                   |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| D2 QuizPack 与基础引擎 | 用自有有限 AST、规则白名单、结构/引用/资源限额验证器；借鉴 SurveyJS 的测试维度。 | 固化 QuizPack schema 与错误语义；不引入 SurveyJS JSON 或其表达式语言。            |
| D24/25 剧情商品        | 预留 `StoryRuntime` 适配接口和故事哈希/状态 DTO，届时再实现剧情商品。            | 作者确认是否引入 `inkjs@2.4.0`；完成隔离回放、配额、DoS、升级兼容和许可随附设计。 |
| D11–D20 后台/编辑      | 继续受控 registry、草稿/审核/发布快照设计。                                      | Puck 不在本路线自动发生；只有独立 Studio 授权后再做 authenticated/codesplit POC。 |
| D21–D30 发布与维护     | 给所有外部依赖保留 SBOM、固定版本、升级回归与退出演练。                          | 建立依赖漏洞告警、许可清单和旧报告/旧剧情只读兼容策略。                           |

需要作者批准的技术决策：

1. 是否在 D2+ 允许一个单独 PR 试用并可能引入 `inkjs@2.4.0`，前提为上述安全配额和状态回放验收通过。
2. 是否将 QuizForge 的条件规则明确限定为自有有限 AST（推荐），从而永久不接受 SurveyJS expression string。
3. 是否把 Puck 延后到后台授权、审核和发布模型完成后再立项；当前建议保持“不采用”。
4. 若仍希望评估“Quizcraft”，请提供其确切官方 owner/repo 或包链接；在此之前不能作许可/安全/采用结论。

## 审查清单与已知限制

- 本报告未修改架构、QuizPack schema、生产代码、依赖或锁文件；不越过 D1-B/OSS-R 边界。
- 许可证结论只限四个候选的核心发布包，未替代未来完整 transitive-dependency、专利、商标、素材或漏洞审计。
- GitHub 的“最近推送”与 release 只能作为维护迹象；没有承诺 SLA，也没有审计所有 issue/PR 或 CVE 数据库。
- 本轮没有在 iOS Safari、Android Chrome 或正式 Next consumer route 中运行候选 UI，故没有这些通过声明。
- 若未来复制而非链接 MIT 源码，必须在变更 PR 中逐文件记录来源、范围、版权和许可文本；本轮没有复制源码。
