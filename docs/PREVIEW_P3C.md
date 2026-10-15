# P3-C 固定修订内部预览合同（已冻结）

2026-10-16。P3-B已在afaa43e技术验收，交付59a83e0；主控从该点建立codex/fixed-revision-preview。本合同经Astra独立审查通过，先交共享机器接口与真实字体descriptor，再派两线实施。继续两个独立Sol/high实现聊天＋Astra/high独审，当前主控负责合同/共享配置/集成。首款四卡及folio主方向、cabinet揭晓语言不变。

## 出口

运营员在固定productId/draftId/revision上，通过真实私有资源读取和实际纯评分，体验cover/question/resume/result/report/poster六状态。临时答案和结果不写入用户QuizReport，不发AccessKey、不创建正式会话、不封存ProductVersion或发布。历史原文读取独立保留；预览能力不足不能使历史正文不可读。

新预览仅实现精确content.v2、既定六组件2.0.0/props1.0.0、dimensions/archetype1.0.0；v1旧revision可读原文，真实renderer未注册时明确不可预览，不用最新版回退。静态受控registry将schema/state/engine/ID/version/props schema关联到编译组件与DTO adapter，包内无代码/CSS/HTML/动态URL执行口。缺renderer、资源或字体是有限可见状态，不能套研究页成功截图。

## 固定来源和权限

预览入口固定revision而非current指针，响应绑定productId/draftId/revision、canonicalContentSha256、assetSetSha256及renderer/font版本。每次资源或评分请求重新授权。read-only运营员可使用无持久化的预览和临时计算，固定使用studio:read；POST独立同源/CSRF检查后执行只读授权事务，不传import read的writeCredentials参数，不使用withStudioWrite。POST评分也须有界读取、同源与CSRF保护，不能伪装业务写权限或绕过当前身份撤销。

首次进入单独严格解析固定正文、完整内容引用与registry支持，不把旧归档策略/当前媒体seal变化用作历史读取拒绝理由。真实评分调用prepareContentForScoring/scorePreparedContent，答案输入只含完整questionId/optionId和预期固定内容/素材hash；不接客户端分数、结果、reportTemplateRef。全部问题对应当前快照，错hash/缺答/重复/跨题明确失败。

## 最小传输与临时状态

这是预览页面数据最小化与体验约束，不向有权读完整历史正文的运营员承诺结果保密。资源API权限以当前studio:read＋固定revision内完整资源归属为准，不增加客户端phase/resultRef授权。预览UI只请求当前状态必要的白名单资源，接口本身允许已授权运营员读取该revision中任意合法声明资源；无需伪造阶段token或正式会话。

预揭晓DTO只含标题、受控layout props、维度显示必要信息、厅/题/选项文案和cover/scene资源引用，不传结果名单、portrait、baseline、原型target或贡献向量。完整内容与评分逻辑留服务端；实际图像是否中性仍须人审，schema不能代替像素检查。

揭晓只由真实score的selectedResultRef/reportTemplateRef选择该卡、该baseline及portrait，返回精确sourceBinding、用于显示的一位小数、结果/报告/海报必要数据。距离不展示为相似度或科学置信度。只显示content.v2存在的事实，不能补造年代、经历、文化简介或“相似人物”。

预览答案为内存态；可在预览内回到resume继续，刷新明确重置，不复用D1演示localStorage。导航/请求竞态使用固定绑定、当前请求代次和当前答案三重关联；取消仅减少工作量，不作为迟到响应不会处理的证明。每个评分请求携带严格UUID requestId，服务端回显，并返回实际评分的规范化answersHash。客户端为本轮发送的不可变答案快照保存requestId，答案任何编辑立即推进代次并清空结果/报告/海报/PNG；只接受当前绑定、requestId和未变答案快照对应的响应。不得只比较revision/hash。评分返回的actual answersHash再绑定结果与导出，不接受客户端自报分数。字体/图片加载和canvas编码同样捕获代次，迟到操作不得恢复旧下载入口；旧ObjectURL立即撤销。错误/加载/未答/素材失效均有真实状态；不授予完成权威。

答案子对象保持64KiB/100题上限；完整评分HTTP请求封套（binding＋requestId＋answers）固定96KiB，沿专用有界reader，既有写接口4KiB不变。预览入口完整JSON封套固定512KiB、评分/报告/海报完整JSON封套固定256KiB，错误封套≤4KiB。具体Schema按字段白名单建立，不承诺所有合法content.v2均可在这个renderer预算内显示；序列化完整封套后超限必须明确PREVIEW_LIMIT_EXCEEDED，不截断成功。机器合同实施时验证精确上限、+1、UTF-8与转义边界。超renderer预算返回不可预览，不能截断成功或放宽原包1MiB/既有评分上限。海报使用单独严格PreviewPoster DTO，只含实际选中卡和已验证数据。

