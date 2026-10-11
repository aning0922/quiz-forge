# QuizForge

趣味测评商品研发、导入与运营平台。核心模式为 **Codex 精品商品研发 + QuizPack 标准化导入 + QuizForge 统一运行与运营**。面向移动端 H5，强调每个商品独立的视觉身份、确定性评分和一次正式完成后可反复查看的结果报告。后台 AI 为可选辅助，不是运行与发布依赖。

**当前主线已包含历史人物完整合成体验与真实 PNG 海报导出（D1-C）。** F1「测评与资源版本底座」已完成技术验收，Draft PR #6 待合并。作者已授权按路线托管推进至首款端到端内测，P1 包工具已在独立堆叠分支完成技术验收，Draft PR #7 待合并，接续 P2 数据库与最小后台；其他旧开发聊天保持暂停。前台仍为研究/演示，没有正式评分、AccessKey、数据库、管理后台或商品发布。最新事实见 [进度](docs/PROGRESS.md)，授权和阶段门槛见 [托管开发](docs/MANAGED_DEVELOPMENT.md)、[P1 合同](docs/QUIZPACK_P1.md)。

## 本地运行

需要 Node.js `20.19+`（20.x）或 `22.13+`，推荐团队后续统一受支持的 LTS；Corepack 与 Git。项目锁定 pnpm `10.32.1`，避免本机全局 pnpm 与 Node 不兼容。

```sh
git clone https://github.com/aning0922/quiz-forge.git
cd quiz-forge
git rev-parse --show-toplevel
git remote -v
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

已检出仓库时直接从其根目录执行安装/开发命令，不再进入另一个 `quiz-forge/` 子目录。正式 `origin` 为本仓库，默认分支 main；不要对旧项目副本提交。

在项目目录内也可使用 `pnpm`，Corepack 会读取 `packageManager`。本机默认 pnpm 11.9.0 在目录外与 Node 20.20.1 不兼容；不要运行全局升级修复其他项目。若发行版无 Corepack，先安装符合团队约定的工具再执行。

访问开发服务器打印的本地地址（默认 `http://127.0.0.1:3000`）。研究页面及生产构建不需要数据库配置。P2-A 只接受 `QUIZFORGE_P2A_CONFIG` 指向本工作区生成的私有 runtime.json；`.env.example` 仅说明路径入口，不包含连接串或凭证。数据库与认证仍在实施验收，不能作为生产环境使用。

## 验证

```sh
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e:install
corepack pnpm test:e2e
```

也可执行 `corepack pnpm check`（浏览器须先安装）。Playwright 启动生产构建，端口 3100 必须空闲。浏览器缓存存放项目内 `.cache/`，截图与 HTML 报告在被忽略的 `test-results/`、`playwright-report/`。`pnpm exec playwright show-report` 可查看报告。测试通过不代表 D1 的正式视觉设计验收。

`typecheck` 先运行 `next typegen`，因此干净检出不需要已有构建产物；`next-env.d.ts` 与路由类型由 Next 生成并忽略，不在 Git 中绑定 `.next` 文件。

## 路由

历史人物完整合成演示位于 `/studies/visual-v2-c`，含封面、四厅十二题、本机恢复、固定合成报告和真实 PNG 导出；旧研究页面保留。下表为 D0 基础入口，不是完整路由列表。

| 路由                 | D0 行为                          |
| -------------------- | -------------------------------- |
| `/`                  | 工程与三主题方向入口             |
| `/themes`            | 主题构图研究板                   |
| `/themes/historical` | 历史人物匹配设计简报             |
| `/themes/sins`       | 七宗罪趣味人格设计简报与娱乐说明 |
| `/themes/animals`    | 动物人格匹配设计简报             |
| 未知路由/主题        | 404 与返回入口                   |

没有开通真实用户答题、管理后台或业务 API 路由。它们的建议结构记录在架构文档，避免 D0 空接口造成错误能力预期。

## 工程结构

```text
src/
  app/                       # 路由、布局、全局样式
  components/                # 领域无关组件与 shadcn/ui 基础组件
  features/
    quiz/                    # 合成演示题目与进度解析；正式评分待实现
    quizpack/                # F1 合同与 P1 受限 ZIP/构建/验证；正式导入待实现
    theme/                   # 主题配方与历史人物研究体验
    report/                  # 合成展示 DTO 与真实 PNG 导出；正式快照待实现
    product/                 # 测评工作区合同与草稿纯逻辑；真实发布待实现
    ai-generation/           # Schema 草稿与审核边界（仅说明）
    fulfillment/             # 渠道适配边界（仅说明）
    studio/                  # 独立后台视图，P2-A 正在接入真实认证
  lib/                       # 通用工具及 server-only DB/认证/HTTP 边界
  config/                    # 工程元信息
public/assets/themes/        # 研究素材与清单；商业批准仍按manifest
tests/e2e/                   # 入口、路由、布局、动态偏好烟测
docs/                        # 产品、架构、数据、视觉、阶段证据
```

