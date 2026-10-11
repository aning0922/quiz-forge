# D1-B 浏览器截图证据

日期：2026-10-11（Asia/Shanghai）。基于本分支最终生产构建，Chromium 156.0.8078.4、DPR 1。共 28 张全页截图：封面/答题/恢复 × 320×740、375×812、390×844、430×932、1440×1000 共15张，另13张边界状态。除 Pixel7 一张明确标注 Android Chrome UA/触摸模拟外，均为 Desktop Chrome UA 的 CSS 视口检查；不是 iOS Safari 或 Android Chrome 实机证据。

总控与独立审查查看实际图片，结论是没有发现本轮布局、身份提前泄露、阅读或操作遮挡的阻断项，仍待作者人工审美验收。状态输入全部为合成题目/答案，不含真实用户信息或 AccessKey。旧 D1-A/A.1 图片保持原文件不变。

| 状态                     | CSS视口   | 截图                                                                                                               | 条件                                                                                 |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 未揭晓封面               | 320×740   | [historical-cover-320x740-chromium-156.png](historical-cover-320x740-chromium-156.png)                             | 最终生产构建；全页/无横向溢出                                                        |
| 答题未选择               | 320×740   | [historical-question-320x740-chromium-156.png](historical-question-320x740-chromium-156.png)                       | 最终生产构建；全页/无横向溢出                                                        |
| 书签恢复                 | 320×740   | [historical-resume-320x740-chromium-156.png](historical-resume-320x740-chromium-156.png)                           | 最终生产构建；全页/无横向溢出                                                        |
| 未揭晓封面               | 375×812   | [historical-cover-375x812-chromium-156.png](historical-cover-375x812-chromium-156.png)                             | 最终生产构建；全页/无横向溢出                                                        |
| 答题未选择               | 375×812   | [historical-question-375x812-chromium-156.png](historical-question-375x812-chromium-156.png)                       | 最终生产构建；全页/无横向溢出                                                        |
| 书签恢复                 | 375×812   | [historical-resume-375x812-chromium-156.png](historical-resume-375x812-chromium-156.png)                           | 最终生产构建；全页/无横向溢出                                                        |
| 未揭晓封面               | 390×844   | [historical-cover-390x844-chromium-156.png](historical-cover-390x844-chromium-156.png)                             | 最终生产构建；全页/无横向溢出                                                        |
| 答题未选择               | 390×844   | [historical-question-390x844-chromium-156.png](historical-question-390x844-chromium-156.png)                       | 最终生产构建；全页/无横向溢出                                                        |
| 书签恢复                 | 390×844   | [historical-resume-390x844-chromium-156.png](historical-resume-390x844-chromium-156.png)                           | 最终生产构建；全页/无横向溢出                                                        |
| 未揭晓封面               | 430×932   | [historical-cover-430x932-chromium-156.png](historical-cover-430x932-chromium-156.png)                             | 最终生产构建；全页/无横向溢出                                                        |
| 答题未选择               | 430×932   | [historical-question-430x932-chromium-156.png](historical-question-430x932-chromium-156.png)                       | 最终生产构建；全页/无横向溢出                                                        |
| 书签恢复                 | 430×932   | [historical-resume-430x932-chromium-156.png](historical-resume-430x932-chromium-156.png)                           | 最终生产构建；全页/无横向溢出                                                        |
| 未揭晓封面               | 1440×1000 | [historical-cover-1440x1000-chromium-156.png](historical-cover-1440x1000-chromium-156.png)                         | 最终生产构建；全页/无横向溢出                                                        |
| 答题未选择               | 1440×1000 | [historical-question-1440x1000-chromium-156.png](historical-question-1440x1000-chromium-156.png)                   | 最终生产构建；全页/无横向溢出                                                        |
| 书签恢复                 | 1440×1000 | [historical-resume-1440x1000-chromium-156.png](historical-resume-1440x1000-chromium-156.png)                       | 最终生产构建；全页/无横向溢出                                                        |
| 第12题长内容             | 390×844   | [historical-long-question-390x844-chromium-156.png](historical-long-question-390x844-chromium-156.png)             | 最终生产构建；全页/无横向溢出                                                        |
| 方向键选中与可见焦点     | 390×844   | [historical-keyboard-focus-390x844-chromium-156.png](historical-keyboard-focus-390x844-chromium-156.png)           | 最终生产构建；全页/无横向溢出                                                        |
| 完成前确认               | 390×844   | [historical-confirm-390x844-chromium-156.png](historical-confirm-390x844-chromium-156.png)                         | 最终生产构建；全页/无横向溢出                                                        |
| 仅本地演示结束           | 390×844   | [historical-complete-demo-390x844-chromium-156.png](historical-complete-demo-390x844-chromium-156.png)             | 最终生产构建；全页/无横向溢出                                                        |
| 320宽真实长题/选项24px   | 320×740   | [historical-long-24px-320x740-chromium-156.png](historical-long-24px-320x740-chromium-156.png)                     | Actual long question, option font 24px                                               |
| 保存失败                 | 390×844   | [historical-save-failed-390x844-chromium-156.png](historical-save-failed-390x844-chromium-156.png)                 | Actual adapter setItem throws synthetic QuotaExceededError                           |
| 损坏书签恢复异常         | 390×844   | [historical-corrupt-recovery-390x844-chromium-156.png](historical-corrupt-recovery-390x844-chromium-156.png)       | 最终生产构建；全页/无横向溢出                                                        |
| 坏书签修改后仍可显式重置 | 390×844   | [historical-corrupt-after-edit-390x844-chromium-156.png](historical-corrupt-after-edit-390x844-chromium-156.png)   | 最终生产构建；全页/无横向溢出                                                        |
| 真实双标签清空后连续修改 | 390×844   | [historical-conflict-real-clear-390x844-chromium-156.png](historical-conflict-real-clear-390x844-chromium-156.png) | Two actual browser tabs; clear then two edits; storage remains null                  |
| 减少动态效果             | 390×844   | [historical-reduced-motion-390x844-chromium-156.png](historical-reduced-motion-390x844-chromium-156.png)           | prefers-reduced-motion: reduce; transition 0s                                        |
| 缺装饰背景               | 390×844   | [historical-missing-landscape-390x844-chromium-156.png](historical-missing-landscape-390x844-chromium-156.png)     | Decorative landscape request aborted; paper and entry retained                       |
| 水合前加载态             | 390×844   | [historical-loading-ssr-390x844-chromium-156.png](historical-loading-ssr-390x844-chromium-156.png)                 | JavaScript disabled to retain pre-hydration loading state; not a remote data failure |
| Pixel7 UA/触摸模拟       | 390×844   | [historical-pixel7-emulation-390x844-chromium-156.png](historical-pixel7-emulation-390x844-chromium-156.png)       | Pixel 7 / Android Chrome UA and touch emulation; not physical device                 |

