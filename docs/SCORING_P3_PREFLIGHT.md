# P3 确定性评分前置决策预案

日期：2026-10-12。状态：**架构预研，待总控冻结实施合同；未实现、未执行评分测试**。本文不启动 P3，不代表引擎、产品见证、覆盖、预览或发布已经通过。普通工程沿已授权 P1–P5 路线推进，P3 实施仍依赖 P2 的实际交付与阶段合同。

本文整理只读分析，不新增引擎、测试、包、素材或报告。数学推导与文档中的候选见证均不能冒充运行时测试证据。

## 证据与适用范围

- 工程分析基线：`codex/studio-foundation`，`df9e45d310bebb704a61882117a9a1f5b2f8861e`。
- 评分合同来源：[P1 content Schema](../src/features/quizpack/v1/content.ts)、[引用验证](../src/features/quizpack/v1/references.ts)、[兼容声明](../src/features/quizpack/v1/compatibility.ts)、[P1 内容实现说明](P1_CONTENT_IMPLEMENTATION.md)、[P1 合同](QUIZPACK_P1.md)。
- F1 差异来源：[foundation Schema](../src/features/quizpack/foundation.ts)。
- 四卡内容来源：独立分支 `codex/first-product-content`，提交 `e8ba8108c30168c8120f0b05354c8821c1d787f9` 的 `docs/FIRST_PRODUCT_CONTENT_DRAFT.md`，版本为 draft-2 / 四卡内测草案已选定。该文件当时仍在独立分支，不假设当前工作树已包含它。
- 作者选择的记录见[托管开发](MANAGED_DEVELOPMENT.md)：李白、苏轼、陶渊明、白居易四卡成为首款内测草案；不再将第四卡写作等待阵容选择。这不等于题目、权重、报告、文化、视觉、素材或发布批准。

P3 首批只实现 `dimensions@1.0.0` 与 `archetype@1.0.0`，不加入 branching、AI 增强、心理诊断、效度或准确率承诺。正式完成事务、不可变 QuizReport 与历史读取由 P4 实现。

## F1 与 P1 的边界

F1 `foundation.v1` 是三结果 synthetic 声明：选项使用 `effects`，规则含 `declarationOnly:true`，缺少 P1 完整归一化/距离语义，baseline 所在位置也不同。F1 不能直接作为评分输入，也不能仅把 effects 改名后运行。

P1 `quizpack-content.v1` 使用 `contributions`、两个规则判别分支、精确归一化边界、完整结果 profiles、独立 reportTemplates 和 1–32 个结果。P3 应对 F1 返回明确的 unsupported-contract；保留 F1 的草稿/hash 工具不等于继承其声明为评分就绪。

P1 的 `candidateValid` 只证明既有 policy 下的技术检查；`importable:false`、`publishable:false` 原义不变。评分、覆盖和实际见证均由独立 P3 证据描述。未来规则执行语义变化必须改变 engine version，不能让旧 `1.0.0` 内容静默产生新结论。

## 输入完整性

评分答案仅为完整的 `{questionId, optionId}[]`。Product、内容版本、engine version 和逻辑定义由服务端选定的候选或固定版本提供，客户端不能指定得分、目标、结果或版本。

- 每题恰好回答一次；缺题、重复题、额外题、未知题均拒绝。
- option 必须属于对应 question；拒绝另题的合法 option、未知 option、错误大小写或自动修正 ID。
- 不接受分数、数组索引、label、result ID 或未知字段作为答案。
- 答案数组顺序不影响结果；内部按冻结的问题顺序规范化。
- 每个 option 的 contributions 覆盖每个维度恰一次，包括显式 0；缺维度不能补 0。
- 定义和引用的 Product/version 精确一致；结果集合、profiles、resultOrder 完整且无重复。
- 常数维度、缺失/错误边界、未知 engine/method 拒绝。

P1 已检查完整向量与真实边界；P3 的准备步骤仍须确保这些不变量，不能仅凭 TypeScript 类型、客户端报告或 `candidateValid` 运行。

## 共同算术与精度

对题目 q、维度 d，所选 option 的整数贡献为 c(q,d)：

```text
r[d] = Σq c(q,d)
m[d] = Σq min(option in q) c(option,d)
M[d] = Σq max(option in q) c(option,d)
n[d] = 100 × (r[d] − m[d]) / (M[d] − m[d])
```

包内 min/max 必须分别严格等于 m/M，且每维 m < M。

