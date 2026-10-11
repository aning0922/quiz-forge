# P1：受限 QuizPack 工具链

日期：2026-10-12。依据作者 P1–P5 托管授权与 Astra high 前置架构审查。状态：合同冻结，尚未实现。F1 的 foundation.v1 保持不变。

## 交付和范围

实现独立 quizpack.v1 / quizpack-content.v1 合同、两个引擎声明的合成包、受限 ZIP 验证、真实静态图片解码、确定性构建、机器可读 CLI。P1 不执行评分，不接数据库/上传接口，不提供导入、审核、组件渲染、Key 或发布。candidateValid 只描述当前 policy 下技术检查通过；importable/publishable 永远 false。证据不得被 P2 直接升级为批准，P2 必须重新验证。

包只允许 manifest.json、content.json、assets/<resource-id>.<png|jpg|webp>。manifest strict，列出除自身外的全部文件路径、实际字节数、MIME 和 SHA-256，并固定 packId/packVersion/productId、contentSchemaVersion、engine 和组件合同兼容声明。content 独立建模 Product、各内容/视觉/报告/资源版本、有限问题/选项、维度、结果、报告、六状态布局、资源和见证答案。禁止任意表达式、源码、HTML、网络 URL、开放 props 和包内字体。

dimensions 和 archetype 使用 strict 判别分支、有限整数贡献、明确 sum 聚合及归一化；archetype 固定完整目标向量、距离与平分顺序。必须有完整确定性基线报告。P1 只支持 DETERMINISTIC；COMPOSED、AI_ENHANCED 和 branching 后置。cover/question/resume/result/report/poster 六状态都固定组件 ID/version/propsSchema 和有限 props。兼容通过仅表示工具理解合同，不代表组件存在或渲染通过。

静态检查重复 ID、问题/选项归属、贡献/目标维度全集、结果覆盖、版本精确引用、资源用途、见证答案完整。资源只属于目标 Product，来源/许可/审核值都是声明。每个结果有声明见证但不执行。未知合同拒绝，缺完整基线拒绝。A 流先完成严格类型和两个 Product/两类引擎 fixture 并交接 B。

## 容器和限额

reader 支持 STORE/DEFLATE；builder 只输出 STORE。单卷、非 ZIP64、无 data descriptor/extra field/comment，普通非可执行文件。合法但不支持的 ZIP 返回 ZIP_UNSUPPORTED_PROFILE。路径使用固定 ASCII 小写形式；拒绝修正路径、反斜线、绝对/盘符/冒号、空段、点段、百分号、NUL、大小写别名和重复。禁止链接/设备、目录条目、加密、嵌套归档、其他文件类型。

顺序：有界输入 → central/local/EOCD 结构一致性 → 逐条实际解压计量与 CRC → JSON/manifest → 完整性 → 全图片解码 → 引用/兼容 → 证据。验证 offsets、无重叠、无前缀/尾随/隐藏条目，各头名称/flags/method/CRC/size 相同；DEFLATE 必须消费全部压缩字节。禁止按包路径解压到磁盘。

| 限额                    | 固定上限                      |
| ----------------------- | ----------------------------- |
| 输入/总实际解压         | 32 MiB / 64 MiB               |
| 条目/资源               | 66 / 64                       |
| manifest/content/单资源 | 256 KiB / 1 MiB / 8 MiB       |
| 单条与总压缩比          | 100:1                         |
| JSON 深度               | 32                            |
| 题/每题选项/维度/结果   | 100 / 8 / 16 / 32             |
| 单图尺寸/像素/帧        | 8192 px / 1600 万 / 1         |
| 解压与媒体并发          | 各 1                          |
| 整包/单媒体期限         | 60 秒 / 5 秒                  |
| issues                  | 100，溢出显式 issuesTruncated |

生产 policy 不接受包提高限额；测试只能下调。截止时间覆盖接收、解压和媒体；取消/超量/超时/IO 失败关闭流、终止并回收媒体子进程、清理临时文件。输入先总量有界缓存，再逐条解压；不是任意 ZIP 的无缓存单遍解析。

