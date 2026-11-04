# QuizForge 托管开发

开发、验证、独审和收口统一遵循 [根 AGENTS.md](../AGENTS.md)。本文件的带日期条目、测试数量、全量运行和逐图复核均保留为原批次记录，不要求新任务重新执行。当前任务以用户最新授权及最新实际检查点为准；文档中的旧“尚未合并”“待实现”和阶段启动指令不覆盖后续事实。

## 2026-11-04 字体源就绪与单资源修正等待

新接线设计`6a9cb4a`待定向复核，已审B服务`3833d60`保持关闭。固定源及OFL六项实际SHA已恢复并核对；NotoSerifSC取原固定Google Fonts commit，MaShanZheng取Google Fonts原文件，Literary取LXGW WenKai SC原文件。TC查找候选SHA不匹配已保留未使用，不改旧pin。私有源/URL/SHA证明位于A树`.cache/known-ten/pinned-font-sources/verified-source-receipts.json`。

固定源TTF的3种缺glyph及2种缺U+0020反例均失败关闭且零subset输出；这不是最终语料或字体覆盖证明。字体工具profile、私有输出保护和环境已准备好，最终语料/UI文案复核后仍各font一次生成。主控最新聚焦赵云poster取景，A尚未执行素材取件或source hash冻结，待新版manifest/ZIP receipt；其余52素材B证据继续复用。新取件CLI显式要求预期archive SHA，不能因同目录路径相同而默收被替换的ZIP；不修改B所有权。

## 2026-11-04 最终十人1.5共享接线设计：待主控/Astra定向复核，未执行新准入

B已由主控明确冻结交接：`delivery-v1/manifest.json`、`archive-receipt.json`、`known-ten-resources-only.zip`；准确ZIP30,087,195B/SHA`82d84066df013eb29303ee631dfea50feb7801552e13b7e944566db56052dab2`，53资源payload30,079,293B，预留后31,406,397B。此为素材包，不是QuizPack。A可按准确输入接收；独立视觉后如改某图，仅更新受影响字节/hash及真实相关闭包。以下收口新增共享接口/可执行登记和source准入设计；本条不授新source、不填尚未存在的hash、不执行迁移。

1. **取件与内容。** A私有cache独立目录保存B原manifest/receipt/ZIP和实际解包字节，复用现restricted ZIP parser与currentResourceV3Schema；核53个完整ref及字节、10×4用途映射、13共享旧identity/图像事实保持，抽苏轼reveal和杨/唐/蔡report、姓名一个代表图实际本地decode。复用B相同输入的全53解码/姓名alpha/裁切组合证据，不重做整套B视觉。新完整content仅将已冻结十人catalog/copy与53声明接入现v3合同，24题、五维、算法/匹配政策不改，既有4344组纯输入结果按实际未变范围复用。源码不得取B review.sourceAdmission=pending当作批准。
2. **有限终态UI与字体语料。** 仅新增客户端reader model可选`reexchangeRequired`表现标志（不成为server授权），v1 host/v2 controller/共享status/千载experience从已核实的policy终态派生；未知pending保留，只能核实原请求，不能自动清除/重发或生成新completionKey。用户明确采纳原结果后按原exact pending身份处理；若原attempt已过代，不据applied-save重新启用旧题目。终态用固定文案：`题目版本已更新。请使用原兑换码重新进入；本页原操作记录仍会保留。`、`这个兑换资格已完成答题。请使用原兑换码重新进入，查看已保存的报告。`，按钮`使用原兑换码重新进入`，只链接既有`/access`，不携带Key、不自动exchange/发grant。首页/封面CTA与原兑换modal不变。上述固定语料与现全部UI/十人固定正文/题干/PNG文字、U+0020一并收入Serif/Literary/Brush各自真实使用字符集；新profile预检所有glyph/OFL/tool pins后一次subset，不覆盖旧font/descriptor。
3. **新的精确登记。** Qianzai使用已定consumer1.5.0/preview1.3.0及角色presentation.v2/copy.v3、完整3.0.0 refs，不复用1.4/旧五人selector。新runtime-inputs/字体数据/角色资料接在版本分支；baseline新增独立文件。生成新`d3-runtime-bindings-known-ten.json`，现`d3-runtime-bindings.json`保持原字节并作为历史metadata进入lookup；current registration指向新精确closure，旧tuple不获可执行fallback。engine/structured条目沿既有Schema保留语义id/version而以新entrySha形成新完整identity，原完整tuple作为历史保留；算法版本不因validator/shared合同扩展而伪变更。实际改到的v1 access gateway另新增consumer-folio1.0.3 descriptor/编译identity，1.0.2旧JSON仅保留metadata，legacy engine/folio preview未变不重封存。所有新增policy-contracts/ten-role-identity及实际transitive files/固定新fonts都须收齐；不能只修private-test首错误，不能覆盖旧JSON的hash。
4. **新实例与source。** 最终build/demo拟在新的受管worktree `codex/qztx-known-ten-final`执行，避免在A旧63234等运行目录重建；不借28267合成图谱、1ec2旧准备身份、作者或UNKNOWN。正常init选择确认空闲的专用test PG/origin（拟55537/63237，以实际管理器为准），取真实instanceId/root/marker后才生成新privateTestUse/有限identity。新authorizationId限定本次已授权工程内测，所有资源商业/再分发false、private-test-only；新source只认此准确身份+三hash+完整资源表和新baseline完整tuple，不扩大到请求/环境动态注册。
5. **准确DDL闸门。** 目录已到0032，当前下一空闲为0033，主控串行最终核号。完整content/manifest/assetSet/包及baseline/renderer字节稳定后，追加0033有限OR登记，保持旧source clauses、函数签名/owner/search_path/ACL和旧迁移字节；只更新本次有限source/资源/baseline准入函数，不改policy/auth/评分/报告快照格式。前置绑定准确0032 checksum及实际原函数body/结构。准确DDL、完整registration/provenance差异先送主控/Astra窄审，通过后只在新自有实例正常迁移；runtime catalog从该实际最终DB读出后再更新，不猜hash绕校验。
6. **可观察出口。** 字体真实覆盖、新ref/runtime选择和implementation:check通过后才build；媒体只用新root固定media scripts及原停止/封存协议。新完整QuizPack实际ZIP/文件数/大小与新封存身份核验，按真实服务走导入/审核/封存play/显式启用/资格；一条完整24题、恢复、唯一完成、报告/双PNG/原码回看及本次实际受影响异常。字体/53资源是新运行输入，需对应真实媒体/浏览器证据；B离线/进程内SQL不冒称此出口。旧报告/旧字体仍从原snapshot路径读；作者审美/实机/商业另作相应验收。本设计复核期间可继续取件、收语料/工具准备，不执行新source准入或覆盖旧运行目录。

## 2026-11-04 字体新profile准备与B交件读取

A已补Serif v13/1.12.0、editorial v6/1.5.0；后者要求逐font固定characters、--kind和私有--descriptor-out，缺glyph/错OFL/输出cmap缺字均失败，现有新profile font/manifest禁止覆盖。原editorial active descriptor不被v6生成器写回，最终候选与新版本接线另取精确文件。固定工具venv位于A树`.cache/qztx-font-tools`，无全局设置改动；静态与四输出保护负例通过，未读取真实TTF或subset。实际字库仍待最终UI语料/源文件/最终用途冻结，不把这些准备检查写成覆盖或字体通过。

已找到B的共享私有交接目录：`/Users/aipuli/.codex/worktrees/quizforge-qztx-known-ten-content/quiz-forge/.cache/known-ten-art/delivery-v1/`。仅只读确认manifest为`qianzai.known-ten-art-delivery.v1`、resources40/shared13/characterSlots10及明确非source/DB/runtime准入范围。主控已提示B还在裁切自检；A等待其最终准确字节冻结再绑定，不改B所有权、不据createdAt推定final、不把30,089,041B资源和预留预算冒称最终ZIP大小。字体固定输入与登记接点沿前一条，技术步骤无需再次找作者审批。

## 2026-11-04 B定向恢复补证及最终登记/字体输入交接

HTTP UNKNOWN P2已由`c92f7ea`修复且Astra窄复核关闭；新报告JSON单行修复`b241006`解决真实Drizzle owner端口与裸SQL serializer差异，待R只审该差异及新回执。三故障场景（未提交completion/ACK返回丢失、精确backend断连后迟到callback、启用先于最终事务）分别定向通过；v2 matching-context保存/受控完成/原回执恢复3项通过。详细失败保留、SHA、精确回执及SQL/资源IO证据分层见PROGRESS最新条目。28267正常stop，32迁移/目录保持，其他连接0；不重跑已过A10+5或六不变量。

**登记依赖已只读核清。** `.cache/known-ten/policy-registration-dependencies.json`仅比较现有descriptor与当前源码并收集实际静态依赖，不生成登记、最终source/hash或字体。原legacy archetype/dimensions/folio-preview的已列文件未变；仍可执行的folio consumer1.0.2需随新授权接线处理`contracts.ts`、v1 client/controller、errors的闭包变化（旧JSON不原地改写）。D3 engine/structured preview/qianzai preview共同受`private-test.ts`影响，并新增`private-test-ten-role-identity.ts`依赖；structured/qianzai consumer还受v1/v2 contracts、v2 client/controller、errors及新`policy-contracts.ts`影响，qianzai consumer另有已提交`report/qianzai-tongxin/layout.ts`变化。历史descriptor保留元数据，未获当前可执行绑定的仅核metadata自洽；最终不能只清掉首个private-test错误就称登记闭合。

待实际到件后，准确接点是`theme/qianzai-tongxin/{runtime-inputs.json,editorial-fonts.ts,component-map.ts}`、其封面/揭晓/报告/PNG使用点、`product/internal-versions/implementation-data/d3-runtime-bindings.json`及新baseline，必要`implementation-catalog{,-v2}.ts`/`internal-play/access-gateway-binding.ts`显式可执行绑定与source准入。现component-map仍consumer1.4.0/preview1.2.0，不能冒称已是计划1.5/1.3。`build-qztx-runtime-inputs.ts`仍固定Serif1.2.0、`build-qztx-d3-descriptors.ts`固定1.11.0；最终应新增准确版本分支/输出，不直接运行历史builder覆盖旧登记。当前字段可承40用途/完整ref，实际新增ref和53资源事实必须来自B最终交件；source迁移在已执行0032之后实核空闲号，不预填三hash。

**字体字符输入交B/主控。** 服务终态枚举已经固定，但完整原码重开UI尚未实现，故界面逐字语料还未完全冻结，不宜现在subset。现v2 controller实际可见的保留文案必须纳入最终字符源：`原操作尚未核实；请稍后再次核实，不会重新发送。`、`原操作已保留；请核实结果后再继续。`、`当前授权已失效；已保留本页输入和原操作。`，以及components/host已有UNKNOWN/denied/unavailable、恢复/退出按钮文本。版本过代/资格已完成提示和重新兑换按钮最终中文在UI接线时稳定后补入同一语料；SQL错误码、测试夹具/日志/文档文本不是产品字体输入。合并十人全部姓名/别名/固定报告与source题干/标签/导出文字，保留U+0020与标点/有效换行，不用作者答案。

Serif builder当前到v12、editorial到v5；最终追加新profile/新输出，使用现固定官方源hash/OFL与工具版本。editorial的missing现仅打印，生成前须改失败关闭。字体、coverage与源码声明/运行font/PNG共用document稳定后一次冻结、一次生成，仍不得覆盖旧font或以旧177缺字审计冒称新语料全部覆盖。此次没有字体生成或素材准入。

## 2026-11-04 批次B切片2交审与剩余运行门槛

A实现显式activation/resolve、受控exchange/save/complete/logout/void、准确attempt授权、原回执优先、跨attempt有限终态和独立READ COMMITTED锁定恢复。0030–0032已执行字节不改；consumer catalog按28267实际32迁移/27表更新，draft-schema仅同步0030扩展后的准确audit_target。SQL/服务/API验证使用原验证root/manifest，不触碰作者环境或以合成图谱准入新source；两次服务前置失败及一次report JSON参数失败均保留，修复后按原现场续验。

真实PG服务5项、SQL不变量6项（前三复用失败运行）、进程内真实PG HTTP 2项通过；精确脚本/回执、静态和定向单测见PROGRESS最新条目。0032授权续验及A10+5共享既有结果。owner核32迁移/原五行与报告不变、catalog ad236ba8…fa8d7、其他连接0并close，正常stop及端口/PID/数据保留证明在`slice2-{owner,stop}-receipt.json`；当前28267已停止。

此切片交准确diff独审，不称完整B/原生IO/Next网络或浏览器验收。待封存private-test与本切片客户端/合同闭包，最终source1.5/新字体/40用途真实输入，以及真实ACK-loss与迟到completion并发补证；当前实现登记检查失败，不启动依赖成功构建的E2E、不重写旧renderer identity凑通过。有限终态仅接识别/停止旧entry，完整原码重开UI及终止文案视觉留下一实际接线批次。主控按这些实际剩余范围协调，不重跑已通过的A10+5、47项初轮单测或未变化的历史媒体矩阵。

## 2026-11-04 0031已应用后的定向缺陷修复

准确062f245/c78cad36经Astra窄审通过后，主控授权正式0031隔离验证。28267按正常管理协议恢复并应用0031；operator越权启用及不满足account_actor资格会话的两项真实app拒绝/零副作用证明已通过。admin正例触发局部变量product与同名table整行引用歧义，失败保留，不解释为权限或环境通过。原数据库无新head/ledger/audit效果；连接close后正常stop。

0031已经执行不得改字节，故最小服务修复占下一空闲0032，只改启用函数局部selector名，绑定原0031 checksum/函数body hash前置，原授权及锁序不变。准确SHA1266d0362702472c98326deb113d980289deb1d37d7646550abd533bd6d78315；source号之后实核。授权harness保留原失败、复用两成功反例并用独立resume文件续验admin/void/ACL，未跑到项不记通过；静态仅新harness必要类型/ESLint/格式。后续按已授权本批隔离修复/服务接线持续，不升级作者环境或处理UNKNOWN。

## 2026-11-04 十人用途资源/字体/source1.5交接边界

主控转交作者“这版还可以，继续吧”：六重构稿+保留四位成为当前十人用途制作基线。此授权覆盖同角色母图的用途复用/必要裁切与姓名、报告头、海报技术制作；不要求40槽全部重画，不把衍生品工程核对写成作者逐张审美或商业批准。旧李白baked资源继续历史读取，不能套作新十人李白批准。B正在制作，A不从旧`resource-differences.json`的pending快照推翻最新作者反馈，也不从其中“current”字段自行选最终文件；必须收B确切最终版本/路径/字节回执。

