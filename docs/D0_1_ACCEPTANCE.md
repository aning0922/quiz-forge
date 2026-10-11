# D0.1 独立仓库与架构收口验收

日期：2026-10-11（Asia/Shanghai）。D0 外部初审有条件通过；本轮只完成收口，D1 未开始。

## 独立检出核验

初查发现会话旧目录仍受原项目 Git 管理。未重建 Git 或更改旧 origin，而是从正式远端正常 clone 到 `/Users/aipuli/Documents/Projects/quiz-forge`；该路径仅为本次环境证据，不是程序依赖。

- `pwd` 与 `git rev-parse --show-toplevel` 均为新独立目录。
- origin：`https://github.com/aning0922/quiz-forge.git`；main；克隆基线 `73b019d7ab7167877b77b7efa76524c589b752e9`；初始工作区干净。
- 安装、开发、类型、构建、浏览器测试与提交全部在独立根执行；Next 临时 root 覆盖已移除，agentRules=false 防止开发启动自动修改 AGENTS.md。
- 旧项目工作区和 origin 未改动；没有嵌套初始化、重写历史或强推。正式仓库保持 PRIVATE。

## 实际修改范围

`AGENTS.md`、`README.md`、`next.config.ts`；架构、数据、产品愿景、决策、路线图、D1 标准、PROGRESS、D0_ACCEPTANCE；新增 OPEN_SOURCE_REUSE_PLAN、本验收文档和 `.github/workflows/ci.yml`。

无新消费者/后台页面、表、Key 服务、引擎、候选开源依赖、插画或视觉实现；已有研究页面和锁文件保持。

## 访问与研究规划

架构补齐公共已发布介绍/授权演示、对应商品有效 Key、暂存恢复、一次完成、原链接只读报告、消费者/运营分离布局、无强制注册、独立无 Key 分享及可选多 Key 账号关联。数据只新增拟议公共投影、演示和访问/分享授权、未来关联关系；资源 ID 不能代替授权。

开源专项计划覆盖 Quizcraft、SurveyJS Core、inkjs、Puck，要求真实仓库/版本/许可/维护/技术兼容证据和四类采用决策，D1 期间或 D2 大规模实现前评估。Quizcraft 准确仓库待核，不能凭名称猜许可。当前未审计或集成任何候选。

D1 改为 A/B/C 历史人物素材与体验、结果/海报完整精品验收，之后 D/E 暗黑和卡通；累计十五状态、截图、素材授权和人工验收门槛保持，不限定一天。

## 本地验证（新独立检出）

| 命令                                      | 实际结果                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile` | 成功，锁文件不变，无旧 node_modules/.next 依赖          |
| `corepack pnpm format:check`              | 通过                                                    |
| `corepack pnpm lint`                      | 通过，0 警告/错误                                       |
| `corepack pnpm typecheck`                 | typegen + tsc 通过                                      |
| `corepack pnpm test`                      | 1 文件/3 项通过                                         |
| `corepack pnpm build`                     | 生产构建成功，无旧目录根推断警告                        |
| `corepack pnpm test:e2e:install`          | 在新项目内安装 Chromium 成功                            |
| `corepack pnpm test:e2e`                  | 20 项通过，移动/桌面与 320px、导航、404、动态偏好无回归 |
| `corepack pnpm dev --port 3200` + curl    | 开发服务启动，入口和 historical 均 HTTP 200；验收后停止 |
| dev 启动前后 `git hash-object AGENTS.md`  | 哈希一致，框架不再自动追加治理块                        |
| `git diff --check`                        | 通过                                                    |

安装仍提示 unrs-resolver build script 被跳过，当前实际检查正常；Playwright 的颜色环境提示无测试失败。现有测试不证明未实现的访问/事务业务正确。没有修改 UI，不新增商业视觉通过声明。

## CI 基线与状态

新增根 workflow，main push/PR/手工触发，Node 24 + pnpm 10.32.1，contents 只读，动作固定提交，冻结安装后格式/lint/类型/单测/构建；无部署、DB/模型凭据和 CI 浏览器依赖。已核实仓库 Actions enabled=true。

本地检查成功不等于远端 CI 通过。首次推送前远端尚未执行本工作流；推送后的实际 run、结论和链接在最终交付及后续证据记录中确认。如权限/额度阻断，记录阻断，不改付费或安全设置掩盖失败。

## 阶段边界

本轮完成后停止等待作者验收；D1 和开源候选实验/集成都未获本轮执行授权。最终提交 SHA 和远端同步结果由交付消息提供，仓库根用 `git log -1` 核验。
