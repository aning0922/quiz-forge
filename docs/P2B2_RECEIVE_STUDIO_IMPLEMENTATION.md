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
