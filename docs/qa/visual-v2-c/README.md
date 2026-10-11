# Visual V2-C 真实浏览器证据

2026-10-11（Asia/Shanghai），生产构建、Chromium 156.0.8078.4、DPR1。`records.json`记录48张实际浏览器捕获，均无文档横向溢出。另有2张由最终390px首屏直接拼接的对照图，不是新增浏览器捕获，也不是概念渲染图。

## 完整路径

[六阶段首屏拼图](complete-flow-comparison.png)：封面 → 四厅首题 → 确认 → 揭晓 → 报告 → 海报。每格为390×844真实首屏，未改写页面内容。[揭晓与报告并排对照](reveal-to-report-comparison.png)用于检查大幅人物画之后是否直接转入阅读。

[报告首屏](report-390x844-first.png)、[完整报告](report-390x844-full.png)、[五维图谱组件截图](report-atlas-390x844-component.png)、[独立海报画幅](poster-art-390x844-component.png)。`component`仅捕获标明的DOM组件，不冒充完整页面。

主代理已实际从封面进入12题、刷新恢复、完成长题与确认、进入揭晓、阅读章节/展开文化、到海报并返回揭晓。自动化另检验取消/改选/键盘、独立key、保存失败、损坏/冲突、身份及请求隔离、缺图、reduced-motion、SSR读取状态。截图复核不等于作者商业或实机验收。

## 复跑

从本仓库根运行生产构建，在独立终端启动3102预览，再执行以下采集命令；E2E独占3100，不复用预览服务器。

