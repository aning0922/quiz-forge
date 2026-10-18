# P3-E 精确基线落账与内测版本封存

承接P3-D交付a66c456及其独立验收；范围、锁/保留与永久核实方案及第十节共享显示合同已通过Astra前置审查；共享显示Schema可先实施，review/version账本机器Schema仍须先提交独审再交数据/UI实施。作者已批准历史人物12题、四报告、八图作为内测基线；不重复请求同一内容/视觉批准。本阶段将既有批准精确记录到实际草稿，并封存内部版本；没有公开发布指针、生产迁移、部署、商业发布或消费者完成能力。P4内部Key将显式固定已封存versionId/snapshotHash/internal-test用途。

## 一、批准与字段覆盖

受信registry由工程内受控代码登记，不从请求或QuizPack接受authorStatement、approved=true或自报合法projection digest。条目固定原作者批准记录/时间/范围、原Markdown commit/path/rawSHA、review JSON/HTML/prompt原字节SHA、九资源槽位到八张原图的精确边、源图SHA/bytes/媒体事实，以及投影profile/version/digest。三张私有PNG和审阅包保持私有；Next只包含受信摘要和必要无秘密描述，不引用.cache原文件。原pending审阅材料保留历史，不改成已批准文件。

首款采用精确预登记路径，不实现通用运行时语义等价引擎。离线转写器先核真实源字节，再产生有版本的完整字段映射证据；经独立核验后registry固定实际canonicalContentSha256、assetSetSha256、canonicalManifestSha256、Product与九槽八图精确边。运行时只接受同一规范产物，重新核实际规范字节和所有既有资格；离线projection/profile digest是审计证据，不是另一个相似包的通行证。原ZIP仅重压缩而上述三项规范hash完全相同视为同一内容登记，但导入来源/归档仍必须各自通过原协议，不能复用原import权威。

离线完整字段分为作者语义精确比较、受控技术值精确绑定、独立资格验证。作者语义覆盖Product标题、题序/题干/选项顺序/全文、维度标签和每个贡献归属、归一化/targets或ranges/距离/平分/resultOrder、结果label、人物/报告/立绘边、全部报告段落和数组顺序、海报全部文字/娱乐说明、六状态heading/body/density/showProgress/资源边、四厅顺序/name/chapter/introduction、每题section/caption/sceneOverride、封面及全部alt。ID/版本/路径/slug/category/tags、组件注册、来源/许可/approval claim和见证输入逐项固定；没有忽略字段。拒绝重复/断裂引用；数组保持明确业务顺序，不默认trim、改标点或Unicode归一化。Schema增长须更新完整分类和profile。

任何受绑定内容、技术身份、许可或实现依赖改变，均产生新的受控条目及对应离线核验，不能接受客户端自报摘要。作者实质语义或原图改变才需要针对变更项的新人工批准；纯工程变更沿既定授权审查。只接受八张批准图的原字节，不在本批开放派生图。具体历史条目必须在离线完整映射及许可依据形成后启用，无占位成功；合成测试条目明确purpose=test/ci及非作者批准含义。

许可条件独立：v2沿用现有commercialUse/redistribution要求，不伪造两项true、不暗改准入。已确认内测视觉不额外授予商业权利，也不证明既有权利不存在。实际生成记录/适用条款/字体OFL等先核证据；首款实际包有缺口时具体列明，不能把合成夹具当其许可证明。历史product_asset的unverified与包内claim不改写；新账本只记录有范围的内测批准。

## 二、两张领域表与权威边界

draft_review保存不可变internal-test批准记录：Product/draft/revision/contentSHA/assetSetSHA/manifestSHA、registry条目与证据SHA、profile/version/projectionSHA、原作者来源与日期、运营记录人/时间、原操作key/fingerprint。首批仅record-baseline，不扩成未知内容可由operator自由批准的通用审核流程。

product_version保存不可变内部版本：UUID、Product、精确源revision及review、canonical snapshot-binding文本/SHA、全部逻辑/视觉/报告/资源/组件/engine版本和实现身份、renderer/registry实现身份、font bytes/coverage/license hash、原validation identity/policy/evidence，用途internal-test，publicationApproved=false。正文引用永久不可变draft_revision与资源声明，不另建一套可变内容副本。review→revision和version→approved-internal review/revision均用精确复合FK/约束绑定；app只有有限SELECT/INSERT，不可更新/删除。原key唯一、同一Product/draft/revision的审核唯一、同一Product/snapshotSHA封存唯一；异key重复明确拒绝，不冒充另一个key的成功。

