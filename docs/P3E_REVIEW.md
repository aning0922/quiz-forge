# P3-E 独立审查记录

2026-10-18，承接P3-D交付a66c456。已完成范围/共享合同、显示解耦、精确基线登记及数据底座审查；实际服务、后台与阶段集成仍在推进，不能视为P3-E或P5完成。

## 范围与锁协议

Astra认可首款有限精确登记路径：离线核完整批准语义及技术映射，受信registry登记实际canonicalContent/assetSet/manifest三hash，运行时精确匹配同一产物，不新增通用语义等价引擎。baseline/renderer/engine分域，descriptor留存独立于代码执行可用性，临时preview能力不能用于P4持久Key。

首稿设计出现两项P2，已在[合同](INTERNAL_VERSION_P3E.md)修订并完成设计复核：

- 仅独立连接StorageReadGuard可能在连接中断后留下物理删除与业务提交窗口；新增同一业务事务的同键非等待shared advisory锁，取得后重验原guard，事务锁保持到COMMIT/ROLLBACK。review新增引用也执行，文件IO仍在事务前并确认收口。
- 同review多版本加100硬上限可能使无key、未被消费的请求永久unresolved；新增仅seal的capacity-exhausted终态，单RR原key优先、精确目标/head和100不可删除slot事实，依数据库NOT NULL/CHECK/UNIQUE硬约束。普通VERSION_LIMIT不充当证明。未来不得原地放宽旧协议，推翻已发永久未应用证据。

以上为设计P2关闭，实现须真实PG维护竞争/断连/容量竞态验收。

## 共享显示机器合同

主控提取lib/assessment-contract/display-v1、display-shapes-v1和display-limits-v1；旧Studio合同按原字段顺序组合并继续以binding.productId检查引用，显示正文不带draft/requestId或消费者权威。字体descriptor和resource transport仅供项目内受控adapter构造，无动态URL或代码能力。

主控15文件127项相关单元、类型、定向lint/format通过。Astra在独审副本复制准确8文件，实际16文件128项通过，包括5776例旧版解析器与新版逐路径差分（成功数据及失败issues完全一致）；浏览器独立打包仅包含中性合同及Zod，没有feature/server-only/Node依赖。旧字段顺序、完整封套预算、Product绑定、资源/结果/海报关系均保留，无剩余P1/P2，可冻结第十节并交B解耦。

B后续transport/媒体收口、私有评分句柄、六状态DOM和实际PNG尚未实施/验收；不能把本段Schema审查外推为这些运行链路通过。素材来源依据和首款离线映射另行核验，不用代理检查代替作者新内容或发布批准。

## 首款来源与离线映射

Astra已实际读取ROW/Europe Terms、Services Agreement和官方商业输出FAQ，认为来源文稿准确，可结合具体生成记录作为八图commercialUse/redistribution的供应方输出使用依据；不等于独占版权鉴证或作者商业发布批准。正式声明须绑定最终来源文稿SHA、单图SHA和精确生成记录，原资源pending/平台unverified及独立内测账本边界保留。

独审核19离线产物摘要、36实际输入摘要、来源公开文稿和OFL摘要；三张新原始PNG及李白原PNG核验通过。1971叶映射与outline逐项一致，168 reviewed-exact及1364可寻址评分转录逐源一致；四个witness.status沿既有declared-not-executed常量。九条alt只移除历史待审二字并记录批准来源，其他文本不改；category、空tags及列明的heading/ID/template属于受控技术映射，无新P1/P2。此时45来源/许可null和三权威hash为空的状态仍真实，最终规范包须完成声明后重新核验，不能据草案提前记准入成功。

## 审核与版本机器合同

主控新增internal-versions的strict请求、三类identity、review批准事实、不可变snapshot、分域指纹、永久核实终态、有限列表、完整封套预算和async integrity。独审发现一项P2：直接复用server canonical引入node:util/Buffer，浏览器无法bundle；仅新协议改为Schema解析后可在浏览器运行的canonical，原通用安全canonical不改。新实现明确不提供JS Proxy鉴别能力，不替代服务器通用不可信对象入口。