- 不 clamp；合法完整答案越界说明逻辑或数据不变量破坏，应失败。
- 匹配前不截断、不四舍五入、不保留固定小数位。
- 不按当前答案重新估计边界。
- 支持 P1 合同允许的负贡献。
- 每维极值可单独达到，不意味着各维极值可以同时达到。
- 不计算综合人格总分、百分位、准确率或置信度。

原始整数求和在 P1 的 100 题、单贡献 ±100 范围内可精确表达。通用归一化、距离与跨维比较使用 **BigInt 有理数**。不同分母公倍数可能超过 JS 安全整数，不能从首款四维样例推断所有合法包都能用 Number 精确匹配；不得用 `Number.EPSILON` 定义平分。

内部有理数约分、分母为正，零统一为 `0/1`。JSON 用十进制字符串表示分子/分母，不直接序列化 BigInt。大小由既有题数/维度/贡献/边界限额约束，不接受外部无限长度数值。

## dimensions 引擎语义（待冻结）

profile j 匹配，当且仅当每维的精确归一化值都落入其闭区间：

```text
∀d: profile[j].min[d] ≤ n[d] ≤ profile[j].max[d]
```

用整数交叉乘法比较，包含两端。

- 一个匹配：选择该结果。
- 多个匹配：选择 resultOrder 中最先的匹配结果，并输出匹配集合供内部审计。
- 无匹配：返回 `NO_PROFILE_MATCH`，没有结果或报告。不选最近中心，不回退第一张卡，不临时扩区间。

P1 只检查 ranges 有序和引用完整，未保证所有合法答案都匹配。P3 实施前必须冻结零匹配、重叠和覆盖语义；结构通过不能升级为完整覆盖。

建议覆盖证据仅接受以下两类：

1. 对规模可控的规则，完整枚举可达原始分数向量，证明每个向量至少匹配一个 profile。
2. 内容明确提供全维 `[0,100]` 的兜底 profile，并在 resultOrder 最后；该结果仍须有能实际选中它的见证。

不能替作者自动添加兜底。覆盖分析的状态数/工作量限额须在实施前冻结；超限返回 `coverage: inconclusive`，不声称覆盖通过。运行评分仍保留 `NO_PROFILE_MATCH` 失败行为。

当前 [P1 synthetic fixture](../src/features/quizpack/v1/fixtures/synthetic.ts) 的 dimensions 区间为 `[0,24]`、`[25,74]`、`[75,100]`。这不证明连续空间无缝覆盖；其实际可达值为 `0,25,50,75,100`，且两维由相同贡献产生，应由 P3 对实际可达输入验证。不能只看连续区间空隙就判此 fixture 失败，也不能据此推定一般包安全。

## archetype 引擎语义（待冻结）

P1 没有额外维度权重字段，因此 `archetype@1.0.0` 在归一化空间中各维等权。目标 t(j,d) 为完整 0–100 整数向量：

```text
D[j] = Σd (n[d] − t[j,d])²
```

- 取最小精确距离；数学上完全相等时才按 resultOrder。
- 不开平方，不增加余弦距离、距离阈值或相似度百分比。
- profiles 数组位置不决定胜者；resultOrder 是平分顺序的权威。
- 内部保存全部候选精确距离；消费者 DTO 不必暴露候选排名或目标向量。
- 合法完整答案且结果集合非空时，总能选择一个结果；每个结果是否可被选中仍需逐项执行见证。

可使用统一公分母进行精确整数比较：

```text
L = lcm over d of (M[d] − m[d])
A[d] = 100 × (r[d] − m[d]) × L / (M[d] − m[d])
K[j] = Σd (A[d] − L × t[j,d])²
D[j] = K[j] / L²
```

比较 BigInt K 即可，无需浮点距离。

## 显示与技术结果快照（待冻结）

匹配保存精确值。四维展示建议固定为十进制 half-up 一位小数，用整数算术格式化；例如精确 1.25 显示 1.3。显示规则版本与 engine version 分开，显示调整不能改变结果。

P3 输出建议命名 `quiz-score.v1`，仅是技术评分结果，不是正式 QuizReport。最小字段：

