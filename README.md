# QuizForge

趣味测评商品研发、导入与运营平台。核心模式为 **Codex 精品商品研发 + QuizPack 标准化导入 + QuizForge 统一运行与运营**。面向移动端 H5，强调每个商品独立的视觉身份、确定性评分和一次正式完成后可反复查看的结果报告。后台 AI 为可选辅助，不是运行与发布依赖。

**当前为 D0.1 工程收口，D0 有条件通过。** 可运行工程入口与主题研究页；已补充访问模型和 CI 基线，尚无真实测评、消费者目录、数据库业务、用户 Key、AI 生成、支付、后台认证或商品发布功能。全部方向示例明确标注为临时演示数据。D1 必须另行授权。

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

访问开发服务器打印的本地地址（默认 `http://127.0.0.1:3000`）。D0 不需要 `.env.local`；`.env.example` 仅记录后续数据库变量形状，不能用于生产。

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
    quiz/                    # 内容、版本、评分边界（仅说明）
    quizpack/                # 商品包构建/验证/导入边界（提案类型）
    theme/                   # D0 主题简报与研究展示
    report/                  # 不可变报告及海报边界（仅说明）
    product/                 # 商品及发布边界（仅说明）
    ai-generation/           # Schema 草稿与审核边界（仅说明）
    fulfillment/             # 渠道适配边界（仅说明）
  lib/                       # 通用工具；db 为预留说明
  config/                    # 工程元信息
public/assets/themes/        # 待制作素材清单，非最终图片
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
- [30 天路线图（计划）](docs/ROADMAP_30D.md)、[技术决策](docs/DECISIONS.md)
- [阶段进度与限制](docs/PROGRESS.md)、[D0 验收证据](docs/D0_ACCEPTANCE.md)
- [开源复用研究计划](docs/OPEN_SOURCE_REUSE_PLAN.md)、[D0.1 验收](docs/D0_1_ACCEPTANCE.md)

尚未确认小红书经营类目与外部 H5 履约权限。平台保持独立，未来经合法授权再接入第三方销售及自动发货。
