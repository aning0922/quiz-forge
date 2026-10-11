# 藏馆探寻：答题节奏浏览器证据

日期：2026-10-11（Asia/Shanghai）。生产构建，本worktree专属3102；Chromium 156.0.8078.4，DPR1。共23张真实浏览器截图及1张由四张390首屏拼接的对照。旧V2/V2-B资料完整保留。

## 优先查看

- [四厅真实390首屏对照](rooms-comparison.png)
- [选择后与行记点亮](q1-selected-390x844-full.png)
- [第十二题正常长文](q12-390x844-full.png)
- [320px / 真实24px题干、说明与选项](q12-long-24px-320x740-full.png)
- [缺图可继续答题](q1-scene-missing-390x844-full.png)
- [桌面雨蓝回廊](q7-1440x1000-first.png)

## 复跑

在仓库根完成 `pnpm build` 并启动 `pnpm start --port 3102`，核实该端口属于本worktree后执行：

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2-questions/capture.mjs
node docs/qa/visual-v2-questions/contact-sheet.mjs
```

脚本在独立浏览器中使用合成回答推进12题，等待当前场景与字体加载；异常截图用实际图片请求拦截。`first`为真实首屏，`full`为完整页面；四厅对照只组合q1/q4/q7/q10的first截图，不用全页覆盖模拟首屏。24px测试直接作用选项正文，并断言实际computed字号，避免父按钮字号被子级16px覆盖。

## 截图清单

| 文件                                                                     | 视口        | 状态              |
| ------------------------------------------------------------------------ | ----------- | ----------------- |
| [q1-390x844-first.png](q1-390x844-first.png)                             | 390 × 844   | q1                |
| [q1-390x844-full.png](q1-390x844-full.png)                               | 390 × 844   | q1                |
| [q1-selected-390x844-full.png](q1-selected-390x844-full.png)             | 390 × 844   | q1-selected       |
| [q3-390x844-full.png](q3-390x844-full.png)                               | 390 × 844   | q3                |
| [q4-390x844-first.png](q4-390x844-first.png)                             | 390 × 844   | q4                |
| [q4-390x844-full.png](q4-390x844-full.png)                               | 390 × 844   | q4                |
| [q6-390x844-full.png](q6-390x844-full.png)                               | 390 × 844   | q6                |
| [q7-390x844-first.png](q7-390x844-first.png)                             | 390 × 844   | q7                |
| [q7-390x844-full.png](q7-390x844-full.png)                               | 390 × 844   | q7                |
| [q9-390x844-full.png](q9-390x844-full.png)                               | 390 × 844   | q9                |
| [q10-390x844-first.png](q10-390x844-first.png)                           | 390 × 844   | q10               |
| [q10-390x844-full.png](q10-390x844-full.png)                             | 390 × 844   | q10               |
| [q12-390x844-full.png](q12-390x844-full.png)                             | 390 × 844   | q12               |
| [q1-375x812-first.png](q1-375x812-first.png)                             | 375 × 812   | q1                |
| [q4-375x812-first.png](q4-375x812-first.png)                             | 375 × 812   | q4                |
| [q7-375x812-first.png](q7-375x812-first.png)                             | 375 × 812   | q7                |
| [q10-375x812-first.png](q10-375x812-first.png)                           | 375 × 812   | q10               |
| [q6-430x932-first.png](q6-430x932-first.png)                             | 430 × 932   | q6                |
| [q12-430x932-first.png](q12-430x932-first.png)                           | 430 × 932   | q12               |
| [q7-1440x1000-first.png](q7-1440x1000-first.png)                         | 1440 × 1000 | q7                |
| [q12-long-24px-320x740-full.png](q12-long-24px-320x740-full.png)         | 320 × 740   | q12-long-24px     |
| [q1-reduced-motion-390x844-full.png](q1-reduced-motion-390x844-full.png) | 390 × 844   | q1-reduced-motion |
| [q1-scene-missing-390x844-full.png](q1-scene-missing-390x844-full.png)   | 390 × 844   | q1-scene-missing  |

## 实际视觉检查

已由助手与GPT-6 Astra检查q1/3/4/6/7/9/10/12完整页面、四厅首屏、选中、缺图、reduced-motion、320px24px长文和桌面。四厅材质、光源、空间有实质变化；图与选项不根据答案改变价值倾向。双列问笺同权，320px统一单列。最初sticky操作条遮住长说明，已改为普通文档流；最终长图中按钮位于全部选项后，未覆盖正文。

点亮严格按各question.id的真实回答状态，取消早期答案会只熄灭对应行记，不伪造连续进度。所查布局无横向溢出、截字或操作层遮挡。自动检查和助手审查不等于作者审美批准。

限制：每厅3题共用一个场景构图，本轮只有4幅环境画，不声称12个独立场景；q4较长且320px大字需要滚动。真实拇指触达、连续作答兴趣与完成率需要用户体验；无真实评分、人格线索计算或AI请求。
