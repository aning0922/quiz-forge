# P4 消费者纯显示实现

从 P3-E `c83788b` 接续共享 `5916516`、`6b5b4ef`，接口小提交为 `52cd7a4`。当前已实现独立六视图、精确 source/runtime 映射检查、server-only 显示投影及 consumer PNG；尚无持久化 host、业务 HTTP 或真实 Key/session/report 闭环。显示中的保存/完成状态由调用方提供，合成浏览器验证不证明真实持久化。

## Props 与回调边界

`interfaces.ts` 只依赖 React 类型与稳定 display-v1，不接受 raw Key、grant、Cookie、CSRF、operation key、数据库对象或完整评分源。调用方须先验证 source/play/runtime 的精确绑定、获权内容及服务器事实；类型不授予这些权威。

- cover/question/resume 使用 DisplayEntryBodyV1；saved 来自已核验服务器 state/receipt，无默认成功。保存提示不显示 stateRevision；时间按 zh-CN / Asia/Shanghai 呈现并标注北京时间。
- saving、UNKNOWN、conflict、失权或不可用时只有 blocked controls，没有编辑或进度导航回调。实际 host 仍须同步撤销授权代次并拒绝迟到动作。
- 完成回调只打开检查，不评分、发送 complete 或将其显示为已完成。
- result/report/poster 只接保存后的 ResultDisplaySnapshotV1 和只读导航，没有重新答题、返回编辑或再次完成回调。
- 媒体只接已验证内容、loading 或有限 unavailable。缺图不换成 Emoji、装饰图或其他结果，不接任意 URL/异常原文。
- 海报显式区分 idle/exporting/ready/unavailable，导出失败不改报告或重新评分。

## 实施入口

| 文件                  | 实际职责                                                              |
| --------------------- | --------------------------------------------------------------------- |
| components.tsx        | 沿 folio/cabinet 的六个纯消费者视图，各状态保留不同配方               |
| consumer.module.css   | 独立样式、移动端/长文案/减少动态效果，不改旧 CSS                      |
| registry.ts           | 编译表、固定六角色映射及逐字段核对，错误/缺失映射返回 null            |
| projection.ts         | server-only 中性 entry 与可信评分显示投影，无浏览器评分入口           |
| renderer-client-v1.ts | bindConsumerRendererClientV1(mapping, font)，绑定六组件及精确字体 PNG |
| renderer-server-v1.ts | CONSUMER_SERVER_DISPLAY_V1，绑定 projectEntry/projectResult           |
| components.test.ts    | 实际 SSR 组件的状态隔离、阻塞控件、只读入口及缺素材                   |
| projection.test.ts    | 来源/hash/版本失败、预揭晓隔离、可信评分关系及冻结无别名              |
| registry.test.ts      | 精确 source/runtime 映射，错误或缺失实现不能回退                      |

新实现方向为 consumer-folio-cabinet@1.0.0。source 保留既有六 ID / 2.0.0 / props1.0.0；runtime 分别为 consumer-folio-cover、consumer-folio-question、consumer-folio-resume、consumer-cabinet-result、consumer-folio-report、consumer-folio-poster，均为1.0.0 / props1.0.0。entry SHA、能力登记及闭包摘要由 root 生成/冻结；本步没有注册可用消费者版本。

后续计划 host.tsx 导出 ConsumerExperienceV1，接收组合边界注入的已解析 runtime 能力。host/controller 不运行时导入 root catalog/descriptor，避免自身 entry SHA 循环；其真实依赖必须纳入最终 descriptor 闭包，不能只封纯视图。

## 投影与复用

projectConsumerEntryV1(content, expectedCanonicalContentSha256) 从严格来源与精确内容 SHA 显式挑选题目/选项、中性 cover/scene 及 frame，不调用带 Studio scope 的 preparePreviewContent，也不造 PreviewBinding。权重、候选报告、未揭晓人物资源、完整 source 不进入浏览器。

projectConsumerResultV1(content, actualContentScore, expectedCanonicalContentSha256) 在调用方实际执行固定 engine、核来源/授权后包装既有 projectContentScoreForDisplay。内部失败仅为 SOURCE_UNSUPPORTED / SOURCE_MISMATCH / DISPLAY_LIMIT_EXCEEDED，不是 HTTP 状态或永久未执行证明。结果 helper 保留原262144 B显示封套上限，外层再核 consumer 报告预算，不扩大旧闭包。历史报告读取只取已保存快照，不重评分、重建文案或调用 AI。

