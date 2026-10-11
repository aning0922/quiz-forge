# Visual V2-A.1 真实浏览器截图

日期2026-10-11（Asia/Shanghai），Chromium 156.0.8078.4，DPR1，Next生产构建。54张页面/组件截图，与原V2-A目录隔离。机器记录见 [records.json](records.json)，复跑脚本见 [capture.mjs](capture.mjs)。`first`是首屏，`full`是完整页面，`component`是实际浏览器中的组件裁切。

快速对照：[A/B图谱](atlas-comparison.png)、[报告首屏](report-comparison.png)、[海报首屏](poster-comparison.png)。这三张派生拼图由 [contact-sheet.mjs](contact-sheet.mjs) 使用真实截图生成，不计入54张原始截图；没有用图像生成模型绘制UI证据。

## 默认报告、图谱、海报

| 证据          | A · 入画寻己                                    | B · 风骨藏馆                                       |
| ------------- | ----------------------------------------------- | -------------------------------------------------- |
| 390报告首屏   | [A](journey-report-390x844-first.png)           | [B](collection-report-390x844-first.png)           |
| 390完整报告   | [A](journey-report-390x844-full.png)            | [B](collection-report-390x844-full.png)            |
| 390五维图谱   | [A](journey-atlas-five-390x844-component.png)   | [B](collection-atlas-five-390x844-component.png)   |
| 390海报首屏   | [A](journey-poster-390x844-first.png)           | [B](collection-poster-390x844-first.png)           |
| 390完整海报页 | [A](journey-poster-390x844-full.png)            | [B](collection-poster-390x844-full.png)            |
| 320报告       | [A](journey-report-320x740-full.png)            | [B](collection-report-320x740-full.png)            |
| 375报告       | [A](journey-report-375x812-full.png)            | [B](collection-report-375x812-full.png)            |
| 430报告       | [A](journey-report-430x932-full.png)            | [B](collection-report-430x932-full.png)            |
| 1440报告      | [A](journey-report-1440x1000-full.png)          | [B](collection-report-1440x1000-full.png)          |
| 1440图谱布局  | [A](journey-atlas-five-1440x1000-component.png) | [B](collection-atlas-five-1440x1000-component.png) |
| 320海报       | [A](journey-poster-320x740-full.png)            | [B](collection-poster-320x740-full.png)            |

其余375/430/1440海报和320/375/430图谱文件按同一命名列在records.json内。

## 边界、题签与动效

| 证据                  | A                                               | B                                                  |
| --------------------- | ----------------------------------------------- | -------------------------------------------------- |
| 4项，0/50/100/0.5     | [A](journey-atlas-four-390x844-component.png)   | [B](collection-atlas-four-390x844-component.png)   |
| 7项，49.99/50/50.01等 | [A](journey-atlas-seven-390x844-component.png)  | [B](collection-atlas-seven-390x844-component.png)  |
| 7项长名称与解释       | [A](journey-atlas-long-390x844-component.png)   | [B](collection-atlas-long-390x844-component.png)   |
| 320长文24px           | [A](journey-long-24px-320x740-full.png)         | [B](collection-long-24px-320x740-full.png)         |
| 古诗解读和出处展开    | [A](journey-verse-source-390x844-component.png) | [B](collection-verse-source-390x844-component.png) |
| 原创题签首屏          | [A](journey-original-report-390x844-first.png)  | [B](collection-original-report-390x844-first.png)  |
| 原创题签完整报告      | [A](journey-original-report-390x844-full.png)   | [B](collection-original-report-390x844-full.png)   |
| 原创题句海报          | [A](journey-original-poster-390x844-full.png)   | [B](collection-original-poster-390x844-full.png)   |
| 省略可选题签          | [A](journey-no-verse-390x844-first.png)         | [B](collection-no-verse-390x844-first.png)         |
| 减少动态效果          | [A](journey-reduced-motion-390x844-full.png)    | [B](collection-reduced-motion-390x844-full.png)    |

## 实际检查结论

助手实际读取两套图谱组件、390首屏、完整报告、320海报、长文24px、桌面双列与出处展开截图，并在浏览器中检查可访问树（meter名称/值）。GPT-6 Astra独立读取主要截图和数据结构，确认A连续细线与B编号分段属性面板的结构差异，以及合成来源/非优劣说明在分数前可见。上述是助手检查，不是作者视觉通过。

本轮修正：默认首项图谱曾落在首屏之外，压缩重复摘要后390×844可见首项数字与完整刻度；B原创竖签较长，改为短竖签并在横排归属行保留“非古诗引用”；A 320海报继承通用卡片高度导致画幅变长，恢复3:4并加入所有视口比例检查。最终源重新构建后重抓本目录证据。

五视口均无横向溢出。24px长文本可自然换行，未省略名称与解释；4/5/7项按DTO数量渲染，数值与条形长度一致；0/100边界不越界，小数不伪装成端点。默认题签保留两行古诗、作者作品与可展开来源，原创另有可见归属；海报保持一行诗句/署名和两项小标签，面部、姓名与称号可见。

说明文字16px及以上，刻度端点、编号、来源标记等为辅助元数据。正文对比度A10.48:1/B10.18:1，条形与轨道A4.88:1/B5.52:1。实际浏览器E2E检验对比度阈值、ARIA文本与reduced-motion；未声称通过完整读屏、Safari/Android实机、弱网或商业内容验证。

B五项桌面双列留有一个自然空位；320海报的归属和小数值标签较小，完整来源与解释在报告中提供。这些为当前可接受的原型限制，仍待作者审美、字体、文学与架构审查。

## 复跑

在本worktree根完成生产构建并启动3102，再在同一根执行截图命令：

```sh
pnpm build
pnpm start --port 3102
```

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2-a1/capture.mjs
```

E2E使用另一个独占3100生产服务器，`pnpm test:e2e`不会复用未知服务器。截图脚本不改原V2/D1证据目录，也不接收真实用户数据。
