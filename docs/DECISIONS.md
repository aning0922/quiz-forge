# 决策记录

日期：2026-10-11（Asia/Shanghai）。状态是 accepted 表示 D0 架构选择，planned 表示待开发，不意味着业务实现。

| ID      | 状态       | 决策与原因                                         | 影响/后续                                                                   |
| ------- | ---------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| ADR-001 | accepted   | Next.js App Router + strict TypeScript，模块化单体 | 低运维复杂度；业务逻辑归领域，不进路由或 UI 基础组件                        |
| ADR-002 | superseded | D0 初始采用临时目录提交，现由 ADR-022 替代         | 当前使用独立 QuizForge 检出与 origin，不再使用旧目录操作约定                |
| ADR-003 | accepted   | pnpm 10.32.1 与锁文件，Node ≥20.19/22.13           | 本机默认 pnpm 11 与 Node 20 不兼容；不修改全局工具。团队后续推荐受支持 LTS  |
| ADR-004 | accepted   | Tailwind v4 + shadcn/ui 手工基础环境               | D0 只引入 Button、cn、CVA、Radix Slot、components.json；不套 SaaS 页面模板  |
| ADR-005 | accepted   | 五层主题结构和独立构图                             | D0 是方向研究；D1 后才能固定正式 Token 与配方                               |
| ADR-006 | planned    | PostgreSQL + Drizzle，完成事务与唯一报告约束       | 已装 ORM/驱动；未连接数据库，无表/迁移。D5/D11 必须集成验证                 |
| ADR-007 | planned    | AI 输出版本化数据 Schema，程序确定性评分           | 不能执行生成代码；结构校验加作者审核，不把 AI 当完成权威                    |
| ADR-008 | planned    | 发布版本不可变，结果为锁定快照                     | 保留引用素材与模板版本，旧结果不随新内容漂移                                |
| ADR-009 | accepted   | 交易渠道解耦，权限确认后接入                       | 不预设小红书经营、支付或订单 API 权限                                       |
| ADR-010 | accepted   | 系统字体与原创 CSS 装饰作为 D0 研究表达            | 无远程字体构建依赖；不把装饰当立绘。D1 正式字体需授权/跨端验证              |
| ADR-011 | accepted   | Vitest 4（兼容当前 Node），Playwright 生产构建烟测 | 不盲用需要更新 Node 的最新版 Vitest；D0 Chromium 检查不等于实机/Safari 通过 |
| ADR-012 | accepted   | 预留模块以 README 表达，没有空业务 API             | 目录边界可维护，不虚构可用服务或启用数据库                                  |
| ADR-013 | accepted   | 图片生成延后 D1，D0 输出 pending 素材计划          | 可用工具不代表最终插画和版权已获批准；不在初始化冻结低质正式页面            |
| ADR-014 | accepted   | D0 不部署、不自动开始 D1                           | 本轮验收工程骨架并提交；等待作者下一阶段指令                                |

