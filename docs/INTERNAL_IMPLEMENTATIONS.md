# P3-E 精确实现身份

2026-10-18。本步建立受信、编译期选择的 renderer/engine 描述与只读构建检查；不表示 review/version 服务、实际数据库导入或 P4/P5 已完成。版本合同见 [INTERNAL_VERSION_P3E](INTERNAL_VERSION_P3E.md)。

## 选择与留存

`implementation-catalog.ts` 保留不可变 metadata，按 kind/id/version/entrySha256 四项精确查找。可执行 availability 与历史 metadata 分离；不可用时 resolver 返回 null，不选择 latest、近似版本或请求指定的代码。历史事实读取不得依赖当前代码/字体还能执行。

| 实现                        | entrySha256                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| folio-cabinet-preview@1.0.0 | 35a1f8c7c6ce06c1afe09d7c3920f50a13a8fbbd674b7b6609890ae7dc1ed4f2 |
| archetype@1.0.0             | f934c3399f3731fb89afcbe9de8eb94f776f6d955d18e797eec072c532ba042d |
| dimensions@1.0.0            | e0b9231cd64d9c4ae62923788007beb28b59f2aef8327791ab7ba5fce37741d7 |

renderer implementationSha256 为 b315647781f67ea18dc3831744ee0fe7da21126198b2ac44ff4a48c8ba081b3a；两 engine 使用同一受控 adapter 闭包 d80686a5459a809600dcc577ce99dbc3fdb89db31bd3f0563ff39f43f849bd79，algorithm 不同，因此完整 entry 身份不同。registry 仅包含已审编译入口，不能从包、环境或数据库注册代码。

server resolver 提供固定评分 wrapper / 结果投影，client resolver 提供六状态组件及绑定具体字体的海报导出。engine wrapper 的私有 WeakMap 拒绝其他引擎或通用适配器产生的句柄。当前 renderer capability 仅为 `studio-internal-preview`，不承担消费者持久会话和正式报告权威。

## 构建检查

`pnpm implementation:check` 为只读门禁，`pnpm build` 在 Next 构建前调用。它验证各 descriptor 的 canonical 摘要、选中实现源码/样式/字体及配置字节、运行时静态 import/export 闭包、直接依赖版本、选中 importer 行和 lock records。现有 renderer 固定 47 文件、134 snapshots；engine 固定 25 文件和三 snapshots。三条 descriptor 实际共核 51 个不同源码/资源文件、280 条选中 lock record（包含各 descriptor 的重复）。

固定 tsconfig、renderer 的 Next/PostCSS 配置、Node 支持范围、packageManager、相关 pnpm lock settings；不固定整个 package.json、整个 importer 或整个 lockfile，新增无关依赖不会改变旧身份。当前实现没有选中 patch；发现 patch_hash 时明确拒绝，不能把尚未支持的补丁验证冒称已覆盖。

永久检查器使用有限 pnpm v9 文本读取器，拒绝重复/缺失/有歧义的 section/key，不接受 CRLF 或有歧义的 key quoting。选中源码中的动态 import、require 和 import-equals 被拒绝；当前 CSS 静态包引用和固定字体 URL 被显式覆盖。未来实现使用新的动态加载或 CSS 引用形式时须扩展并审查闭包规则。此次清单发现过程已由 Astra 用独立 TypeScript 转译闭包核过；永久 checker/resolver 的实际实现仍待独审。

受控 selector 的代码审查、冻结安装和构建证据共同保证实现选择；本门禁不是运行时扫描仓库或客户端自报身份。部署后资源丢失仍可能发生，新 seal 应在同一实际 owner/deadline 内验证 descriptor 指定的 font/coverage/license 字节；历史读取不做该 IO。浏览器每次 PNG 导出仍实际验证字体、字符覆盖与图片字节。

## 已完成验证与限制

主控三文件 30 项专项测试、定向 lint/typecheck 和只读门禁通过。覆盖错误 identity、跨引擎句柄、真实见证、metadata 留存而执行禁用、选中源码/字体/配置/依赖/settings 篡改拒绝、无关依赖新增不影响旧身份、重复 lock key 拒绝。

真实 Chromium 156.0.8078.4 使用精确 client resolver，浏览器 bundle 无 Node/Studio/评分实现、无 Buffer，实际导出三个合成和四个人物 PNG，全部 1080×1920；七个 Blob URL 均释放，FontFace 集合回到零。四人物由主控实际逐张查看，姓名/文案/人物与边框完整、未见裁切或重叠。合成三图字节与前次独审输出一致。本步是独立浏览器导出测试，使用本地受控资源 transport；不是生产 Next 页面、数据库准入、版本封存或消费者 E2E 验收。原内部预览水印保留。

私有产物与日志保存在受管主树 `.cache/p3e-implementation-*`，四人物导出图不进入公共 Git；安全摘要见 `docs/qa/p3e-implementation-browser.json`。首次探针的 CSS bundler 设置与 TSX evaluate helper 问题修正后重跑通过，没有更改产品显示代码。