**B→A交接接口（复用现有Schema）。** 以`known-ten-catalog.ts`的10个完整role ref和40个resource ref为索引，每个用途交本地最终原文件与`currentResourceV3Schema`可解析声明（ref/path/mediaType/bytes/SHA/width/height/purpose/source/license/approval）。附母图完整版本/原路径/hash、用途reuse/crop/redraw/program-nameart、父子来源链及实际生成/编辑回执；同字节跨用途复用仍按40个用途身份清楚映射，不混错角色，不冒充重新生成。姓名图5:7透明、真实alpha/可见内容范围、熟悉展示名与固定锚点合成核对；报告头/海报以同角色母图复用为先，各自标实际构图及必要差异。source/license evidence沿现字段记录工程内测授权、AI来源/程序字体来源，不凭空填commercialUse/redistribution=true。整份内测content使用现privateTestUse与一致private-test-only资源声明，不混旧实例批准；13共享项也须明确本新用途的复用依据和实际字节，不改旧声明/版本。

**预算与离线入口。** 复用`tests/analysis/qianzai-known-resource-plan.ts`的13共享+40用途、53资源/55文件基准与旧审计，未变输入不重跑。最终到件才读实际文件解码尺寸、SHA/字节/alpha/资源类型和总量；64资源/66文件、32MiB ZIP、64MiB展开、8MiB单资源、1MiB content、256KiB manifest均保持。旧共享17,899,935 B与角色原始余量14,343,777 B只是前次计划，排除ZIP头，不能据此说最终包通过；最终ZIP实算，不靠抬限额。完整报告PNG由共用document/程序导出，不作额外人物资源塞进40槽或重画整份报告；两PNG输出另按最终实际renderer验证。

**字体单次收口输入。** A收服务/UI版本终止与恢复文案，B收十人姓名/称号/引句/出处与固定报告语料，合并现`qianzaiKnownRoleText()`、supported-theme阅读文案、source题干/选项/封面/按钮/加载错误/报告与PNG固定标签；不用作者答案/个人数据。保留换行策略和U+0020，不trim掉有效空格。原1027码点、旧Serif/Literary各缺177的证据复用，但它不是加入服务文案后的最终字符集。Serif/Literary/Brush按实际使用文本分别固定characters与hash，代码点全集闭包一次冻结后各生成一次，不为每幅图反复subset。当前`build-qztx-font.py`仅列到v12、`build-qztx-editorial-fonts.py`到v5；届时追加新profile/版本及新输出目录，不覆盖旧字体/coverage/OFL/descriptor。沿固定官方源hash与fontTools/brotli版本；必须断言最终required全部有glyph（editorial脚本现只打印missing，交付前需失败关闭），U+0020在coverage内，记录woff2/coverage/license真实hash/bytes。待终止文案稳定与资源用途实际接线后才运行，不在本交接步生成。

**最终接线依赖次序。** (1)服务B/终止合同与固定文案稳定；(2)B最终40用途及13共享复用声明到件；(3)冻结字符输入→新字体→固定锚点/共用document与两PNG技术检查；(4)扩受控新十人ref/props与runtime-inputs/component-map、baseline、renderer descriptor闭包，旧版本分支保持；(5)为最终新独立内测服务/DB选择并正常创建准确受管身份，再绑定privateTestUse、冻结content/assetSet/manifest三hash与完整包；(6)主控核0031之后实际空闲source迁移号，准确DDL/diff及来源证据独审后才登记/导入/测试启用。不能把28267合成验证图谱或旧6736候选冒充正式demo，也不能提前复制旧instance marker/hash。现有runtime-inputs/builders是否支持新十人必须按真实新ref分支最小扩展，不用旧五人目录或全局宽放规则代替准入。

正式demo验收目标是新独立真实服务/DB、十人全流程、海报/报告两PNG、整包上传→检查→预览→测试启用与升级政策实际体验；每项按自己的证据层级记录。现有63230/63233/52880、旧报告及所有失败/UNKNOWN保持；工程内测授权不含main合并/生产迁移/对外部署/Release。本步仅明确交接，不生成新素材/字体、source/假hash或迁移。0031授权P1仍待准确062f245窄审，换图不触发A数据库或评分/旧媒体回归。

## 2026-11-04 切片1授权P1修正：account_actor与固定能力，待窄复核

Astra对`bf28302`指出operator helper统一放行operator/admin导致直接app EXECUTE可越权启用，且未复用当前账号完整资格。最小修正仅触及0031 operator helper及activate/void四个调用：在auth advisory内调用`qf.account_actor`，复用已设密码、身份完整、revision、当前session期限及active账号条件；私有helper增加有限capability参数，activate锁前/锁后固定`version:seal-internal`且仅admin，void固定`access-key:void`允许admin/operator，未知capability拒绝。参数不从请求传入，app仍不获helper EXECUTE；PUBLIC撤销签名同步为(text,text)，公共入口签名及其余锁序/tuple/FK/ACL/claim投影不改。不依赖TS补权限。

新准确0031 SHA`c78cad364630daa315b2289c7b0e744ee317543419d3ca7ff5d3a50495ef3d92`。本步仅与当前`role-policy.ts`和0023 `account_actor`逐项核对、四处固定调用/私有ACL签名及diff静态核对；无TS变更不重跑类型/ESLint，无新SQL执行/PG用例、无正式0031应用。旧9d7dd098回滚记录原样保留且不代表新版本通过。窄审后仅补operator直接activate准确拒绝且ledger/head/audit零变、有效admin成功、account_actor资格不足拒绝、operator合法void成功；不重跑A10+5，不进切片2，不动作者/6736/UNKNOWN。该P1先交主控送Astra授权路径窄复核。

## 2026-11-04 批次B切片1：0031受控接口与精确repository待窄审

主控转交Astra对`41d13ea`设计通过，明确0031用于B受控写接口，source准入顺延之后实际空闲号。按Sol/high实施第一切片：`0031_consumer_controlled_writes.sql`新增受控lock/save/complete/rotate/exchange/revoke/activate/void入口，内部lineage/operator/authority helpers不授app EXECUTE；无任意SQL/通用patch，过期授权flag只在私有helper中由revoke常量开启。为避免旧app INSERT绕过完成函数的grant检查，额外收紧report INSERT（source/FK guards保留，受控definer调用它们）；原三类UPDATE仍关闭。0030字节保持，新增函数受现0030 checksum与完整结构指纹`3b19480ff84e3b7300f893e081ca4bead8fb50a4e3cdaf06f1c6985c8a9b5b01`前置检查保护，PUBLIC权限撤销，管理器仅授指定入口。

exchange在Key锁内先决定report/current generation与slot、旧新两个session id，固定排序锁existing sessions后才创建不可见的新row并锁grant。计划后不重选槽：时钟越界令原0030 guard拒绝则整体回滚/BUSY，不能再补锁另一旧session。rotate独立入口也先计划再按序锁两session；后续服务不得先锁目标/原grant再调用跨attempt轮换。enable按auth advisory→fence→product/head→当前actor/session，按原operation返回旧receipt，同play新operation拒绝空增代次；save/complete独立校精确lineage、期限、current gen、CAS与canonical输入，原receipt成功只在有效读取授权之后优先。complete使用固定report composite，非任意表写；observe只有锁定/返回内部事实，不提供写mode。HTTP CSRF/source IO准入仍属切片2，不能据SQL函数存在宣称服务可用。

`consumer-session/policy-repository.ts`新增精确session/当前代次/报告原session读入口，以及受控lock/save/rotate/exchange/revoke/activate与原operation/head分读；只回server内部raw row、不冒充public DTO或TS锁凭证，切片2须沿已有领域解码器验证后接线。原readClaimMetadata改DISTINCT ON(key_id)按created_at/id确定首次认领，移除全session LIMIT51；每个Key都有确定认领投影，仅展示/禁止作废依据，不授权activeattempt。旧service调用尚未切换，完整report/void repository与HTTP接线属于下一切片，runtime catalog仍0029，不能独立部署。

准确0031 SHA`9d7dd098532af0fa3427d18ffd30c47790bb85a19f4c605785fb9d66b5368997`。相关TS/定向ESLint通过；在原owner/root绑定的28267实例正常start，最终DDL仅BEGIN→创建→ROLLBACK语法检查通过，0030结构完全恢复、连接close并正常stop，未应用0031、未更新runtime指纹。旧版及补exchange后的两份语法回执保留在验证root `.cache/known-ten/0031-rollback*.{intent,result}.json`。未执行函数行为/并发/伪造输入/HTTP反例，A的10+5不重跑；先交准确DDL与diff窄审，再按授权实施/验证下一切片。6736、作者实例、UNKNOWN及素材source准入保持独立。

## 2026-11-04 批次B服务接线设计：待定向独审，尚未实现

基线为已通过Astra证据复核的`ee1dd848`与0030（SHA`c6009e5ebbda4107b63aa475e8434a8b0a6af87cc42627ca03759987adc65db3`）；10+5真实PG及owner/stop证明复用。作者升级政策不重开，人物字图/锚点及source1.5准入独立。B仅交付不依赖最终美术的显式启用、原码exchange、精确attempt授权、保存/完成、grant撤销/轮换和有限恢复服务/API；使用隔离合成源验证，不注册假source/hash，不更改0030已执行字节。本文只作可审设计，未开DB、迁移、业务代码或新测试。

**源码核对与最小文件范围。** 当前`consumer-flow/service.ts`是v1/v2共用服务（经`current-contracts.ts`/`current-wire.ts`分派），不能只改一条旧v1 resolution。exchange先`lockConsumerSession(key)`，read authority按key取首行，`matchesKey`把签发play等同实际play；grant轮换UPDATE未写新session_id，`verifyLockedGrant`读回后就发“锁凭证”但无grant FOR UPDATE；所有这些在多attempt/新ACL下都需对应修正。

| 接点                    | 必要修改位置与责任                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 显式启用/读取原启用回执 | `product/internal-play/activation-contracts.ts`，新增同目录`activation-service.ts`/`activation-repository.ts`；复用既有service的固定源/依赖IO预检、operatorRead/operatorWrite；新增有限activate及resolve路由，集中接`consumer-flow/http/{handler,runtime}.ts`、`http-protocol.ts`、`service-contract.ts`。现play create只封存，不自动启用。 |
| 资格与attempt           | `fulfillment/access/{repository,service}.ts`、`consumer-session/repository.ts`、`consumer-flow/{authorization,service}.ts`；移除key-only/optional-session选择器，保留报告按唯一key查找，但随即使用report.session精确定位。                                                                                                                  |
| 保存/完成/恢复          | `consumer-flow/{transaction,resolution,resolution-v2,current-contracts,current-wire,contracts,contracts-v2}.ts`及必要新增policy终止状态合同；`report/persisted/repository.ts`仅接精确授权/完成检查，原snapshot/receipt正文格式不改；`fixed-execution.ts`和request-owner/sql-owner生命周期复用。                                             |
| SQL受控权限与锁         | 下一追加迁移、`lib/db/{migrate,consumer-transaction,consumer-schema-facts}.ts`及新增窄SQL接口repository；必要Drizzle声明同步，不开放表级UPDATE/owner连接给app，不改历史迁移checksum。                                                                                                                                                       |
| HTTP终止语义            | `lib/consumer-contract/v1/errors.ts`和既有handler/response；v1/v2消费者解码器识别有限新终止状态。页面视觉、姓名图/新renderer不在B；消费者UI完整重开路径留后续，B不得据API证明声称浏览器交付。                                                                                                                                               |

**受控SQL接口。** 建议六个固定职责：`consumer_lock_authority`（只定位/验证/取锁）、`consumer_activate_product`、`consumer_save_attempt`、`consumer_rotate_grant`、`consumer_revoke_grant`、`consumer_void_unused_key`。名称以实现定稿为准，权限/职责不得合并成任意command/SQL/JSON patch平台。SECURITY DEFINER固定`search_path=pg_catalog`、全限定表名、PUBLIC EXECUTE撤销、app只获指定函数EXECUTE；不信任调用方声称已持锁或自报actor。锁函数返回准确内部行事实，TS只在函数完成且同ConsumerTx中签发witness；写函数自行重新验证/幂等重入同锁序，不能靠TS witness作为数据库权限。原app INSERT session/key/report的0030 guards保留，新增attempt创建、Key签发、report INSERT前也走相应锁与授权；受控save严格限定原状态字段、canonical绑定/hash、revision CAS、原grant id/digest/session与当前期限，拒绝越界字段。rotate原16槽/8h规则不变，复用槽同时写新session_id、新grantId、新digest；旧token不能随slot变成新权限。revoke只改精确原grant的revoked_at，可处理已过期grant，幂等已撤销按原identity读回；不授读/写权限。void保留原issue binding及未被任何attempt/report认领约束。

**统一锁序。** 所有领域写：共享维护fence → product → head → Key → session → grant；consumer product/head取SHARE，启用product/head取UPDATE。非锁定credential/id查询仅作selector，锁后重验完整身份，不签发authority。operator写保留既有`withStudioWrite`外层auth advisory `(72461,1)`（所有operator先取），受控activate/void SQL入口也先重入该auth锁再取领域锁，不能只依赖TS调用方预锁；启用在product/head后取actor/session SHARE并最终再验期限/role，保留auth事务末尾touch。匿名consumer不取auth锁、不在后面反向取得它；运营play seal、issue、void也统一领域前缀，不能如旧void先Key再product，不能SHARE后升级product。`consumer_lock_authority`的observe模式取得上述锁但不先判head current，以便原回执胜出；mutation断言在原结果判定后执行。logout独立验证digest/CSRF/原grant全identity，不要求active Key/current head；expired grant仅此模式可用。需要触达旧/新两个session的轮换在Key锁之后按固定session id顺序取锁，再取grant；不得持grant后回锁session。保留有界NOWAIT/lock_timeout与owner关闭协议。数据库helper禁止通过调用参数把write变read或绕current校验。

**启用路径。** 现有`version:seal-internal`权限/CSRF，新增`POST /api/studio/products/[productId]/play-activations`和对应`play-activation-applications/resolve`读取入口，沿既有应用resolve的HTTP约定。输入仅A的activation binding（准确play tuple、expectedGeneration、operationKey）；先授权查原operation，相同binding返回原receipt，不因当前head已变化/新依赖离线改判失败。无原回执才在事务外复用当前固定source/renderer/font/assets IO预检；沿原IO owner保有resource-read guard直到最终事务和关闭交接，不把已结束IO预检当作无限期资格；最后operatorWrite/受控SQL重核当前权限、产品未归档、准确封存tuple、预检source身份及expectedGeneration，原子ledger→head→audit。audit由0030 trigger唯一生成，TS不重复append。head已经是同一play且是新operation时返回ACTIVATION_CONFLICT，不制造无变化的代次重开；不同目标正常+1，回滚旧版本不是默认功能。恢复只读原ledger并单独附当前head：receipt属于原操作，head不是其成功证明；无receipt/关闭未证实保持未决，绝不重放activate。