修复后主控12合同单测、类型/lint和真实Chromium156的5项完整性/4身份家族逐字SHA对照通过。Astra独立重跑12测试、实际browser bundle/file页面（Buffer/require均不存在）及4家族对照；另256组Unicode/转义/数值/顺序差分、512次字节边界、14类非JSON/accessor零执行/深度拒绝均通过，P2关闭。独审最坏完整100列表129221B、detail5171B、8renderer state5367B均在预算；无剩余机器合同P1/P2，可冻结交两实现流。权限、DB、真正same-RR/当前授权、资源收口和维护并发仍须实际实施验证。

A的每请求owner闭包设计已前置复核：同步transfer和一次性runNew、精确db/budget/clock身份、实际FS及SQL/关闭收口归actual callback；保留原数据库取消关闭机制、UNKNOWN与晚成功核实。独审18项既有task/storage回归通过只说明现有基础，不冒称新owner已验收。

## 编译期精确基线登记

主控登记历史人物与明确synthetic-test两条descriptor，register仅模块内静态调用；metadata按完整kind/id/version/entrySHA查找，申请按真实源Product/三hash/实例用途匹配，供已核真实来源的应用服务使用。无请求、环境变量、数据库或cache动态注册入口，不宣称hash匹配授予导入/native资格。

Astra独审17单元、深层冻结与purpose矩阵、全部实际字段/来源摘要/语义边及4+3评分见证通过。历史条目entrySHA为b16780ff815b38a224b456344e1509b672c10fe398482c4aaca297985bffd4a0，synthetic为808741230320dfd12ef7eb4bcfaec0063bfae6080ef2aa74393df94ec6ee55fc。synthetic原规范JSON/五PNG与双准备进程逐字节相同，作为固定测试输入保存以避免跨平台重新编码；仅四精确canonical JSON路径排除格式化。真实三张私有PNG未进入Git。

registry实际server bundle闭包仅受控代码和两descriptor，没有tests/.cache/原图或私有路径；这不是最终Next trace验收。模块无剩余P1/P2，可供A接入；新写仍须源码端口重算真实hash、实际purpose限制、请求identity精确一致，facts由descriptor给出。原key优先与历史metadata独立于执行可用性，须在服务集成验证。

## 显示实现解耦

B 的 5a21027（主控集成2ca7698）改为纯显示DTO、编译adapter注入resource transport/字体，保留旧Studio封套和错误constructor。Astra实际21文件141项、56种引擎/长报告/维度/问题边界及非法输入逐字节投影对照通过；旧及伪造prepared句柄被拒绝。独审Chromium156导出的low/middle/high三PNG旧新字节完全相同，1080×1920，6个Blob URL均释放、FontFace回归零；实际查看中间样例无新问题。

纯导出bundle没有Product/Studio/Node。旧Studio对照harness为其旧模块图提供未使用且调用即抛错的node:util proxy shim；没有将它冒称生产Next构建或消费者浏览器bundle。当前显示范围无剩余P1/P2，后续后台新链路独立验收。

## 数据底座、真实旧库与审计NULL修复

A提交b004596/0d20483，Astra独立核六列revision及九列review FK、100 slot硬约束、canonical文本/SHA/列对应、源触发器、有限SELECT/INSERT与禁UPDATE权限、函数/索引/触发器精确guard；owner同步transfer、一次性db/budget身份、实际SQL/close观察和quarantine符合合同。独审实际30项相关单元通过；A的31项PG及5项重复guard、谱系升级和两旧清理/升级测试由独审读取实际工具证据与断言，不冒称独审重跑PG。

独审发现P2：新增audit_target OR分支在target_kind或target_revision为NULL时CHECK结果为NULL，PostgreSQL接受。A在原隔离库实际复现两action各两字段共四例，事务回滚后零残留。64ace0d显式非空并将整个CHECK包IS TRUE，精确guard同步；保留停止旧checksum现场，在fresh实例验证四负例23514/audit_target、两正例成功，连同谱系升级/两guard/核心合计23PG通过。Astra读精确diff与实际结果确认P2关闭，三个commit可集成。该结论不包含A后续未提交服务或真实owner+FD/晚COMMIT故障测试。

主控集成为1b446c5/b2f726b/1633f55后，另升级此前从P3-D真实建立的0016实例：14旧表、16迁移checksum及5blob在任何新认证写入前逐项保持一致，3修订谱系保留，原首次及两次追加key回执一致；双向旧新guard验证正确，未补造review/version。实例已停止保存，安全证据见[旧库升级](qa/p3e-legacy-upgrade.json)。不是用新代码重建0016代替原现场，也不是native/浏览器准入验收。