批准语义映射由离线受控转写与独立核验完成，可信服务仅接受受信登记的精确规范hash；数据库保护其精确来源绑定、不可变保存、唯一性及事务完整性；FK不被描述为能重新执行TypeScript语义投影、证明外部授权或独立识别作者。沿用现有认证/验证服务的信任边界，不把持有完整backend DB凭据者当普通请求调用者。客户端没有注册批准、绕过服务或提供自报digest的入口。若以后要求数据库独立验证语义真实性，应另做可信精确候选登记协议，本批不夹带未实现权威。

## 三、操作协议

新增review:record-baseline和version:seal-internal权限；operator可记录服务器已有批准的完全匹配对象，read-only只读。原作者与记录人不能混为一人。请求沿既有同源/CSRF、当前授权、预算和Product gate，不向公开目录投影任何新内容。

记录与封存使用各自明确的Product内key命名空间和不同fingerprint domain；共享草稿key协议不改。请求冻结完整目标、registry/依赖身份和预期hash，不接受自由authorStatement。新申请只允许当前head；成功原key匹配优先于归档、head、当前准入及新的物理检查，直接返回原固定回执。任何失败/空读/普通409/断连不推定回滚，不自动换key/目标。新增pending须与旧first/append桶共用既有Product gate，未知锚点阻止新准备但不隐藏原请求只读核实。

只读核实在单RR业务快照查Product/key，存在先完整tuple/fingerprint比对；无key时只对可永久证明的旧head失效或唯一目标已用给严格终态，其他保持unresolved/有限错误。成功输出前另一次当前身份复核，不触session/audit。解除仅显式exact compare原锚点和代次；之后重读、新确认、新key，不自动提交。字段/字节预算在机器合同中另定，沿15s操作、2s锁/5s语句/10s事务原预算，不隐式重试。

## 四、封存与资源/实现留存

review与version的新引用写入均参加同一存储维护锁协议：初始授权/原key短查和纯映射完成后，先取得现有有界共享StorageReadGuard，再进入auth锁→Product锁的短写事务；成功原key只读重放不创建新引用，可走不含新FS核验的快路径。业务写事务还必须在Product锁前执行同键pg_try_advisory_xact_lock_shared(72461,2)，失败立即回滚不等待；沿withStudioWrite既有auth锁可先获得，但不能在auth锁内阻塞等维护锁。取得事务共享锁后再确认原guard仍有效且源精确，才写新引用。外层guard若此前失效则拒绝；此后即使guard连接断开，事务共享锁仍保持到COMMIT/ROLLBACK，禁止物理删除穿过提交窗口。review可不读取图片字节，但必须持共享守护到提交和释放收口，以便与清理器的独占维护锁及“查引用→删文件→删DB”的整个区间互斥。所有正常引用创建入口均采用这一顺序，不能只修seal；新增并发测试必须在实际引用查询后调度review写入，验证删除与新引用不交叉。

先当前授权、短查原key→固定目标与纯映射验证→获取现有有限资源操作名额与StorageReadGuard→在原始总deadline/总量预算内核八个唯一blob真实字节与九个声明关系，确认所有FD关闭→短写事务Product锁、再次原key查询、新申请head/review/hash/依赖复核、INSERT version与单条审计、最终授权/COMMIT→守护释放收口。文件IO不占长写事务，不新增lease/ACK/GC或后台队列。迟到FD/close不确认/守护连接失效沿现有读取收口规则保留未知；不因HTTP超时提前释放。

快照摘要与操作key/创建时间等回执字段分开；固定实现身份不只版本名字。受控registry按版本+实现摘要解析，后续不可将同一身份解析到改变的代码。字体按原bytes/coverage/license精确绑定；缺固定依赖明确不可用，不能退回latest。封存不是文件系统与DB原子事务，后续读取仍核固定字节，损坏不得换图或改快照。

必须给所有会删blob的维护/测试清理入口加封存引用的前置留存检查，在任何物理删除前完成；仅新增RESTRICT FK不够。各独立夹具有精确范围和真实退出证明，最终清理按依赖顺序先P3E自有version/review，再旧夹具。任何外部版本引用均拒绝且保留文件/DB，不能先删文件再让FK报错。通用生产存储域通过显式保留接口查询产品引用，不绕过模块边界到处互查表。

