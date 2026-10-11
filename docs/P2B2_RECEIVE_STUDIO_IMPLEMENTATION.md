# B2-1 Studio 接收适配实施记录

日期：2026-10-12。独占分支 `codex/p2b2-receive-studio`，受管 worktree `p2b2-receive-studio`，固定基线 `5f2f8e5`。

## 里程碑一：reader 与文件准备

已实现 raw reader 适配：创建时不调用 read，cancel 不依赖 generator 启动且幂等；正常取消必须等待在途 read 与 reader.cancel 两者 settle 才释放锁；拒绝或挂起不构成停止证明。Handler 清理 helper 最多等待 1 秒并观察迟到拒绝。raw header 检查拒绝 multipart、编码和 Range/Content-Range，不信 Content-Length。

已实现浏览器本地文件准备：先检查真实大小 1..32MiB，再计算 SHA-256，一次生成 canonical UUID，并保留完整 input 与原 Blob。客户端检查不替代服务器真实计量/hash。

实际检查：专属单元 2 文件、8 测试通过；专属 eslint 通过；Next typegen + TypeScript 通过（2026-10-12）。初次类型检查发现测试 mock 取消函数推断为 Promise<undefined>，已显式改为 Promise<void> 后通过。

尚未接入 A 流服务，尚未运行真实 HTTP/数据库/生产浏览器验收。此里程碑不证明收到原包，也不证明 ZIP、内容、资源或授权正确。A 的共享合同到位后再接入 Handler 与页面；最终集成全套检查、3100 E2E 和图检由总控串行运行。
