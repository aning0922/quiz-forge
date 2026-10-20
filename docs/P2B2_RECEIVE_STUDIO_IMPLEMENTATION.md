# B2-1 Studio 接收适配实施记录

日期：2026-10-12。独占分支 `codex/p2b2-receive-studio`，受管 worktree `p2b2-receive-studio`，固定基线 `5f2f8e5`。

## 里程碑一：reader 与文件准备

已实现 raw reader 适配：创建时不调用 read，cancel 不依赖 generator 启动且幂等；正常取消必须等待在途 read 与 reader.cancel 两者 settle 才释放锁；拒绝或挂起不构成停止证明。Handler 清理 helper 最多等待 1 秒并观察迟到拒绝。raw header 检查拒绝 multipart、编码和 Range/Content-Range，不信 Content-Length。

已实现浏览器本地文件准备：先检查真实大小 1..32MiB，再计算 SHA-256，一次生成 canonical UUID，并保留完整 input 与原 Blob。客户端检查不替代服务器真实计量/hash。

实际检查：专属单元 2 文件、8 测试通过；专属 eslint 通过；Next typegen + TypeScript 通过（2026-10-12）。初次类型检查发现测试 mock 取消函数推断为 Promise<undefined>，已显式改为 Promise<void> 后通过。

尚未接入 A 流服务，尚未运行真实 HTTP/数据库/生产浏览器验收。此里程碑不证明收到原包，也不证明 ZIP、内容、资源或授权正确。A 的共享合同到位后再接入 Handler 与页面；最终集成全套检查、3100 E2E 和图检由总控串行运行。

## 里程碑二：HTTP dispatch 与页面状态准备

总控明确交接 A `1bfe0082f38818b11da78730895e2bc1941b8594`，本分支 cherry-pick 为 `8928071`。实际为六方法；Handler 使用 A 的入口 deadline 工厂、DTO 和服务接口，沿既有 runtime/database adapter、Host/Origin/CSRF、strict JSON 与安全错误投影。意图新建 201、重放 200；读取和 disabled settings 返回 no-store 200；PUT 在所有早拒路径直接取消 reader，服务迭代前不 read。没有生产替代服务或直接业务 SQL。

准备列表/状态页组件、本地 SHA-256、完整意图与 key 保留、精确 page1/size1 无 status 查询、显式原 key/原 input 重提、上传/读取/恢复控件。已有 ID 的未知结果先读权威状态，不自动 PUT；空精确查询不证明未提交。received 固定显示“原包已隔离接收，尚未验证”、not-run、不可发布，无后续业务按钮。内存保留边界明确告知用户。只读、关闭、归档、空列表、错误、上传等待及未知状态已准备。

实际检查：专属 HTTP/查询/reader/准备单元 4 文件 29 测试通过，全仓 40 文件 566 测试通过；format:check、lint、typecheck 通过。初次页面类型检查发现 exactOptionalPropertyTypes 下的可选 props、RequestInit.body 和索引类型，已修复后通过。

已核实 55422 空闲并用管理 CLI 创建专属 purpose=test 实例，配置仅留本 worktree 私有目录。尚无 A 实际服务对象，因此未安装 API route 运行入口、未执行真实 HTTP/DB 接收或浏览器，也未启动 3100。此提交可独立验证适配边界；待服务交接后接真实路由、专属 HTTP/DB 与生产 E2E。

## 里程碑三：响应边界与累计未知整改

总控及独立 Astra 提出两项 P2：成功响应未经形状/归属/声明校验会错误清除 unknown；未知后原 key 重提遇到确定拒绝会抹去更早的 unknown。已在独占 imports 下新增 checked client adapter，复用 A 的字段 Schema/常量，严格校验 ImportDto、固定 not-run/publishable、settings、有限 Page 以及 safe error envelope。无效成功 JSON、null/{}、204、错 Product/import ID、错 bytes/hash 和未知错误码均保持 WRITE_OUTCOME_UNKNOWN；无效读响应返回 STUDIO_UNAVAILABLE，不清除未知状态。精确查询要求 page1/size1、0/1 条、total 与 hasNext 一致，并匹配原完整声明中的 bytes/hash 与固定 target（DTO 不包含 target，合同固定 new-draft）。