**原码exchange与历史分支。** 保留独立exchange预算事务且实际close后才开Key事务。digest查Key仅作product selector；拿product/head（head可缺失）再锁Key，重验digest及原issue完整tuple。先查唯一report：有报告则锁report.session，核该session原签发tuple与Key完整对应、实际tuple与report完整对应；不依赖当前head、新renderer可用性或Key expiry，未撤销Key可发原session只读grant。无report才要求原Key未过期未撤销、head存在且可用；按`(keyId,head.generation)`精确选已有attempt，否则创建空答案/revision0/空matchingContext新attempt，写原签发列与实际head tuple。禁止重签Key、续期、复制答案或从调用方接受目标play。Key锁+per-generation唯一收敛并发exchange；grant新凭据仅实际提交与owner close确认后回cookie，UNKNOWN继续沿现有secret-cookie/预算协议，不自动重试或从resolve补发grant。

**读取/写入分界。** read/reauthorize用已验grant的sessionId+keyId，不取“首条/最新”；分别校验session的key-bound签发tuple与原Key、实际attempt tuple与immutable activation（legacy0走原tuple），不是只比keyId。report/result/export严格以report.session及snapshot授权，历史缺原资源报既有DEPENDENCY_UNAVAILABLE，不转用新字体/图或重算。旧未完成session的readSession返回有限version-superseded状态；readEntry/resources/save/complete不再给旧题目入口或写权限，entry/资源body handoff前重验head（同原request owner/读屏障机制），已经发出的旧画面不能撤回但后续写必拒绝。完成且同session仍走原report-only读取；完成在另一attempt时旧grant仅得资格已完成终止状态，不能被升级成另一session报告权限，需原码exchange重新授权。save/complete最终事务先核原binding/session，再认原save回执/唯一report，未决才检查current head、Key/grant期限、revision及source。complete重资源IO仍在锁外，最终再次锁定/重验并封存唯一report；不改评分/原snapshot格式。

**对外合同与UNKNOWN。** 新增有限HTTP错误`VERSION_SUPERSEDED`(409)、`NO_ENABLED_PLAY`(409)、`ACTIVATION_CONFLICT`(409)，复用OPERATION_CONFLICT/KEY_NOT_ACTIVE/ACCESS_DENIED/DEPENDENCY_UNAVAILABLE/BUSY/OUTCOME_UNKNOWN。SQL只按明确SQLSTATE+已知message/constraint映射，不能把所有23514映为版本拒绝；驱动失联/commit或rollback未证明仍先归UNKNOWN，错误映射不得覆盖它。旧`superseded`表示同session revision被后写替代，不改其语义。新增独立`consumer-policy-resolution.v1`终止envelope承载`version-superseded`（原请求binding/hash、准确旧session/代次、authoritative current generation）和`entitlement-completed`（原请求身份、requiresReexchange=true，不夹带异session report正文或授信URL）；v1/v2原成功resolution原样保留。新session-view policy终止分支同样不塞新session state。确切旧save lastReceipt匹配先返回applied；确切complete report匹配先返回applied；同session其他完成沿旧completed-other；另一attempt完成用新资格终止envelope，不能放宽现合同中report.binding.session一致断言。

UNKNOWN resolve先保留原operationKey/completionKey/session/binding，按原回执和唯一report只读核对。无结果时，仅普通读看到新head不够：执行独立READ COMMITTED读写事务中的受控锁定观察（仅取锁、不改领域行；不能在RR read-only事务中执行FOR SHARE/UPDATE），拿到product/head→Key→原session/grant并确认原结果仍缺失；启用已线性化且旧写不可能再提交，才给确定version-superseded。缺head、锁忙、提交/连接关闭不明均保持UNKNOWN，禁止生成新completionKey或从恢复补发grant。旧grant已失效需重新授权，权限不足不泄露结果；无权时不可据此推断原操作失败。数据库屏障只证明DB效果，不证明旧ResourceReadTask已close；原file/owner/quarantine证据独立保留，不制造fileStopProof或处理6736/63226现场。

**迁移、可运行边界与验证。** 0030不改；受控函数/ACL/必要状态合同需新追加迁移。当前正式目录到0030，服务迁移建议占下一空闲0031，原source预期0031再顺延，须主控在实现前串行核号，不自行冲突落盘。只有函数/ACL/schema事实及服务接线在隔离环境共同具备后，才从实际新catalog生成runtime指纹；不能先单改指纹或恢复app UPDATE宣称可运行。B首个可验收切片为受控SQL/锁与精确repository，第二切片接enable/exchange/save/complete/logout/resolve/API；仅补直接输入变化使A证据失效的反例，不重跑原10+5。必要真实PG：禁用/权限与启用CAS/同op冲突；complete先赢和enable先赢、并发兑换收敛同attempt、16槽跨attempt身份；过期/已完/无head历史授权、旧tab严格拒绝；ACK丢失读原receipt、迟到写屏障、SQL/IO关闭分离。API实际调用覆盖v1/v2及历史/跨attempt终止解码；浏览器全流程/素材最终闭包属后续，B不冒称通过。新测试实例仍按原manifest/root正常管理，验证root28267已停止且保留，仅按明确测试计划启动或另建实例，不复用6736失败为干净基线。设计通过后切Sol/high实施，不扩运营后台/多商品迁移平台或最终美术准入。

## 2026-11-04 批次A独立数据库验收完成，配套runtime仍未交付

Astra已对准确`fdcdbb0`的两P2窄复核通过，主控授权后在新root/instance `28267eb19487c265372bdb7671caac89`原0029合成legacy基线上应用正式0030（SHA`c6009e5ebbda4107b63aa475e8434a8b0a6af87cc42627ca03759987adc65db3`）。正常stop→同分支ff已审提交→核hash→start→一次迁移/反例，manifest/root保持。主harness 10项检查与两修正专项5项检查真实PG通过：旧行/原报告/29回执精确保持，完整签发FK/不可变activation FK/原final FK保持；严格superseded、双直接app INSERT无排他升级、旧/过期grant纯注销及篡token失败均有对应SQL证明。原设计、契约及无关静态按输入复用，具体命令/限制见PROGRESS最新条目。

`final-policy-owner-receipt.json`确认30项checksum、原五行及canonical报告、目录SHA`8b559565a5cc2682936b9e6717d6aedebb974bb061da0f83ebcd902073cf033e`与夹具前一致，app三个UPDATE仍关闭，其他owner/app连接0且连接close。随后正常managed stop，`final-policy-stop-receipt.json`确认55536/63236无监听、postmaster.pid消失、PGdata/manifest/admin/runtime保留；全部回执位于验证root `.cache/known-ten/`，6736候选失败与作者/UNKNOWN不动。

批次A到此收口。本结论是DB schema/guards，不是完整新版流程：runtime全局catalog仍0029，启用/保存/注销受控服务入口、精确session定位、业务UNKNOWN恢复及UI未接线，不能单独部署。无新source/字体/renderer登记、无生产迁移或main合并。后续B–D不在此批内，按既有授权另行协调，不让人物风格修改触发数据库准入。

## 2026-11-04 新0029验证root与owner交接

主控授权准备全新managed实例，正式0030继续等`fdcdbb0`窄复核。新root `/Users/aipuli/.codex/worktrees/quizforge-qztx-policy-a-validation/quiz-forge`、分支`codex/qztx-policy-a-validation`从pre-policy `1409761`正常建立，只含0029；正常init生成test instance `28267eb19487c265372bdb7671caac89`/PG55536/origin63236，manifest根从未改写，未开应用。沿既有合成夹具建立一未完/一已完资格，Key2/session2/report1，原29checksum/报告原文hash/无policy表已核实，期限不续，其他app/owner连接0、连接close确认。原始intent/seed/owner回执均在该新root `.cache/known-ten/`；准确hash、安装及失败说明见PROGRESS最新条目。

此项只证明正式验证前置就绪，不是0030/业务反例通过。后续须在该root保持owner身份，核准确reviewed代码与0030输入后再执行；不改6736候选回执、不删结构凑基线，也不把B修图接成DB/source准入。当前A主实现树仍`codex/qztx-known-ten-integration`，DB验证树独立且尚停pre-policy提交；主控应按两树实际状态协调，不能从当前sidebar/cwd推定目标。

## 2026-11-04 实际DDL窄修交接：两P2与版本负例身份

Astra实际审`e8dea73`后指出Key INSERT在product/head SHARE后再取product UPDATE的升级问题，以及过代/期限检查早于纯logout导致原grant不能撤销的问题。准确0030现仅修这两段：归档在已持product SHARE下读取；原grant身份与父锁确认后，整行除revoked_at外不变的纯撤销先返回，签发/轮换才校current attempt/原report。直接app UPDATE权限保持关闭，未补后续service或UI。

反例harness补精确错误消息：旧session写要求`23514/VERSION_SUPERSEDED`，不接受其他约束失败作版本拒绝证明；相关过代/完成资格反例同样核有限错误身份。新DDL SHA`c6009e5ebbda4107b63aa475e8434a8b0a6af87cc42627ca03759987adc65db3`，正式0030仍未执行，交Astra仅窄复核两P2。仅修改harness的必要静态检查，既有契约/只读比较器证明复用；真实写库反例仍未通过。主控现要求停在安全提交边界，后续其协调全新自有managed实例与legacy合成基线再做正式0030验证；6736候选/失败/manifest/root及所有UNKNOWN原样保留，不删结构或改回执凑成功。

## 2026-11-04 比较器失败关闭为工具诊断，正式0030及业务反例仍未通过

首项失败已定位为Drizzle保留PG timestamptz原文与原始postgres-js Date/UTC JSON之间的表示差异。独立只读REPEATABLE READ事务以SQL原生`IS NOT DISTINCT FROM baseline::timestamptz`核对两Key/两session/一report的每个时间列，非时间原字段/canonical TEXT逐字核对，全5行无变动；再以每行+1微秒的5项只读反例证明不会放过微小时间变动。完整原始before/两种after/NULL等值及原失败hash另存`.cache/known-ten/policy-draft/comparison-diagnosis.raw.json`，原失败现场不删除覆盖。工程harness已接同一精确比较helper，不采用JS Date归一化作为断言依据。

这只关闭比较工具问题：未重放候选升级、未执行正式0030、未跑后续写库反例；新库head/activation/grant/新attempt均0，核对连接close已确认。0030实际DDL审仍以`e8dea73`/SHA`caafe67ed831c10deee98bd27f367e872d667aedd678293618f4eb2b9c475816`为准，本工具修复不改该输入。候选`test_consumer_latest_policy_a`回执保持；迁移器严格前缀匹配不能把它当正式0030或改名凑成功，后续实例/历史衔接需主控收口。

## 2026-11-04 最新版答题批次A：准确0030待实际DDL独审，非完整交付

主控已转交Astra对`fbca479b`设计的通过结论，授权Sol/high实施最小批次A；落实历史完成分支先于head/新依赖、session必须精确定位、UNKNOWN原回执优先、DB锁序与不可变activation引用四项。主控另已核目录仅0001–0029：正式分配`0030_consumer_latest_attempts.sql`给policy schema/guards，旧source0030预留取消，source准入顺延到后续实际空闲号（预期0031、冻结时再核）。旧迁移字节及原校验回执不改，不把source/hash混入policy。

**本批可审范围。** 0030新增不可变`consumer_product_activation`与显式head，ledger触发器按fence→product排他→head排他核CAS/当前operator/session后原子写head/receipt/audit，代次递增、不删除或复用。session以generated coalesce列保持原Key完整签发tuple FK，以独立实际play FK及不可变activation ledger FK约束新attempt；原完成最终状态FK/报告key唯一保持，legacy行不UPDATE回填。共享代码为独立activation/attempt契约、Drizzle字段、封闭namespace与迁移ACL；无启用service/API/UI、无新source/renderer或报告格式变更。

**运行前置与锁序限制。** 这是Draft内部schema准备，禁止单独部署到现有运行产品；没有默认head，旧单session/gen0 writer不兼容。为避免BEFORE ROW UPDATE已经持tuple锁却假称product先锁，app对session/key/grant的直接UPDATE权限收紧；未来配套受控写入口必须在DML前完整拿fence→product→head→key→session→grant。当前guard只给新INSERT按此显式父锁顺序取锁；可信owner原始UPDATE的上级取锁为NOWAIT失败关闭，不能冒充已实现服务锁序。head/activation对app只读、不得直接启用；历史完成grant分支先按原report.session定位、可无head，保留expiry后回原报告。runtime全局schema指纹仍留0029，0030库不会被旧runtime当作可用；其精确新指纹与配套service接线/UNKNOWN/浏览器批次未完成，不得称为可上线升级。未改作者63230等库，原1ec2身份/root保留。

**实际数据库状态与审查衔接。** A按原root正常init自有`6736f75ceb805215b1c7daab651450d7`/test/PG55535/origin63235，旧29迁移和合成未完成/完成基线先建立。编号到达前，使用迁移器显式definitions入口提交当时DDL初版的`test_consumer_latest_policy_a`候选回执；正式0030尚未执行。首个旧行比较因驱动+08文本/UTC ISO表示差异失败，未记通过；随后只读核实5条原Key/session/report既有字段时间instant一致，binding/receipt/report canonical TEXT逐字不变，原29回执不变，head/activation/grant/新attempt均0，其他app/owner连接0，owner连接已close。回执与失败保留在`.cache/known-ten/policy-draft/`及`latest-policy-check.failure.json`，不删除或将候选回执改名成正式0030。初版候选DDL SHA`74ab43dbd37bb372a5b27ea7eda99fea12b5399aad3eb569aca5174f5708c1e1`保留；正式0030额外对operator/session取SHARE NOWAIT锁，使并发禁用/撤销不能穿越最终授权检查，准确SHA`caafe67ed831c10deee98bd27f367e872d667aedd678293618f4eb2b9c475816`，该正式版本未执行。真实反例尚未跑到，准确0030与测试harness先交实际diff独审。该库已有独立候选历史，正式0030的实例衔接由主控确定，不能改历史凑成正式成功。

## 2026-11-03 最新版答题与历史只读：定向设计待Astra审

作者政策已确定，不再询问同一选择。仅同商品当前启用的完整包可开始/继续答题；切换使旧未完成会话失效，原未完成Key权益可重新进入新版；完成过的Key只返回原不可变报告，原人物/分数/文案/资源与链接授权回看/导出保留。上传/检查/预览/显式启用沿现运营流程，扩人物由Codex交付新版整包，不新增人物管理后台。本节是提交定向审的最小方案，尚未改生产协议/SQL或激活任何实例。

