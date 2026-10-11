# P1 B 流工具链实施

2026-10-12。基线 ecf0b0500a856769b51ca0c24f6776418fae35e2；共享合同修订 360b9c008983495075d689788e942291285a9028 已接入。实现工作树为 p1-package-tools，分支 codex/p1-package-tools。

首个里程碑：受限 ZIP 与本地 IO。ZIP 在解压前核验 central/local/EOCD、单卷 profile、路径、普通文件属性、连续且无隐藏区的字节布局、声明大小/压缩比。逐条 STORE/DEFLATE 实际字节计量、完整压缩流消费量、CRC；全部在内存，禁止路径解压。内部 readRestrictedZip 返回归档 SHA 和只读 Map 接口，P2 可复用这条安全读取路径，不能只凭报告另行解压。

IO 只接受显式文件；检查父目录与来源链接、目录越界、普通文件、O_NOFOLLOW 最终打开与字节预算。输出同目录临时 inode，经 fsync 后 hard link 原子提交，默认拒绝覆盖并清理临时文件。JSON 使用共享纯函数的严格普通 JSON/canonical/重复键检测，未改变 F1 语义；再实施下调深度。

限制：本地文件系统不作为恶意并发写者的 OS 安全隔离；来源目录需要由本地调用者控制。任意 AsyncIterable 的永久阻塞 next 无法被工具强制终止；工具取消后调用 return，Node 输入流主动 destroy，操作期限不会等待阻塞 return。媒体子进程与整包编排将在 A 流到达后接入。此里程碑不提供 import/publish 或正式商品批准。

待接入：A 内容合同与媒体验证、build/validate、三项真实 pnpm CLI 和编排测试。总控负责 package.json 入口、集成六项检查和独占 3100 E2E。
