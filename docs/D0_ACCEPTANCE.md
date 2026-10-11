# D0 验收证据

日期：2026-10-11（Asia/Shanghai）。结论：工程初始化和补充架构工作已完成，自动检查通过，待作者人工验收；D1 未开始。

## 环境与技术栈

| 项目                    | 实际版本/状态                                                     |
| ----------------------- | ----------------------------------------------------------------- |
| 本机 Node.js            | 20.20.1，满足工程 Node ≥20.19 要求                                |
| Git                     | 2.50.1 (Apple Git-155)                                            |
| Corepack                | 0.34.6                                                            |
| pnpm                    | 项目固定 10.32.1；默认全局 11.9.0 与当前 Node 不兼容              |
| Next.js / React         | 16.4.0 / 19.3.0                                                   |
| TypeScript              | 5.9.3，strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes |
| Tailwind                | 4.3.3，PostCSS 同版                                               |
| shadcn/ui               | 手工源码组件环境，new-york；Button/CVA/Radix Slot 1.4.0           |
| Motion                  | 14.1.0；D0 无正式商品动效                                         |
| Drizzle / postgres 驱动 | 0.45.4 / 3.4.9；无真实 DB/Schema/迁移；PostgreSQL 服务版本未检查  |
| Vitest / Playwright     | 4.1.11 / 1.64.0                                                   |
| ESLint / Prettier       | 9.39.5 / 3.9.10                                                   |

版本选择依据和兼容风险见 `DECISIONS.md`。没有提交真实密钥；`.env.example` 为明确的本地示例。

## 实际验证

命令均在 `quiz-forge/` 执行。检查报告只反映 D0 范围，不代表未实现业务通过测试。

| 命令                                      | 结果                                 |
| ----------------------------------------- | ------------------------------------ |
| `corepack pnpm install --frozen-lockfile` | 成功；锁文件一致，无全局工具变更     |
| `corepack pnpm format:check`              | 通过                                 |
| `corepack pnpm lint`                      | 通过，0 warning / 0 error            |
| `corepack pnpm typecheck`                 | 通过；先 typegen，不依赖已有构建产物 |
| `corepack pnpm test`                      | 1 文件、3 测试通过                   |
| `corepack pnpm build`                     | 生产构建与全部静态入口生成成功       |
| `corepack pnpm test:e2e:install`          | 项目内 Chromium 安装成功             |
| `corepack pnpm test:e2e`                  | 20 测试通过；两项目，生产服务器 3100 |
| `curl` 本地 3000 入口                     | HTTP 200；验证后停止临时预览服务器   |

早期严格 lint 的 PostCSS 匿名导出警告已修正；Vite ESM 配置提醒通过项目 `type=module` 修正。ESLint 10 peer 冲突后固定兼容 9；pnpm 提示 resolver 安装脚本被跳过，当前实际验证正常。Playwright 启动器的 NO_COLOR/FORCE_COLOR 提示不影响检查结果。

## 覆盖与限制

- 单元测试：未知主题不能默选；三主题全五状态仅方向；素材包引用匹配且全部 pending，不伪报批准。
- E2E：五真实路由的 HTTP/内容/运行时错误、导航往返、未知主题 404、键盘跳转、reduced-motion、320 px 各路由无横向溢出。桌面与移动各 10 项。
- 实际截图：390×844（mobile Chromium）及 1440×1000（desktop Chromium），五路由各全页截图；每项目附正常/减少动态截图。不是 D1 正式十五状态。
- 截图视觉检查：主入口和三主题简报阅读/构图无裁切；按钮原文字对比问题已修正；三研究方向有独立几何构图，角色立绘均明确待制作。
- 未测试：QuizPack 解析/导入、三评分引擎、数据库/并发完成、AI 增强、真实报告/海报、后台/支付、Safari 或实机。它们没有实现，不作通过声明。

## 证据文件

保留以下当前 D0 截图，全部为合成方向数据：

- [桌面入口](qa/d0-home-desktop.png)
- [移动入口](qa/d0-home-mobile.png)
- [古风简报](qa/d0-historical-mobile.png)
- [暗黑简报](qa/d0-sins-mobile.png)
- [卡通简报](qa/d0-animals-mobile.png)

完整测试运行报告在被忽略的 `playwright-report/`，原始截图在 `test-results/`，重新运行会更新这些产物。上述保留截图是 D0 工程研究板，不是商业页面验收。

## 商品研发模式调整与架构影响

保留 Next/TypeScript 工程、三引擎规划、五项视觉实现载体、一次完成及历史结果、独立交付边界。改为精品研发和标准包生产，新增 QuizPack/导入记录、ProductVersion、ProductVisualVersion、组件注册引用、三报告模式与唯一 AI 增强任务提案。

包通过结构/引用/兼容/规则/安全检查后导入草稿，人工预览审核发布；普通商品不改业务代码，精品 React 布局在主工程审核注册。三模式结论全部确定性，AI 只增强文案并完整回退。ZIP 安全、素材授权、旧组件保留和外部 AI 幂等是新增风险，详细策略在 `QUIZPACK_SPEC.md`、`REPORT_MODES.md`。

30D 排期前移包 Schema/验证/构建到 D2–D4，数据库 D5、评分 D6/7、运营导入 D16；AI 文案与草稿辅助 D19/D20。D1 视觉优先不变。不存在需要重建 D0 工程的技术冲突，但包安全和历史兼容增加工期，按里程碑调整，不能压低验收。

## Git 与阶段边界

沿用父仓库 `origin`，本次独立提交只含 `quiz-forge/`；SHA 与远程同步结果由最终消息提供，避免文档自引用提交哈希。父仓库其他工作的未跟踪文件未纳入提交。本轮没有部署或开发 D1。