## 五、P4与退出

内部Key明确选择sealed internal version时固定versionId+snapshotHash+internal-test用途。未来公开Key首次激活选published版本的既有规划保持独立；本阶段不实现发Key、消费者会话、正式报告或公开分享。

先冻结准确机器Schema、错误、registry/投影字段分类与资源预算，再两独立实现流：A迁移/约束/服务/资源保留与PG，B后台/HTTP/pending/流程/E2E；主控共享接口/受信profile/依赖描述/总验收，Astra独审。退出需真实旧库升级、逐字段映射变异、并发/幂等/UNKNOWN/权限/FS收口及外部引用保护、六项工程检查、生产浏览器四宽、媒体部署新绑定与准确CI。所有结果按真实证据记录，不用人工批准取代工程验收，亦不用工程检查冒称作者新内容/发布批准。

## 六、机器合同草案及预算

所有对象strict。Product沿现有assessment ID；draft/review/version/operation key沿现有规范UUID；revision沿1..100；SHA256为小写64hex；登记id为受控assessment ID、version为严格三段版本。schema version分域，不复用首稿或追加协议。请求路径Product必须与完整binding一致。

- RevisionTarget：draftId、revision、canonicalContentSha256、assetSetSha256、canonicalManifestSha256，三hash均指该实际不可变修订。
- RegistryIdentity：id、version、entrySha256。entry摘要基于条目自身规范JSON，字段覆盖source provenance/批准日期范围/实际三hash/九槽边及媒体声明/离线完整映射证据；不包含全registry列表、构建时间或请求key。
- ReviewBinding：productId、idempotencyKey、target、baseline（RegistryIdentity）。fingerprint domain为quizforge.review-record.v1，含该完整binding，不含运行时生成id/时间。
- SealBinding：productId、idempotencyKey、target、reviewId、reviewSha256、renderer（RegistryIdentity）、engine（RegistryIdentity）。fingerprint domain为quizforge.internal-version-seal.v1。字体及六组件由选中renderer条目固定，不接受客户端自选URL/源文件；engine必须与正文对应。
- ReviewReceipt：id、binding、fingerprint、purpose=internal-test、baselineApproval（原日期/来源/范围）、recordedBy、recordedAt、reviewSha256。reviewSha固定批准的来源/registry/目标，不含记录人时间或操作key；回执仍完整保存原操作事实。内部资料原文/私有路径不进入DTO。
- VersionReceipt：id、binding、fingerprint、purpose=internal-test、publicationApproved=false、snapshotSha256、createdBy、createdAt；另提供有界snapshot详情读取。相同语义/依赖快照不同key拒绝，不返回created=false冒充成功。
- Snapshot：schemaVersion、productId、target、reviewId/reviewSha256/baseline identity、全部content/visual/report/resource/component版本、engine identity/logicHash、renderer identity及六组件精确三元组、字体id/version/fileSHA/coverageSHA/licenseSHA/weight、原validation的validator/policy/evidence/candidate身份。canonical snapshot自身不含versionId/操作key/创建时间，不允许自由额外字段。相同review可以在实际新实现条目被审查后封存另一不同snapshot；不原地替换旧快照。
- 每Product最多100 review（对应最多100修订）、100 version。限制只在新申请时检查；原key回执不受容量改变影响。数据库强约束或Product锁下唯一slot1..100，不以浏览器计数作为权威。
- request完整UTF-8 JSON ≤4KiB；error ≤4KiB；review/版本写成功或resolve封套≤64KiB；只读版本详情≤64KiB；snapshot规范文本≤32KiB；review规范批准事实≤8KiB。首批不新增无限列表：只读该修订review和最多100版本的metadata列表，response≤256KiB；完整内容仍走已有固定正文接口，不在列表重复。必要时列表容量按真实最大DTO推导，不运行时截断或假空成功。
- pending新桶quizforge.studio.review-record.v1与quizforge.studio.version-seal.v1，各沿16项/每项4KiB/桶64KiB。与旧first/append共用同Product preparation gate；其他Product的可确定合法锚点不误阻断本Product。未知格式/读写失败维持封闭，新旧协议不迁移、不自动清除。

原操作schema/domain固定head-only、单调head、唯一目标、snapshot算法及100容量的语义；将来若放宽必须使用新协议，不得使已签发永久未应用证明失效。