```sh
pnpm build
pnpm start --port 3102
```

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2-c/capture.mjs
node docs/qa/visual-v2-c/contact-sheet.mjs
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2-c/performance.mjs
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/visual-v2-c/responsive-assets.mjs
```

`performance.json`含每路由3个全新BrowserContext冷加载样本及1次1.6Mbps/150ms/CPU×4模拟诊断；严格预算失败时脚本返回非零。预算范围为390 CSS px/DPR1/本机生产服，记录HTML与应用资源（JS/CSS/图/字体）传输、LCP、CLS和24帧程序滚动，不能当成真实移动用户或完整手指滚动/INP数据。封面无滚动范围时0帧间隔不代表“零成本滚动”。

`responsive-assets.json`记录390 CSS px/DPR2、DPR3的真实选源。首轮发现DPR3答题选到321,752B旧原图，已在新候选中将上限收至960px，复测与专项测试验证实际77,708B；旧研究稿仍保留原源。报告与揭晓仍来自同一人物画，未更换角色。字体和原AI美术的授权状态见各manifest，AI概念商用仍pending。

## 截图索引

| 状态                        | CSS视口     | 类型      | 文件                                                                                         |
| --------------------------- | ----------- | --------- | -------------------------------------------------------------------------------------------- |
| cover                       | 390 × 844   | first     | [cover-390x844-first.png](cover-390x844-first.png)                                           |
| cover                       | 390 × 844   | full      | [cover-390x844-full.png](cover-390x844-full.png)                                             |
| question-1                  | 390 × 844   | first     | [question-1-390x844-first.png](question-1-390x844-first.png)                                 |
| question-1                  | 390 × 844   | full      | [question-1-390x844-full.png](question-1-390x844-full.png)                                   |
| question-4                  | 390 × 844   | full      | [question-4-390x844-full.png](question-4-390x844-full.png)                                   |
| question-7                  | 390 × 844   | full      | [question-7-390x844-full.png](question-7-390x844-full.png)                                   |
| question-10                 | 390 × 844   | full      | [question-10-390x844-full.png](question-10-390x844-full.png)                                 |
| question-1-selected         | 390 × 844   | full      | [question-1-selected-390x844-full.png](question-1-selected-390x844-full.png)                 |
| question-12                 | 390 × 844   | full      | [question-12-390x844-full.png](question-12-390x844-full.png)                                 |
| confirm                     | 390 × 844   | first     | [confirm-390x844-first.png](confirm-390x844-first.png)                                       |
| confirm                     | 390 × 844   | full      | [confirm-390x844-full.png](confirm-390x844-full.png)                                         |
| resume                      | 390 × 844   | full      | [resume-390x844-full.png](resume-390x844-full.png)                                           |
| reveal                      | 390 × 844   | first     | [reveal-390x844-first.png](reveal-390x844-first.png)                                         |
| reveal                      | 390 × 844   | full      | [reveal-390x844-full.png](reveal-390x844-full.png)                                           |
| report                      | 390 × 844   | first     | [report-390x844-first.png](report-390x844-first.png)                                         |
| report                      | 390 × 844   | full      | [report-390x844-full.png](report-390x844-full.png)                                           |
| poster                      | 390 × 844   | first     | [poster-390x844-first.png](poster-390x844-first.png)                                         |
| poster                      | 390 × 844   | full      | [poster-390x844-full.png](poster-390x844-full.png)                                           |
| report-atlas                | 390 × 844   | component | [report-atlas-390x844-component.png](report-atlas-390x844-component.png)                     |
| report-inscription-expanded | 390 × 844   | full      | [report-inscription-expanded-390x844-full.png](report-inscription-expanded-390x844-full.png) |
| report-culture-expanded     | 390 × 844   | full      | [report-culture-expanded-390x844-full.png](report-culture-expanded-390x844-full.png)         |
| poster-art                  | 390 × 844   | component | [poster-art-390x844-component.png](poster-art-390x844-component.png)                         |
| cover                       | 320 × 740   | first     | [cover-320x740-first.png](cover-320x740-first.png)                                           |
| question                    | 320 × 740   | first     | [question-320x740-first.png](question-320x740-first.png)                                     |
| reveal                      | 320 × 740   | first     | [reveal-320x740-first.png](reveal-320x740-first.png)                                         |
| report                      | 320 × 740   | first     | [report-320x740-first.png](report-320x740-first.png)                                         |
| poster                      | 320 × 740   | first     | [poster-320x740-first.png](poster-320x740-first.png)                                         |
| cover                       | 375 × 812   | first     | [cover-375x812-first.png](cover-375x812-first.png)                                           |
| question                    | 375 × 812   | first     | [question-375x812-first.png](question-375x812-first.png)                                     |
| reveal                      | 375 × 812   | first     | [reveal-375x812-first.png](reveal-375x812-first.png)                                         |
| report                      | 375 × 812   | first     | [report-375x812-first.png](report-375x812-first.png)                                         |
| poster                      | 375 × 812   | first     | [poster-375x812-first.png](poster-375x812-first.png)                                         |
| cover                       | 430 × 932   | first     | [cover-430x932-first.png](cover-430x932-first.png)                                           |
| question                    | 430 × 932   | first     | [question-430x932-first.png](question-430x932-first.png)                                     |
| reveal                      | 430 × 932   | first     | [reveal-430x932-first.png](reveal-430x932-first.png)                                         |
| report                      | 430 × 932   | first     | [report-430x932-first.png](report-430x932-first.png)                                         |
| poster                      | 430 × 932   | first     | [poster-430x932-first.png](poster-430x932-first.png)                                         |
| cover                       | 1440 × 1000 | first     | [cover-1440x1000-first.png](cover-1440x1000-first.png)                                       |
| question                    | 1440 × 1000 | first     | [question-1440x1000-first.png](question-1440x1000-first.png)                                 |
| reveal                      | 1440 × 1000 | first     | [reveal-1440x1000-first.png](reveal-1440x1000-first.png)                                     |
| report                      | 1440 × 1000 | first     | [report-1440x1000-first.png](report-1440x1000-first.png)                                     |
| poster                      | 1440 × 1000 | first     | [poster-1440x1000-first.png](poster-1440x1000-first.png)                                     |
| question-12-long-24px       | 320 × 740   | full      | [question-12-long-24px-320x740-full.png](question-12-long-24px-320x740-full.png)             |
| report-long-24px            | 320 × 740   | full      | [report-long-24px-320x740-full.png](report-long-24px-320x740-full.png)                       |
| poster-long-24px            | 320 × 740   | full      | [poster-long-24px-320x740-full.png](poster-long-24px-320x740-full.png)                       |
| reveal-reduced-motion       | 390 × 844   | full      | [reveal-reduced-motion-390x844-full.png](reveal-reduced-motion-390x844-full.png)             |
| cover-image-missing         | 390 × 844   | full      | [cover-image-missing-390x844-full.png](cover-image-missing-390x844-full.png)                 |
| legacy-questions-q1         | 390 × 844   | first     | [legacy-questions-q1-390x844-first.png](legacy-questions-q1-390x844-first.png)               |

窄屏大字压力图将正文/题干/操作文字设为24px并检查实际字号，不声称覆盖所有系统字体设置或VoiceOver。320px长题与长报告自然纵向延伸；没有通过缩小文字或隐藏内容来塞入一屏。旧藏馆首题重新捕获于`legacy-questions-q1-390x844-first.png`，与旧证据一起保留供比较。
