# QuizForge

趣味测评商品研发、导入与运营平台。核心模式为 **Codex 精品商品研发 + QuizPack 标准化导入 + QuizForge 统一运行与运营**。面向移动端 H5，强调每个商品独立的视觉身份、确定性评分和一次正式完成后可反复查看的结果报告。后台 AI 为可选辅助，不是运行与发布依赖。

**当前为 D0 工程初始化。** 可运行工程入口与主题研究页；尚无真实测评、数据库业务、AI 内容生成、用户 Key、支付、后台认证或商品发布功能。全部方向示例明确标注为临时演示数据。D1 必须另行授权。

## 本地运行

需要 Node.js `20.19+`（20.x）或 `22.13+`，推荐团队后续统一受支持的 LTS；Corepack 与 Git。项目锁定 pnpm `10.32.1`，避免本机全局 pnpm 与 Node 不兼容。

```sh
cd quiz-forge
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

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

目前位于现有私有父仓库的 `quiz-forge/` 子目录；没有嵌套 Git，无代码或运行路径依赖父项目，可以整体复制后独立安装。应用构建根显式指向本目录。

## 维护文档

- [工程约束](AGENTS.md)、[产品愿景](docs/PRODUCT_VISION.md)
- [模块架构](docs/ARCHITECTURE.md)、[数据模型](docs/DATA_MODEL.md)
- [QuizPack 提案规格](docs/QUIZPACK_SPEC.md)、[三种报告模式](docs/REPORT_MODES.md)
- [视觉系统](docs/VISUAL_SYSTEM.md)、[D1 视觉验收](docs/D1_VISUAL_ACCEPTANCE.md)
- [30 天路线图（计划）](docs/ROADMAP_30D.md)、[技术决策](docs/DECISIONS.md)
- [阶段进度与限制](docs/PROGRESS.md)、[D0 验收证据](docs/D0_ACCEPTANCE.md)

尚未确认小红书经营类目与外部 H5 履约权限。平台保持独立，未来经合法授权再接入第三方销售及自动发货。