1. **现状与新增状态。** 当前没有权威启用head事务；`access_key`签发binding固定play且不可改，`consumer_session.key_id`唯一，`quiz_report.key_id`唯一并精确关联完成session。新增商品级`consumer_product_head`（product主键、准确play id/hash、单调generation）及append-only启用operation/receipt ledger（product+operationKey唯一、完整binding、actor、receipt/hash）。新head由显式有权限操作创建，不按createdAt或最大slot自动选“最新”，未启用时不开放答题；上传/封存不自动切换。沿当前`version:seal-internal`写权限/CSRF与新明确启用审计，不借“创建play”事件冒充切换；审计enum如需增值按既有分步迁移方式串行编号。
2. **Key与尝试分离，保住外键。** 不改原Key的id/digest/签发binding/play/期限/撤销状态，也不创建派生Key伪装重发权益。session允许同Key多个版本尝试：替换key_id单列唯一为`UNIQUE(key_id,activation_generation)`，原session id/play/答案/回执不改；旧行generation=0，新尝试只准当前head generation。新增新尝试的原签发play id/hash列（旧行为NULL），再用生成列`COALESCE(原签发列,实际session play列)`承接原Key完整tuple FK；CHECK区分legacy0与新尝试必填签发列，实际session目标另设准确play FK。这样不用对已完成session执行回填UPDATE，旧关系不退化成只核keyId，现有report最终状态FK与`UNIQUE(key_id)`继续保证一个权益最多一份报告。session创建后generation/签发关系/实际play均不可变；gen0新插入拒绝，旧行只供历史读取/原回执核实。
3. **切换事务与锁序。** 启用先在事务外完成当前operator/候选完整包与可用renderer/source预检，最终事务重验。所有答题写入、兑换创建、Key签发/作废按同一顺序：既有共享维护fence → product行锁 → 商品head共享行锁 → Key → session → grant。消费者写取product共享锁，运营修改/初次启用取product排他锁；所有路径顺序一致。启用持同fence/product锁后取head排他锁，核expectedGeneration/目标完整tuple、当前权限、未归档/依赖可用，再原子写head、幂等receipt和审计。切换不扫描改写所有Key/session/grant。相同operationKey+binding只读原回执，改binding冲突；并发启用CAS只一个成功。不允许静默降级或按错误target回退旧包，回滚政策另有明确操作才设计。
4. **旧标签页与线性边界。** save/complete最终写事务及数据库防护都核head generation、session实际play、Key期限/撤销、grant/CSRF、原revision CAS；不能只在请求开始或前端检查。启用排他锁等待已持共享锁的写事务结束：完成先提交则其原报告永久胜出；启用先提交则旧尝试后续save/complete失败为VERSION_SUPERSEDED，无部分完成/新报告。save先提交但未完成也不得继续旧版，原save回执仍为applied。耗时评分/资源IO仍在原owner阶段/域锁外，最终再次核head；不把request timeout当未提交。旧页面只显示版本更新/重新开始或原报告，不回传可继续答题的旧entry；完成后仍禁止改写/第二份报告。
5. **资格重开沿原exchange，不增人物/权益后台。** 使用原兑换码，持head共享锁后锁Key，先查原报告：有报告直接授原session只读grant，不能转unused或发新版尝试；无报告且原Key仍有效/未撤销，则取当前generation已存在session，或原子创建空答案/revision0/未选择的新session。唯一(key,generation)使双标签/并发兑换收敛同一尝试；不自动搬答案或gender context。原expiry/撤销/风控与兑换预算保持，不自动续期或把过期权益变有效。旧session/grant不改绑；新grant完整绑定新session并沿原16槽/8h规则生成，旧token绝不能因换slot变成新版权限。重开入口提示用原码进入新版，不新增可任意指定目标play的请求。原签发/作废operation仍按原binding恢复，不能把历史回执解释成当前目标。
6. **UNKNOWN恢复。** 先按原operationKey、session、binding只读核save/complete/启用回执；提交成功就认原成功，不能因已切换改判失败或重放到新版。启用也可能ACK丢失，必须读原启用ledger并同时报告当前head（可能后来又升级），不可盲重启用。原complete未决时先核唯一report；若新head提交屏障与锁顺序已证明旧写不可能再提交，可给原操作确定的superseded结果，再允许原码exchange；证明不足保持UNKNOWN，不自动重开或生成新completionKey。数据库效果证明与ResourceReadTask/连接实际close证明分开，升级不制造fileStopProof、不清理隔离/预留、不绕过原owner收尾协议。兑换自身UNKNOWN沿既有预算/secret-cookie处理，不自动重复请求或从read补发新grant。
7. **历史报告与资源。** read/report/export先按报告原key/session/play/snapshot授权，完成分支不受当前head限制；保存/完成分支才要求当前head。现exchange已支持已完成Key在expiry后回原报告，保持此语义；grant仍有原授权期限，原链接若需重新授权应回同报告，不变成新答题资格或公开链接。新runtime仅提供历史report/result/export读路径与原字体/素材/profile/copy，不能让旧“继续答题”入口复活，也不调用新评分或AI重算。当前retention会保留全部play/Key/session引用图，本批不削弱或清理；待历史读闭包及report/原session FK、原回执/UNKNOWN所需图确证后，才另批裁掉无引用旧答题资产。此政策不是立即删除作者数据/旧源码/实例的授权。
8. **代码与迁移范围。** 主要为internal-play启用service/repository/contracts/现详情动作；access及consumer-session repository；consumer-flow authorization/service/resolution、有限错误码与controller“重新开始”分支；历史只读resolver/export/resource retention审计。新增当前head/启用ledger、session代次/签发生成列与FK/unique及相应DB guards/ACL/catalog facts；不改既有迁移字节或报告snapshot格式。下一空闲迁移号由主控与source准入串行收口，不能擅用尚未冻结source的0030模板。新隔离实例仍须从其原受管root/admin/manifest打开，不复制改root；旧63230/63233/63234、作者记录与63226 UNKNOWN保持。

**独立验收批次与必要验证。** A：先审schema/完整FK/锁序/错误与回执合同，再在授权新隔离库用合成旧未完成/已完成数据验证真实升级：旧报告hash不变、旧session/Key回执未改、跨商品/未知head/非法gen插入和直接SQL旧写反例拒绝。B：启用+exchange/保存/完成真实PG并发，覆盖完成先赢/启用先赢、保存先赢、双兑换同尝试、并发启用CAS、跨多次升级及过期/撤销/已完成码不得再领新报告。C：ACK丢失/事务回滚/连接未关闭等定向故障，验证原key恢复、迟到写屏障、UNKNOWN不重放与旧保留协议；不重复无关媒体矩阵。D：新runtime仅一条受影响实际浏览器链：旧标签提示→原码新版空白开始→唯一完成，加历史原链接/人物分数文案/PNG读回及缺旧字体/资源反例；不跑全套E2E。已有copy/4344匹配/首样/字体准备按输入复用。当前仅提交此设计供Astra定向审；批准后按批次实施，不需作者再次确认已确定政策，不先执行持久化修改。

## 2026-11-03 知名十人首样接线

A在同一新树接B苏轼棋局/杨玉环舞姿原母图，独立63234供原图与production CSS安全区同屏核看，未编辑/批量派生/授信。两张390px及代表桌面已实际查看，5:7姓名180×252和姓名/红章/竖句框位一致，无横溢或页面错误。空框不冒充已交付字图/引用，about说明未批准边界；新review组件不接正式runtime，原UI/CSS/字体/登记保持。实际路径/hash/截图/owner及未验证项见PROGRESS最新条目。阶段1与本步交Draft PR54，等主控/作者首样反馈再决定后续美术，63230/63233/新test/UNKNOWN不动。

## 2026-11-03 知名十人阶段1实施

作者确认并开始后，A独立`codex/qztx-known-ten-integration`基`f08f8ff`接B `4130c44`/`64dc748`新目录及熟悉展示名，new ref3.0.0；B继续持人物资料/设计坐标/私有图包，A持共享选择器/评分映射/后续预览。A用目录驱动通用ref/性别选择和候选评分映射，不动24题/算法/73资格。复用4344组原有界合成输入，真实男女any均观测全员获胜，any近邻3308/4344须保留，不据胜率改名单/坐标；2目录测试和相关静态通过，具体证据及工具失败修复见PROGRESS最新条目。

quote现字段足够史传/他人引文，无需先改schema，首样可见署源避开原锚点。阶段2只接苏轼棋局/杨玉环舞姿母图和必要基础资料先预览，作者看前不批量/冻结source。旧63230/63233与UNKNOWN、新test管理身份保持；无0030、导入、正式登记、构建或部署，不把阶段1说成十人正文/美术验收。

## 2026-11-03 阅读候选分组修复

主控实看发现每主题拆四块造成回退，A仅修review wrapper为一主题一张既有card，四短段/三有限强调标签，完整保留新解释、人物呼应、条件和小一步及原snapshot。neutral/正式reader/layout/formatter/fonts/登记不动。修后wrapper2项与静态通过；只补A窄屏/桌面、A/B长图3/1卡实际核验，原其余证据复用。新图在`.cache/evidence-readability/one-card-fix/browser/`，63233保持，旧提交/初图保留；现PR53补小提交，具体尺寸/hash见PROGRESS最新条目，待主控/视觉复核此修复后收口，不扩优化。

## 2026-11-03 报告阅读候选集成

主控依据作者参考站研究授权本批，Astra确认local review显式v3边界。A独立`codex/qztx-evidence-readability`基`1b55073`；B两文件纯模块`97f339b`及收窄修复`e8a401e`已集成，B6项测试/静态直接复用。A只增review wrapper及其2项本地真实样本/未知源测试；正式reader/layout/v2 copy/fonts/登记保持基线，无闭包文件差异。三份既有李白3/1/0支持合成输入复算hash一致，不重跑搜索、不读作者记录。前后具体例句、实际UI/PNG与未运行原因见PROGRESS最新条目。

独立63233提供`/content-review`原review前后对照、真实reader及纯Canvas；仅候选document标v3，不冒称正式1.5/source或数据库导出回执。每条实际主题只携一份原snapshot，已有文学呼应/反证/neutral保留；按阅读层次展开会增加长图高度。新名单、图样/专属正文、准入/0030/部署继续暂停；63230及63226 UNKNOWN保持。工程/助手图检不代替作者内容、实机或商业批准。

## 2026-11-03 新隔离身份交B离线组包

主控授权A按正常受管init生成新test实例。实际instance `1ec2da760d5ccc0aa38664bcc4aefca6`、origin63231、PG55531、DB marker `quizforge.p2a.v1:1ec2da760d5ccc0aa38664bcc4aefca6:test`及授权标签`qztx-historical-ten-private-20261103`已核真实manifest/root/admin/DB；既有29迁移checksum一致，业务表空。精确tuple编译在`private-test-ten-role-identity.ts`，五字段scope在本树私有`.cache/ten-role-integration/test-identity-scope.json`；B接必要shared提交即可离线parse新marker，不借旧实例。

A只扩精确candidate marker语法，未注册source/资源/baseline/renderer，未写0030或用占位hash。8项直接相关marker/旧final测试及静态检查通过；详情见PROGRESS。新PG运行中、63231未起应用；旧63230与UNKNOWN保持。源与美术最终冻结、精确0030独审/迁移仍是后续步骤，本轮身份准备不授予正式运行或旧试稿准入。

## 2026-11-03 历史名单与六位正文增量

主控确认男李白/苏轼/王维/辛弃疾/白居易、女李清照/薛涛/谢道韫/班昭/秦良玉名单独审通过。A只接B `8521194`的三份纯资料文件，聚合仅六位已完成历史正文；不接旧小说/传说导出、研究脚本或source组装。B继续交新名单正式contract/roster及四位替换正文；A不抢改B所有权文件。最终入口须精确拒旧名单，现无可执行新source入口/登记。美术未冻结，故不进行PNG、准入或新库迁移，63230保持；范围与未运行原因见PROGRESS最新条目。

## 2026-11-03 作者纠偏与旧首例停止

A曾接入B旧候选`9fe2f1e`→`02ab1c3`。作者最新限定女性向古偶、人类、仅真实历史人物；小说及传说候选暂停替换，等待B新名单。孙悟空资料/四槽仅保留私有试制，不注册新source，不作为未来十人的视觉证明；未提交selector移出生产目录，不为废弃方向补测试或PNG。历史试制发生过的姓名框冲突及通用228→204修复、11项layout通过记录保留；该通用几何仍待真实历史角色素材实际核验，不能宣布未来效果通过。

不再放行旧名单批量制作。A继续可复用的新版本类型/准入结构，最终source严格限定新冻结真实历史角色，不为小说字段扩展额外运行能力。最终资料/资源声明/授权/source/baseline尚未冻结，不预填hash、不建库迁移、不启renderer；精确SQL仍待独立审查。详细旧试制回执与未运行边界见PROGRESS最新条目。旧63227/63230等运行树与63226 UNKNOWN保持。

## 2026-11-03 十角色共享接口准备

A独立树`codex/qztx-ten-role-integration`基于PR52@1f2177b，主控确认1.5 consumer/1.3 preview、新角色presentation/copy及独立source门控；Astra通过最小设计，最终SQL另审。A先交`classical-edition.ts`类型接口，B只供新角色资料/copy/语料/私有图包，A负责可信绑定和共享登记/字体/源准入。当前不启用新renderer、不填hash、不改DB，不在63230运行树改动。阶段检查与范围见PROGRESS最新条目；待B数据及最终封存事实逐步集成。

## 2026-11-03 1.4真实接入里程碑

A在独立`codex/qztx-v14-real-integration`（基PR51@6a1e9f4）接入63230真实隔离test库，复用0029/同source/33封存资源/原review，正常重新登录同一合成操作员后新封存版本、新play和Key。Astra确认正常登录路径；未调用fixture插账户/session，未扩大构包/validation origin能力或修改旧managed manifest。consumer1.4 entry保持b88be4dd…b4809。

真实完整24题、恢复、唯一完成、六卷/新解释/五维、双PNG、原Key同snapshot与精确origin/cookie-path反例通过，细节见PROGRESS最新条目。63230为新统一真实体验，63227旧1.3及其旧资格/report保持，63228模拟和63229无DB公开SSR仍独立；63226 UNKNOWN不动。最后签发未使用独立作者资格至本树0600私有HTML，未上传秘密。主控协调最终独审/集中体验，十角色内容由B另批输入，不进入此次运行接线。未合并/部署，不追加全量验证。

## 2026-11-03 封面上滑等价要求

作者明确CTA或封面上滑均须打开同一PR50原兑换窗，成功后仍沿原controller；不能绕过资格。A核现有单指56px/纵向1.25倍手势已接同一openRedemption，实际Next63229原生移动触摸输入及防误触反例通过，仅补现有记录，不重复实现手势、不增桌面wheel、不改runtime或重建。精确范围与回执见PROGRESS最新条目；原窗更正及63227/28/29边界继续有效。

## 2026-11-03 补足真实SSR宿主证据

主控明确授权因Next hydration缺陷补一次真实生产宿主路径。A在独立树必要build，以63229只承载公开营销页验证，无DB配置/Key/native；发现并修正hydration前坏图onError遗漏，正常与失败时序均实际通过。最终build yPrvKlZ1c0emWCSYFQ3FK、截图与回执见PROGRESS最新条目。63228仍为合成答题/报告候选，63229为真实Next公开SSR，63227仍是未更新旧作者runtime，三者不混称。

## 2026-11-03 作者更正优先：原兑换弹窗保持