CreateReceive 的拒绝现在累计保存 previousUnknown，仅已校验创建/重放或精确命中记录可清除。ExistingReceive 与子控件同步最新服务器状态，恢复到 awaiting-upload 后可就地重新选择原文件；所有上传仍需显式操作。

实际检查：专属 5 文件 49 单元测试通过，typecheck/lint 通过。已编写生产 E2E：关闭/只读/空状态、真实原字节 received、独立 PG 观察已提交后丢 POST 响应、空查询后原 key/input 重提、后续 CSRF 拒绝保持累计 unknown、无效成功响应与无效 exact read 不清除未知。敏感凭证仅 0600 私有 fixture，trace/video/自动截图关闭，主动截图仅已登录无敏感字段状态。**这些浏览器用例尚未运行**；A 的实际服务、CLI 和测试 reset 清理合同尚待交接，不能据此宣称 HTTP/DB/E2E 验收通过。

补充：全仓 41 文件 586 单元测试通过。format:check 曾发现 E2E 两处链式调用在首轮格式化后仍需规范化，二次 prettier write 后全仓 format:check 通过；仅修正文档与测试格式，没有添加镜像测试。

## 里程碑四：真实接入与 HTTP/DB 验证

总控明确交接 A 核心 `f9593a7870938a4934388a578c5f8b783f9d2ee4`（本分支 cherry-pick `672b226`）。仅对本流 purpose=test/55422 运行管理 CLI migrate，实际应用 0006/0007；imports 启停也只使用管理 CLI。接入六个真实 HTTP 操作、两个页面组合以及 Product 详情导航。PUT/recover 的绝对起点在 Next route await params 之前保存，传给统一 context 工厂，预算不因页面参数/鉴权等待重置；新增过期入口测试证明不读 raw、不建 DB 即取消。

真实 PostgreSQL HTTP 专属 15 测试通过：disabled200/no-store、当前身份/只读能力、201/200重放、异指纹冲突、exact key包含received、跨Product404、归档可读但拒接收、配置快照后关闭仍拒写、strict query、Host/Origin/CSRF及早拒raw取消、假Content-Length下实际计量、重复received不read、真实hash拒绝、独立owner连接观察实际已提交intent后WRITE_OUTCOME_UNKNOWN与原key重放。首轮1项失败来自测试helper的undefined默认参数仍使用登录身份，改为显式null后15项通过；没有放宽生产判断。

生产 E2E 共8例已发现但**未运行**（由总控独占3100）：追加真实hash拒绝图检以及已停止claim的显式恢复/就地选文件。恢复夹具使用A窄内部afterCommit故障钩子，实际提交claim，独立DB确认receiving且read=0；正常helper退出后，由真实HTTP恢复自行证明记录PID已结束。无生产HTTP测试开关、无伪造receipt、无私有uploads访问。prepare→CLI enable→seed-recovery→CLI disable→cleanup在本流实例已实际通过，输出仅固定安全标志。

Astra复审另指出HTTP502+CSRF_REJECTED等错配仍会错误解除未知。本流adapter现用有限code→HTTPstatus映射，错配写为WRITE_OUTCOME_UNKNOWN、错配读为STUDIO_UNAVAILABLE；502/CSRF、500/INVALID_REQUEST、合法403/CSRF均有回归。专属5文件53单元、typecheck、lint、全仓format:check通过；新增映射前全仓42文件592单元通过，映射新增3项已由专属单元实际验证。

生产build通过，BUILD_TRACE_OK：53 traces、8614 paths、0 violations。Turbopack对A storage.ts动态.cache/p2a路径有两处宽匹配性能警告，未改A或共享构建配置，交总控评估。未运行本流浏览器/视觉截图、远端CI、test:driver或全仓test:db；专属HTTP真实证据不能替代阶段全矩阵。

## 总控生产浏览器反馈：状态选择器收口

