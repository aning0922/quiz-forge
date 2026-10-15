# P3-A 内容合同与纯评分

日期：2026-10-15。本合同已完成独立Astra前置审查及修订，现冻结；不是实现或验收证据。B2-3已技术验收，基线为802585bff3d4c13a82783f23a4a0d5105a26addf，新堆叠分支codex/content-scoring-foundation接续。主控先交严格公共机器Schema，再派依赖实现。本批围绕历史人物首款必需的确定性逻辑与有限表现数据；网页内文案编辑后置。重新导入为追加修订独立设计，在同 Product 首次返修前实现，禁止删首稿、改 Product 或重置数据库绕过。

## 出口与边界

实现 quizpack-content.v2 的严格离线 Schema、明确 v1/v2 分派、引用闭合和组件能力声明，以及 dimensions/archetype@1.0.0 纯评分、逻辑 hash、见证执行和有限覆盖分析。v1 既有 parser、JSON Schema、兼容语义和 CLI 默认输出保留。v2 尚不接 ZIP 构建/验证的默认入口、私有候选/归档、DB 首稿、HTTP 或消费者页面；随后单批追加 authored/v2 准入。kind=authored 与 content schema 版本独立判断，不能把作者内容改标 synthetic。

本批不改迁移、不产生平台审核批准、正式报告或可发布版本，不运行媒体、不生成假资产声明。旧 synthetic 的实际像素仍为夹具。两份既有 P3 preflight 说明总体目标，本合同规定本批精确范围。

## 有限 content.v2

新模块位于 features/quizpack/content/。沿用 v1 所有基础字段，schemaVersion 改为 quizpack-content.v2，增加下述严格对象，未知字段拒绝。v1 模块对 v2 仍拒绝；新 dispatcher 只识别 v1/v2，未知版本明确失败。两者共用原文本规范、精确引用、数值限制，原 content/JSON/全包资源限额不放宽；仅v2每状态layout.resourceRefs从1–16变为1–64，v1仍1–16。所有新增短文本为1–N Unicode code points、至少一个非空白字符，拒绝未配对surrogate，不trim或normalize；沿用禁止HTML/控制字符/URL scheme规则，字段不解释为路径。JSON Schema须表达同一长度与严格结构；v1既有语义不变。

- visualPresentation.coverSceneRef：精确 ResourceReference，purpose=cover。
- sections：1–8 项，各有 id（既有 stable ID）、name≤40、chapter≤40、introduction≤400、sceneRef（purpose=decoration）。ID 唯一，所有厅必须至少有一题。
- questionFrames：1–100 项，questionRef、sectionId、caption≤80、可选 sceneOverrideRef（purpose=decoration）；每题恰好一项，questionFrames[i]精确对应questions[i]，拒绝乱序而不静默重排。每厅连续，顺序按 sections，不能重返早先厅，不从 index/3 猜测。
- resourceDescriptions：1–64 项，每项 resourceRef、alt≤240；精确覆盖 content.resources，禁止重复。所有图片都有明确替代文本；描述只提供语义，不算实际资源用途，不能为unused资源补资格。
- reportPresentation.resultCards：1–32 项，resultRef、displayName≤80、subtitle≤120、posterLine={kind:original,text≤120}、posterDisclosure≤240；精确覆盖全部 results，不增写历史事实字段。original 仅是作者声明。
- 新 content 仍保持六状态，布局 props 四字段不变。六个受控 ID 沿用 folio-cover/question/resume、cabinet-result、folio-report/poster，componentVersion=2.0.0、propsSchemaVersion=1.0.0；root/reportTemplates/layouts 必须整套一致。v1 保持 1.0.0，不能混用或回退最新版。
- layout.resourceRefs 要与实际状态资源图一致：cover={coverScene}；question={所有 section.scene 与 override}；resume={coverScene、所有section.scene与override}；result/report/poster={全部 portraits}。集合按完整{productId,id,version}身份比较，重复引用拒绝，不自动去重修复；禁止多带人物到揭晓前状态。允许集合不表示消费者一次收到全部资源，未来resume只解析当前场景；本版result/report/poster不允许额外包内背景。资源使用闭合以该图与结果 portraitRef 为准。此声明不能证明图片本身中性、素材获准或渲染器实际存在。