作者确认上一轮码页评价为看错，撤销重设计。A恢复PR50原弹窗及流程：主页→千载同心封面→点击开启→原兑换窗；保留过场全屏、减少动效、人物解释及真实图片就绪补核。不得再次把主页点击变成兑换窗或另开码页。只读复现63227公共封面图完整而ready=false，与63228候选ready=true分开记录；截图本身不能绑定origin。演示返回链接修为`/platform`，本批只做导航/缓存/缺图及src切换的定向验证。详细证据见PROGRESS最新更正；旧作者runtime/UNKNOWN保持，未新增数据库、迁移或准入。

## 2026-11-03 作者反馈候选分工与交付

A独立树 `codex/qztx-entry-viewport-fix` 负责码页/缓存封面/三幕覆盖、共享字体及精确登记，并集成B `baae5df` 的“为什么像人物”共享正文。主控协调；独立视觉聊天检查受影响真实候选和原型，Astra只审本批差异、减少动效P2修复及身份边界。B18项内容验证复用；A仅补身份/绑定9项、相关静态与合成浏览器/PNG路径，不另开数据库/媒体矩阵。

候选63228为真实组件/评分/Canvas＋合成会话，consumer1.4.0、Serif V12/Literary V5、旧Brush V4；旧1.3.0报告不升级。原63227作者实例/源码/Key和63226 UNKNOWN不触碰。范围、精确entry、浏览器与未运行原因见 PROGRESS 最新条目；仅新Draft PR交付，main/生产及正式runtime替换仍待对应授权。

## 2026-11-03 最终独立集成与临时体验交付