图片扩展名、MIME、magic/真实格式、尺寸、字节/hash 一致；PNG/JPEG/WebP 静态图在受控子进程用 sharp failOn:warning 完整像素解码，metadata 成功不足以通过。不缩略代替验证，不静默转码。父进程限时并 kill/reap，子进程只接收字节。子进程不是 OS 沙箱，不具备 RSS 硬限额；远端上传服务开放前需要 OS/container 资源隔离。P1 仅本地离线工具，不声称图片中不存在任意元数据载荷。

## 构建、CLI 与证据

构建核心接受显式资源 bytes 映射，不扫描任意目录。根据实际输入计算文件大小/hash；canonical JSON 保留数组顺序；固定路径排序、STORE、mode 0100644、DOS 本地字段 1980-01-01 00:00:00，forceDosTimestamp:true，空 comment。跨 TZ 必须 bytes/hash 相同。构建后通过独立 validator 才能写出；写出临时文件原子提交、默认不覆盖既有目标、失败清理。

命令使用 pnpm --silent quizpack:check/build/schema，stdout 仅 JSON；产物写显式目标，错误不泄漏绝对路径、原文、堆栈或恶意输入。CLI 只按显式清单读取本地资源，拒绝来源链接与目录越界。具体参数由 B 写入使用文档并加入真实 pnpm 子进程测试。

报告绑定完整 archive SHA、原始 manifest/content SHA、目标 Product、validatorVersion、policyId、可信兼容 policy hash。逐项 checks: container/structure/references/integrity/media/compatibility = passed/failed/not-run；issues 有稳定 code/path/message。未知失败不伪报通过。unverified 明列评分/可达性、授权、人工内容/视觉审阅、运行器渲染、DB/导入/发布未实现。

## 文件所有权与接口

全部新实现位于 src/features/quizpack/v1/，不改 F1 语义。

| 流              | 独占文件                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A：内容与图片   | manifest.ts、content.ts、references.ts、compatibility.ts、media.ts、media-worker.*、fixtures/ 及这些测试；docs/P1_CONTENT_IMPLEMENTATION.md |
| B：ZIP/构建/CLI | zip.ts、build.ts、validate.ts、io.ts、scripts/quizpack-* 及这些测试；docs/P1_TOOLCHAIN_IMPLEMENTATION.md                                    |
| 总控            | api.ts、limits.ts、package.json/锁文件、共享阶段文档、集成与 CI                                                                             |

A exports：parseQuizPackManifest(input:unknown):Result<QuizPackManifest>；parseQuizPackContent(input:unknown):Result<QuizPackContent>；validateContentReferences(manifest,content,targetProductId):PackIssue[]；checkCompatibility(manifest,policy):PackIssue[]；DEFAULT_COMPATIBILITY_POLICY；inspectImage(bytes,expected,signal):Promise<Result<ImageFacts>>；getQuizPackManifestJsonSchema()/getQuizPackContentJsonSchema()。types 在各自文件导出，通用类型从 api.ts。A 先交接 manifest/content 字段和 fixture 的独立 commit，B 接入后完成编排，不修改 A 文件。

B exports：validateQuizPack(source:AsyncIterable<Uint8Array>,context:ValidationContext):Promise<QuizPackValidationReport>；buildQuizPack(input:BuildInput,context:ValidationContext):Promise<Result<BuildOutput>>。build input 内容为 unknown、身份参数和显式资源集合；不信任调用方提供的 hash。API/limits 修改需总控解决后通知另一流，不在各分支重复调整。

## 验收与阶段退出

独立构造/修补恶意 ZIP，不能只用合法 builder：精确上限/+1、压缩比/虚报大小/实际流量、取消超时清理；路径链接加密方法 ZIP64/descriptor/extra/重叠/头不一致/截断/CRC/尾随；manifest 缺多重复/hash；伪装媒体、可读头损坏像素、超像素、多帧、尺寸不符、字体；未知字段/重复 JSON 键/跨 Product 与版本/基线缺失/未知兼容；两个 Product 两引擎成功且始终禁止 import/publish；遍历顺序及跨 TZ 确定性；真实 pnpm 三入口成功与失败。

集成后执行六项检查和 Astra high 独立审查，记录精确 SHA、实际 CI 和已知限制，建立独立 Draft PR。P1 技术门槛通过可继续已授权 P2，保留主线合并与人工决定。本阶段不改 UI，既有消费者页面回归由 E2E 确认。