## 私有资源读取

新增只读接口按固定revision＋完整resource ref定位，先当前授权与revision归属，再核固定asset-set、product_asset声明hash和blob hash/bytes/MIME。不能暴露任意blob SHA/path下载口，不能以caller提供URL/文件路径作为读取权威。跨模块通过显式服务接口，theme/renderer不直查DB。

复用既有受控路径推导、O_NOFOLLOW/非阻塞、私有祖先目录/文件身份、实际大小与hash核验和句柄关闭规则；不借用虚构ArchiveOperation/fence或ACK。单图≤8MiB，先完整有界核验再响应，可信MIME、nosniff、private/no-store；无共享缓存/304/公共图片优化。取消、超时、未确认读任务与并发FD/Buffer上限采用下方定量策略，不能把已发出IO当作从未开始。资源仅GET，显式HEAD拒绝、Range拒绝；不发ETag/Last-Modified，禁止304。授权在请求前及完整读取完成后重新核验当前session；撤权后的新请求拒绝，不能承诺远程收回已下载字节。已确认的清理前置为同advisory key共享读锁与清理独占锁互斥，DB连接消失不等于IO停止；P3-C fixture清理必须先证明受管server实际退出。不得将未确认结束读任务归还并发额度。

客户端只为当前所需图片获取Blob URL，卸载/切换快照及时撤销，迟到响应不替换新图；不把授权cookie/原始Key放到URL、日志、PNG或公开对象。

## 视觉、字体和素材

复用现有tokens、题页键盘/选择状态、folio阅读与cabinet结果构图，以及海报有界排版/字体失败/PNG编码交互。消除固定12题、index/3分厅、固定李白/分数/人物介绍和单图resolver；questionFrames/sections决定题厅，选项与维度数量按有限Schema。

字体需覆盖真实首款全部显示文本及固定UI，按cmap核查；受控字体文件/版本/许可证证据固定在repo组件侧，不能从包下载任意字体。缺字/未加载阻止PNG导出，不截字或静默方框。沿既有1080×1920导出目标，但长文本/1–16维等超排版能力须明确拒绝，不挤出画布。

九张正式素材和四卡文案/权重/报告的批准仍由作者决定。缺失portrait不得借李白、Emoji、色块或装饰图冒充。可用的待审真实素材只用于明确内部审阅，不能赋予商用/发布资格。技术验收的合成fixture保持明确标记；后续真实首款素材制作、权利证据和完整审阅包另行交作者审核。

## 两线划分与验收

主控：精确DTO/registry机器合同、公共错误/预算、依赖/字体、集成与3100。A：鉴权固定revision预览服务、私有资源读取、临时评分端点/真实PG/FS失败边界。B：受控registry适配、六状态UI/PNG、移动/键盘/加载/失败体验。先共享接口再并行，不双写文件；不改消费者Key/报告持久化模型。

验收包括六项工程检查、固定来源与权限/撤权/错引用/丢失或损坏blob/中止的实际边界，真分数绑定报告、不泄露揭晓前资料、完整PNG及字体覆盖、四宽320/375/390/430六状态实际截图和人工助手像素审查、独立审查/CI。程序图检与作者内容/素材/商业批准分别记录。先完成历史人物方向，不扩另两主题或重新设计既定风格。

## 精确投影合同

共享机器合同位于features/product/preview/contracts.ts，限浏览器安全的Zod/纯标量依赖，不能因复用Schema把node:crypto或server-only带入客户端。范围字段复用现有productIdSchema、draftIdSchema和有界修订号Schema；productId是受限字符串，不是UUID；内容Ref仍为完整productId/id/version，不用显示名替代引用。renderer注册为folio-cabinet-preview@1.0.0；字体注册为historical-preview-serif@1.0.0，机器合同最终加入真实字体文件SHA及覆盖表SHA，不使用占位SHA。

PreviewBinding固定productId/draftId/revision/canonicalContentSha256/assetSetSha256，以及renderer{id,version}/font{id,version,fileSha256,coverageSha256}。服务端依真实固定修订生成；全部请求校验完整绑定，任何字段不匹配返回PREVIEW_BINDING_MISMATCH；不能自动换current。主控先冻结Font descriptor再并行UI实现。

Layout只传精确component{id,version,propsSchemaVersion}与props{heading,body,density,showProgress}，六状态分别只允许已有受控ID@2.0.0/props1.0.0。原始resourceRefs在服务端校验，不透传整组layouts或人物集合。Asset只传resourceRef/mediaType/bytes/sha256/width/height/purpose/approval/alt，alt取精确resourceDescriptions；不传path、storageKey、任意URL或来源许可长文。