封存资源总预算固定32MiB、最多64声明和64唯一blob，沿包/内容现有更小限制取最小；首款八图10491566字节、最大3034825。按唯一hash顺序读取验证并释放每块，任何时刻不保存全部图缓冲；整个操作一个15s单调deadline，单文件/锁/关闭观察预算只能进一步缩短，不能逐图重新启动15s。

具体Zod/DTO命名与所有最大长度由主控先提交并经Astra审查；以上未实现，不允许A/B各自再发明不一致封套。

## 七、数据库与锁、永久核实证据

新增0017迁移，保留0016及之前所有checksum。draft_review含目标三hash、原source引用、registry/批准事实规范文本和SHA、原key/fingerprint及actor/time；product_version含精确review/目标复合FK和snapshot文本/hash、原key/fingerprint及actor/time。每表自有Product内key唯一，review目标唯一，version snapshot唯一，且version slot NOT NULL、CHECK 1..100、UNIQUE(product_id,slot)形成硬容量；全部字段不可变，app只有限SELECT/INSERT。FK精确绑定实际revision内容/资源/manifest和review，不仅绑定UUID。source_manifest若需新增唯一索引供FK引用，必须逐项guard并保留旧行；不回填新审批事实。

review与seal分别一条专用成功审计，最终授权与业务事实同事务提交。原成功key重放不新增审计；回滚不留审计；读/resolve不touch session或写审计。正常auth写lock→Product FOR UPDATE顺序沿既有协议；新的共享storage guard更外层先取得，不能在持Product写锁时等待存储维护锁。

resolve有独立operation discriminant及完整原binding：单RR READ ONLY快照读取Product→原key，存在先精确比对全部tuple/fingerprint，然后固定成功回执或IDEMPOTENCY_CONFLICT；无key时核精确基准存在及三hash一致。current大于target为obsolete；等于时，review的目标已被另一key记录，或version的同一snapshot被另一key封存，可返回target-used永久证明（包含原binding、当前观测、冲突回执摘要，且不同key、同精确目标/快照一致）。current小于target、空读、读取错误、依赖暂时缺失、缺字节或普通409都不能证明未提交。version目标snapshot须以原冻结输入/精确review及选中依赖可靠重建后才能作唯一消费证明，否则保持unresolved。先出现原key则永远优先，不以target-used覆盖真实成功。另有仅seal的capacity-exhausted永久终态：无原key、精确target/三hash及当前head可靠，且同RR读到固定协议的100个不可删除slot已满；proof含原binding、当前观测、limit=100、occupiedCount=100。普通VERSION_LIMIT、临时并发槽或IO繁忙不等于此证据。合法证据只准显式解除原锚点，不恢复已满容量的新准备。

obsolete/target-used/capacity-exhausted仅提供显式解除本地原锚点的依据，不自动再提交。history/read已封存记录不要求当前head，缺运行依赖只影响运行可用性，不隐去原记录。只读成功输出前另做新的当前授权复核。失权的迟到响应不显示可操作证明。

新增业务错误建议REVIEW_BASELINE_MISMATCH、REVIEW_ALREADY_RECORDED、REVIEW_NOT_FOUND、REVIEW_LIMIT、VERSION_ALREADY_SEALED、VERSION_LIMIT、VERSION_DEPENDENCY_UNAVAILABLE、VERSION_RESOURCE_UNAVAILABLE，并复用DRAFT_BASE_CONFLICT/PRODUCT_ARCHIVED/IDEMPOTENCY_CONFLICT等。HTTP仅明确白名单，状态/完整DTO预算在主控机器合同中一次冻结；不向客户端泄漏内部路径、SQL或未验证的hash事实。写未知仍走现有WRITE_OUTCOME_UNKNOWN封套。

## 八、最小展示实现整理与精确依赖

现有P3-C只有内部运营预览，不能将其登记成已存在的正式消费者controller。P3-E先把六视图的纯Answers类型、report/preview的有界媒体字节校验/取消/字体/Canvas与Studio认证URL适配解耦；Studio继续提供受控transport，原HTTP格式、临时体验语义与画面保持。纯显示DTO正文与draft scope封套分离；抽出受信完整ContentScore到显示快照的映射，未来P4仅服务器调用，历史直接读封存快照，不重算评分。测试保留旧preview输入/输出字节与错误、取消、释放行为。