提供 parseSupportedContent(input:unknown)、validateSupportedContentReferences(content,targetProductId)、getContentJsonSchema(version) 的有限接口；可给新 schema 脚本显式 --content-version v2 模式，零参数旧输出原样。零参数脚本输出的实际stdout字节保持不变；显式v2模式仅输出标识为content.v2的JSON Schema，不拼成v1 manifest+v2 content包合同。新引用接口只核内容内部身份/规则/表现引用/资源用途及组件声明，不取代旧validateContentReferences(manifest,content,target)的完整职责/错误路径。v2包级文件一致性、真实registry和ZIP均not-run，无candidateValid/renderReady资格。旧v1 manifest及默认构建/验证入口不改，仍拒绝v2。

## 纯逻辑与依赖方向

features/quiz/scoring 拥有纯逻辑、Prepared 定义、精确算术、评分、见证和覆盖。不得引用 app、数据库、theme、report 或 quizpack。features/quizpack/content/scoring-adapter 调用 quiz，并从明确支持的严格内容生成逻辑投影与外层报告绑定。通用基础合同可提取到 lib/contracts；不复制两份会漂移的规则语义。

输入投影必须有内部版本 quiz-scoring-definition.v1、productId、contentVersion、engine、dimensions（仅精确身份）、questions/options（仅精确身份、归属和完整 contributions）、rules、results（仅精确身份）。逻辑投影不含文本、资源、layouts、content schema/kind、报告内容或 reportTemplateRef。完整内容 hash 独立绑定上述所有显示语义。引擎中不能用文案、数组索引、浮点误差或用户字段修改决定。

prepareScoringDefinition(input:unknown) 返回仅准备函数能构造的 Prepared 对象。先用有界普通JSON快照拒绝Proxy、getter、符号键、稀疏数组、环和异常原型，再严格Schema及语义检查，不能先递归Zod/clone后限额；复制且深度冻结，使用私有 WeakMap 持有可信内部值，不能仅靠 TypeScript brand 或可仿造属性通过执行入口。输入改变不影响已准备对象。

强制检查精确 Product/version、各命名空间唯一 ID、全局 option 唯一与题目归属、完整贡献向量、全部结果 profiles/resultOrder 恰好覆盖、引擎/规则一致、完整真实 min/max。总和边界从每题每维贡献重新计算；常数维度、错误边界、缺失/重复/额外引用拒绝。

答案只接受 {questionId,optionId}[]，每题恰好一个，完整数量不超过100；未知/重复/跨题/缺题/未知字段拒绝，不接受分数/结果/版本。按定义问题顺序规范化，输入顺序无关；答案失败时没有结果或报告。

## 算术与结果

每维原始贡献求和；精确归一化 100*(raw-min)/(max-min)。不 clamp、不提前舍入。使用 BigInt 有理数，约分、正分母、零0/1；JSON 输出十进制字符串。显示采用单独版本 quiz-score-display.v1 的整数 half-up 一位小数，不参与匹配。

- dimensions：所有维度落在 profile 闭区间才匹配；多匹配按 resultOrder，零匹配返回 NO_PROFILE_MATCH，不能回退第一张。
- archetype：归一化空间各维等权平方欧氏距离，不开方；精确最小，相等才按 resultOrder。profiles 的排列不影响结果。
- quiz-score.v1 输出 productId/contentVersion/engine/logicHash/answersHash、规范答案、每维 raw/bounds/精确normalized、判别 decision（matchingResultRefs 或 distances/tiedMinimumResultRefs，selectedResultRef），无时钟/随机ID/DB。reportTemplateRef 不进入核心输出，由适配器按同一固定内容选中结果绑定，外层核完整内容 hash。
- logicHash=SHA256(UTF8("quizforge:quiz-logic.v1\n") || UTF8(Canonical(normalizedLogic)))，其中换行是一个U+000A字节；集合规范化规则必须固定：维度/问题依定义顺序，选项依定义顺序，contributions/bounds/targets/ranges 按维度顺序，profiles 按 resultOrder，结果按 resultOrder。仅显示字段改变且保持contentVersion/逻辑实体Ref不变时不改logicHash；contentVersion改变会改hash。题序或选项序改变属于逻辑输入规范变化，本版 hash 随之变化。
- answersHash=SHA256(UTF8("quizforge:quiz-answers.v1\n") || UTF8(Canonical({schemaVersion:"quiz-answers.v1",logicHash,answers:规范答案})))；复用中立 canonical 实现，不能依赖 quizpack 形成循环。