## 精确实现与浏览器复验

Astra对a589b00实际永久manifest/resolver/checker独审通过，无P1/P2。独审副本30专项及3descriptor/51文件/280record门禁通过，另用独立YAML读取逐边核140个snapshot及packages/importer对应无漏边；注入真正无关dependency/importer/lock条目仍通过。metadata留存与精确可执行选择、固定字体、私有引擎句柄及篡改拒绝符合当前边界。

独审实际Chromium156.0.8078.4重导3合成/4人物海报，七图1080×1920且字节/SHA与主控完全一致，7URL释放/FontFace零回归；四人物均逐张查看，无裁切/重叠。bundle无Node/Studio/评分代码，无Buffer。测试harness首次私有文件相对路径错误改为已知绝对只读路径后通过，未改产品代码。此处不代表生产Next或数据库封存E2E通过。

主控底座完整1612单元、lint、类型通过。完整451PG首次450通过、唯一失败是旧数据库表清单尚缺新两表；仅补精确预期后原文件41项全过，保留首次失败日志。46真实驱动场景通过。B新增客户端集成159项通过；服务/HTTP/后台、最终完整测试与媒体/E2E出口仍继续。

## 服务与HTTP配对

7a65877真实服务与69b6b17 HTTP经过Astra配对独审，无阻断集成P1/P2。独审实际10文件128项通过，含新增7项HTTP/service/owner/回执配对（DB读取隔离）和3项真实字体/延迟FD关闭探针。确认原key在归档/不可执行条目/无FS条件仍优先、绑定冲突与fresh失权拒绝、写后关闭失败为UNKNOWN而只读核实为不可用；实际FD延迟关闭后才关闭DB、guard和clock。

A首轮服务PG因合成ordinal素材声明冲突为9/10，保持固定像素字节并修正测试来源构造后第二轮10/10；主控集成6f93f85再次真实10/10。该结果不冒充最终100slots/物理留存/生产Next路由/E2E。纯HTTP追加独审118项及B客户端171+8独立回归均通过。

主控另增加真实PG并发探针：通过仅用于测试的读取屏障，确保两个不同key都先观察不存在，再分别竞争相同review及version；每类只有一个成功，失败类型受限，失败原key获得严格target-used证明，最终1review/1version/2审计。实际运行通过，未修改生产锁策略或登记动态实现。夹具仅清理本次精确actor/ID，未知行保留。

## 后台失权代次待整改

ce1357实际页面/路由生产构建在主控通过：80traces、17204paths、0私有违规，完整144文件1704单元、format/lint/type通过。Astra代码核无新增可执行HTML路径，静态样式符合16px正文/44px目标方向；真实四宽图检仍待最终构建。

独审真实React/Chromium156复现P2：已有seal原请求正在核实，页面state/list返回401后只清空页内事实，没有使独立pending区epoch失效；随后迟到的有效sealed响应仍可被接纳并启用清理，实际点击会删除原锚点。页面父层与两个恢复区必须共享稳定Product的授权失效代次，401/403/CSRF同步使在途写/核实/清理失效并保留锚点；普通503/404仍应保留原请求只读核实。已交B整改，未关闭前不签UI失权/迟到验收，不以1704单元或构建成功替代该实际反例。

原反例使用精确组件/flow/client，Next Link仅替为a，既有未执行node:util使用throw shim；该隔离复现不能当生产Next视觉验收。独审其余45项SSR/flow/view-state通过，P2仍真实待修。主控14项PG（13服务+1不同key并发）日志已由独审直接复核。

## 失权、夹具归属与测试日志整改关闭

跨组件失权P2由2feb807/dd3448修复，主控集成dd0011d/4c29c09。Astra用四类真实React页面重跑24浏览器交互：16项401/权限/CSRF/Origin403先到后迟到有效proof均不允许清锚且保留原tuple；8项404/503仍可核实并显式清除。独立116相关单元通过。这是实际组件交互，不冒称生产Next E2E。

cd590夹具首稿只核登记来源却按Product删除完整图，独审提出同Product外actor额外来源P2。A真实复现：finish后加入第三个无review/version引用、reserved=0的ready源，旧cleanup已删除自有review/version并达到首次unlink；精确拦截避免真实删图，原现场停止保留。a705在任何DELETE/unlink前核完整imports/validations/revisions/applications/assets、actor、首次来源及workspace事实。fresh负例保留所有账本/外来行及5文件，跨Product借用4旧PNG、只删除1自有scene的实际正例也通过；Astra逐行与实际工具证据复核关闭。不是只靠最终FK拒绝。