入口封套value包含binding、contentSchemaVersion、kind、engine、product{productId,title}，layouts{cover,question,resume}，完整有序questions[{id,productId,version,prompt,options:[{id,productId,version,label}]}，visualPresentation{coverSceneRef,sections,questionFrames}及其精确中性资源并集assets。不得包含contributions/rules/targets/witnesses、结果和portrait元数据。所有section/frame字段沿v2有限Schema逐项投影。

cover按固定title/cover/layout和章节信息渲染；question由frame定位section/sceneOverrideRef，不按题index/3猜分厅；resume从内存答案得到题号/已答数，没有savedAt或服务器保存成功字段。刷新明确清空临时答案，返回resume仅表示当前页面内继续。

评分请求为{binding,requestId,answers}，answers元素仅questionId/optionId；requestId为UUID，不是持久化幂等key。评分响应value为binding/requestId/answersHash/logicHash/contentSchemaVersion/contentVersion/reportVersion/selectedResultRef/reportTemplateRef、dimensions、result、report、poster。服务端真实prepareContentForScoring/scorePreparedContent产生引用和hash；dimensions按原content.dimensions顺序，仅传{dimensionRef,label,normalizedText}，normalizedText用已验证displayHalfUp生成一位小数，严格范围0.0..100.0，不传完整ScoreSnapshot、normalizedAnswers、所有距离或候选。

result含该状态Layout、实际卡displayName/subtitle和portrait Asset；report含该状态Layout、mode=DETERMINISTIC和完整baseline{title,summary,strengths,tensions,reflection,disclaimer}。poster为ready|unavailable严格联合：ready带状态Layout与当前实际卡displayName/subtitle/posterLine{kind=original,text}/posterDisclosure、portrait Asset及完整维度；unavailable只给POSTER_LIMIT_EXCEEDED等有限原因，报告/评分仍有效。海报UI绘制固定应用标识“内部预览／待审／非正式报告”，不以应用水印替代包内disclosure。

页面报告显示完整1–16维。初版1080×1920海报仅接收完整1–4维，8码点单行维度名、12码点单行人物名、24码点单行副标题、48码点最多两行原创题句、72码点最多两行disclosure；不挑前四维、不截断。候选文字区x=90..990、y=1220..1868，人物名字号≥60、副标题≥30、题句≥32、disclosure≥24像素；实际加载字体后measureText/行数/边界仍须验证，任一超限不可导出。这里只是实现接收约束，尚无新PNG实际证明。

原内容未定义的年代、生平、相似人物、维度解读、短标签、古典出处等一律不补造。资源声明pending明确显示，文案与素材没有从test通过自动变为approved。

## 文件责任及接入顺序

主控：本合同、共享contracts/limits/descriptor、字体文件/真实cmap清单/许可证据、公共HTTP错误登记及专用reader预算、迁移/锁文件/package scripts/CI、生产构建绑定、独占3100与最终验收。

A：features/product/preview服务/repository/auth；quizpack私有资源读取门面；受控只读锁扩展；app/api/studio固定revision preview/score/resource路由；真实PG与FS失败测试。不能修改旧import read语义、旧写能力或生成假ArchiveOperation；相关共享storage-lock扩展须先给主控精确diff审阅再提交，保证原独占锁和停止协议不变。

B：features/theme/preview静态组件registry与白名单投影、features/report/preview真实PNG、features/studio/preview六状态和临时状态控制、固定revision页面入口及真实截图测试。通用UI不按productId硬编码；adapter跨模块只接显式DTO/纯输入接口，不查DB/FS。前后台共享投影函数须server-only或明确纯模块，服务端选择实际结果，客户端不能指定结论。

A依B投影的精确纯接口调用：preparePreviewContent(content, binding)得到严格入口及服务端私有PreparedPreview；scorePreview(prepared, answers, requestId)由实际评分生成严格揭晓；签发对象用私有WeakMap，不透出完整正文给客户端。接口须主控先交确定类型，再允许A/B并行；实现细节不使用全局持久化缓存或跨请求旧授权。

## 授权、资源IO与离线清理的冻结数值

当前已有studio:read允许operator/read-only访问整个运营空间，没有Product成员ACL，不声称只读自己的商品。POST使用assertStudioSource的write/api来源检查、session绑定CSRF，再进入不带writeCredentials的read只读事务；不更新session或制造业务写UNKNOWN语义。bootstrap/score发布前再开新事务核当前权限，资源按下列顺序处理；原repeatable-read中重复读不充当撤权复核。

固定修订正文/asset-set必须在服务端先核有界长度、实际SHA和严格结构，不借readReadyDraftSource重新判当前validation资格。asset解析按revision内完整Ref→asset-set成员→product_asset声明hash/blob SHA→blob目录；只投影实际核验字段，合法alias不要求source_validation_id等于本revision来源。公开历史正文接口不改。

每进程4个资源槽、等待队列0，第5个立即503/PREVIEW_BUSY并Retry-After:1；已取消未收口任务也占槽。单请求最多1个blob FD、全部最多4个；expectedBytes+1原始Buffer最大8,388,609字节，四槽原始buffer最多32MiB+4字节。64KiB读取/hash块。HTTP原起点总成功期限15秒、锁取得/单次检查≤2秒、文件核验≤5秒，均不超过总剩余期限；失败后最多观察5秒真实收口，不增加成功期限。

只增加私有StorageReadGuard，用独占max=1连接/reserved handle取得pg_try_advisory_lock_shared(72461,2)，核本连接真实共享锁；原StorageLock独占API/停止协议不改。读锁连接不绑请求abort立即end；生命周期跟实际已发出的FS任务走。每请求既有应用池最多5连接，四资源请求最多20应用连接+4读锁连接，不能把FD上限说成总连接数或整个进程内存上限。

顺序为：轻量协议检查与槽位→当前授权→共享读锁→重新当前授权和精确revision/asset-set/目录→完整文件校验→真实关闭全部FD→新只读事务最终授权→关闭应用DB与读锁→响应已验证的内存字节。只读私有目录不得调用会创建目录的ensureStorage/scanStorage。文件必须是受控blobPath、所有祖先私有、regular/正确uid/0600/nlink=1、O_RDONLY|O_NOFOLLOW|O_NONBLOCK；同一FD前后dev/inode/size/mtime、实际字节/MIME/SHA一致。

响应正文只流出已完整验证的内存，绝不边读文件边发布未验证字节。64KiB块、高水位1，若块复制每槽最多再计一个排队块+一个交付块128KiB；总槽保留至正文完成/cancel/error，不能handler返回Response就释放。总期限涵盖慢消费者响应，逾期不能继续成功输出；超过期限前已交付的部分字节不能撤回，客户端必须完整核字节数/SHA后解码，失败不发布Blob URL。

取消关闭继续操作/结果发布门，但所有已发出的open/read/stat/close Promise必须跟踪。晚到FD先登记再关闭，真实未收口一直保留槽；5秒观察超时不伪造close，不提前归还额度。锁断连时拒绝图片发布但不声称FS停止。没有新的数据库表/lease/fence/reservation/ACK，也不做在线GC或新daemon。

测试清理由同一受管server owner编排进程调用stopAndProveServerExit后得到私有ServerExitProof（WeakMap权威），绑定instance/runId/cwd及本次launch身份，再执行cleanupPreviewFixture。必须观察真实ChildProcess close、自有进程组严格不存在（身份/权限不明拒绝）、端口已释放；单独exitCode/timeout race resolve/空pg_stat_activity都不是证明。不导入带CLI main副作用的既有fixture脚本，只复用其小型OwnedChild模式。随后仍取原清理独占锁并保留所有原backends/ACK/原生control/ownership/hash/外部引用检查。proof不写可伪造JSON文件，假对象不能调用清理。进程退出事实弥补锁断连后本地读任务仍可能活着的边界。

评分是既有同步、结构有界的实际核心；请求前后检查deadline/abort，超时不发布成功。不声称能抢占执行中的CPU，本批不新增worker执行系统；不在请求内跑coverage/witness扫描。

## 协议与有限失败

固定页面：/studio/products/[productId]/drafts/[draftId]/revisions/[revision]/preview。API在同固定路径的/api/studio前缀下：GET preview读取入口，POST preview/score临时计算，GET preview/resource读取精确Ref。资源查询含完整绑定/Ref的严格序列化参数（总query≤4KiB），由共享编码器生成；不接任意path/URL/blobSha。资源禁HEAD/Range/304；成功/失败均private,no-store与nosniff，无Next公开优化。请求总大小沿专用96KiB reader，现有4KiB reader不变。

使用现有认证/来源/无权限/不可用错误语义，新增有限PREVIEW_UNSUPPORTED、PREVIEW_BINDING_MISMATCH、PREVIEW_LIMIT_EXCEEDED、PREVIEW_INVALID_ANSWERS、PREVIEW_RESOURCE_UNAVAILABLE、PREVIEW_BUSY、PREVIEW_TIMEOUT、PREVIEW_CANCELLED。错误不回显输入/文件路径/正文。入口不可预览仍显示真实原因和原文阅读入口；评分失败保留可编辑临时答案，不出现假完成；结果/报告/海报失效立即撤销。

新增测试侧server owner/cleanup函数由A提出隔离模块，主控负责接入现有独占3100/Playwright编排，不能依赖“未知已运行服务”。真实P3-C夹具清理必须通过owner证明；不能给既有CLI任意加一个布尔参数绕过。
