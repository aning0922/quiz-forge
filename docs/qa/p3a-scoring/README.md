# P3-A 数据线执行证据

本目录是纯评分和明确 `authored-pending` 逻辑审阅的实际执行记录，不是合法 QuizPack、平台审核、素材授权、正式报告或发布证据。没有创建 Product、数据库实例、资源声明或媒体任务。核心代码不读文件、网络或时钟；本目录的捕获和独立核验脚本属于离线 QA，负责文件 IO 与测量。

运行代码提交为 `1b1714d139ed1f52dacc46c38fadafd23244ae7e`，基于共享合同 `0b60b2970c45cdfb2949c2eb8b3a39c3ac8cc5dc`。最小评分里程碑为 `cecb529`；内部 Map 别名修复为 `f6fc40a`。本线不修改共享合同、P1/v2、CLI、迁移、配置或依赖。

## 首款来源与实际执行

- 原来源：`03fdc240c924e2fe7379534176e11d1e6ab3bc58:docs/FIRST_PRODUCT_CONTENT_DRAFT.md`，原文件字节 SHA-256 为 `8c049714ae07c5ed2f10fff334cc041364789781de28bfbbd5442a26d6dc0653`。核心内容对应 draft-2，展示文案不进入算术投影。
- 审阅 fixture：`src/features/quiz/scoring/fixtures/historical-review.json`。准确转写十二题、48 个完整四维向量、四个目标、结果顺序及四组完整见证，仅使用 `historical-cabinet / 1.0.0` 审阅身份。
- transcription SHA-256：`01a95213f955f7014a05d37163eed93a0d5dbd4c9662acf3dc3c3d265f9bb7a0`。
- 实际 logicHash：`6e44add1bf8bbcf2e3ccec319bd46fc4c6270c3fa474ea30a1887d6d8f8adb07`。
- 实际 witnessesHash：`0ceeba46cb52ab393f786bdcf5ea787bbd37ddd6f2557443afcc71d1528f8419`。

`historical-execution.json` 保存严格 sourceBinding、身份、见证报告和四份完整核心 score，包含规范答案、每维 raw/bounds/精确分数、16 个精确距离、唯一胜者及答案 hash。四组原始和依次为 `(33,29,8,8)`、`(14,32,27,7)`、`(24,8,7,30)`、`(1,11,32,28)`，实际胜者依次为李白、苏轼、陶渊明、白居易。整份格式化文件 27,996 UTF-8 bytes，未截断。

`verify-source.py` 实际读取上述准确 Git 源文件，以 Python `fractions.Fraction` 独立重算原始表格，核对 48 向量、4 见证、16 距离、胜者、逻辑/答案/见证/转写摘要。没有导入 TypeScript 引擎。结果为 `source-fraction-verification.json`，实际通过。这是独立算法复算，不冒充独立上下文的 Astra 审查。

`historical.test.ts` 另实际执行每维的最小/最大完整答案，验证真实 0/100，不推定四维极值共同可达；机械核验固定四卡的模数无精确同距证明前提。引擎真实同分行为由独立合成规则测试，不编造本商品同分答案。包内 `declared-not-executed` 未修改，也未生成包。

## 固定预算边界实测

环境为 Node `v20.20.1`、macOS arm64。`bounded-workload-measurements.json` 是一次本地观察；每项运行前显式 GC，计时只覆盖实际分析调用。数字不是性能 SLA，也不是 OS 内存隔离保证。

| 合成模型                  | 实际结果                         |  本次耗时 | 退出计数/保留量                                                      |
| ------------------------- | -------------------------------- | --------: | -------------------------------------------------------------------- |
| 五个独立八选项轴          | `inconclusive/frontierStates`    |  22.30 ms | frontier 达 20,000；24,681 转移；保留峰值 24,096；路径峰值 116,384 B |
| 100 题八选项累加          | `inconclusive/transitions`       | 165.20 ms | 正好 1,000,000 转移；57 个完整题层；路径峰值 555,579 B               |
| 16 维/32 profile 密集比较 | `inconclusive/scalarComparisons` | 471.61 ms | 正好 10,000,000 标量比较；16,384 最终可达向量；路径峰值 98,304 B     |

三项调用后观察到的 heapUsed 分别约 26.72/39.35/26.13 MB，RSS 分别为 116,686,848 / 149,520,384 / 136,347,648 bytes；完整前后值保存在原始 JSON。进程累计 maxRSS 最高 146,016 KiB，不能归因成单个模型的独立峰值，也不证明任意合法输入均低于该数。

其余三个派生/重叠预算（retained states、坐标加法、路径 bytes）通过内部预算组件的定向边界测试逐项验证：工作前拒绝超额，恰好耗尽仍可完成必要工作。正式公共 API 没有 policy 覆盖参数。独立小笛卡尔积枚举与 DP 对 25 组区间模型结论一致，反例必须经实际公共评分函数复验；复验的加法及范围比较也计入本次预算。

100 题、16 个不同大素数跨度模型实测评分 2.21 ms，定义 wire 322,070 B，score wire 8,627 B；两个距离均有 133 位分子/128 位分母。独立逐项分数加法 oracle 与引擎统一公分母算法一致。全合法输入最坏上界另机械核验：LCM 不大于 `20000^16`（69 位）、平方分母最多 138 位、距离分子最多 143 位，均低于机器合同 160 位。

## 复验命令与限制

从本仓库根目录执行：

```sh
pnpm exec vitest run src/features/quiz/scoring
node --expose-gc --import tsx docs/qa/p3a-scoring/capture.ts
python3 docs/qa/p3a-scoring/verify-source.py
```

后两条会更新本目录执行证据。capture 记录当次 Git HEAD；复验前应确认源码身份。耗时和内存每次可能变化，评分与派生 hash 必须一致。

本线定向测试、类型和 lint/格式检查通过；完整六项、集成兼容、远端 CI 和独立审查由主控另行记录。当前只提供纯模块与审阅证据；没有 authored/v2 持久化准入、真实注册预览、Key、QuizReport 或批准发布能力。