## 见证与覆盖

见证由 adapter 严格提取，每个结果恰好一组完整答案与预期 resultRef。执行所有见证并报告所选结果/expected 是否一致和有限错误。保留包内 declared-not-executed，执行结果另存quiz-witness-evidence.v1，核心绑定logicHash/witnessesHash/固定policy身份，外层另用严格sourceBinding判别联合绑定完整content或authored-pending逻辑审阅来源；可达不代表覆盖率或科学效度。

dimensions覆盖以逐题可达原始向量DP，固定policy dimensions-coverage.v1。纯同步接口，无时钟/定时器/AbortSignal或运行中取消承诺。单层最多20000状态、当前+下一层共40000、尝试转移1000000（重复也计）、坐标加法16000000、标量范围比较10000000（每维min/max各一次，含结构证明）、两层代表选项下标Uint8Array总字节4000000。每状态只留首个代表路径，最多100字节；丢弃旧层，不保留祖先链或所有层。只在去重确认插入新状态且预算检查之后复制代表路径，禁止每次候选转移复制答案。转移计数在生成向量/去重键之前，所有计算/分配前先检查预算；调用方不能提高编译固定预算。本接口无外部预算参数。

遍历问题/选项顺序固定，frontier保留首次插入顺序，profiles依resultOrder。仅最终完整答案向量可判断无匹配；反例必须通过实际scoreCompleteAnswers复验。不会把中间部分和或不可达连续区间缺口当失败。报告严格三态proven/uncovered/inconclusive，绑定logicHash/policyId/policyHash、有效预算、实际计数、原因码；counterexample最多1个，带完整规范答案和raw。超任一预算为inconclusive，不等于非法定义或passed。最终全部可达向量检查完成才proven。

最后一个profile若明确全维[0,100]，允许结构全域证明，不自动添加；每结果可达性仍由见证分别报告。archetype合法非空profiles的总覆盖是算法语义，不伪造dimensions报告；调用dimensions分析archetype返回UNSUPPORTED_COVERAGE_ENGINE。最坏边界需记录实测耗时和内存，固定计数不是OS内存隔离保证。小模型独立穷举对照DP，不用同一算法构造预期。

## 公共接口与预算

主控先交中立lib/assessment-contract/primitives.ts与scoring-v1.ts，原定义搬移、原路径再导出，Zod调用/字段/分支顺序及P1错误包装不改。中立lib/json/canonical.ts提供有限普通JSON快照与canonical能力，原P1包装保留预算/异常类型/原输出字节。提取前保存quizpack:schema stdout和两个旧包字节摘要，提取后逐字节比较。

内部LogicInput严格字段：schemaVersion=quiz-scoring-definition.v1、productId、contentVersion、engine、dimensions:Ref[]、questions:{ref:Ref,options:{ref:Ref,contributions:{dimensionRef:Ref,value:int}[]}[]}[]、results:Ref[]、rules（复用原P1严格两分支）。各Ref.version必须等于contentVersion。prepared是私有WeakMap签发handle，不持久化，不接受spread/JSON往返/伪造。所有公开输出深冻，内部Map不暴露。

固定预算：logic canonical≤2MiB、depth32；答案≤64KiB/100项；witness输入≤2MiB/32项；单score≤64KiB；见证报告≤2MiB；issues最多32、只返回固定字段路径/索引及有限码不回显值；fraction十进制字符串≤160位，规范非负分子/正分母/约分，无前导零。机械验证当前整数/16维最坏分母位数；无外部Fraction输入。有限错误：INPUT_LIMIT_EXCEEDED、UNSUPPORTED_LOGIC_SCHEMA、UNSUPPORTED_ENGINE、INVALID_DEFINITION、REFERENCE_MISMATCH、INVALID_NORMALIZATION_BOUNDS、INVALID_PREPARED_DEFINITION、INVALID_ANSWERS、NO_PROFILE_MATCH、INVALID_WITNESS_SET、WITNESS_RESULT_MISMATCH、UNSUPPORTED_COVERAGE_ENGINE。ScoringResult={ok:true,value}|{ok:false,issues:{code,path}[],issuesTruncated:boolean}。