```ts
{
  schemaVersion: "quiz-score.v1",
  productId,
  contentVersion,
  engine: { id, version },
  logicHash,
  answersHash,
  normalizedAnswers,
  dimensions: [{
    dimensionRef,
    rawSum,
    bounds: { min, max },
    normalized: { numerator, denominator }
  }],
  decision:
    | {
        kind: "dimensions",
        matchingResultRefs,
        selectedResultRef,
        tieBreak: "result-order"
      }
    | {
        kind: "archetype",
        distances: [{ resultRef, value: { numerator, denominator } }],
        tiedMinimumResultRefs,
        selectedResultRef,
        tieBreak: "result-order"
      },
  reportTemplateRef
}
```

以上是字段草案，不是已实现 TypeScript 类型。集合按冻结维度/问题/resultOrder 排序输出。logicHash 对规范逻辑投影计算，answersHash 对规范答案计算，均由服务端产生。

调用层附加并验证全内容 canonical hash、archive hash、draft/revision 或 ProductVersion 绑定。逻辑 hash、包内 content.json 原始字节 hash、完整内容 canonical hash 不可混用。引擎输出不含当前时间、随机 ID 或数据库状态。

P4 完成事务再把评分结果与完整 baseline、资源/组件/内容版本一起封存为正式报告；历史读取不重跑引擎。

## 最小 API 与领域边界（待冻结）

```ts
prepareScoringDefinition(input: unknown): Result<PreparedScoringDefinition>

scoreCompleteAnswers(
  definition: PreparedScoringDefinition,
  answers: unknown,
): Result<ScoreSnapshotV1>

verifyDeclaredWitnesses(
  definition: PreparedScoringDefinition,
): WitnessVerificationReport

analyzeDimensionsCoverage(
  definition: PreparedScoringDefinition,
  fixedAnalysisPolicy: CoveragePolicy,
): CoverageReport
```

PreparedScoringDefinition 仅由准备函数产生，脱离调用方可变对象；执行中不继续读取外部可变规则。

建议 `features/quiz` 拥有纯逻辑投影、精确算术与引擎，quizpack adapter 从 P1 内容取得投影。投影是内部接口，不是新对外包格式；复用 P1 子 Schema，避免两套规则含义漂移。

纯逻辑准备允许在正式角色资源未完成时核验四卡算术，不需伪造图片 hash、许可 true 或 approved。此结果不产生合法完整 QuizPack，也不是资源/注册预览/发布证据。

## 四卡草案映射

评分数据可无损映射 P1，不需要增加维度权重或目标精度字段：

| 内容项               | P1 映射                                                     |
| -------------------- | ----------------------------------------------------------- |
| 十二题、每题四选项   | questions/options，全局唯一 `q01-a` 等 ID                   |
| 四维                 | exploration / expression / connection / steadiness          |
| 四十八个完整整数向量 | contributions，显式保留全部 0                               |
| 精确 bounds          | `(0,48)`、`(0,48)`、`(4,48)`、`(2,48)`                      |
| 引擎                 | archetype@1.0.0 / sum / linear-to-0-100 / squared-euclidean |
| 李白目标             | `(70,60,10,15)`                                             |
| 苏轼目标             | `(30,65,55,10)`                                             |
| 陶渊明目标           | `(50,15,10,60)`                                             |
| 白居易目标           | `(5,25,65,55)`                                              |
| resultOrder          | li-bai → su-shi → tao-yuan-ming → bai-ju-yi                 |
| 四份报告             | DETERMINISTIC 六字段完整 baseline                           |
| 四组候选见证         | 完整 questionRef/optionRef；包内保持 declared-not-executed  |

草案见证的原始贡献和预期分别为 `(33,29,8,8)`、`(14,32,27,7)`、`(24,8,7,30)`、`(1,11,32,28)`。这些是内容文档中的预期，不是本线执行结果。P3 必须从最终转写且 hash 固定的逻辑实际运行，核验原始和、精确分数、全部距离、胜者与 reportTemplateRef。

执行证据单独存放，不能把包内 witness.status 改成现有 Schema 不接受的 executed。四卡依旧是编辑文化意象，不代表历史人格测量、统计效度或科学分类。

## 表现合同与资源缺口

评分可映射不等于完整四厅体验已能无损装入当前封闭布局合同：

- 每选项贡献理由没有运行时字段，保留在作者审阅材料，不塞入消费者 label。
- 四厅分组、题签和逐题场景映射缺少对应 props/content 字段。
- 每结果原创海报短句无独立结果字段，不挪用 strengths/reflection 改变报告语义。
- “这张卡可借用的做法”是受控组件呈现标题，字段仍为 strengths；不按 Product ID 在通用组件硬编码。
- 真实人物资源与许可未齐，不能为构建通过填造许可声明。

