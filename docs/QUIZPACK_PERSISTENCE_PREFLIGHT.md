# QuizPack 持久化 JSON 尺寸预检

2026-10-12，**仅 B2-2 规划证据，未冻结、未实现、未验收**。测量基线为 `codex/media-isolation-preflight` 的 `2df9ead`，对应[验证归档提案](STUDIO_P2B2_VALIDATION_PROPOSAL.md)。本轮只读 P1 源码并在内存生成合成 JSON，调用纯 parser/canonical/引用检查；未执行 ZIP、media、DB、构建或完整 `candidateValid`。Schema/纯引用通过不能替代完整 P1 验证。

统计口径为 compact/canonical JSON 的 UTF-8 字节；key 排序不改变字节数。以下不是 SQL `jsonb::text`、JSONB 内部格式、行、索引或 WAL 尺寸。仅尺寸与固定断言保存在当前 worktree 的相对路径 `.cache/p2b2-json-size-analysis/sizing-W4ZKE4/measurements.json`，这是忽略的本机临时证据，不作为克隆后必有的仓库资源；文档保留摘要，不写入输入/报告正文。

## 实际测量与适用边界

| 合成样本                                                    | 原始 JSON 字节 |           序列化字节 | 实际断言/限制                                                                                                 |
| ----------------------------------------------------------- | -------------: | -------------------: | ------------------------------------------------------------------------------------------------------------- |
| 单资源：三个满长 ASCII 文本                                 |         12,653 |               12,653 | resource Schema 通过                                                                                          |
| 单资源：三个满长 BMP 汉字文本                               |         36,653 |               36,653 | resource Schema 通过，32KiB 不足                                                                              |
| 单资源：三个满长未配对 surrogate 文本，引用闭合所需路径长度 |         72,653 |               72,653 | resource Schema 通过；未执行整体引用/媒体验证                                                                 |
| resource Schema 全字段包络                                  |         72,657 |               72,657 | parser/Schema 通过；路径按 Schema 96 字符上限，不冒充完整合法包                                               |
| 单资源：允许的 TAB/LF/CR 转义                               |         24,654 |               24,654 | 每文本4,000 UTF-16单元，parser/Schema 通过                                                                    |
| U+0000 / 未配对高、低 surrogate                             |          各678 |          后两者各678 | JSON parser 均通过；resource Schema 拒绝 NUL，但接受未配对 surrogate                                          |
| 正确配对的 surrogate                                        |            672 |                  672 | parser/resource Schema 通过                                                                                   |
| content 边界科学计数法整数                                  |      1,048,576 |            1,048,588 | content Schema、纯引用检查0 issue；canonical 实际失败 `JSON_SIZE_LIMIT`，序列化列为解析后 JSON.stringify 长度 |
| manifest Schema 全字段包络                                  |         19,983 |               19,983 | manifest Schema 通过；重复声明等语义未满足，只用作保守尺寸包络                                                |
| 非法 content 的 parser issues                               |            765 | 20,264（issues数组） | 原始 parser 返回166条；不受最终报告100条上限约束                                                              |
| 构造的100 issue报告包络                                     |         不适用 |               37,277 | 固定外围1,078字节、单 issue361字节；不是实际 validator 输出                                                   |
| 构造的任意长错误码报告                                      |         不适用 |              271,140 | 270,000字符自定义码；不是实际 validator 输出，只展示无条件界缺口                                              |

## 上界条件与建议预算