核心函数：prepareScoringDefinition(unknown)→Result<Prepared>；scoreCompleteAnswers(Prepared,unknown)→Result<ScoreSnapshot>；verifyDeclaredWitnesses(Prepared,unknown)→Result<WitnessEvidence>；analyzeDimensionsCoverage(Prepared)→Result<CoverageEvidence>。Score字段沿上节，NormalizedAnswers字段名固定normalizedAnswers，core没有reportTemplateRef。witness输入={schemaVersion:quiz-witness-input.v1,entries:{expectedResultRef:Ref,answers:Answer[]}[]}，精确覆盖结果；先验集合错误拒绝，逐项答案失败/选错结果在严格证据项中记录有限错误，不把部分执行当通过。结果证据不必重复32份完整score，只保留expected/selected/answersHash与实际原始和/精确归一化及有限错误，依然有完整机器验证证据。

adapter为私有签发PreparedContent，先一次有界快照+严格分派+内部引用校验，固定完整content及result→report映射，再准备core。scorePreparedContent只能由handle内的core实际执行评分并选择报告；不能接受外部score作可信输入、不能重读调用方可变对象。输出外层content schema/contentVersion/reportVersion/canonicalContentSha256、reportTemplateRef、实际core score。完整内容hash沿既有canonicalP1Json字节口径，不加新域。

## 公共机器字段的补充冻结

主控公共提交用严格Schema逐项表达以下字段，不由A/B各自扩展；所有对外字符串/数组/整数字段都受上述固定预算及结构限制。Prepared仍是私有WeakMap的opaque handle，新增readScoringIdentity(Prepared)→ScoringResult<{productId,contentVersion,engine,logicHash}>，供适配器读取真实已准备身份而不复制hash算法。

witnessesHash=SHA256(UTF8("quizforge:quiz-witnesses.v1\n")||UTF8(Canonical({schemaVersion:"quiz-witness-input.v1",entries:规范见证})))。entries按resultOrder；每份answers按questions顺序；先核完整集合与完整答案，非法单项不伪造规范answersHash。inputSha256=SHA256(UTF8(Canonical(原始有界witness快照)))，保留原数组顺序、不先排序；普通JSON/外层结构/结果集合非法直接返回ScoringResult失败、不生成报告。报告全量输入身份保留该摘要；若任一答案非法导致不能规范全体，witnessesHash=null，报告status=failed，仍逐项执行其余合法见证。

witness policy descriptor固定为{schemaVersion:"quiz-witness-policy.v1",id:"declared-witnesses.v1",completeSet:true,answerOrder:"question-order",resultOrder:"rule-result-order",maxWitnesses:32,maxInputBytes:2097152,maxOutputBytes:2097152}；policyHash=SHA256(UTF8("quizforge:quiz-policy.v1\n")||UTF8(Canonical(descriptor)))。证据quiz-witness-evidence.v1含logicHash、inputSha256、witnessesHash（64hex或null）、policyId/policyHash、status passed|failed、entries。entry严格联合：passed或mismatch含expectedResultRef/selectedResultRef/answersHash/dimensions（复用Score维度字段），mismatch另含固定WITNESS_RESULT_MISMATCH；invalid含expectedResultRef/issues/issuesTruncated，不带成功字段。合法完整答案但NO_PROFILE_MATCH也进入invalid，总状态failed，但答案仍可规范，不因此将witnessesHash置null；只有答案非法使整个集合不能规范时才置null。全部passed才总passed。集合不完整/重复错误返回ScoringResult失败，不产生不完整报告。

coverage policy descriptor固定为{schemaVersion:"quiz-coverage-policy.v1",id:"dimensions-coverage.v1",algorithm:"reachable-raw-vectors-dp",globalProfile:"last-only",frontierStates:20000,retainedStates:40000,transitions:1000000,coordinateAdditions:16000000,scalarComparisons:10000000,pathBytes:4000000}，沿同一policy hash域。严格证据quiz-coverage-evidence.v1公共字段logicHash/policyId/policyHash/budget（完整descriptor）/processedQuestions/stats；stats为实际transitions、coordinateAdditions、scalarComparisons、peakFrontierStates、peakRetainedStates、peakPathBytes。proven分支proof={kind:exhaustive-reachable-vectors,reachableVectorCount}|{kind:last-global-profile,resultRef}；uncovered含counterexample={normalizedAnswers,rawSums:{dimensionRef,rawSum}[]}，必须由实际完整评分NO_PROFILE_MATCH验证；inconclusive含limit枚举frontierStates|retainedStates|transitions|coordinateAdditions|scalarComparisons|pathBytes。processedQuestions为已完整扩展题数，结构证明0、完整枚举或反例为总题数、预算退出不计未完成层；预算恰好耗尽但全部必要工作已完成仍可proven。额外字段拒绝，archetype数学总覆盖不产生本报告。