## 可恢复截图流程

[capture.mjs](capture.mjs) 是自编检查/截图脚本，不是产品运行时。它使用已安装 Playwright，连接已经核实的本分支生产构建3100；不安装依赖、不执行第三方项目脚本。先从本 worktree 根构建并在另一个终端启动自己的服务器，确认端口没有其他工作流占用，再运行：

```sh
pnpm build
pnpm start --port 3100
```

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/d1b/capture.mjs
```

重生成会把上一批本阶段 PNG 移到忽略的 `.cache/d1b-previous-captures/`，只刷新 D1-B，不碰历史目录。人工审阅后才提交新版。普通 E2E 的回归截图写到 `test-results/d1b-regression/<project>/`，两个项目隔离，不能覆盖这批待审材料。

全页截图归一到页面顶部，避免已滚动视口中的屏外 fixed 跳转链接被截图引擎收进整页图；导航的滚动与焦点由实际操作/E2E另行检查。减少动态效果使用真实 media 条件且断言进度条 transition 为0。缺背景用请求 abort 验证浅纸、文字与入口保留；加载图以关闭 JS 保留 SSR 水合前状态，不冒充远端加载错误。保存失败通过适配器实际抛出合成 QuotaExceededError，坏书签用不合法 JSON，冲突用两个真实页面共享 storage 后 clear 再连续修改，并检查 storage 仍为空。