| 对象                      | 当前 P1 条件与可证明包络                                                                                                                                                                                                                                                                                                                                           | 建议持久化预算                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| canonical content         | [limits](../src/features/quizpack/v1/limits.ts) 限raw1MiB；[content Schema](../src/features/quizpack/v1/content.ts) 无 default/coerce/transform。整数规范化最多新增 `64×4 +64×2×1 +16×2×2 =448` 字节，故包络1,049,024字节。三项分别为资源bytes、width/height、normalization min/max。                                                                              | 保留2MiB；但需独立 P1 canonical 预算/桥接                                  |
| canonical manifest        | [manifest Schema](../src/features/quizpack/v1/manifest.ts) 固定ASCII字段、最多24组件/65文件，各字段取最大值的包络19,983字节。该包络不要求引用/完整验证成立，因此覆盖其子集。                                                                                                                                                                                       | 保留512KiB；raw256KiB不变                                                  |
| 完整 resource declaration | [文本/资源 Schema](../src/features/quizpack/v1/content.ts) 三文本各最多4,000 UTF-16单元。全部Schema包络为 `3×4000×6 +657 =72,657` 字节；6字节涵盖未配对surrogate，允许控制字符TAB/LF/CR仅需2字节，其他被禁控制字符不能用于放大。正确Unicode的每单元最多3字节，包络为36,657字节；657包含其他满长字段与JSON语法。整体引用闭合要求path匹配最多80字符ID，路径少4字节。 | 改64KiB，前提为下述显式后台UTF-8/Unicode policy；32KiB不能覆盖正常汉字样本 |
| 最终 P1 report            | [validator汇总](../src/features/quizpack/v1/validate.ts) 最多100 issue并保留issuesTruncated。已检查Schema/引用路径最多8段、固定key最多20 ASCII单元；静态消息46处、最长76单元，已观察固定码最长35单元。保守使用码64/消息128/每issue512字节、外围2KiB，条件上界53,248字节。前提为有限可信码、固定ASCII消息/路径以及P1有界输入；不是任意Report对象的界。              | 保留256KiB；严格报告合同与字节检查仍必须实现                               |
| 最多3份报告               | 3份各256KiB净payload合计786,432字节；仅数组`[]`与两个逗号还增加4字节，其他证据/attempt元数据另计。                                                                                                                                                                                                                                                                 | 保留净payload总和768KiB；外层metadata独立上限须另冻结                      |

[canonicalPackJson](../src/features/quizpack/v1/io.ts) 当前调用[F1 canonical helper](../src/lib/foundation-json.ts)，后者对序列化累计字节硬限1MiB。因此2MiB持久化字段不能令上述1,048,588字节样本成功canonical。后续需在可信桥接/P1兼容工作中提供独立、明确有界的P1 canonical预算，不全局放宽F1。原字节及其hash仍固定，canonical输出/hash另存；不能修改或截断原包后沿用旧received证据。

[PackToolError及取消传播](../src/features/quizpack/v1/zip.ts) 的code是任意string，当前可保留自定义PackToolError取消原因；TypeScript Report类型也不执行长度检查。因此报告上界不是无条件承诺。可信bridge须只生成/传递有限异常码，对最终报告执行strict结构、固定码、issue数量与字节检查，再绑定保存；未知码或超限是明确桥接失败，不能截报告冒充完整证据。单独parser产生的原始issues不得保存为最终validator report。

## 后台文本 policy 与尚待真实 DB 验证

[PostgreSQL 18 官方 JSON 文档](https://www.postgresql.org/docs/18/datatype-json.html)明确JSONB拒绝U+0000并要求surrogate配对正确，编码也影响可接受字符。P1 JSON parser接受这些合法JSON转义；当前P1文本Schema已拒NUL但没有拒绝未配对surrogate。因此64KiB资源预算的后台policy必须在任何持久化写入前检查候选/报告所有字符串，拒NUL及未配对surrogate，并确认数据库/连接UTF-8。该policy比P1 Schema窄，须有稳定version/hash并进入validation_key；拒绝应归属于后台持久化policy，不回写原P1报告、不替换字符、不截断、不宣称原内容已修复。

launcher可行性闸门完成后，仍须做同字节完整P1验证及真实DB容量/边界验收：冻结应用canonical字节与SQL约束的各自口径，实际确认UTF-8设置、中文/配对Unicode保存、NUL/未配对Unicode写前拒绝、2MiB/512KiB/64KiB/256KiB及三份报告/外层元数据边界。大小覆盖不是完整包、内容、素材或业务正确的证明。

写前policy拒绝或数据库明确返回输入拒绝/确认回滚是确定失败，不能仅因发生SQL错误就写unknown。真实提交结果不明才保留未知状态并按权威查询/显式恢复处理；本轮未连接DB，也未证明该失败分类或实际SQL容量已实现。
