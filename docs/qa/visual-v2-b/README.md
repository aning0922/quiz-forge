# Visual V2-B 浏览器视觉证据

采集日期：2026-10-11（Asia/Shanghai）。生产构建，专属本机预览端口3102；Chromium 156.0.8078.4，DPR 1。共 50 张真实截图，另有5张由原始截图拼接的对照图。原 V2-A/A.1 证据未覆盖。

截图只是指定浏览器状态证据，不等于作者商业视觉通过。揭晓/报告/海报均来自实际 React/CSS 与两张已生成的完整美术资源；没有用概念示意图代替页面。

## 优先查看

- [两方向390揭晓首屏](reveal-comparison.png)
- [两方向390海报首屏](poster-comparison.png)
- [山河方向旧/新揭晓对照](landscape-legacy-comparison.png)
- [图鉴方向旧/新揭晓对照](celestial-legacy-comparison.png)
- [山河完整报告](landscape-report-390x844-full.png) · [图鉴完整报告](celestial-report-390x844-full.png)
- [山河报告衔接视口](landscape-report-continuity-390x844-viewport.png) · [图鉴报告衔接视口](celestial-report-continuity-390x844-viewport.png)

## 复跑

先在仓库根完成 `pnpm build`，再启动 `pnpm start --port 3102`。该端口必须属于本 worktree，不能复用未知服务。

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2-b/capture.mjs
node docs/qa/visual-v2-b/contact-sheet.mjs
```

脚本等待可见图片decode/ready和字体完成（桌面隐藏的惰性章首图无需请求）；截图禁用动画以采集最终帧，另有reduced-motion状态。缺图图像使用真实网络拦截。`first`为首屏，`full`为完整页面，`component`为组件完整裁切，`viewport`为滚动到画作/图谱过渡后的真实视口。纯海报画幅以`poster-collectible`记录，画幅外的返回入口不属于海报。旧新对照的左侧引用历史390真实截图，右侧为本轮截图，不伪称同一时间采集。

## 全量截图

| 截图                                                                                    | 视口        | 类型      |
| --------------------------------------------------------------------------------------- | ----------- | --------- |
| [landscape · reveal](landscape-reveal-390x844-first.png)                                | 390 × 844   | first     |
| [landscape · reveal](landscape-reveal-390x844-full.png)                                 | 390 × 844   | full      |
| [landscape · report](landscape-report-390x844-first.png)                                | 390 × 844   | first     |
| [landscape · report](landscape-report-390x844-full.png)                                 | 390 × 844   | full      |
| [landscape · poster](landscape-poster-390x844-first.png)                                | 390 × 844   | first     |
| [landscape · poster](landscape-poster-390x844-full.png)                                 | 390 × 844   | full      |
| [landscape · report-art-atlas](landscape-report-art-atlas-390x844-component.png)        | 390 × 844   | component |
| [landscape · report-continuity](landscape-report-continuity-390x844-viewport.png)       | 390 × 844   | viewport  |
| [landscape · poster-collectible](landscape-poster-collectible-390x844-component.png)    | 390 × 844   | component |
| [landscape · reveal](landscape-reveal-320x740-first.png)                                | 320 × 740   | first     |
| [landscape · report](landscape-report-320x740-first.png)                                | 320 × 740   | first     |
| [landscape · poster](landscape-poster-320x740-first.png)                                | 320 × 740   | first     |
| [landscape · reveal](landscape-reveal-375x812-first.png)                                | 375 × 812   | first     |
| [landscape · report](landscape-report-375x812-first.png)                                | 375 × 812   | first     |
| [landscape · poster](landscape-poster-375x812-first.png)                                | 375 × 812   | first     |
| [landscape · reveal](landscape-reveal-430x932-first.png)                                | 430 × 932   | first     |
| [landscape · report](landscape-report-430x932-first.png)                                | 430 × 932   | first     |
| [landscape · poster](landscape-poster-430x932-first.png)                                | 430 × 932   | first     |
| [landscape · reveal](landscape-reveal-1440x1000-first.png)                              | 1440 × 1000 | first     |
| [landscape · report](landscape-report-1440x1000-first.png)                              | 1440 × 1000 | first     |
| [landscape · poster](landscape-poster-1440x1000-first.png)                              | 1440 × 1000 | first     |
| [landscape · report-long](landscape-report-long-320x740-full.png)                       | 320 × 740   | full      |
| [landscape · poster-long](landscape-poster-long-320x740-full.png)                       | 320 × 740   | full      |
| [landscape · reveal-reduced-motion](landscape-reveal-reduced-motion-390x844-full.png)   | 390 × 844   | full      |
| [landscape · reveal-art-unavailable](landscape-reveal-art-unavailable-390x844-full.png) | 390 × 844   | full      |
| [celestial · reveal](celestial-reveal-390x844-first.png)                                | 390 × 844   | first     |
| [celestial · reveal](celestial-reveal-390x844-full.png)                                 | 390 × 844   | full      |
| [celestial · report](celestial-report-390x844-first.png)                                | 390 × 844   | first     |
| [celestial · report](celestial-report-390x844-full.png)                                 | 390 × 844   | full      |
| [celestial · poster](celestial-poster-390x844-first.png)                                | 390 × 844   | first     |
| [celestial · poster](celestial-poster-390x844-full.png)                                 | 390 × 844   | full      |
| [celestial · report-art-atlas](celestial-report-art-atlas-390x844-component.png)        | 390 × 844   | component |
| [celestial · report-continuity](celestial-report-continuity-390x844-viewport.png)       | 390 × 844   | viewport  |
| [celestial · poster-collectible](celestial-poster-collectible-390x844-component.png)    | 390 × 844   | component |
| [celestial · reveal](celestial-reveal-320x740-first.png)                                | 320 × 740   | first     |
| [celestial · report](celestial-report-320x740-first.png)                                | 320 × 740   | first     |
| [celestial · poster](celestial-poster-320x740-first.png)                                | 320 × 740   | first     |
| [celestial · reveal](celestial-reveal-375x812-first.png)                                | 375 × 812   | first     |
| [celestial · report](celestial-report-375x812-first.png)                                | 375 × 812   | first     |
| [celestial · poster](celestial-poster-375x812-first.png)                                | 375 × 812   | first     |
| [celestial · reveal](celestial-reveal-430x932-first.png)                                | 430 × 932   | first     |
| [celestial · report](celestial-report-430x932-first.png)                                | 430 × 932   | first     |
| [celestial · poster](celestial-poster-430x932-first.png)                                | 430 × 932   | first     |
| [celestial · reveal](celestial-reveal-1440x1000-first.png)                              | 1440 × 1000 | first     |
| [celestial · report](celestial-report-1440x1000-first.png)                              | 1440 × 1000 | first     |
| [celestial · poster](celestial-poster-1440x1000-first.png)                              | 1440 × 1000 | first     |
| [celestial · report-long](celestial-report-long-320x740-full.png)                       | 320 × 740   | full      |
| [celestial · poster-long](celestial-poster-long-320x740-full.png)                       | 320 × 740   | full      |
| [celestial · reveal-reduced-motion](celestial-reveal-reduced-motion-390x844-full.png)   | 390 × 844   | full      |
| [celestial · reveal-art-unavailable](celestial-reveal-art-unavailable-390x844-full.png) | 390 × 844   | full      |

## 助手实际复核

已检查390两方向揭晓和海报、完整报告及过渡区，并检查320长文本、缺图和桌面状态。人物脸部、持物手与主体服饰没有被标题/诗句覆盖；画作完整contain，默认390主按钮在首屏内。长姓名采用专门字号/行高，长称号和长题句自然向下增长。图鉴画底加入色调一致的渐隐，减少原画终点与题签延伸的硬接缝。新增无人物的雾入纸/月纹绢面章首画连接主画与阅读区；图谱底面保持干净，保留准确五维值与可访问语义、退为二级阅读信息。缺图和加载态的人名采用高对比暖白字，状态说明右置，避开竖排姓名。

未做真实消费者三秒识别研究、iOS/Android实机、完整读屏、弱网LCP或商用美术授权验收；自动无横溢断言和助手图片检查不能替代作者审美批准。
