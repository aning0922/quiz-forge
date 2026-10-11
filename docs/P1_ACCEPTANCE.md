# P1 包工具技术验收

2026-10-12（Asia/Shanghai）。代码验收提交 `3a1ad7ad98e6220bd1a26648f4589d42a12950c1`，正式 origin 为 aning0922/quiz-forge，分支 codex/quizpack-toolchain。后续交付文档提交不改变下述代码基线。P1 技术门槛已通过，可按作者托管授权继续 P2；不代表 main 已合并或内容/视觉/商业发布已批准。

## 已交付

- 独立 quizpack.v1 / quizpack-content.v1 strict 合同；两个 Product、两种引擎声明的合成 fixture；精确 Product/版本/资源/组件引用和六状态对应关系。
- 有界接收与受限 ZIP 结构扫描、STORE/DEFLATE 实际解压计量、CRC/SHA-256、完整压缩流消费和单调绝对期限；无磁盘路径解包。
- PNG/JPEG/WebP 原尺寸完整像素解码、动画/格式/像素/损坏拒绝、原生 Buffer loader 白名单、串行子进程及超时/取消 kill/reap；包内字体拒绝。
- canonical JSON 与固定 STORE/顺序/mode/DOS 时间构建，构建后独立验证；三个真实 pnpm --silent CLI，显式文件清单、脱敏错误、no-clobber 与明确原子提交回执。
- 分层验证证据绑定 archive/manifest/content SHA、目标 Product、validator/policy、兼容 policy 和有效限额 hash；技术成功始终 importable:false/publishable:false。

## 实际检查

在总控 worktree 执行冻结安装及 pnpm check，退出码 0：format:check、lint、typecheck、test、build、test:e2e 全部通过。Node 20.20.1/macOS arm64；20 个测试文件、385 项单测通过；生产构建后独占 3100 的 Chromium E2E 186 通过、10 项既有预期跳过，约 1.1 分钟。结束后 3100 已释放。没有新增 UI，既有研究体验/真实 PNG 导出由这批 E2E 回归；不把历史截图当作新商品视觉批准。

独立 Astra high 审查覆盖全部 P1 专项，8 文件/200 测试通过。五项复现问题全部修复并复审闭合：同步 ZIP 超期、空白必需文案、导出 Schema 遗漏 URL 限制、媒体成功回调超期、原子提交后晚到取消误报失败。不存在未解决 P1/P2 级发现。详见 [独立审查](P1_REVIEW.md)；200 项已包含在全仓 385 项内，不重复累计。

代码提交对应的远端 [CI 38158768248](https://github.com/aning0922/quiz-forge/actions/runs/38158768248) 已实际 completed/success，headSha=3a1ad7ad98e6220bd1a26648f4589d42a12950c1。Ubuntu 24.04/Node 24 冻结安装、格式/lint/类型/单测/生产构建均通过；远端没有运行 E2E，不能把本地 E2E 称为远端结果。后续纯文档交付 head 的 CI 单独核实，不与本代码 run 混淆。

[Draft PR #7](https://github.com/aning0922/quiz-forge/pull/7) 已创建并关联当前总控，基线为 F1 的 codex/assessment-resource-foundation，依赖 [Draft PR #6](https://github.com/aning0922/quiz-forge/pull/6)。两者仍 OPEN/Draft，main 仍为 b3e30bc；没有合并或部署。

## 实际命令产物

总控从 A 的 synthetic-archetype fixture 生成四个原创合成资源，以真实 quizpack:build 写出，再以 quizpack:check 重验。产物为 15,266 bytes，archive SHA-256 为 `3380e32b52d12e223dfbceb77d5079f602ca8f14e68adb80b6fa4bc7d6088076`；container/structure/references/integrity/media/compatibility 六项 passed，candidateValid:true，importable/publishable:false。

最终 CLI 返回 committed:true，output 为 quizpack-output-commit.v1，回执 bytes/hash 一致，postCommit.status=complete、warnings=[]。开发产物位于总控被忽略的 .cache/p1-smoke/reference-final.quizpack；不进入 Git，也不是正式历史人物测评。可重复命令与输入形状见 [工具使用](P1_TOOLCHAIN_IMPLEMENTATION.md)。真实三入口、文件/stdin、拒绝输出和跨 UTC/Pacific-Honolulu 字节一致性另有自动回归。

## 限制与下一阶段

仅为本机离线受限包工具；来源父目录须可信，媒体子进程不是 OS 沙箱/RSS 硬限制，远端任意上传还不能开放。pending/approved 与来源许可仍是包内声明。未执行评分/见证，不证明组件实际渲染、人工内容/素材批准；数据库导入、后台、Key、正式报告与发布尚未实现。提交回执不保证文件此后未被本地其他进程替换，不保证断电持久性；提交后清理警告要按已提交结果处理。

P2 先按 [数据库与后台预案](P2_DESIGN_PREFLIGHT.md) 建隔离本地数据库与运营认证，再做 Product/目录/草稿 revision/导入，最后结构预览与送审。逐里程碑冻结合同、测试与独立审查。首款内容准备保留独立分支，规则和人物覆盖修订后再交作者决定，不混入本 P1 技术验收。