247原测试中的Playwright APIRequest/route.fetch会在失败HTML报告嵌入Cookie/CSRF；独审用环境注入的纯合成哨兵证实，普通catch加固定错误也不能清掉内部step日志。e715改为受限Node http.request、不重试/不跟随redirect/不转发Set-Cookie、有限路径/方法/预算及无raw cause错误。Astra独立实际两旧对照检出、六新场景全部stdout/JSON/HTML ZIP/附件零哨兵，P2关闭。六case完成门禁11纯边界与7真实Playwright模式也通过，只有完整六次真实passed允许finish。535另确保迟到response及客户端finally完成之后再断言拒绝，新增真实原key重放校验。

## 真实关闭拒绝与完整批次的前提修正

A d9a4ca8两项在隔离Node child实际打开/读/hash文件及真实PG事务，再有意拒绝FileHandle.close或driver.end；保留真实FD/保留reserved连接。超最后原deadline再过完整5s仍四名额/四shared guards，维护忙且第五新工作拒绝，原key/只读resolve继续可用、账本仍1/1/2。只在实际child close/组消失、PG/guard为零后才精确清理；Astra代码与两份实际安全JSON复核通过。这是注入拒绝，不声称操作系统自行故障。

root第一次后续完整PG共467项，186通过/263失败/18跳过。首个真实失败为生命周期final cleanup看到imports.enabled=true而保守拒绝；已保留账本使后续reset保护级联拒绝，并非把所有失败解释为独立业务缺陷。f677现场停止保存。c2d6e5只在两类测试调用方显式正式禁导入：普通生命周期在首次cleanup前，quarantine场景在child前；从enabled=true分别实际2项与2项通过，独审关闭对fresh默认false的依赖，生产cleanup检查未放宽。新的完整PG仍单独待结果。

root E2E编排同runId、独立single-worker/retries0 project依赖P3D，默认mobile/desktop排除新spec；全PW成功且真实退出证明成立后，核completed、正式禁导入，再P3E→P3D→P3C→B3→B2精确清理。未知/失败保留；精确project名加入现有CLI白名单，不允许控制参数绕过真实执行。独审只读枚举251测试/19文件，P3E六case无重复；参数13项通过，实际完整E2E尚未运行。

## 最终回归与版本列表成功分支 P2

调用方修复后主控 fresh 完整 PG 56 文件 469 项全部通过，243.87 秒。5db7d46 远端普通 CI 39125409038 亦实际 1709 单元、469 PG、46 driver，并在另两个 fresh 库通过 14 服务与 3 媒体 UNKNOWN；媒体 CI 39125408991 success。此前失败现场未复用。

第一轮生产 E2E 因新增 beforeAll 默认 30 秒小于正常认证窗口等待最多 61 秒而在准备期失败，235 通过/1 失败/10 旧 skip/5 未运行。34ba467+3cc1ca8（root 4cd8c2f/5db7d46）给两个 hook 各 120 秒，子进程仍 90 秒；Astra 精确复核实际 execFile close、六项完成门及失败保留不变，通过该修复。

第二轮为 237 通过/1 失败/10 旧 skip/3 未运行；新增 review/seal 前两项及 40 张图实际完成。版本列表第三项在异步草稿成功返回后卸载，按钮 detached。root 用实际失败 fixture 的有效完整 DraftSummary 离线确认 URL helper 的 unrecognized_keys；Astra 独立严格 checkDraftRead 接受 21 字段 DTO，旧 helper 拒绝 18 个额外字段，三字段投影成功。实际 React/Chromium 156 operator 与 read-only 两类迟到合法 draft GET 均导致 ZodError、整页卸载、恢复按钮从可用变为 0，而两原锚点仍原样保留。此为生产 P2，B 正修复并等独立复验；不以 force click 或更长 timeout 绕过。独审证据为其私有 `.cache/p3e-ui-review/draft-crash-result.json`，未连接 root 失败库。

此前 24 场景失权矩阵的 draft GET 使用失败响应，未覆盖此合法成功分支，故其通过不外推。两轮失败库 434…/d4faa… 均正式停止、相关进程与 3100 均无残余，finish/cleanup 未放行。最终技术出口和修复后全量图检仍待完成。
