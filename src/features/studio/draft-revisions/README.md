# P3-D Studio 实施

基线为共享 f35fd84，并同步 source-used 证据修复 1e74adc。公共合同及 DB/迁移不属于本目录所有权。

首批提供独立 URL/query 编解码、严格客户端绑定/指纹校验、4KiB 请求及64/128KiB成功封套/4KiB错误封套读取、独立有限错误表、注入 ProductDraftRevisionService 的 HTTP。append 使用写 UNKNOWN 边界；resolve POST 仍检查来源/CSRF但只调用只读服务签名，history 同样不借写权威。服务负责真实授权、RR/事务及成功前身份复核，HTTP 单测的注入对象不是 PG 证据。

新增 pending 桶保留旧桶，分别有16项/单项4KiB/整桶64KiB预算。prepare 与 sent 同步回读后才 fetch；未知、普通409、空或错误响应均保留完整原 tuple。所有写临界段复用旧 acquireDraftProduct 门闩，WeakSet仅核本调用 handle，未另建 Product 锁。旧首次的新准备检查追加桶；旧首次原 key 的读取/重放协议不变。新准备/追加发送检查旧桶，旧未知和任一整桶损坏阻止新准备；服务器读取与核实不因另一桶锚点而被隐藏。

resolve 只展示严格核验的证据，不自动移除条目。applied 可显示原固定回执，unresolved 保留，两个 not-applied 终态仍需用户显式 exact compare 移除。移除时再次严格解析、重算指纹、核原 tuple/当前请求代次/存储现存条目；不能按 Product 删除新 key。随后重新读取 current、重新确认、新 key，不自动换 base 重发。RevisionEpoch 将导航/撤权/重试与迟到响应隔离，abort不作为证明。

单测覆盖的是合成 DTO、存储失败、跨桶冲突、迟到票据、严格返回身份、预算及注入 HTTP；未启动数据库、3100、native、生产构建或浏览器。组件、真实服务薄路由和生产 E2E 接续实施；最终真实生产与四宽图检由主控集成后执行。
