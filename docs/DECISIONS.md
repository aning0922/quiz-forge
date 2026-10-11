# 决策记录

日期：2026-10-11（Asia/Shanghai）。状态是 accepted 表示 D0 架构选择，planned 表示待开发，不意味着业务实现。

| ID      | 状态     | 决策与原因                                         | 影响/后续                                                                   |
| ------- | -------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| ADR-001 | accepted | Next.js App Router + strict TypeScript，模块化单体 | 低运维复杂度；业务逻辑归领域，不进路由或 UI 基础组件                        |
| ADR-002 | accepted | 沿用父私有 Git，所有产品文件仅在 quiz-forge        | 不另建嵌套仓库、不修改其他项目；独立运行可迁移                              |
| ADR-003 | accepted | pnpm 10.32.1 与锁文件，Node ≥20.19/22.13           | 本机默认 pnpm 11 与 Node 20 不兼容；不修改全局工具。团队后续推荐受支持 LTS  |
| ADR-004 | accepted | Tailwind v4 + shadcn/ui 手工基础环境               | D0 只引入 Button、cn、CVA、Radix Slot、components.json；不套 SaaS 页面模板  |
| ADR-005 | accepted | 五层主题结构和独立构图                             | D0 是方向研究；D1 后才能固定正式 Token 与配方                               |
| ADR-006 | planned  | PostgreSQL + Drizzle，完成事务与唯一报告约束       | 已装 ORM/驱动；未连接数据库，无表/迁移。D5/D11 必须集成验证                 |
| ADR-007 | planned  | AI 输出版本化数据 Schema，程序确定性评分           | 不能执行生成代码；结构校验加作者审核，不把 AI 当完成权威                    |
| ADR-008 | planned  | 发布版本不可变，结果为锁定快照                     | 保留引用素材与模板版本，旧结果不随新内容漂移                                |
| ADR-009 | accepted | 交易渠道解耦，权限确认后接入                       | 不预设小红书经营、支付或订单 API 权限                                       |
| ADR-010 | accepted | 系统字体与原创 CSS 装饰作为 D0 研究表达            | 无远程字体构建依赖；不把装饰当立绘。D1 正式字体需授权/跨端验证              |
| ADR-011 | accepted | Vitest 4（兼容当前 Node），Playwright 生产构建烟测 | 不盲用需要更新 Node 的最新版 Vitest；D0 Chromium 检查不等于实机/Safari 通过 |
| ADR-012 | accepted | 预留模块以 README 表达，没有空业务 API             | 目录边界可维护，不虚构可用服务或启用数据库                                  |
| ADR-013 | accepted | 图片生成延后 D1，D0 输出 pending 素材计划          | 可用工具不代表最终插画和版权已获批准；不在初始化冻结低质正式页面            |
| ADR-014 | accepted | D0 不部署、不自动开始 D1                           | 本轮验收工程骨架并提交；等待作者下一阶段指令                                |

框架要求核对来源：[Next.js 安装与 ESLint说明](https://nextjs.org/docs/app/getting-started/installation)、[shadcn/ui 手工安装](https://ui.shadcn.com/docs/installation/manual)。实际包版本以 `package.json` 和 `pnpm-lock.yaml` 为准；Node 20.20.1 高于框架最低要求 20.9，工具链要求项目下限 20.19。

## D0 补充指令决策（2026-10-11）

- ADR-015 accepted：Codex 精品商品研发 + QuizPack 导入 + 统一运行运营是核心；后台 AI 生成降为可选，不能阻断发布和运行。保留现有工程/模块，不重启或提前开发。
- ADR-016 planned：.quizpack 使用 ZIP 纯数据容器，固定文件/兼容/哈希/规则夹具；限额、隔离、授权与人工审核后发布，拒绝包内代码。D0 仅提案类型。
- ADR-017 planned：ProductVersion 固定逻辑、商品视觉、报告/素材和专属组件版本；同逻辑多视觉，升级/回滚不改旧会话/报告。
- ADR-018 accepted：视觉支持全局基础、主题语言、商品资源、专属布局、交互表现；原五项视觉实现工具继续保留，不限制精品构图。专属 React 在主工程审核并通过受控注册引用。
- ADR-019 planned：三报告模式结论均确定性，AI_ENHANCED 只增强文字；完整基线、唯一任务、外部幂等/未知成功回退及最终一次封存。
- ADR-020 accepted：ESLint 9.39.5 固定匹配 Next 当前 react/import/a11y 插件 peer 范围；ESLint 10 试装出现 peer 冲突已撤回。9 已被上游标为停止支持，后续插件兼容后升级，不压制冲突。
- ADR-021 accepted：QuizPack Schema/验证/构建前移 D2–D4，数据库 D5，AI 辅助后移；30D 是里程碑计划，包安全与历史兼容不压缩。
