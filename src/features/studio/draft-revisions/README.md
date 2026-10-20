# P3-D Studio 实施

基线为共享 f35fd84，并同步 source-used 证据修复 1e74adc。公共合同及 DB/迁移不属于本目录所有权。

首批提供独立 URL/query 编解码、严格客户端绑定/指纹校验、4KiB 请求及64/128KiB成功封套/4KiB错误封套读取、独立有限错误表、注入 ProductDraftRevisionService 的 HTTP。append 使用写 UNKNOWN 边界；resolve POST 仍检查来源/CSRF但只调用只读服务签名，history 同样不借写权威。服务负责真实授权、RR/事务及成功前身份复核，HTTP 单测的注入对象不是 PG 证据。

新增 pending 桶保留旧桶，分别有16项/单项4KiB/整桶64KiB预算。prepare 与 sent 同步回读后才 fetch；未知、普通409、空或错误响应均保留完整原 tuple。所有写临界段复用旧 acquireDraftProduct 门闩，WeakSet仅核本调用 handle，未另建 Product 锁。旧首次的新准备检查追加桶；旧首次原 key 的读取/重放协议不变。新准备/追加发送检查旧桶，旧未知和任一整桶损坏阻止新准备；服务器读取与核实不因另一桶锚点而被隐藏。

resolve 只展示严格核验的证据，不自动移除条目。applied 可显示原固定回执，unresolved 保留，两个 not-applied 终态仍需用户显式 exact compare 移除。移除时再次严格解析、重算指纹、核原 tuple/当前请求代次/存储现存条目；不能按 Product 删除新 key。随后重新读取 current、重新确认、新 key，不自动换 base 重发。RevisionEpoch 将导航/撤权/重试与迟到响应隔离，abort不作为证明。

页面批增加验证详情的独立追加面板、显式冻结确认、固定回执和原请求核实；旧首次应用面板保持。工作区页增加独立追加锚点与锚定历史，current与原回执分别显示。历史scope使用已有只读hook新增的lastValue保留已知不可变draft身份，当前读取仍沿value只展示本次成功；刷新current或暂时失败不卸载历史组件，不拼新旧anchor。元数据仅按手动分页加载，最大100行，读取固定正文与预览仍使用原revision URL。

独审发现初版把整个追加区条件挂在来源读取成功后，来源503/404会隐藏原核实入口。整改后按稳定Product挂载，来源undefined/刷新/失败只关闭新准备，pending核实、拒绝状态和固定回执不依赖可变来源，且不沿用来源error的refreshing禁用。未发送确认同时核原source/base读取对象及完整tuple；即便刷新后返回相同字段，也要重新确认，不能恢复旧确认。生产E2E专门覆盖R2丢响应后来源HTTP503和真实不存在validation的404，仍核实原key并明确解除，未因此增加成功修订。

三条新API薄路由使用A真实createProductDraftRevisionService工厂：append、只读resolve、history。没有占位服务或伪成功状态。共享合同、A数据提交bc05261/6e9310b只作为依赖同步，不属于本线修改。

单测覆盖的是合成 DTO、存储失败、跨桶冲突、迟到票据、严格返回身份、预算、确认失效、历史续页及注入 HTTP；未启动数据库、3100、native、生产构建或浏览器。生产E2E接续A的真实独立夹具，最终真实生产与四宽图检由主控集成后执行。

七项生产E2E使用A正式fixture合同/helper和root传入QF_DRAFT_REVISION_E2E_RUN_ID；仅second、third成功追加至R2/R3，其他场景不制造额外成功。beforeAll120s/afterAll90s，prepare90s/finish60s；仅全通过finish，绝不从spec清理。实际执行和四宽截图尚待root，静态列举不代表通过。

视觉复核后的语义收口：准备按钮和确认标题明确以所示旧修订为基准追加，不暗示修改该旧修订。未知写入提示仅记录本次提交未收到可确认成功回执的历史事实，并指向原请求核实区最新证据，避免在严格终态出现后仍建议重放；不增加父子状态同步或自动清锚点。对应生产E2E同步精确定位，并在过期终态核对该稳定提示。实际重建与重拍仍由主控完成。

已应用回执的解除锚点操作使用独立容器，与固定阅读/预览链接保留16px垂直间距；四宽截图检查同时断言该间距，避免链接换行后操作贴边。其他终态的移除行为和授权检查不变。