复用稳定 display-v1、lib/browser/display-assets 的有限字节/hash 读取、display-task 的取消/期限；PNG 复用既有字体验证及纯换行。旧 theme/preview、studio/preview、report/preview 和已封存 descriptor 字节不变，新视图不调用 PREVIEW_COMPONENTS。未新增依赖、素材、DB 或 app 路由。

## 验证与限制

接口步 Prettier、ESLint、完整 typecheck、共享 state/identities15项通过。新增五个测试文件共14项涵盖投影/组件/映射/PNG；SSR和mock canvas不冒称浏览器验收。

实际浏览器入口：TSX_TSCONFIG_PATH=./tsconfig.json node --conditions=react-server --import tsx tests/browser/consumer-display.ts。它用实际组件 bundle、既有合成测试像素及固定真实字体，起独占临时 loopback 静态服务后关闭，不接业务HTTP/DB/native/3100。工具bundler仅从现有tsx依赖解析，无新依赖/全局浏览器设置。

Chromium156.0.8078.4实际通过：六状态×四宽24图；320长文案/缺素材/loading六状态18图；320保存态3图，共45张完整页面。宽320/375/390/430、视口高900；断言无横向溢出、正文≥16px、按钮≥44px、15阻塞组合零可编辑控件、六状态减少动态效果无动画、实际选择回调。真实Canvas PNG1080×1920；错误资源hash/缺字体/失效代次均失败，页面零异常。

45/45图及PNG已逐段原像素复核，无P1/P2；一项非阻断P3是320暂歇页三个并排操作的标签分多行，文字完整且目标尺寸合格。证据在本worktree忽略目录 .cache/p4-consumer-display/1792332467748/ 的 result.json、visual-review.json与原图。合成噪点不代表正式立绘质量，合成保存/完成输入不代表实际报告。首款同内容/视觉内测基线已批准，后续实际P5仍须验证。

业务HTTP/controller沿root/A冻结合同继续，当前尚未接入。真实DB、3100生产E2E、生产build及首款现场由总控安排；本步不能记作完整P4验收或对外发布批准。

本工作树本次全局检查实际通过：pnpm format:check、pnpm lint、pnpm typecheck、pnpm test（152文件/1739项，20.02秒）。生产build/DB/3100 E2E按总控独占安排未运行，不能将本结果视为全阶段出口。

## 显示小修补验

按总控实际首款纯显示预检反馈，仅在 baseline.title 与“displayName · subtitle”完全相同的情况下省去重复副标题，源文字不改、不按商品ID分支。暂歇页操作组改为自适应行宽，320单列，其余移动宽度两列加整行，避免按钮碎行。

仅以 --resume-only 补跑四宽实际组件及重复标题断言，未重拍原45图或重跑PNG；Chromium156.0.8078.4、viewport900、4图均无横向溢出且目标≥44px，4/4原图已查看，无P1/P2，原暂歇按钮P3关闭。补验目录为 .cache/p4-consumer-display/1792334081173/，result.json记录四图及exactDuplicateSuppressed=true。静态服务与浏览器实际await关闭，Node退出0。真实首款素材质量及持久化仍不在本合成补验内。

## 消费者控制器基础（尚未挂页面）

新增 authority.ts / pending.ts，尚不是完整host或业务HTTP接入。ConsumerAuthorityV1按完整session/play身份发出不可伪造ticket；同步revoke/adopt后旧ticket永久失效，供后续读/保存/完成/图片/PNG共用。

本标签sessionStorage每session最多一个save或complete原请求记录；不存rawKey/grant/CSRF。prepare完整保存并回读、核规范答案hash后才返回；markBeforeSend先持久mayHaveBeenSent并再次回读，完成前不准POST。已存在/损坏/写入失败/回读变化均拒绝，不覆盖另一候选。mark与显式remove都在异步校验后再次核当前授权回调及完整记录；普通错误/空读不会自动清理，remove调用方仍须先核允许的终态证据及用户显式动作。所有消费者controller实际接入和跨页面浏览器恢复仍待后续验证。

5项合成单测通过：准备/回读、损坏/写入失败/错误hash、全session绑定与替换保护、ticket失效/伪造，以及异步回读期间失权不标发送/不删锚点；typecheck和定向lint通过。该记录是客户端恢复辅助，不授予服务器完成或评分权威。