独立 A 在 `codex/qztx-final-integration` 保留历史整合 PR33、PR49 与 B 定稿正文/图包；主控协调，Astra 审查0029、schema-facts、四槽清单修复与最终实际回执，B只读复核实际PNG/截图，不重跑浏览器。最终差异及精确提交/自动CI见 [Draft PR #50](https://github.com/aning0922/quiz-forge/pull/50)，完整结果与限制见 PROGRESS 最新条目。

交付边界为：**一条修复后的完整24题真实UI流程**（首页/恢复/唯一完成/六卷/双PNG/原资格只读），以及**五角色服务合成witness封存后的真实浏览器/双PNG**；不称五条完整UI答题，也不称作者视觉、实机或商业通过。最终consumer entry `9732bdfd555a05ceb412ee8c8918fa9a8b076b6acff38a6035a08dd4bb4aadbe` 与 build `KXq_tK62aCBrap2QOJWmG`、新play和回执一致，原失败report/play/Key不改。

原定63226 validation保持revision1/held/UNKNOWN，无DB fileStopProof ACK，不制造证明、释放预留、删除文件或另发validation。停止候选/原pack/日志/原build和seal原字节保留；PID退出或lease过期不构成恢复证明。主控与独审明确允许原63227在同一origin/source/隔离DB身份下作为临时体验环境，不能称63226已恢复。所有自动驱动/故障注入结束后，以正常服务签发独立未交换作者资格，私有 `.cache/final-integration/author-experience.html`（600）含新资格及五角色只读入口，不入Git。服务归属与固定runtime config见本树 `server-owner-corrected.json`。

正常重启仅在该自有63227进程已停止、端口归属确认后进行：从集成树根使用原 `.cache/p2a/79331f888c569d9fbf7a2a08e5f33f68/runtime.json`、原 `.cache/final-integration/platform-art`，执行 `QUIZFORGE_P2A_CONFIG="$PWD/.cache/p2a/79331f888c569d9fbf7a2a08e5f33f68/runtime.json" QUIZFORGE_PLATFORM_ART_DIR="$PWD/.cache/final-integration/platform-art" pnpm start --port 63227`；不重建、不迁移、不切origin。原作者服务、旧工作树和旧答案/资格保持；旧合成grant只读被拒原因未确认（存在8h期限线索），没有续期或重放。main合并、生产迁移/部署、商业发布及63226后续维护仍需各自明确授权。

## 2026-11-02 报告内容与长图专项收口

在第2项内容验收中按作者反馈插入本批：独立 A 完成紧凑五维长图及人物姓名去重（4731002、093ac2d）；独立 B 完成五角色小传、建议和三句寄语（0d7e710）；主控在 `codex/qztx-report-depth` 集成字体、实际网页与 PNG 验证，Astra 复核对应差异和最终图。详细结果见 PROGRESS 最新条目。不重跑未变底层合同、不扩大到新人物美术或正式接线。63224/63225提供独立体验与对照，待作者体验反馈；本批不合并、不部署生产。

## 2026-11-02 首款可交付版本接续计划

作者确认当前界面基本可用，并授权主控按计划实施。基线 `4106d1d`（PR #47），独立集成 `codex/qztx-delivery-prep`。保留63218/63219及所有旧环境；当前UI作为阶段基线，只修实际缺陷，不继续泛化重设计。

| 顺序 | 执行内容                                                                           | 可验收出口                                              | 依赖与边界                                                 |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | 定位PR47四个CI失败，保留身份/状态反例；梳理PR32–47依赖                             | 定向修复、自动CI事实、可合并顺序                        | 不合并/关闭/重写旧PR，不改main或作者实例                   |
| 2    | 核对五角色固定资料与动态文案；生成每角色两种真实可达的合成评分样例，三载体并列验收 | 可切换角色/结果的本地内容验收页、覆盖与缺口说明         | 作者确认内容后进入定稿；不伪造角色/分数、不使用作者答案    |
| 3    | 沿已确认视觉为未齐套角色制作线上母图、报告/海报衍生图和姓名字图                    | 每角色完整资源及页面效果，明确来源/审核状态             | 主控在线生图；固定封面/三幕/公共UI保持，新增美术需作者审核 |
| 4    | 最终内容/资源/渲染版本接回Studio→QuizPack→审核版本→访问码→消费者                   | 隔离真实库的一条完整24题、恢复、报告、双PNG与原链接回看 | 复用已验D1/D2，仅验证新接线；不在旧实例迁移或重建          |
| 5    | 最终手机体验和有影响的异常路径内测、整理交付                                       | 稳定内测版本与合并/发布建议                             | 合并main、生产迁移、部署、商业发布需明确授权               |

沿用独立开发聊天：A负责CI/依赖收口，B负责可达样例与内容验收工具；主控负责集成、计划、资料来源和资源分类；Astra独审实际diff与已得证据，不重复全量。首批做到第1项工程收口和第2项具体内容验收页；到作者内容/素材选择闸门再停，其余已授权常规工作持续推进。

### 首批资源核对与后续制作范围

本次只读核对现有私有 `fixture-02/runtime-inputs.json`；资源审核状态均为 `private-test-only`。既有 V8 封面（含水波/倒影/灯光/飘瓣）、性别场景、三幕校准背景、题干纸框、未选/选中框、报告纸底及公共边框继续复用，不按角色重生。

| 角色   | 当前揭晓 / 报告 / 海报资源                             | 姓名字图                      | 下一步                                                       |
| ------ | ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------ |
| 李白   | 专用揭晓853×1844；报告与海报共用780×874画像            | 500×700                       | 保留确认构图，补同角色报告/海报专用图，避免低分辨率放大      |
| 苏轼   | 三处共用864×1536参考画像                               | 500×700                       | 线上角色母图，派生报告与海报专用构图                         |
| 陶渊明 | 三处共用941×1672参考画像                               | 500×700                       | 线上角色母图，派生报告与海报专用构图                         |
| 李清照 | 已有独立线上揭晓852×1846、报告1254×1254、海报1162×1354 | 1060×1484；与500×700同5:7画布 | 作为分用途样板，先验收复用，不无故重生                       |
| 木兰   | 三处共用941×1672参考画像                               | 500×700                       | 名称按现有“木兰”候选审阅，内容定稿后制作角色母图与专用衍生图 |

每角色交付四类资源：无字揭晓竖图、报告顶部构图、相逢海报无字人物图、透明姓名书法图。完整报告长图复用报告顶部图和网页共享正文，不再生一张带正文的整图。姓名图同5:7画布、字组居中，使用既定下部锚点；不因字数改变容器。称号红签、诗句、分值、雷达、三行短句和六卷正文保持程序排版；固定称号和文学题签不伪装答案结论。图片继续女性向古偶/月夜水岸/深青暖灯的既定方向，服饰纹理与各角色面孔差异作为实际图检重点。

PR依赖核对：#32→#34→#35→#36→#37→#38→#39→#40→#41→#42→#43→#44→#45→#46→#47为当前千载同心包含链；#33平台首页独立基于#32，其7个补丁未包含于#47。第4阶段须先把首页接入隔离集成分支，再验证目录入口至真实消费链，不把演示入口误记为平台整合完成。仅记录依赖，不合并或关闭任何PR。

## 2026-10-26 《千载同心》D1–D4 接续

作者已批准24题五维、五人物池、娱乐性指数及确定性六卷，并授权按D1→D4实施。基线main `0d1715c`，独立集成`codex/qianzai-tongxin-d1-d4`、核心`codex/qianzai-tongxin-core`。A `01a13f49-bff9-74b0-8f7c-03cd46b346c1`负责D1内容/评分及后续核心服务；B `01a13f4a-3ac5-7a72-9ae0-70b24ec85f04`先负责独立Art Factory W1/有界批量工具，再按阶段接消费者视觉；Astra `01a13f4a-c9f8-7cc3-9558-81f86263cad1`进行针对性合同与实现审查。开发为GPT-6.1 Sol/high，架构/独审为GPT-6 Astra/high，保持最多两条实现流，不以主控子代理替代。

主控单写进度、领域总合同、共享配置与集成，串行协调迁移、端口与资源接入。Art Factory原规划聊天和私有资源库提供来源与规则，当前实施分工不改变其历史只读证据。资源分类、任务上限、视觉依赖和D1–D4出口见[实施合同](QIANZAI_TONGXIN.md)。现有环境与原件保持；新增美术作者审核，main合并/生产/商业发布另行授权。

## 2026-10-26 V2-B 四批交付点

B1–B4 继续使用原 A/B 独立开发聊天与 Astra 独审，主控未用子代理替代。A 负责四任务工作区与准确对象，B 负责账号整合及实际发现的 Argon2 部署绑定，主控负责共享外框、平台入口和真实隔离验证。作者允许直接重构，本次删除旧通用页面和空导航包装，无新增数据库迁移。完成范围、精确运行提交、证据与本机 3250 演示见 [最新进度](PROGRESS.md) 和 [V2-B 验收](S1_ACCEPTANCE.md#2026-10-26-studio-v2-b-四批整合)。独立 Draft 停在作者体验点，下一步不自动合并、生产部署或扩展功能；以下记录保持原日期语境。

## 2026-10-24 S1 本地技术出口

原 A/B 独立开发聊天与 Astra 独审完成本批实现、导航 P2 整改、有限截图复核。主控集成运行 `6eeb60f`，全量 1981 单元、生产 build、main 媒体 66×3、259 E2E/10 既有 skip 和六组 fixture cleanup 通过，测试实例停库；详见 [S1_ACCEPTANCE.md](S1_ACCEPTANCE.md)。最终文档 head 的准确 CI/独审单独留于 [Draft PR #24](https://github.com/aning0922/quiz-forge/pull/24)。

独立聊天和分支保留；A/B 不启动新实现。原作者 3100 服务已恢复原构建和原库，新增 3110 demo 仅合成数据、供作者验收。当前尚未获 S1 作者体验验收，不自动合并 main、启动消费者视觉升级、生产迁移或发布。下文为启动与历史记录。

## 2026-10-23 S1 Studio 体验整理启动

作者已明确授权后台布局与核心操作整理，主控基于已合入R1的main a641b04建立独立 `codex/studio-experience-s1`。合同和文件边界见 [STUDIO_EXPERIENCE_S1.md](STUDIO_EXPERIENCE_S1.md)，共享接口候选 da4f892 通过格式/lint/typecheck，A/B预检与Astra独立冻结审查已完成，允许实施；尚未宣称实现完成。

A `01a13f49-bff9-74b0-8f7c-03cd46b346c1` 接框架与商品管理，B `01a13f4a-3ac5-7a72-9ae0-70b24ec85f04` 接商品内导入到发码的界面；原Astra `01a13f4a-c9f8-7cc3-9558-81f86263cad1` 独审。模型沿原Sol/high实施、Astra/high审查。旧R1工作树及未提交草稿保留，S1使用新受管工作树，不替换成主控内子代理。

主控单写共享展示接口、合同、集成及验收；原作者体验环境不重建、不迁移、不读取答案/凭证，测试使用隔离合成数据。常规工程推进到Draft PR和作者验收，不自动合并或发布。下方为R1及此前历史。

## 2026-10-21 R1 技术出口与作者验收点

原两条独立开发聊天与 Astra 独立审查完成 R1，本地结果见 [R1_ACCEPTANCE.md](R1_ACCEPTANCE.md) 和 [qa/r1-acceptance.json](qa/r1-acceptance.json)。主控已完成全量工程检查、原环境复核与恢复入口，A/B 实现及实际非空恢复演练完成，Astra 对生命周期、schema 规范化、下载边界、HTTP 协议、图像和最终完整性/停库证据复核后无未关闭阻断。最终准确交付提交 CI 单独记录在 [Draft PR #22](https://github.com/aning0922/quiz-forge/pull/22)。

本次源/目标只用独立合成数据，全部自有演练 PG 停止、现场保留；原 39eb 与原 5686ff0 构建的本机 3100 入口继续可用。原备份与源复核包、失败回执、截图、PNG 及凭证保持私有，不将原作者数据纳入测试。备份首版只支持本机 macOS arm64/PG18.4、固定当前版本和维护模式，完整边界见运行手册。

R1 已到作者验收点，A/B 不再开展新实现，独立聊天/分支/工作树保持。主控仅完成本批交付同步与准确 CI 核验；main 合并、正式发布管理（第 2 项）、运营、新主题、部署或发布须后续明确指令。以下保留本阶段启动与此前阶段记录。

## 2026-10-21 R1 授权与独立聊天接续

作者明确授权第 1 项“运行环境与备份恢复”，保留现有内测环境，完成后交付验收。主控从归档 main c6fba4b 接续 `codex/runtime-backup-recovery` / Draft PR #22。两条独立 Sol/high 开发聊天仍为 A `01a13f49-bff9-74b0-8f7c-03cd46b346c1` 与 B `01a13f4a-3ac5-7a72-9ae0-70b24ec85f04`；Astra/high 原独立审查聊天 `01a13f4a-c9f8-7cc3-9558-81f86263cad1` 使用新 R1 审查 worktree，旧审查现场保持不动。没有替换为主控内子代理。

主控单写机器合同、package scripts 与集成；A 负责一致快照、源准入、PG 恢复与真实数据测试；B 负责私有产物、校验/封存、CLI 与合成恢复演练。文件所有权、退出标准和有限维护模式见 [RECOVERY_R1.md](RECOVERY_R1.md)。合同先独审冻结，再分别实施，最终统一工程检查、实际隔离恢复与独立复核。共享合同 `083ad81` 已由主控 20 项纯边界/类型/lint 与 Astra 独立 20/20 复验，通过后冻结并启动两线实现；真实备份恢复尚未完成。

R1 不授权正式商品发布、运营扩展、新主题、生产迁移/部署或自动 main 合并。原运行工作树、数据库、素材及用户记录保留；恢复绝不覆盖该实例。以下为此前阶段记录。

## 2026-10-20 主线合并与首个内测版本归档授权

作者已实际体验《千载同心》，反馈“整个流程目前没什么问题”，并明确授权“好的，开始第 1、2 步吧”。本次范围为将已验收F1–P5成果合并main、核验合并后的准确提交、整理版本与恢复记录，并在最终验证通过后创建`p5-internal-beta-1`标签。此前main合并等待条款由本次明确授权覆盖；生产迁移、公开部署、商业上架、GitHub Release发布和P6+仍需后续明确授权。

主控持有Git远端合并与标签写入权，A只读核对恢复边界，B独立交付版本说明，Astra独立审查合并条件和最终证据。合并对象锁定PR #6–#20的已验收head，保存原main `b3e30bc2e77c4da2a2cce950d0353123d19bf592`与最终开发交付`5686ff0fb9040456ec1b5782004cd0ba3fff1069`。按依赖关系处理PR，以merge commit保留历史，不强推、不改写旧阶段提交、不删除分支；每步核head、base和预演tree，变化或冲突先停止核实。最终归档文档以单独PR提交，准确main检查成功且独审后才打标签，不预写未来CI结果。

PR #6–#20已全部依次实际合并，阶段代码main为`56c28380f1d9ddde6dc5d06097c4156098a7c7fe`，tree与5686ff0一致。原23次成功CI的实际checkout及逐步merge证据见[机器记录](qa/p5-main-archive.json)。GitHub合并API只原子匹配head；base采用合并前复读和合并后两个parents/tree/main核对，未宣称原子base CAS。最终文档PR严格仅限根AGENTS.md和docs路径及正常文件模式，其他全部路径与验收版本保持一致；最终准确main的push CI及单独Linux媒体验证均成功后才创建版本标签。

作者体验服务仍运行在原受管工作树，39eb仅为本机test实例。本次另建受管归档worktree，不在运行目录切换代码、重建、运行迁移或全量E2E，不读取作者答案和报告。代码标签不包含私有数据库、素材、凭证、原始报告或可直接搬迁的媒体封存产物；恢复边界见[版本说明](releases/P5_INTERNAL_BETA_1.md)。本次不创建新的开发阶段。

## 2026-10-20 已授权 P5 首款目标完成

历史人物首款《千载同心》已在原39eb内部test实例真实完成四个作者见证的12题答题、持久恢复、唯一报告、原Key只读回看和四张1080×1920PNG。最终精确图1play/4Key/4session/4report/8grant，原内容/八图不变；升级、live、只读audit实际exit0，所有已拥有的服务/句柄关闭，实例停止保留。A/B各完整查看68原图，Astra独立20张，限定71文件隐私扫描通过。见[P5_ACCEPTANCE.md](P5_ACCEPTANCE.md)。

当前P1–P5授权目标已完成本地内测，文档37bb8ca的远端CI39430084373暴露旧`p3e-close-fault`退出观察失败：checks通过、database失败、fresh未运行。A以新库3/3反例修正三个测试文件（32594da→root78939ed），原fd/db加六边界共8/8通过，Astra独立六边界通过；生产保护与首款数据未变。root在本提交推送后核实准确head的完整CI，实际结果另记[PR #20](https://github.com/aning0922/quiz-forge/pull/20)。继续保留主控＋两条独立开发聊天＋Astra独审、分支与全部证据。没有重跑一次性升级或live脚本、启动P6+、合并main或发布的默认授权；后续新范围另行明确。已有内测内容/视觉批准不被解释为商业素材权利或发布批准。

## 2026-10-20 P4 出口与 P5 接续

P4运行144d0b1、测试898fbfc已完成技术出口，见[P4_ACCEPTANCE.md](P4_ACCEPTANCE.md)：259生产E2E/10既有skip、实际退出清理、1961单元/496PG、新main66×3、29图双线复核及准确CI通过。新1.0.1入口与旧1.0.0报告精确绑定兼容、自然过期只读报告已实际验证。现接续已授权的P5历史人物首款四结果现场，原39eb实例及已批准内容/八图保留；root独占升级/3100/最终图审与审计，A/B和Astra独立聊天继续。首款现场未执行前不宣告P5完成；不追加素材/发布授权，不合并main或运行生产迁移。

## 2026-10-18 P4 共享合同与并行归属

机器/设计基线 6ae499a 已独审收口并由主控冻结，允许 A 进入 0018/guard/owner/事务/留存及真实 PG，B 进入 HTTP 与消费者/运营 controller；具体范围见 CONSUMER_P4/P4_DATA_DESIGN。root 继续精确实现登记与集成，3100 独占串行。此为实施启动，未验收实际 P4/P5；已批准同一内容/视觉不重复请批。

主控在 `codex/consumer-session-report` / Draft PR #20，从 c83788b 接续；当前机器接口至 50a35a6。共享基础/codec、领域 DTO/纯视图接口、errors/resolve 已由原 Astra 独审分别通过；entry/service/owner/同事务 ports 正在收口。主控完整 1763 单元及 format/lint/typecheck 已过，尚未验收数据库或消费者端到端。

A（原聊天 01a13f49-bff9-74b0-8f7c-03cd46b346c1，`codex/p4-consumer-data`）负责后续 0018、guard、惰性 owner、数据事务/领域 ports、保留与真实 PG；B（原聊天 01a13f4a-3ac5-7a72-9ae0-70b24ec85f04，`codex/p4-consumer-ui`）负责纯六视图/PNG，冻结后接消费者/Studio host 与 HTTP。root 独占共享基础/应用接口/精确实现登记/全量集成、生产构建与 3100；Astra 原独立聊天负责非实施审查。常规工作沿既有授权推进，同一内容与视觉内测基线不重复请批。详细状态和仍待实现的边界见 [CONSUMER_P4](CONSUMER_P4.md)、[P4_REVIEW](P4_REVIEW.md)。

## 2026-10-18 P3-E 技术出口完成，接续 P4

生产 eb7595a / 测试 f924f23 已完成精确基线批准和不可变内测版本：1710 单元、469 fresh PG、46 driver、独立 fresh 服务 14/媒体 UNKNOWN 3、完整生产 E2E 241/10 旧 skip 均通过；最终 main 媒体 66×3 封存、80 traces/17204 路径/0 私有违规。准确 f924f23 的 CI 39128057215 与 39128057251 均 success。A/B 分别检查 80 原图，Astra 核完整证据并实际查看 20 状态代表图，无剩余 P1/P2，保留三类非阻断后台排版 P3。详见 [P3E_ACCEPTANCE](P3E_ACCEPTANCE.md)、[P3E_REVIEW](P3E_REVIEW.md)、[P3E_VISUAL_CHECK](P3E_VISUAL_CHECK.md)。

已批准首款的真实原包已实际经 native 准入、首稿、author-baseline 落账及 slot 1 内测版本封存；三 hash 与批准产物一致。39eb 实例禁导入并停库保留，原图及凭证继续私有。原 0016 谱系真实升级到 0017 保留旧行/回执/blob；失败和升级现场分别保存。最终测试实例 f746 已真实退出/精确清理/停库。PR #19 堆叠于 #18，main 未合并，商品未发布。

继续原两条独立 Sol/high 开发聊天（A 数据 01a13f49-bff9-74b0-8f7c-03cd46b346c1、B 界面 01a13f4a-3ac5-7a72-9ae0-70b24ec85f04）与 Astra/high 独审（01a13f4a-c9f8-7cc3-9558-81f86263cad1），由当前主控集成，不改为会话内子代理。下一步先冻结 P4 消费者机器合同，再接独立 play 版本、Key、匿名恢复、服务器答案 CAS 和唯一确定性报告，最后完成首款 P5 现场。P4 目前仅前置协议准备，未实现表或业务。内容/视觉沿作者已批准基线，常规工程连续推进；实质内容、素材变更或发布仍找作者审核。

## 2026-10-18 P3-D 技术出口完成，接续精确审核与内测版本

作者已确认首款12题、四报告、八图作为内测基线，见[FIRST_PRODUCT_BASELINE](FIRST_PRODUCT_BASELINE.md)。追加不可变修订P3-D最终运行/测试c1ca647完成技术验收：1560单元、本地完整431PG及49增量、最终远端433PG/14服务/3UNKNOWN、46驱动、235生产E2E及10旧skip、main媒体66×3封存、72trace/15075路径/0私有违规。61图由两开发聊天分别逐张复核，Astra无剩余P1/P2，普通39110069377与Linux媒体39110065866均准确head实际success。详见[P3D_ACCEPTANCE](P3D_ACCEPTANCE.md)、[REVIEW](P3D_REVIEW.md)、[VISUAL_CHECK](P3D_VISUAL_CHECK.md)和[QA](qa/p3d-integration-progress.json)。

真实0015旧库升级到0016，原六表事实、10blob和旧回执保留，并在原谱系追加r2后验证旧正文/首次归属及原key仍不变。最终生产Next/workers确已退出、四夹具精确清理、自有数据库停止；失败与旧升级现场保留。PR #18仍堆叠Draft，main未合并。

接续P3-E：将已批准具体材料离线精确映射到实际包，受信registry固定规范内容/资源/manifest摘要，再记录内测批准并封存固定版本；通用运营审批及消费者会话尚未实现。之后继续P4内部Key、服务端恢复、一次完成与不可变报告、P5真实首款闭环。两独立Sol/high开发聊天与Astra/high独审方式不变，常规工程连续推进，同一基线不重复请批；实质内容/素材变更和发布仍保留人工闸门。以下为阶段过程历史。

## 2026-10-18 内测内容与视觉已确认，接续修订与版本流程

作者已明确确认“内容与视觉可作为内测基线”，准确范围和不可变材料hash见[FIRST_PRODUCT_BASELINE](FIRST_PRODUCT_BASELINE.md)。下方2026-10-16等待作者审核的段落是历史；此次确认已解除内容/视觉内测基线等待，不扩大为商业权利、部署或发布批准。

主控从已验收922937f建立codex/draft-revisions，恢复原两独立Sol/high开发聊天和Astra/high独审，先冻结P3-D追加不可变revision合同，再分别实施数据事务/后台流程。旧首稿、旧修订与原key回执保留；更改内容不得沿用旧审核资格。后续接审核/内测版本封存、P4消费者Key/会话/一次完成/不可变报告，目标仍为首款P5内测，尚未宣称完成。P3-D合同已由独立Astra预审通过并冻结于30ebc20。共享追加/核实/分页Schema与服务接口已实现；旧首稿回执仍限定revision1，新409不携带容易误解的currentRevision。定向123项单元、类型与定向lint通过；尚无0016迁移或追加运行功能验收。两独立开发流将从同一共享代码提交接续，最终六项检查、真实旧库升级与生产E2E仍待集成。

## 2026-10-16 P3-C 技术出口完成，首款内容与素材待作者审核

运行ac69b76、测试49da513完成固定revision/完整资源绑定、真实评分、只读运营预览、六状态和1080×1920 PNG。1504单元、395本地完整PG及增量、最终远端417PG/46driver/14服务/3UNKNOWN、228生产E2E/10旧skip、零warning build、新main媒体66×3、25图双线逐张复核均通过。准确代码head普通38805921796与媒体38805921596实际success，Astra最终无剩余P1/P2。详见[P3C_ACCEPTANCE](P3C_ACCEPTANCE.md)、[REVIEW](P3C_REVIEW.md)、[VISUAL_CHECK](P3C_VISUAL_CHECK.md)和[QA](qa/p3c-integration.json)。

最终浏览器与workers已真实退出，P3-C→B3→B2精确清理成功，自有d9数据库停止；旧失败/未知现场保留。PR #17堆叠Draft、main未合并。主控、两条独立Sol/high实现聊天与Astra/high独审的方式保持，已交付聊天等待下一项协调，不恢复旧D1或改用当前会话子代理。

当前按作者保留的人工闸门提交具体内容与素材审阅：12题/48选项权重、四份完整基线报告、李白/苏轼/陶渊明/白居易和四厅；中性封面复用第一厅，9资源槽位/8张独立图片。新增三幅原图及提示词/来源保存在本会话本地审阅材料中，未进公共Git或正式QuizPack，状态仍pending。作者确认内容和视觉不自动授予商业权利、main合并、生产迁移、部署或发布。

这仍不是历史人物P5端到端内测完成：同Product追加修订、审核/版本封存、AccessKey/消费者会话与恢复、一次完成事务、不可变用户报告和正式历史查看尚待后续。常规工程授权继续有效；在具体内容/素材审核反馈后，主控按既定路线继续协调，发布仍另审。以下为阶段历史。

## P3-B 技术退出与P3-C准备

运行c419aa6、最终测试afaa43e通过完整技术出口；详见[P3B_ACCEPTANCE](P3B_ACCEPTANCE.md)。远端普通38788800066与媒体38788800035均实际success，Astra无剩余P1/P2，32图已逐张检查。两实现聊天本批提交均集成，原分支与工作树保留；主控已清理最终浏览器夹具并停自有实例。

接续P3-C固定修订内部预览的精确接口合同：当前授权运营员读资源与真实临时评分，固定正文/素材绑定、答案请求代次、受控六状态及PNG；不增加正式会话或发布权威。A预研鉴权/有限私有读取，B预研DTO/渲染/字体，Astra独立冻结前审查；接口冻结之前不实施。继续复用三条独立聊天，不恢复旧D1或改用子代理。

## P3-B 接续分工

P3-A交付0059175，运行ce190cd全部技术验收通过；主控分支codex/supported-pack-admission。[PACK_ADMISSION_P3B](PACK_ADMISSION_P3B.md)已独立Astra复审冻结。原A聊天更名“QuizForge P3-B · 准入数据与历史”，原B更名“QuizForge P3-B · 包工具与可信桥接”，thread ID和Sol/high配置不变；仍由“QuizForge · 架构与独立审查”独审。两聊天从0059175新建受管工作树，旧提交保留。

主控独占共享合同/有限报告/identity/archive policy、0015迁移/guard、CLI/配置/闭包和3100；A负责validation应用与旧历史/首稿来源，B负责package与可信桥接。先公共机器Schema，再业务并行；未提前让两流放宽准入或改公共文件。真实升级限制及当前pending统计修订已入合同，生产迁移和发布不在授权内。

## 2026-10-16 P3-A 技术退出

最终代码ce190cd、[验收](P3A_ACCEPTANCE.md)：1316单元/335PG/46driver/222生产E2E（10旧skip）、六项工程检查、最终main媒体66×3及五源码变更拒绝、双CI均通过。Astra确认全部登记P1/P2关闭。四卡真实数学执行已完成，仍authored-pending，无持久化准入或发布批准。PR #15未合并，自有DB/3100已停。

两开发聊天已提交的评分/内容成果均集成；旧handoff工作树当前不在Git注册列表，提交保留。下批由原独立聊天创建新的受管树继续，不能回到旧D1或覆盖目录。P3-B只读预研已完成，合同按升级静止/旧历史/新资格/跨策略alias及有限报告身份修订，冻结后才实施；不再向作者重复请求常规阶段启动许可。

## P3-A 接续登记

主控从B2-3交付802585b在同一受管根工作树创建codex/content-scoring-foundation，保留#14交付分支。[CONTENT_SCORING_P3A](CONTENT_SCORING_P3A.md)经独立Astra两轮合同及公共机器字段复验后冻结。现有独立聊天分别更名为“QuizForge P3-A · 纯评分引擎”（01a13f49-bff9-74b0-8f7c-03cd46b346c1）和“QuizForge P3-A · 内容合同与适配”（01a13f4a-3ac5-7a72-9ae0-70b24ec85f04），角色继续Sol/high；独立Astra审查聊天不变。先由主控提取不改v1行为的基础Schema/canonical并给出严格机器接口，再派两流实施。

本批是离线内容合同与纯评分，不改变当前P2仅synthetic/v1准入。四卡逻辑审阅封套与完整内容来源明确分开，不造图片hash/许可或平台批准。B2-3最后文档head802585b的CI另核；已验收运行代码和08ecf57两条成功证据不随下一批混写。

## 2026-10-15 B2-3 技术退出与下一批

两条可见独立Sol/high开发聊天与Astra/high独立审查已完成首稿交付；运行代码0804126，后续CI有限诊断08ecf57。1162单元/335PG/46driver/222生产E2E（10旧skip）、最终main媒体66×3与封存、24图、六项检查及独立问题闭合均已完成；08ecf57普通38745820486和媒体38745820485实际success。原080媒体失败保留且原因未定位，详见P2B3_REVIEW，不以新成功改写失败。PR #14未合并，所有自有实例与3100已停。

独立架构预审决定先P3-A内容v2与纯评分，再authored/v2持久化准入、固定修订真实六状态预览、精确审核与版本封存、P4→P5。网页内文案编辑不阻塞Codex→QuizPack主流程；同Product首次需要返修前必须独立完成重新导入追加revision，保留旧来源/原key并使审核证据重新成立。两条实现聊天继续按独立文件所有权接续，主控先交共享机器Schema，未提前启动下一批代码。历史四卡与视觉方向不改，不要求用户重新选择。

## 2026-10-15 恢复独立聊天组织

作者指出本轮将原先独立开发聊天替换为主控会话内子代理，随后明确选择“恢复独立开发、独立审查聊天”。主控确认该组织方式改变不符合“开发方式不变”的要求，现已纠正。主控会话仍为「查看 QuizForge 阶段进度」；技术路线、提交成果及人工批准边界保持既有约定，主线由以下侧栏独立聊天接续。

| 职责             | 独立聊天                        | 模型             | Thread ID                            |
| ---------------- | ------------------------------- | ---------------- | ------------------------------------ |
| 数据与事务       | QuizForge B2-3 · 草稿数据与事务 | GPT-6.1 Sol/high | 01a13f49-bff9-74b0-8f7c-03cd46b346c1 |
| 后台与交互       | QuizForge B2-3 · 草稿后台与交互 | GPT-6.1 Sol/high | 01a13f4a-3ac5-7a72-9ae0-70b24ec85f04 |
| 架构与非实施审查 | QuizForge · 架构与独立审查      | GPT-6 Astra/high | 01a13f4a-c9f8-7cc3-9558-81f86263cad1 |

原A子代理在codex/first-draft-data的ed79a990a20c32a9511193ff01b225ca29bcf9ed提交收束；原B在codex/first-draft-studio的17e886db776e1bb1ac1f47cca92b2da7867fcd6a提交收束。两树干净，自有55421/55422实例停止，失败/UNKNOWN缓存和分支保留；原审查子代理也已完成，不再承载主线。新开发聊天从准确HEAD建立各自受管工作树，并接主控共享c145fc8，旧D1检出不得改动。主控读取独立聊天的进度与回执、派回整改，独占迁移/共享配置/3100集成；所有新工作只限QuizForge。

B2-3仍未技术验收：数据已有34项定向PG；UI已有45pure与合成PG smoke、7浏览器场景尚未跑。主控schema/阶段升级12项PG已过；FK内部trigger禁用的独占新集群probe已实际cycle/source两项通过并停库，仍待新Astra复核关闭P2。源P1原始content仍≤1MiB，大正文只作明确合成历史DB预算测试。最终全量/生产build/媒体重绑定/E2E/图检/CI均由主控接续；本次组织交接不升级成验收。

## 2026-10-15 恢复与新主控

作者在本聊天明确恢复历史人物首款 P5 端到端内测的托管开发，常规工程与测试自行推进，内容、素材或发布批准再提交人工审核。先前暂停由此次明确恢复取代；旧 D1-D 和其他项目不在恢复范围。

已核实正式 origin，并在可达 Git 历史公开检查后将 `aning0922/quiz-forge` 改为 public，GitHub 回读确认 `PUBLIC`。公开检查范围与限制见 [PUBLIC_READINESS.md](PUBLIC_READINESS.md)。没有更改计费、许可证、素材审批或自动合并设置。

新主控工作树为 `/Users/aipuli/.codex/worktrees/quizforge-managed-resume/quiz-forge`，沿用 `codex/quizpack-validation-storage` 和现有 Draft PR #13；恢复提交 `fb02afc6480ee1b7c3fffa3116cd4de988c11271`。它比恢复时远端 `e0e0c2a` 多两项已保存提交：UI 保守状态修复和原请求关闭 observer。未将存在修复视为已通过最终验收。

工作方式保持：总控负责合同、共享配置、依赖与集成；最多两条 GPT-6.1 Sol/high 实现流；GPT-6 Astra/high 负责非实施审查；先固定接口和文件归属，数据库迁移与 3100 生产 E2E 串行；各流独立提交，由总控整合、验证和推送堆叠 Draft PR。

恢复首批仅收口 B2-2B：A 独占测试 fixture/maintenance 与真实 PG/FS 验证，B 独占新增实际 service PG 测试；测试数据库端口分别 55421/55422，总控 55423。新建各自 purpose=test 实例，保留旧失败现场。实际 HTTP/媒体闭环由总控生产构建、绑定、矩阵封存与浏览器验收覆盖；媒体桩的 DB 专项测试只证明相应数据库服务边界。

B2-2B 已于本轮完成技术验收，证据见 [P2B2B_ACCEPTANCE](P2B2B_ACCEPTANCE.md)：1060单元、298普通PG、46驱动、10+3独立服务PG、214生产E2E/10既有跳过、六项检查及两条远端CI通过，24图检查完成。接续 B2-3 首个持久草稿；之后按有限编辑/结构预览、P3 评分与注册预览、P4 Key/会话/锁定报告、P5 内测的既有依赖继续。main 合并、生产迁移/部署和正式发布仍保留原人工批准边界。

B2-3 在 `codex/product-first-draft` 开发，基于交付 `7fc0c55`；冻结合同见 [STUDIO_P2B3](STUDIO_P2B3.md)。总控持共享预算/错误、DDL/权限/guard、集成与3100；数据线拥有受控QuizPack来源接口及product/drafts，界面线拥有studio/drafts及薄路由。先交公共类型，再并行实现；Astra继续独立审查。新业务完成前仍不能把ready当成草稿。

## 2026-10-12 历史启动

日期：2026-10-12（Asia/Shanghai）。作者明确选择“按路线推进到首款端到端内测，在必要人工决策点暂停”。这是P1–P5持续工程授权，覆盖依赖设计、隔离实现、测试、独立审查、修复、提交推送和Draft PR。其他旧开发聊天仍暂停。

## 目标与范围

以一个Product为独立测评工作区，完成Codex研发→QuizPack构建/验证→隔离导入→后台预览/人工审核→固定版本→Key→答题/恢复→确定性完成→锁定报告/PNG→历史读取的首款内部闭环。按各阶段实际证据推进，不以类型、fixture、UI按钮或已创建workflow冒充能力。

P1包工具、P2数据库与最小认证后台、P3确定性引擎与注册预览、P4凭证/会话/报告、P5首款精品内测均已授权。P6其他主题、P7扩展运营、P8 AI/剧情/渠道后置；既有D1-D工作不自动恢复。主线合并、生产迁移、外部部署、真实商品商业发布不自动进行。

## 历史任务与依赖（表内状态属于当时检查点）

| 阶段 | 状态                                | 依赖和交付                                                                           |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| F1   | 技术交付完成，Draft PR #6待合并     | head efe29e6，185单测/186 E2E，CI 38153151107 success                                |
| P1   | 技术验收完成，Draft PR #7           | 从F1提交创建codex/quizpack-toolchain；版本化包合同、确定性构建、受限ZIP/真实资源验证 |
| P2   | 认证/目录/接收/归档/首稿已验收      | 运行事实见B2各验收；后续审核与版本封存仍待实现                                       |
| P3   | A/B/C/D已验收，E实施中              | 评分、准入、固定预览及追加修订已完成；当前精确审核与内测版本封存                     |
| P4   | 排队                                | 发布组合、Key、服务端revision、一次完成事务、不可变报告                              |
| P5   | 内容/视觉内测基线已确认，工程待接通 | 完整首款Key闭环、实机验收和内部端到端运行尚未完成                                    |

当时 F1 与 P1 尚未合并，采用堆叠分支/PR；此为历史依赖说明，实际合并状态以 GitHub 为准。新的交付在现有记录中简要说明提交、工作区、验证/复用结果、限制和下一步，不另建检查台账。

## 模型、并行与职责

总控负责总体架构、共享合同、任务依赖、包/锁文件、集成与最终验收。正常实现使用GPT-6.1 Sol/high的独立聊天；架构决策及非实施审查使用GPT-6 Astra/high。每阶段最多两条独立实现流，先固定接口和文件所有权；3100、数据库迁移和共享配置由总控串行调度。单一文件不并行改动，依赖提交明确后再接入。

改变共享安全、数据合同或迁移时先审对应设计，局部低风险修改直接按现有合同实施。开发线运行受影响的定向检查并交付；总控复用未失效结果，仅补集成新增影响。独审检查差异和证据，有具体疑点才补定向反例，不再重复完整套件或全部截图。UI 按影响选择代表页面和断点实际查看，作者审美/素材/内容批准仍独立。达到本批验收且无阻断即交付，不为提高覆盖率扩展任务。

## 必要人工决策点

- 真实商品内容：正式题目/维度/原型/解释的作者审读，不能把工程合成数据升级为商品结论。
- 视觉与素材：沿既定历史人物方向研发，新的商业素材批准、来源证据、完整角色阵容和最终体验需作者确认。
- 身份/经营：需要真实外部账号、支付/渠道权限、个人数据或服务费用时，先形成可审配置与影响，再请求必要输入。
- 发布：main合并、生产数据库迁移、公开部署和商业上架保留明确授权，不因托管范围推定允许。
- 技术任务如可在隔离环境内独立推进，应继续；只在决定确实阻塞后续时暂停依赖部分，并报告已完成的具体交付和待决项。

没有新增定时任务或声称会话结束后有未登记的后台续跑。本轮通过已授权的独立聊天、等待/读取和明确交接来托管当前路线。

## P1 工作登记

- 总控集成：codex/quizpack-toolchain，合同提交 6e4263c、固定依赖提交 ecf0b05；严格类型检查和本机 sharp PNG 完整解码探针已通过，不等于阶段验收。
- 「QuizForge P1 · 内容合同与图片验证」：01a12bd2-f45b-7a21-8b2d-2984b7460927，GPT-6.1 Sol/high，合同/引用/兼容/媒体独占，先提交内容里程碑供 B 接入。
- 「QuizForge P1 · ZIP构建与命令行」：01a12bd2-fe14-79d1-9464-3721114d615a，GPT-6.1 Sol/high，受限 ZIP/IO/构建/CLI 独占，先独立实现容器。
- 「QuizForge · 架构决策与独立审查」：01a12b96-7cf0-72d0-8e20-e9c0a57b09a0，GPT-6 Astra/high，复用 F1 审查聊天进行前置合同与集成后独立审查。
- 文件所有权、接口、限额和退出标准见 QUIZPACK_P1.md；所有任务使用已核实正式仓库的隔离 worktree，不改旧暂停成果。

## 首款内容准备线

「QuizForge 首款内测 · 内容与验收草案」：01a12be4-a2b1-7893-a202-5177dbb4ae2c，GPT-6.1 Sol/high，独立 codex/first-product-content 工作区。draft-2 已完成十二题/四维、四套完整报告、贡献表、待执行见证和素材清单，独立复审验证数学结构和手算见证。2026-10-12 作者明确选择“采用四卡内测草案（推荐）”：李白、苏轼、陶渊明、白居易。后续按该草案准备首款内测；这不代表科学效度、正式引擎执行、视觉验收、素材商用或发布批准。内容文件保留独立分支，未进入 P1/P2 运行代码，正式包待 P3/P5 门槛。

P1技术交付证据：代码3a1ad7a，385单测/186 E2E（10既有跳过），五项独立发现闭合，代码CI38158768248 success；最终文档head e63df64的CI38159199724也已核实success。详细证据见P1_ACCEPTANCE.md。

## P2-A 工作登记

- 总控集成：codex/studio-foundation，基于 P1 e63df64；数据库、认证、权限和本地隔离合同见 STUDIO_P2A.md。先固定合同和迁移方案，再实施。共享 package/lock、CI、测试配置及集成数据库由总控单写。
- 「QuizForge P2-A · 数据库与迁移底座」：01a12c06-456e-75d3-9daf-8a02523fa346，GPT-6.1 Sol/high；负责独立 PG 集群、三表约束、迁移、最小权限、私有配置、凭证工具和真实 DB 测试。先交付公共接口提交供认证流接入。
- 「QuizForge P2-A · 运营认证与Studio」：01a12c06-4a4a-7390-a35a-1fb7d0f80ac1，GPT-6.1 Sol/high；负责 HTTP 边界、真实认证事务、最小登录/状态页和认证验证。HTTP 独立里程碑 bd55282 已提交，395 单测通过，尚未完成真实 DB 认证、路由或阶段验收。
- 架构与独立审查仍使用 GPT-6 Astra/high。DB 测试端口分别保留 55421/55422，总控集成 55423；使用前检查空闲。生产 E2E 的 3100 仅总控占用，其他开发线不得启动。
- P2-A 退出条件为真实 PG 权限/迁移/认证并发与失效测试、六项工程检查、真实浏览器登录退出与移动视口截图、独立审查、Draft PR 和准确 head 的 CI。未通过前不声称后台可用。

## P2-A 技术检查点

最终代码720b982，442单测、57真实DB、189生产E2E/10既有跳过通过；独立审查无剩余P1/P2，移动UI图检和真实停库503已验证。代码CI38163271691的checks/database均success，PR #8保持Draft。总控及两开发线数据库已停止、3100释放。详细证据见P2A_ACCEPTANCE.md/P2A_REVIEW.md/P2A_VISUAL_CHECK.md。P2-B1计划先落地目录工作区，P2-B导入与P3评分预案已备齐；旧暂停聊天不恢复。

最终P2-A文档交付38177fb的CI38163814070已另行核实success，#8保持OPEN/Draft，未合并main。

## P2-B1 工作登记

- 总控：codex/catalog-workspace，基于P2-A最终38177fb，合同a2df7b8；STUDIO_P2B1.md已冻结；该条为启动登记，最终技术验收以下方退出检查点为准。
- 「QuizForge P2-B1 · 目录数据与事务」：01a12c3b-f2ca-70d1-940d-4c6856a9b134，GPT-6.1 Sol/high；四表/迁移/服务、当前会话的同事务写鉴权、DTO和受控错误。先提交公共里程碑供B接入。
- 「QuizForge P2-B1 · 测评工作区后台」：01a12c3b-f538-7042-80d4-fc2f977f5508，GPT-6.1 Sol/high；真实工作区/目录HTTP及UI、归档恢复和浏览器用例。
- Astra high继续架构决策和独立审查，总控持有共享配置与3100。新workspace浏览器项目依赖studio-auth完成，避免两个fixture并发清理数据库；所有后台认证产物限制继续生效。

发现真实postgres3.4.9断连缺陷后，临时增加独立专项「QuizForge · 数据库断连修复」01a12c54-d5ae-7462-885a-e31849856277（GPT-6.1 Sol/high），专属55424和独立分支；只负责固定版本的受追踪补丁及故障回归，不与两条业务线争用文件。Astra另做补丁复审，总控整合与移除临时规避。私有目录构建追踪由总控和独立Sol/high小代理处理。专项关闭后恢复常规两条实现流。

P3表现预案见PRESENTATION_P3_PREFLIGHT.md：计划保留v1包兼容，以有限content.v2字段表达四厅、题签、场景和卡片海报，不在通用组件按Product ID分支。当前未实现v2或registry。首款内容聊天仅准备新展示文案候选，保留已选定四卡题目/权重/报告；新增文案仍待人工审读。

## P2-B1 技术退出检查点

最终代码44a0d38完成528单测、154真实DB、46驱动故障、198生产E2E/10既有跳过，独立审查闭合。代码CI38168728761两个job实际success，Draft PR #9保持未合并。A/B/driver及root测试实例全部停止，端口3100、55421–55424已核实无监听。接续B2-1原包接收；首款展示候选03fdc240已在内容独立分支完成，未改作者已选定的核心草案，也未升级为素材或内容批准。

## P2-B2-1 工作登记

总控新分支codex/quizpack-receipt基于B1最终文档e8da98b，普通与数据库CI38169117712已实际success。首批只接收原包：quizpack_import、关闭默认上传、显式管理CLI、私有目录/锁/配额、幂等意图与恢复及后台状态；received不代表验证或内容批准。STUDIO_P2B2.md已冻结；独立Astra前置审查的绝对期限与CLI晚到配置写两项P2已写入合同修订。A负责数据库/runtime/接收服务，B负责HTTP/后台；先交共享DTO再集成实现，尚未验收。

- A「QuizForge B2-1 · 原包接收与恢复」：01a12c8e-96f2-76f3-bc0b-c6aacc19f677，GPT-6.1 Sol/high，独占DB/runtime/私有接收服务及真实故障测试，自己的测试端口55421。
- B「QuizForge B2-1 · 导入操作后台」：01a12c8e-9a41-79a3-9db2-74cf2f219011，GPT-6.1 Sol/high，独占HTTP/reader adapter/后台与E2E，自己的测试端口55422。
- 两流固定基线5f2f8e5；总控持有package/lock/shared errors/playwright及3100，集成测试端口55423。新root的独立test实例从旧v1配置生成，供实际升级兼容回归；配置内容私有。
- [Draft PR #10](https://github.com/aning0922/quiz-forge/pull/10)已创建并堆叠于B1，当前仅合同与共享错误/浏览器项目准备，不代表接收功能完成。18项定向HTTP安全测试、类型、定向lint/格式通过；阶段六项与DB/driver/E2E均待集成后执行。

公共交接已完成：A原1bfe008→root7546736，B适配原a44c54f→rootb17b391；B已获总控指定A提交并接入。root22项相关单测与旧v1实例57项真实DB/认证通过，Astra窄审无P1/P2；b17b391的CI38170812606两项job成功。B HTTP/UI原3405076→root1729a8e，29项imports定向通过；客户端响应验证P2已派回B修复。原包service/CLI/表与完整阶段验收仍未完成。

## P2-B2-1 技术退出检查点

最终代码 `f070428b72570977db835946227b2c49d0666e42` 已通过格式/lint/类型、612单元、214真实DB、46驱动场景、生产构建与206 E2E/10既有跳过。独立Astra全部登记问题关闭，20张最终移动截图逐图检查完成；代码CI38174716526两个job实际success。Draft PR #10依赖B1且未合并；最终文档head CI单独核验并记录到PR描述。详细交付见P2B2_RECEIVE_ACCEPTANCE/REVIEW/VISUAL_CHECK。

A与B实现聊天已完成本批任务且各自测试实例停止；总控实例也已停止，3100/55421–55424无监听。后续不在已交付分支继续堆积业务实现。下一批先冻结媒体隔离可行性合同并以独立macOS/Linux流验证正常解码、权限边界和实际停止；两平台未通过前不接B2-2业务表或后台验证按钮。普通技术取舍由总控与Astra审查处理，不重复要求作者批准已有托管范围；必要内容/商业/部署决定仍按上文人工闸门。

## 媒体隔离可行性工作登记

B2-1最终文档head `5caef26` 的CI38175221128已核实checks/database均success，PR #10保持未合并。总控独立工作树 `codex/media-isolation-preflight` 从该已验证提交开始；6066c3b冻结实验合同与明确停止语义，实际平台能力仍未通过。

- macOS/共享流：聊天 `01a12cd4-846c-7d12-ae28-134d73b73a2f`，GPT-6.1 Sol/high；独占shared与macos目录、先交共享类型/父端预检/POSIX探针，再交严格macOS策略与实测。
- Linux流：聊天 `01a12cd4-89f1-7312-b94f-e3b7567d4899`，GPT-6.1 Sol/high；独占linux目录及自身worker锁文件，先准备固定镜像/运行/CI入口，收到总控指定共享提交后复用；真实Linux CI由总控接入。
- 总控持有根package/lock/workflow、集成与阶段文档；Astra独立审查合同及实现。各流创建自己的附加worktree，先核正式origin/基线，不在旧暂停检出写入。

实验不接业务表、数据库、HTTP、Studio或P1正式调用链，不占3100/数据库端口。全部输入/哨兵是合成；平台失败交证据并关闭，不回退裸spawn、不修改主机全局设置。最终两平台实际矩阵、停止事实、固定身份与独立复审通过后再启动B2-2同字节复验/资源归档。

## 媒体隔离技术退出检查点

代码736d923的普通CI38183239291（checks/database）及真实媒体CI38183239317均success。总控macOS66项矩阵三次通过；Linux31项smoke与11项生命周期全部通过，停止应答丢失实际命中且停止确认；独立登记P1/P2全部关闭。612单测、214真实DB、46驱动、206生产E2E/10既有跳过及其余工程检查通过；测试实例停止、控制目录无活跃记录、3100/55421–55424无监听。详见MEDIA_ISOLATION_ACCEPTANCE/REVIEW，PR #11未合并。

后续先将已验证核心迁入生产模块、建立同字节P1可信桥接（B2-2A），再冻结并实现三表/统一归档/后台（B2-2B）。两条实现流保持Sol/high，Astra做非实施审查；新里程碑使用独立工作树，不继续修改已交付的B2-1或旧D1成果。STUDIO_P2B2_VALIDATION.md当前为合同候选，尚未实施；架构方向和常规开发已在托管授权内，不重复请求阶段启动批准。

## B2-2A 准备登记

总控工作树codex/quizpack-validation-bridge基于预检最终1f6f388。STUDIO_P2B2_VALIDATION.md的A范围已按独立审查冻结：A-R独占生产媒体目录及原shared/macOS/Linux脚本迁移，A-V独占P1内部执行拆分及server/validation；总控负责build/CI/fixture/部署身份与串行真实验收。停止上下文由A-R提供，所有层共享首个收尾期限；未知停止或单图运行失败中断整包，不只转成issue继续解码。父交付head CI核清前只准备，不写运行实现；B2-2B SQL与DTO后冻。

父1f6f388最终普通CI38183785073与平台CI38183785046现已全部success。总控正式放行两条Sol/high实现代理：`media_runtime_migration` 在codex/media-runtime-integration，`trusted_validation_bridge` 在codex/trusted-validation-engine，均从fce1246独立受管worktree开始。先交公共上下文/身份合同与纯候选证据；总控另让Sol小代理在专属忽略目录验证Next fixture定位，禁止改业务/根配置或占3100。隔离probe仅占自有3111，完成关闭，不当正式媒体验收。Astra继续非实施审查；Draft PR #12依赖#11，未合并。

## B2-2A 当前集成检查点

普通媒体入口、P1同字节候选与离线opaque封存器已集成；共享UNKNOWN、owned身份、期限竞态、native依赖映射与构建句柄问题均已独立关闭。中间5d779a7普通CI38188941135及Linux核心CI38188941100实际success；后者31smoke/11生命周期不能替代新target工作树和实际Next封存。Next已实测未封存/取消/过期三项关闭，无媒体启动，3111已释放。准确增量见P2B2A_REVIEW，最终target矩阵与阶段全套仍待完成。

当前并行采用Sol/high的媒体适配和Next fixture专属实现、Astra/high的非实施复验，总控单写共享文档/CI并串行真实setup→build→matrix→seal→服务验收。期间普通服务必须停止，未引入跨流程锁或热封存承诺。B2-2B只有精确提案准备，不建业务表/路由；待A退出后冻结三表与DTO再分流实施。

## B2-2B 精确预研登记

三表、统一存储/计量、claim/evidence/complete、恢复与有限重试、DTO/后台和验收分工已整理为[精确候选](STUDIO_P2B2B_STORAGE_PROPOSAL.md)。总控选择包身份canonical/alias/conflict分列、报告原始canonical text冗余以便SQL核真实字节，以及最多三attempt；validate claim同时记录media未知和完整预留，避免额外intent提交窗口。A-R平台身份查询的preclaim IO由平台guard独立保护，尚未打开原包。A-V后续需交prepare identity/restore candidate/SQL evidence projection三个明确接口。当前仍未冻结或实施B，不绕过A的Mac剩余平台验收。

## B2-2A 技术退出检查点

运行代码bdd5c51、集成head4793537：873单元/43离线工具、214真实DB/46驱动、206生产E2E及10既有跳过通过；格式/lint/类型/构建、独立登记问题闭合。Mac目标66项连续三轮、Linux31+11及两平台sealed真实Next入口全部通过。4793537普通CI38194638007与媒体CI38194638047实际success，PR #12仍Draft。原失败合成轮保留失败，已核实退出的控制/哨兵现场完整隔离归档；当前control空，自有服务/DB已停。完整边界与证据见P2B2A_ACCEPTANCE。接续B2-2B精确合同冻结和独立工作树实现，不在已交付A分支堆积业务表，不沿用fixture seal。

## B2-2B 合同准备登记

A最终844054c的普通38195851289及媒体38195851290均实际success。总控新工作树codex/quizpack-validation-storage已建立并完成冻结安装；STUDIO_P2B2B和B2B_VALIDATION_ADAPTERS取代旧STORAGE_PROPOSAL，独立前置复验已闭合并冻结，详见P2B2B_REVIEW。新批次以三表、统一存储、prepare→start和显式recover/retry为边界；V可信适配、D数据事务、S存储服务分开，公共类型后接U后台。总控保留共享配置、迁移集成和3100，未创建B业务表/迁移或启动实例。

## B2-2B 实施登记

合同8173107；共享HTTP有限错误654e823已通过20定向测试/类型/lint/格式；D公共接口ad8a116集成为6818942，公共适配集成后66定向测试通过；root早审的ledger大正文查询和key字段污染已修复，资源前缀排序另由30d0bd6→4718097修复并增加用例。Draft PR #13堆叠于#12、已附加。V在codex/validation-storage-adapters，D在codex/validation-data-transactions，S在codex/validation-archive-service，均Sol/high与独立worktree；D持55421、S持55422、root持55423，3100仅root。root已在旧0001–0008基线创建升级验收用独立test实例949a98a25d2720546a5d4005a748d3c6并停止，未运行新迁移。

远端CI38197814487（8173107）、38197842129（654e823）均未启动job步骤而失败；GitHub annotation明确为近期账号付款失败或支出上限需提高。不是代码检查结果，也不代表通过。需仓库账号Billing & plans恢复后再实际运行；独立本地实现/验证继续，不修改计费设置，不绕过阶段验收。

D数据线已完成本批独立交付（最终c838bbd），自身55421及探查实例全停；V可信适配最终8edb9c3已交付且独立复验闭合。root接入修后DDL/客户端与policy，并在旧8实例实际升级及独立跑通26PG，随后停止55423。U已在codex/validation-studio-console启动，b2486a4公共client/pending/http适配集成为18ea20b，46项纯测试通过；生产route等S实际factory，禁止stub按钮。S在codex/validation-archive-service继续应用服务与FS-safe共享fixture；root持有最终build/seal/3100，不将局部测试当阶段退出。

B2-2B独立实现审查发现receipt最终文件提前可读不足以证明publisher close结束，现63ed778修订为candidate+独立ACK+一次互斥complete/interrupt；0011审计enum/0012保护协议及policy v2，由D复用独立分支实施，S实现私有资格/门/服务。Astra确认此修订和两步迁移无架构阻断。U历史/刷新UI已集成，59纯测试通过；两处UI审查修复独立复验中，routes/helper仍待S factory。root0010库保持停止，下一次升级前先验证0010/仅0011不能启用新业务。远端计费阻断不变。

## B2-2B 集成验收检查点

0011/0012已在root独立旧库实际升级，34项domain与13项client PG分别通过，随后停止。ACK、锁生命周期、写结果未知等运行代码审查问题已独立闭合。S真实应用服务与恢复、U实际API和详情/历史页面已集成；最后运行代码修订ddf195f，构建追踪注解e4ce925。该main构建零warning，59trace/11357路径/零私有违规，部署绑定已实际完成；新媒体三轮正在执行，第一次65/66的失败保留，49f4072只修正BUSY用例屏障并通过独立窄审。

剩余工作为S测试夹具实际连接停止和审计归属两项P2、共享fixture的FS安全回收及实际服务PG故障测试；U补8个浏览器场景。root持有native/build/3100并在服务停止后维护测试数据，最后执行全套回归与四宽截图检查。它们不等于已交付或已通过。远端CI仍因已核实的计费限制没有运行步骤，不能把本地结果替代远端成功；阶段退出前需明确保留该限制。