完整输入封套及最终输出先预算检查后返回，不以子字段各自未超限代替组合预算，不截断成功。评分/输入/policy/转写等派生摘要由准备/执行模块从固定快照计算，不接受调用方自报digest作为执行证据。source.commit/path/sha256是待外层核验的来源声明，纯模块仅绑定进转写摘要，不宣称读取核验了源文件。严格sourceBinding只是证据所绑定的来源事实，平台审核仍需核原来源工件；文件路径/SHA不授予审批。

## 首款逻辑转写

从 codex/first-product-content 的03fdc24（内容draft-2源e8ba810）准确转写已选定四卡、12题/48向量/四targets/order/四完整见证。主控冻结本次审阅身份historical-cabinet/contentVersion=1.0.0，仅审阅封套不创建Product；维度顺序exploration/expression/connection/steadiness，q01–q12和qNN-a/b/c/d，resultOrder li-bai/su-shi/tao-yuan-ming/bai-ju-yi。只形成明确 authored-pending 的逻辑审阅fixture与独立执行证据，不伪造完整资源/许可，不成为合法QuizPack。固定原文来源commit和转写SHA，实际输出需独立机械复算；内容/权重/目标/报告仍待作者审读。

专用quiz-authoring-review.v1封套≤2MiB：status=authored-pending、source={commit:40hex,path:固定docs/FIRST_PRODUCT_CONTENT_DRAFT.md,sha256:原文件字节SHA}、definition:严格LogicInput、witnesses:严格witness input、transcriptionSha256。transcriptionSha256=SHA256(UTF8("quizforge:quiz-authoring-transcription.v1\n")||UTF8(Canonical({schemaVersion,status,source,definition,witnesses})))，不包含自身hash。sourceBinding联合为{kind:content,contentSchemaVersion,contentVersion,canonicalContentSha256}或{kind:authoring-review,source,transcriptionSha256}；均外层绑定实际logicHash，二者不互换、不伪造缺少的contentHash。封套/绑定由主控先交严格Schema；authored-pending不是新QuizPack kind。

## 分工与验收

主控：合同、共享基础schema/canonical提取、全局配置/CLI、集成及最终检查。A独立Sol/high：quiz/scoring全部逻辑与边界测试、四卡逻辑转写及执行证据。B独立Sol/high：quizpack/content v2/dispatcher/引用/adapter与兼容回归。主控先交共享Schema/canonical/封套，A随后交可调用核心接口，B再对接adapter；不得互改对方文件。Astra/high独立合同和非实施审查。现有独立开发聊天分别以同一基线在其干净受管工作树创建新分支，旧交付分支保留；精确公共合同提交由主控另行派发。

验收：六项工程检查（沿用生产E2E确保无回归）、真实DB回归保持旧准入、旧v1两合成包原样构建验证、v1 JSON Schema/默认CLI前后结构一致、严格v2边界与引用、独立算术golden及精确平分/负贡献/大分母、所有失败路径、immutable prepared伪造拒绝、四卡实际见证、DP与独立小穷举对照及预算退出、逻辑/表现/hash隔离、无web consumer暴露、独立审查/推送Draft PR与准确CI。无新UI不伪造截图；真实六状态图检在后续preview批验收。

公共实现补充：witness entry passed要求expected/selected完整Ref相等，mismatch要求不等；invalid issues仅INVALID_ANSWERS或NO_PROFILE_MATCH且单项原因一致，全体规范hash为null当且仅当存在INVALID_ANSWERS。结构非法witness整体失败；形状合法但缺题/重复/未知/跨题选项逐项invalid。coverage机器Schema直接核结构证明processedQuestions=0、穷举>0、反例答案数等该计数且questionId唯一；实际总题数与反例评分仍由Prepared执行层核验。共享Schema本身不执行ordinary JSON快照、整份UTF-8预算、深冻结或实际评分，A/B必须在入口/返回路径实现这些责任。