为实际存在的internal-preview展示代码登记精确renderer entry；其能力显式为studio-internal-preview，不能授予persistent-consumer-session能力。P4实现真实持久controller及必要中性文案/动作适配后，登记新implementation entry并封存新内部版本；可以复用相同已批准正文/review，不需重写报告或改变评分。同review封存新实现仍要求其revision为当前head；不得为P4静默放宽。P4发内部Key由服务端只接受实际具备该能力的精确entry，不把预览标记“刷新重置”带入持久产品流程。

entry覆盖该实际版本的六组件/CSS/投影/海报布局/显示合同/有界共享工具闭包、组件三元组、字体文件及coverage/license/weight。评分engine单独固定精确实现摘要，不能拿规则logicHash替代代码身份。受控构建清单明确选中文件及其SHA，构建检查实际字节并且锁定相关外部依赖精确版本/lockfile选择；源commit仅来源证据。不要hash整个可扩展registry文件/全仓/所有其他条目，从而新增无关entry不改变旧entry摘要。

resolver只允许项目内编译的完整id/version/entrySHA精确命中；DB/包不能带模块路径。实现文件改变必须更新受控身份并保留旧代码，或明确将旧identity标记不可用；不得将旧identity悄悄指向新代码。字体和单个组件缺失/摘要错也不可用，没有latest或默认回退。已登记descriptor必须不可变保留，与代码执行可用性独立；旧代码不可用时仍能用原descriptor重建原snapshot及核实target-used，不让丢执行模块抹去历史身份。运行时不读取.cache原图、原始审核JSON或repo源文件来重建身份；Next只打包已校验的受信清单和代码。

## 九、阶段实施顺序与所有权

1. 主控冻结范围、DTO/预算/规范hash规则和现有批准精确映射规则；Astra前置复核。旧0016真实有谱系的隔离现场在0017实现前建立并停止保存。
2. B先提交最小展示解耦及已有预览回归；主控在实际文件稳定后登记实现摘要。A同步整理首款离线映射证据，随后按共享合同实施0017、严格schema facts/ACL、review/version事务和retention接口/真实PG。无共享文件双写。
3. 主控受信registry/规范字段和构建入口；B在共享机器合同后接新HTTP/pending/后台、实际E2E。Astra始终独立审查，不以实现作者自检替代。
4. 根统一六项检查、真实旧库迁移、真实物理维护竞争与保留、main媒体新绑定/66×3、完整生产E2E四宽图检、准确head双CI、Draft PR。P3-E完成后沿既有授权继续P4/P5，不新增常规阶段人工启动闸门。

## 十、前置显示合同冻结范围

共享文件src/lib/assessment-contract/display-v1.ts：DisplayAnswers、DisplayEntryBodyV1、ResultDisplaySnapshotV1、DisplayAssetV1、DisplayPosterV1、DisplayPosterExportBodyV1及对应strict Schema。字段完全取自旧PreviewEntry去binding、PreviewReveal去binding/requestId、PreviewPosterExport去binding/requestId；不增加旧HTTP字段，保留答案/逻辑hash、结果/报告引用及全部报告文字。共享Schema检验同一Product内引用与海报/结果关系；旧Studio封套继续以binding.productId额外约束，显示Schema合法不授予评分权威。

DisplayResourceTransport固定参数(asset:DisplayAssetV1, signal:AbortSignal, deadlineMonotonicMs:number)=>Promise<Response>；由受控Studio adapter捕获固定binding，通用层不接受客户端任意URL。DisplayFontDescriptorV1沿现PREVIEW_FONT_ASSET全部字段，仅项目注册代码构造，600字重及原文件不变，file/coverage/license均是受控本地资源路径。字体许可SHA在后续renderer登记中绑定，此前不虚造值。

浏览器基础错误类可以移动到lib/browser/display-task并由Studio沿PreviewClientError旧名重导出，以保持instanceof和可观察code一致；本次不重分类取消/超时/字体/图片/PNG错误。原15s预算和资源释放语义保持，任何已传入绝对deadline不得扩期。scorePreview继续私有WeakMap真实scorePreparedContent，再调用server-only projectContentScoreForDisplay(content,scored)得到共享正文，加回原封套；无新客户端分数入口。

此处是可独立审查的前置解耦，保持六状态DOM/CSS、文案、临时重置行为及实际PNG排版；不提前编造P4控制器。主控先提交共享Schema与旧封套组合；B随后独占theme/preview、report/preview、studio/preview、lib/browser/display-*及相关测试。A不修改这些文件，主控不并发改B所有文件。后续实现摘要以最终稳定文件为准。