正式仓库为 [aning0922/quiz-forge](https://github.com/aning0922/quiz-forge)，所有文件位于独立仓库根。Next 根据本仓库锁文件确定应用根，无旧目录的构建覆盖设置，也不依赖其他项目路径。

## 消费者访问与 CI

规划允许公开浏览已发布商品介绍及明确授权的演示。正式答题必须持有对应商品有效 AccessKey；可暂存恢复、最多正式完成一次，完成后原链接直接读取锁定报告。普通买家不强制注册；未来可主动把多个 Key 关联到账号。公开分享采用独立只读凭证，不携带原 Key。消费者与管理后台分开布局，详细规划见 [架构](docs/ARCHITECTURE.md)，尚未实现相关路由或访问校验。

`.github/workflows/ci.yml` 在 main 推送、PR 和手工触发时，从根目录冻结安装并运行格式/lint/类型/单测/构建。CI 使用 Node 24、项目固定 pnpm，需在 GitHub [Actions](https://github.com/aning0922/quiz-forge/actions) 查看实际结果。E2E 保留本地阶段验收，暂不增加 CI 浏览器依赖。

## 维护文档

- [工程约束](AGENTS.md)、[产品愿景](docs/PRODUCT_VISION.md)
- [模块架构](docs/ARCHITECTURE.md)、[数据模型](docs/DATA_MODEL.md)
- [QuizPack 提案规格](docs/QUIZPACK_SPEC.md)、[三种报告模式](docs/REPORT_MODES.md)
- [视觉系统](docs/VISUAL_SYSTEM.md)、[D1 视觉验收](docs/D1_VISUAL_ACCEPTANCE.md)
- [阶段开发路线（计划）](docs/ROADMAP_30D.md)、[技术决策](docs/DECISIONS.md)
- [托管范围与人工决策点](docs/MANAGED_DEVELOPMENT.md)、[P1 包工具合同](docs/QUIZPACK_P1.md)、[P1 依赖评估](docs/P1_DEPENDENCIES.md)
- [P2-A 数据库与认证合同](docs/STUDIO_P2A.md)、[P2-A 验收记录](docs/P2A_ACCEPTANCE.md)、[P2-B 工作区与导入预案](docs/STUDIO_P2B_PREFLIGHT.md)
- [阶段进度与限制](docs/PROGRESS.md)、[D0 验收证据](docs/D0_ACCEPTANCE.md)
- [开源复用研究计划](docs/OPEN_SOURCE_REUSE_PLAN.md)、[D0.1 验收](docs/D0_1_ACCEPTANCE.md)

尚未确认小红书经营类目与外部 H5 履约权限。平台保持独立，未来经合法授权再接入第三方销售及自动发货。

## 测评工作区与后续开发

一款测评对应一个 Product；题目/规则/结果/页面/私有素材均归该测评，发布版本固定内容与资源引用。后台按测评进入工作区，类目和标签只组织目录；数据库与认证后台为后续阶段。详见 [架构](docs/ARCHITECTURE.md)、[数据模型](docs/DATA_MODEL.md)、[资源归属](docs/ASSESSMENT_RESOURCES.md)、[开发路线](docs/ROADMAP_30D.md)。

## F1 本地合同校验

```sh
corepack pnpm --silent foundation:check src/features/quizpack/fixtures/historical.foundation.json --product historical-synthetic
corepack pnpm --silent foundation:schema
```

校验命令支持用 `-` 读取标准输入，JSON限1MiB和32层。成功只代表局部结构与归属/引用检查通过；输出始终包含 `publishable: false` 和 `unverified`。输入中的素材 approved/hash 为自报声明，不证明授权或文件字节。参考包仅合成数据；无真实图片、评分或发布能力。

开发分工、模型和文件所有权见 [F1并行合同](docs/F1_COLLABORATION.md)。

## P1 本地包工具

使用 `corepack pnpm --silent quizpack:schema` 导出合同，`quizpack:check <file|-> --product <id>` 验证，`quizpack:build <input.json> --product <id> --out <file.quizpack>` 构建。输入清单、提交回执、限额和拒绝边界见 [工具使用](docs/P1_TOOLCHAIN_IMPLEMENTATION.md)，实际检查见 [P1 验收](docs/P1_ACCEPTANCE.md)。成功只表示候选包技术合格，始终不授予导入或发布。