前四项由注册组件/表现合同设计处理；若装入包，先修订对应合同和兼容版本，不阻塞纯评分引擎。真实素材/字体、作者内容/文化/视觉审阅与发布批准继续分开留证据。

## 当前四卡不存在精确同分的数学推导

以下仅针对上述来源提交的 bounds/targets，是本次文档推导，**不是引擎测试或已完成的产品验证工件**。P3 需从最终固定内容机械核验前提，绑定 logic/content hash；参数变化后旧证明失效。

对整数原始和，四维精确归一化为：

```text
(25rE/12, 25rX/12, 25(rC−4)/11, 50(rS−2)/23)
```

取 L=3036，缩放后：

```text
A = (6325rE, 6325rX, 6900(rC−4), 6600(rS−2))
```

每个 A 分量都是 25 的倍数；当前每个目标坐标都是 5 的倍数。若两个目标 ti/tj 距离相等，消去共同平方项可得：

```text
2A · (ti−tj) = 3036 × (||ti||² − ||tj||²)
```

左侧为 250 的倍数，`gcd(3036,250)=2`，所以两目标平方范数之差必须为 125 的倍数。

| 目标   | 平方范数 | mod 125 |
| ------ | -------: | ------: |
| 李白   |     8825 |      75 |
| 苏轼   |     8250 |       0 |
| 陶渊明 |     6425 |      50 |
| 白居易 |     7900 |      25 |

余数两两不同，因此当前参数下任意两张卡的精确距离都不可能相等。证明覆盖所有整数 raw sums，比仅覆盖可达答案更强。

据此，P3 可核验这一可复核证明，无需强行穷举寻找不存在的产品 tie 答案。仍必须用独立合成规则验证引擎的真实平分处理，不能编造产品见证。

接近边界/显示舍入相同的产品样例仍值得搜索；它们验证精度和显示，不是完全同分。若最终参数改变使证明不成立，再进行可达向量 DP 或最多 `4^12 = 16,777,216` 组完整答案的有界分析。分别记录完整证明、有限搜索未找到或未知，不把离线搜索放进每次用户提交路径。

## 待执行验收矩阵

| 类别       | 必验                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 输入       | 缺题/重复/额外/未知/错题 option/得分字段拒绝；答案顺序无关                         |
| 准备       | 未知版本、跨 Product/version、不完整向量、重复维度、错误极值、常数维度拒绝         |
| 算术       | 负贡献、非零 min、真实 0/100、非整除分数、不同分母、大公倍数；无 clamp/提前舍入    |
| dimensions | 闭区间端点、多匹配 resultOrder、零匹配失败、可达覆盖证明/分析超限                  |
| archetype  | 精确最近、合成两者/多者同分、profiles 重排不改胜者、resultOrder 仅影响精确平分     |
| 精度       | 显示相同但精确不同、epsilon 会误判的近距离、BigInt JSON 规范                       |
| 见证       | 逐结果执行完整答案；错误见证失败；文档预期与实际运行分栏记录                       |
| 四卡       | 最终数据的原始和/精确分数/16 个距离/四胜者；无同分证明前提；边界/均衡/远离目标样例 |
| 输出       | 同输入稳定结果/hash、无时间随机量、reportRef 正确、目标不冒充用户得分              |
| 集成       | 评分失败不生成成功报告；P3 预览不声称正式完成；P4 提交事务另验                     |

本线没有执行上述检查。手算表、数学推导、P1 验证成功及既有视觉 E2E 均不替代 P3 实际测试。

## 实施前待冻结事项与阶段出口

总控需先冻结：dimensions 零匹配/重叠语义及覆盖门槛/分析限额；精确算术与显示舍入；内部逻辑投影边界；quiz-score.v1 的运行时输出 Schema 与版本绑定。不能让两条实现流各自猜测。

当前四卡评分没有必须扩大 P1 wire Schema 的冲突。F1 不兼容、表现字段缺口与资源许可缺口分别按上文处理，不靠静默转换或填造字段绕过。若改动实际评分含义或外部字段，先修改对应合同及版本策略再实施。

P3 技术验收需包含独立合成边界测试、两个引擎、真实四卡逻辑见证与覆盖/同分证据、受控预览所需后续检查和阶段工程门槛。P4 再建立 Key、完成事务和正式报告；P5 再完成首款内容/资源/实机及人工验收。本文不声称任何上述能力已经完成。
