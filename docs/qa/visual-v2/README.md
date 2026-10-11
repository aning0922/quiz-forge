# Visual V2-A 浏览器视觉证据

日期：2026-10-11（Asia/Shanghai）。浏览器：Chromium 156.0.8078.4，DPR 1。来源为本worktree的Next生产构建，非设计稿渲染。记录中的 `overflow: false` 是程序布局检查，不等于作者审美通过。

截图脚本：[capture.mjs](capture.mjs)；完整文件、视口、状态与浏览器记录：[records.json](records.json)。77张页面截图：两方向×五态×五视口共50张全页、390首屏10张、恢复/长题/确认/真实跨页冲突/保存失败/减少动效/缺图/SSR加载各两张共16张、研究比较页1张。

视口为320×740、375×812、390×844、430×932和1440×1000。手机截图是CSS视口模拟；没有iOS Safari/Android实机通过声明。`first`为首屏，`full`为完整页面；全页长截图不能冒充首屏。

快速比较：[两套五态首屏总览](overview-390.png)、[双封面原尺寸并排](covers-390.png)。这两张附加拼图由 [contact-sheet.mjs](contact-sheet.mjs) 从最终浏览器截图生成，不属于77张原始页面截图，也不是生成模型绘制的UI。

## 390px主要证据

| 状态     | A首屏                                   | A全页                                      | B首屏                                      | B全页                                         |
| -------- | --------------------------------------- | ------------------------------------------ | ------------------------------------------ | --------------------------------------------- |
| 封面     | [A](journey-cover-390x844-first.png)    | [A完整](journey-cover-390x844-full.png)    | [B](collection-cover-390x844-first.png)    | [B完整](collection-cover-390x844-full.png)    |
| 答题选中 | [A](journey-question-390x844-first.png) | [A完整](journey-question-390x844-full.png) | [B](collection-question-390x844-first.png) | [B完整](collection-question-390x844-full.png) |
| 结果揭晓 | [A](journey-reveal-390x844-first.png)   | [A完整](journey-reveal-390x844-full.png)   | [B](collection-reveal-390x844-first.png)   | [B完整](collection-reveal-390x844-full.png)   |
| 报告     | [A](journey-report-390x844-first.png)   | [A完整](journey-report-390x844-full.png)   | [B](collection-report-390x844-first.png)   | [B完整](collection-report-390x844-full.png)   |
| 海报     | [A](journey-poster-390x844-first.png)   | [A完整](journey-poster-390x844-full.png)   | [B](collection-poster-390x844-first.png)   | [B完整](collection-poster-390x844-full.png)   |

## 边界和桌面

| 场景           | A                                              | B                                                 |
| -------------- | ---------------------------------------------- | ------------------------------------------------- |
| 320答题        | [A](journey-question-320x740-full.png)         | [B](collection-question-320x740-full.png)         |
| 375答题        | [A](journey-question-375x812-full.png)         | [B](collection-question-375x812-full.png)         |
| 430答题        | [A](journey-question-430x932-full.png)         | [B](collection-question-430x932-full.png)         |
| 桌面封面       | [A](journey-cover-1440x1000-full.png)          | [B](collection-cover-1440x1000-full.png)          |
| 桌面报告       | [A](journey-report-1440x1000-full.png)         | [B](collection-report-1440x1000-full.png)         |
| 进度恢复       | [A](journey-resume-390x844-full.png)           | [B](collection-resume-390x844-full.png)           |
| 最后一题长文案 | [A](journey-long-question-390x844-full.png)    | [B](collection-long-question-390x844-full.png)    |
| 揭晓前确认     | [A](journey-confirm-390x844-full.png)          | [B](collection-confirm-390x844-full.png)          |
| 真实跨标签冲突 | [A](journey-conflict-390x844-full.png)         | [B](collection-conflict-390x844-full.png)         |
| 保存抛错       | [A](journey-save-failed-390x844-full.png)      | [B](collection-save-failed-390x844-full.png)      |
| 减少动态效果   | [A](journey-reduced-motion-390x844-full.png)   | [B](collection-reduced-motion-390x844-full.png)   |
| 肖像请求失败   | [A](journey-missing-portrait-390x844-full.png) | [B](collection-missing-portrait-390x844-full.png) |
| 水合前加载     | [A](journey-loading-ssr-390x844-full.png)      | [B](collection-loading-ssr-390x844-full.png)      |

## 实际视觉审查

助手通过浏览器查看390封面/题目/结果/报告，并读取生产截图；GPT-6 Astra独立查看两方向五态390首屏、320全页与1440桌面证据。不是只统计截图文件数。

- **首屏层次**：品牌栏64px；封面题名、景窗或卡匣、体验长度和入口层次清楚。研究导航仅出现在比较页。
- **连续答题**：正常390题四选项与下一题可见；A山水章页、B浅纸问笺具有不同结构。320允许自然纵向滚动，未用小字强行塞入首屏。
- **长内容**：最后一题不截断题干/说明/选项；24px选项与导航四宽自动检查通过，控件可增高并换行。
- **揭晓**：固定合成示例标识清楚；人物名、称号、肖像和报告入口均可辨识。单次进入效果，reduce时无动画。
- **报告**：首屏先摘要；章节可跳转、依据与文化可展开；正文使用稳定高对比底面，长文未藏在角色卡内。
- **海报**：A 3:4与B 2:3的独立收藏构图成立；没有伪造二维码、下载和正式完成状态。
- **异常**：保存失败/冲突采用明确提示与实际可操作恢复入口；人物缺图保留文字和报告入口，未用装饰图或其他人物替代。

首轮独立复审发现并修正：B桌面卡匣说明被旋转背卡遮住，改为独立装饰舞台与下方说明；文化折叠图标/文字异常三行，改为内联弹性容器；A人物卡衣带从中央渐变两侧漏出，改为整幅遮罩、文字保留内边距。A 320揭晓姓名额外缩小以增加竹卷旁安全区。修正后使用最终生产构建重抓全部77张，不以旧截图冒充最终版本。

GPT-6 Astra随后重新读取上述三处最终截图与390五态总览，确认说明完整可见、折叠入口单行对齐、衣带碎片消除；未发现剩余的本轮视觉阻断，建议交作者体验和选择方向。这是助手设计复核意见，不是作者验收结论。

仍待作者方向选择、人工审美/文案/美术审批、完整人物阵容、真机与弱网验证。图像生成不等于商用授权完成。本轮视觉完整度适合选方向，不是已可发布商品。

## 复跑

从本worktree根执行，确保端口归属于当前工作区：

```sh
pnpm install --frozen-lockfile
pnpm test:e2e:install
pnpm build
pnpm start --port 3102
```

另一个终端在同一根目录：

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2/capture.mjs
```

脚本只改本V2证据目录，不覆盖D1-A/A.1/B历史截图。`pnpm test:e2e`独立启动3100的生产服务器且不复用现有服务器；日常E2E产物进入忽略的测试输出目录。