总控在真实生产E2E中已通过auth3、workspace9及imports关闭/只读/空状态1例；创建/上传用例实际到达received，但全页not-run文案同时匹配接收面板和列表，strict selector失败。按反馈将not-run、received、rejected及接收暂停提示限定到具名“原包状态”region，保留全部断言；打开状态页后增加URL与页面标题等待，避免在列表过渡态断言/截图。其他意图unknown与精确查询提示为单次操作独有文案，静态检查未发现同类列表复用。仅做本流静态格式/lint与8例发现检查；实际浏览器重跑和图检仍由总控独占3100，本流没有启动服务器。

## 请求数据库初始化预算接入

总控明确交接 A `cd7688d4e6e5bc6758c77788c4f6b6c9010438a1`（本分支 cherry-pick `4438278`）。HTTP 建库现调用 `createDatabase(config, budget?.context)`，archive/recover 的初始化身份查询与后续服务使用同一入口绝对期限/取消信号，其他操作传 undefined。每次 Handler 建独立 client 并在 finally 关闭，不修改 A 或 lib/db/client；没有对 receive/recover 外层做 race，文件操作仍由服务负责 settle 与停止证明。

单元覆盖：延迟配置后 archive 初始化与服务收到同一个 context；recover 初始化/服务 context 同一对象；settings 无预算；建库阶段超时且 db 尚未赋值时返回 RECEIVE_TIMEOUT/408、不进入服务、不read raw、会cancel输入。专属HTTP单元14项、imports共5文件55项通过，typecheck、专属ESLint/格式检查通过。

仅受管重启本流purpose=test/55422并迁移0008；接入新初始化签名后专属真实HTTP/PG15项重新通过。HTTP测试的长服务由 Handler 自建请求client，没有复用 fixture.app；seed-recovery 在专属子进程只执行一次长服务，之前完成鉴权/意图，之后仅用独立 owner 连接观察，最后 close，没有并行共享。3100/E2E仍由总控运行。

## 总控20/20生产E2E后的图检收尾

总控反馈selector修复后实际auth/workspace/imports共20/20通过，并检查四宽关闭状态及320px received/rejected/unknown/recovered截图。图检发现本地文件准备成功时input key随pending变化会重建DOM，造成仍持原文件却显示未选择；现改为仅用户明确清空/重新选择时递增input key，初次SHA-256准备保留native FileList。现有真实接收E2E新增准备成功后的native value断言，以及明确清空后同一个合成文件可再选择的流程，没有删业务断言。

无原文件提示改为当前页上方选择/核实后显式上传。mobileEvidence在每个视口截图前scrollTo(0,0)并等待两个rAF，避免旧滚动位置令固定skiplink投影到整页图中；仍保留320/375/390/430、横向溢出断言与主动安全截图。此增量typecheck、专属ESLint/格式及8例发现通过；新native input断言和更新截图尚待总控生产重跑。本流55422已停止、未启动3100。

## 320px列表长度的图检整改

总控90e9887生产20/20再次通过，并确认native文件名、当前页恢复指导与skiplink截图伪影已修复。真实320px长页发现列表逐卡复用完整事实导致双hash与免责声明重复；本流现以显式ImportSummary组件展示状态、完整接收ID、声明bytes、storageCondition、not-run/不可发布，失败记录仍有按真实lastErrorCode投影的简短原因。完整双hash、冻结事实、修订及完整失败说明继续保留在原包状态面板/详情，不修改A服务或DTO。

列表区边界说明只展示一次。摘要详情链接可见文字收短为“查看接收详情”，可访问名称仍含完整ID，既有按ID/接收记录导航保持有效；分页与末卡之间有24px间距、16px内边距及分隔线。沿既有16px正文、48px链接/按钮目标，摘要事实使用有界两列及ID整行，并继承换行/最小宽度规则。

更新现有真实接收E2E：确认摘要的bytes、已对账、not-run/不可发布且不重复hash，通过摘要链接进入详情，再确认完整双SHA仍显示。typecheck、专属ESLint/格式与8例发现通过，没有新增镜像单元或启动3100；此摘要增量的四宽真实浏览器/分页图检待总控重跑，不能以静态检查声称视觉通过。55422仍停止。
