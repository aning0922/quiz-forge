# P1 B 流工具链实施

2026-10-12。基线 ecf0b0500a856769b51ca0c24f6776418fae35e2；共享合同修订 360b9c008983495075d689788e942291285a9028 已接入。实现工作树为 p1-package-tools，分支 codex/p1-package-tools。

首个里程碑：受限 ZIP 与本地 IO。ZIP 在解压前核验 central/local/EOCD、单卷 profile、路径、普通文件属性、连续且无隐藏区的字节布局、声明大小/压缩比。逐条 STORE/DEFLATE 实际字节计量、完整压缩流消费量、CRC；全部在内存，禁止路径解压。内部 readRestrictedZip 返回归档 SHA 和只读 Map 接口，P2 可复用这条安全读取路径，不能只凭报告另行解压。

IO 只接受显式文件；检查父目录与来源链接、目录越界、普通文件、O_NOFOLLOW 最终打开与字节预算。输出同目录临时 inode，经 fsync 后 hard link 原子提交，默认拒绝覆盖并清理临时文件。JSON 使用共享纯函数的严格普通 JSON/canonical/重复键检测，未改变 F1 语义；再实施下调深度。

限制：本地文件系统不作为恶意并发写者的 OS 安全隔离；来源目录需要由本地调用者控制。任意 AsyncIterable 的永久阻塞 next 无法被工具强制终止；工具取消后调用 return，Node 输入流主动 destroy，操作期限不会等待阻塞 return。媒体子进程与整包编排将在 A 流到达后接入。此里程碑不提供 import/publish 或正式商品批准。

已接入 A 内容合同 2d0f9d4 与总控 package 入口 c198702。A 媒体及文本/状态映射提交 78dc915 已接入；B 完成 build/validate、三项 CLI 及实际往返检查。ZIP 采用 Node zlib 独立扫描/解压而不使用 yauzl；总控可移除未使用的 yauzl 与类型依赖。

## 本地命令

从仓库根执行，stdout 只有一个 JSON 文档，失败 exit code 1。输出证据为本地技术检查，不是导入或发布授权。

```sh
pnpm --silent quizpack:schema
pnpm --silent quizpack:check example.quizpack --product synthetic-archetype
pnpm --silent quizpack:check - --product synthetic-archetype < example.quizpack
pnpm --silent quizpack:build input.json --product synthetic-archetype --out example.quizpack
```

`input.json` 是显式资源清单：

```json
{
  "packId": "example-pack",
  "packVersion": "1.0.0",
  "contentFile": "content.json",
  "assets": [
    { "path": "assets/neutral-cover.png", "source": "images/cover.png" }
  ]
}
```

清单字段 strict，contentFile 和 source 相对清单目录，不允许绝对路径、点段、链接或越界。以上清单是参数示例，实际包必须列出内容声明的全部资源，不能将示例空缺当合格包。CLI 不扫描目录；包内 path 与资源 ID/格式必须符合 A 的固定规则（含 96 字符上限），本地 source 是显式普通文件位置，与包内 path 分开。

build 从 canonical content 提取 Product/schema/engine 与实际组件三元组，并根据实际 bytes 创建 manifest。任何原 content 声明的 bytes/hash/尺寸冲突都导致独立 validator 拒绝，不能静默修复。构建器 STORE 固定路径/组件/清单排序、DOS 本地时间 1980-01-01 00:00:00、mode 0100644，无 extra/comment/descriptor。跨 TZ 一致性必须由真实 CLI 产物比较确认。

validate 在首次 await 前快照兼容 policy 和有效下调 limits，并把两者 canonical SHA 写入证据。builder 同时快照 content 与全部资源 bytes；核心与 CLI 在逐条读取/复制时核验累计 payload 预算，避免先缓冲超限资源全集。接收、解压和媒体共享整包取消信号/期限；媒体单项期限和 worker kill/reap 由 A 实施。报告逐项描述 passed/failed/not-run，原始 archive/manifest/content hash 保留实际字节身份；issues 上限与 issuesTruncated 明确。异常不回显来源路径、输入或堆栈。

总控负责六项集成检查、远端 CI 和独占 3100 E2E。此流不启动 E2E、不创建 PR、不合并 main 或部署。

## 完成交付验证

- ZIP/IO：57 项测试通过。包含独立手写 ZIP 字节夹具、危险路径/普通文件属性、中央与本地头/EOCD 不一致、重叠/隐藏区/截断、CRC、DEFLATE 尾随/第二压缩流、虚报实际大小、限额边界、输入清理；1 ms 下立即供给 28 MiB STORE 包拒绝超时。
- 截止时间修复独立提交 2e949e8。performance.now 绝对单调时间，与 signal 绑定；嵌套操作继承最早截止时间，读入/复制/scan/解压/CRC/hash 及最终成功处检查，批量复制与每条目让出事件循环，外部取消和定时器可被处理。
- build/validate/CLI：两 Product/两引擎往返，真实 PNG/JPEG/WebP 完整解码，独立 validator 之后交付；原始 hash、policy/有效限额快照、未知字段/重复 JSON 键、清单闭合/真实 hash、版本/Product、错误声明、兼容失败/issue overflow 与构建输入 accessors 都有拒绝测试。
- 真实 `pnpm --silent` 三入口通过；build 的 UTC 与 Pacific/Honolulu 产物 bytes/report 完全相同。check 支持显式文件与 stdin；原子 no-clobber、缺文件/链接/越界/错误参数失败 stdout 为单个 JSON，不回显源路径或原文。最终 JSON 在期限检查结束后输出，避免先输出成功又输出失败。
- build 的失败返回保留 Result 兼容，并附可选 issuesTruncated 元数据；结构错误截断到有效 issues 上限，独立 validator 的 overflow 标志也保留到 CLI。
- 本工作树 pnpm format:check、pnpm lint、pnpm typecheck、pnpm test、pnpm build 实际通过。最终 19 个测试文件 / 364 项单元测试通过。E2E/远端 CI 由总控串行验收，此流未执行、不声称已通过。

已知限制维持：本地工具、可信来源目录；受控媒体子进程不是 OS/RSS 硬隔离；资源来源/许可/审核只是声明；见证不执行、不证明可达，组件兼容不代表存在或渲染正确。未实现 DB、导入、人工审核、Key 或发布。所有报告 importable/publishable 始终 false；没有改动 UI、F1、package/lock 或其他项目。最终入口由总控提交接入，未使用依赖由总控统一移除。