框架要求核对来源：[Next.js 安装与 ESLint说明](https://nextjs.org/docs/app/getting-started/installation)、[shadcn/ui 手工安装](https://ui.shadcn.com/docs/installation/manual)。实际包版本以 `package.json` 和 `pnpm-lock.yaml` 为准；Node 20.20.1 高于框架最低要求 20.9，工具链要求项目下限 20.19。

## D0 补充指令决策（2026-10-11）

- ADR-015 accepted：Codex 精品商品研发 + QuizPack 导入 + 统一运行运营是核心；后台 AI 生成降为可选，不能阻断发布和运行。保留现有工程/模块，不重启或提前开发。
- ADR-016 planned：.quizpack 使用 ZIP 纯数据容器，固定文件/兼容/哈希/规则夹具；限额、隔离、授权与人工审核后发布，拒绝包内代码。D0 仅提案类型。
- ADR-017 planned：ProductVersion 固定逻辑、商品视觉、报告/素材和专属组件版本；同逻辑多视觉，升级/回滚不改旧会话/报告。
- ADR-018 accepted：视觉支持全局基础、主题语言、商品资源、专属布局、交互表现；原五项视觉实现工具继续保留，不限制精品构图。专属 React 在主工程审核并通过受控注册引用。
- ADR-019 planned：三报告模式结论均确定性，AI_ENHANCED 只增强文字；完整基线、唯一任务、外部幂等/未知成功回退及最终一次封存。
- ADR-020 accepted：ESLint 9.39.5 固定匹配 Next 当前 react/import/a11y 插件 peer 范围；ESLint 10 试装出现 peer 冲突已撤回。9 已被上游标为停止支持，后续插件兼容后升级，不压制冲突。
- ADR-021 accepted：QuizPack Schema/验证/构建前移 D2–D4，数据库 D5，AI 辅助后移；30D 是里程碑计划，包安全与历史兼容不压缩。

## D0.1 决策（2026-10-11）

- ADR-022 accepted：正式私有仓库 aning0922/quiz-forge；从现有 main 正常 clone 为独立检出，根目录执行全部命令。替代 ADR-002，禁止 git init 重建、改旧项目 origin、覆盖远端或强推。
- ADR-023 accepted：移除 next.config.ts 中临时目录的 Turbopack root 覆盖，采用独立锁文件根推断；通过新检出的安装/类型/构建/开发/E2E 核验。
- ADR-024 planned：公共已发布介绍和明确授权演示、匿名 Key 消费者访问、运营后台分别规划权限与布局；完成后原链接只读，账号关联可选，分享凭证独立于 Key。
- ADR-025 accepted：轻量根目录 CI，Node 24 + 固定 pnpm，动作固定 SHA、contents 只读；冻结安装/格式/lint/类型/单测/构建。实际通过以 GitHub run 为准，权限/额度阻断不能冒充成功。
- ADR-026 planned：D1 期间或 D2 大规模引擎实现前专项评估 Quizcraft/SurveyJS Core/inkjs/Puck。仅研究计划，无许可/维护结论，不集成，不为复用推翻既定边界。
- ADR-027 accepted：D1 拆为连续里程碑，先历史人物素材/答题体验/结果海报整体精品验收，再扩展暗黑和卡通；三主题十五状态与截图标准不降低，不承诺一天完成。

CI 配置按 [checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[pnpm/action-setup](https://github.com/pnpm/action-setup) 官方说明设置。pnpm 版本来自 packageManager，setup-node 缓存使用根 pnpm-lock.yaml；CI 没有部署或调用业务服务。

- ADR-028 accepted：实际 dev 验证发现 Next 16.4 自动追加 agent rules 到 AGENTS.md，设置 agentRules=false 并移除框架生成块，项目治理显式维护；以启动前后文件哈希验证不会再次改写。
- ADR-029 accepted：首次 CI 已真实成功，处理其运行提示：pnpm/action-setup 固定官方 v6.1.0（node24）commit，runner 固定 Ubuntu 24.04，避免旧动作运行时和 ubuntu-latest 标签迁移。调整后再次核实对应 run，记录真实结果。

## D1-A.1 定向决策（2026-10-11）

- ADR-030 accepted（作者明确决定）：首款历史人物以folio为主，cabinet仅吸收为深青金框揭晓/人物卡/海报角色。同一Token、字体、人物与山水材质贯穿长卷，不维护两套消费者流程；旧原型与截图保留研究身份。
- ADR-031 accepted：正式未揭晓阶段不能提前暴露匹配人物。当前统一封面只用无人物山水且不接收report/identity；SSR/请求检查无具体人物。可信服务完成及授权结果路由仍planned，本轮静态synthetic页面不授予完成权威。
- ADR-032 proposed：只读结果展示DTO包含身份/称号、维度、依据、优势/短板、相似人物、文化介绍与收藏海报字段。它不是运行时Schema、评分引擎或正式报告存储。
- ADR-033 accepted：概念肖像只解析固定项目资源ID；未知不回退李白，缺相似资料不补造。正式人物/肖像绑定、资源审批及未知阻断待后续Schema/发布阶段。

详细决策、揭晓边界与D1-B/C验收计划见 `D1A1_VISUAL_DECISION.md`；本轮不授权答题/恢复或发布。

## F1 测评与资源底座（2026-10-11）

- ADR-034 accepted：Product 是测评工作区的稳定身份，题目、结果、私有资源均按测评/版本归属；类目、标签与视觉主题分离。
- ADR-035 accepted：可编辑 ProductDraft 带 revision 与内容哈希；验证/审核绑定同一候选，改动失效；发布生成不可变组合，升级/回滚不改变活跃会话和历史报告。
- ADR-036 accepted：资源按测评管理，以不可变内容版本引用；隔离上传与发布资源分开，DB/文件存储采用可恢复分步提交，拒绝原路径覆盖和跨测评隐式共享。
- ADR-037 accepted：先交付一款测评端到端，最小认证后台前移到包安全/数据库之后；三主题十五状态目标保留，AI/剧情/渠道后置。用户只授权文档与 F1，后续按阶段验收。
- ADR-038 accepted：F1 使用固定 zod 4.6.5 定义运行时结构并生成 JSON Schema；交叉引用另行验证。foundation.v1 不冻结完整 QuizPack；valid 不授予发布，导入文件自报的审核/哈希不是可信证据。
- ADR-039 accepted：本轮从 main b3e30bc 隔离实施，其他开发聊天暂停；保留 D1-D 未提交成果，原主工作区和所有旧研究验收不覆盖。
