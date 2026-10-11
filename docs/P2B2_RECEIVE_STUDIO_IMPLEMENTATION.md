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
