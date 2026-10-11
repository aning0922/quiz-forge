# D1-C 生产浏览器与PNG证据

2026-10-11（Asia/Shanghai）。最终实现的本机生产构建，专用3100，Chromium156.0.8078.4 / WebKit27.2、DPR1。五视口320×740、375×812、390×844、430×932、1440×1000。58张矩阵截图（首屏/完整长图/局部）+2张导出引擎全页预览+6个真实PNG；旧VisualV2/D1证据保持不变。

总控与独立审查实际查看图片；PNG是浏览器受控Canvas编码后通过下载取得，**不是海报网页截图**。文件signature、IHDR和预览解码均1080×1920；六个输出cmap字形完整，人物完整保留脸与手，透明渐变合成到不透明背景（取样alpha全255），没有网页控件/Key/答案。截图不替代作者最终视觉、素材商用批准或iOS/Android实机。Web Share测试模拟应用分支，不证明系统菜单或相册保存。

## 海报成品

| 浏览器引擎            | 样本     | 实际PNG字节 | 本机生成耗时 | 成品                                                                                     |
| --------------------- | -------- | ----------- | ------------ | ---------------------------------------------------------------------------------------- |
| chromium 156.0.8078.4 | default  | 3,100,371 B | 307 ms       | [historical-default-1080x1920-chromium.png](historical-default-1080x1920-chromium.png)   |
| chromium 156.0.8078.4 | long     | 3,132,770 B | 239 ms       | [historical-long-1080x1920-chromium.png](historical-long-1080x1920-chromium.png)         |
| chromium 156.0.8078.4 | original | 3,102,700 B | 240 ms       | [historical-original-1080x1920-chromium.png](historical-original-1080x1920-chromium.png) |
| webkit 27.2           | default  | 2,880,462 B | 246 ms       | [historical-default-1080x1920-webkit.png](historical-default-1080x1920-webkit.png)       |
| webkit 27.2           | long     | 2,917,158 B | 216 ms       | [historical-long-1080x1920-webkit.png](historical-long-1080x1920-webkit.png)             |
| webkit 27.2           | original | 2,883,024 B | 312 ms       | [historical-original-1080x1920-webkit.png](historical-original-1080x1920-webkit.png)     |

[导出原始记录](export-results.json)保留SHA-256、所有实绘字符串/font/宽度/位置/alpha/页面错误。[字体核验](font-audit.json)来自隔离fonttools4.61.1/brotli1.2.0读实际WOFF2 cmap，800声明字全部覆盖，六成品缺字0。未覆盖字符明确报错，不宣称任意汉字都支持。当前PNG约2.75–2.99MiB，耗时是本机样本，不是低端手机性能承诺。

## 页面截图

| 状态                        | CSS视口   | 类型      | 图片                                                                                                                   |
| --------------------------- | --------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| cover                       | 390×844   | first     | [cover-390x844-first-chromium-156.png](cover-390x844-first-chromium-156.png)                                           |
| cover                       | 390×844   | full      | [cover-390x844-full-chromium-156.png](cover-390x844-full-chromium-156.png)                                             |
| question-1                  | 390×844   | first     | [question-1-390x844-first-chromium-156.png](question-1-390x844-first-chromium-156.png)                                 |
| question-1                  | 390×844   | full      | [question-1-390x844-full-chromium-156.png](question-1-390x844-full-chromium-156.png)                                   |
| question-4                  | 390×844   | full      | [question-4-390x844-full-chromium-156.png](question-4-390x844-full-chromium-156.png)                                   |
| question-7                  | 390×844   | full      | [question-7-390x844-full-chromium-156.png](question-7-390x844-full-chromium-156.png)                                   |
| question-10                 | 390×844   | full      | [question-10-390x844-full-chromium-156.png](question-10-390x844-full-chromium-156.png)                                 |
| question-1-selected         | 390×844   | full      | [question-1-selected-390x844-full-chromium-156.png](question-1-selected-390x844-full-chromium-156.png)                 |
| question-12                 | 390×844   | full      | [question-12-390x844-full-chromium-156.png](question-12-390x844-full-chromium-156.png)                                 |
| confirm                     | 390×844   | first     | [confirm-390x844-first-chromium-156.png](confirm-390x844-first-chromium-156.png)                                       |
| confirm                     | 390×844   | full      | [confirm-390x844-full-chromium-156.png](confirm-390x844-full-chromium-156.png)                                         |
| resume                      | 390×844   | full      | [resume-390x844-full-chromium-156.png](resume-390x844-full-chromium-156.png)                                           |
| reveal                      | 390×844   | first     | [reveal-390x844-first-chromium-156.png](reveal-390x844-first-chromium-156.png)                                         |
| reveal                      | 390×844   | full      | [reveal-390x844-full-chromium-156.png](reveal-390x844-full-chromium-156.png)                                           |
| report                      | 390×844   | first     | [report-390x844-first-chromium-156.png](report-390x844-first-chromium-156.png)                                         |
| report                      | 390×844   | full      | [report-390x844-full-chromium-156.png](report-390x844-full-chromium-156.png)                                           |
| poster                      | 390×844   | first     | [poster-390x844-first-chromium-156.png](poster-390x844-first-chromium-156.png)                                         |
| poster                      | 390×844   | full      | [poster-390x844-full-chromium-156.png](poster-390x844-full-chromium-156.png)                                           |
| report-atlas                | 390×844   | component | [report-atlas-390x844-component-chromium-156.png](report-atlas-390x844-component-chromium-156.png)                     |
| report-inscription-expanded | 390×844   | full      | [report-inscription-expanded-390x844-full-chromium-156.png](report-inscription-expanded-390x844-full-chromium-156.png) |
| report-culture-expanded     | 390×844   | full      | [report-culture-expanded-390x844-full-chromium-156.png](report-culture-expanded-390x844-full-chromium-156.png)         |
| poster-art                  | 390×844   | component | [poster-art-390x844-component-chromium-156.png](poster-art-390x844-component-chromium-156.png)                         |
| cover                       | 320×740   | first     | [cover-320x740-first-chromium-156.png](cover-320x740-first-chromium-156.png)                                           |
| question                    | 320×740   | first     | [question-320x740-first-chromium-156.png](question-320x740-first-chromium-156.png)                                     |
| reveal                      | 320×740   | first     | [reveal-320x740-first-chromium-156.png](reveal-320x740-first-chromium-156.png)                                         |
| report                      | 320×740   | full      | [report-320x740-full-chromium-156.png](report-320x740-full-chromium-156.png)                                           |
| poster                      | 320×740   | first     | [poster-320x740-first-chromium-156.png](poster-320x740-first-chromium-156.png)                                         |
| cover                       | 375×812   | first     | [cover-375x812-first-chromium-156.png](cover-375x812-first-chromium-156.png)                                           |
| question                    | 375×812   | first     | [question-375x812-first-chromium-156.png](question-375x812-first-chromium-156.png)                                     |
| reveal                      | 375×812   | first     | [reveal-375x812-first-chromium-156.png](reveal-375x812-first-chromium-156.png)                                         |
| report                      | 375×812   | full      | [report-375x812-full-chromium-156.png](report-375x812-full-chromium-156.png)                                           |
| poster                      | 375×812   | first     | [poster-375x812-first-chromium-156.png](poster-375x812-first-chromium-156.png)                                         |
| cover                       | 430×932   | first     | [cover-430x932-first-chromium-156.png](cover-430x932-first-chromium-156.png)                                           |
| question                    | 430×932   | first     | [question-430x932-first-chromium-156.png](question-430x932-first-chromium-156.png)                                     |
| reveal                      | 430×932   | first     | [reveal-430x932-first-chromium-156.png](reveal-430x932-first-chromium-156.png)                                         |
| report                      | 430×932   | full      | [report-430x932-full-chromium-156.png](report-430x932-full-chromium-156.png)                                           |
| poster                      | 430×932   | first     | [poster-430x932-first-chromium-156.png](poster-430x932-first-chromium-156.png)                                         |
| cover                       | 1440×1000 | first     | [cover-1440x1000-first-chromium-156.png](cover-1440x1000-first-chromium-156.png)                                       |
| question                    | 1440×1000 | first     | [question-1440x1000-first-chromium-156.png](question-1440x1000-first-chromium-156.png)                                 |
| reveal                      | 1440×1000 | first     | [reveal-1440x1000-first-chromium-156.png](reveal-1440x1000-first-chromium-156.png)                                     |
| report                      | 1440×1000 | full      | [report-1440x1000-full-chromium-156.png](report-1440x1000-full-chromium-156.png)                                       |
| poster                      | 1440×1000 | first     | [poster-1440x1000-first-chromium-156.png](poster-1440x1000-first-chromium-156.png)                                     |
| question-12-long-24px       | 320×740   | full      | [question-12-long-24px-320x740-full-chromium-156.png](question-12-long-24px-320x740-full-chromium-156.png)             |
| report-long-24px            | 320×740   | full      | [report-long-24px-320x740-full-chromium-156.png](report-long-24px-320x740-full-chromium-156.png)                       |
| poster-long-24px            | 320×740   | full      | [poster-long-24px-320x740-full-chromium-156.png](poster-long-24px-320x740-full-chromium-156.png)                       |
| reveal-reduced-motion       | 390×844   | full      | [reveal-reduced-motion-390x844-full-chromium-156.png](reveal-reduced-motion-390x844-full-chromium-156.png)             |
| cover-image-missing         | 390×844   | full      | [cover-image-missing-390x844-full-chromium-156.png](cover-image-missing-390x844-full-chromium-156.png)                 |
| legacy-questions-q1         | 390×844   | first     | [legacy-questions-q1-390x844-first-chromium-156.png](legacy-questions-q1-390x844-first-chromium-156.png)               |
| poster-generated            | 390×844   | full      | [poster-generated-390x844-full-chromium-156.png](poster-generated-390x844-full-chromium-156.png)                       |
| poster-generated            | 320×740   | full      | [poster-generated-320x740-full-chromium-156.png](poster-generated-320x740-full-chromium-156.png)                       |
| poster-generated            | 375×812   | full      | [poster-generated-375x812-full-chromium-156.png](poster-generated-375x812-full-chromium-156.png)                       |
| poster-generated            | 430×932   | full      | [poster-generated-430x932-full-chromium-156.png](poster-generated-430x932-full-chromium-156.png)                       |
| poster-generated            | 1440×1000 | full      | [poster-generated-1440x1000-full-chromium-156.png](poster-generated-1440x1000-full-chromium-156.png)                   |
| poster-long-generated       | 390×844   | full      | [poster-long-generated-390x844-full-chromium-156.png](poster-long-generated-390x844-full-chromium-156.png)             |
| poster-art-failed           | 390×844   | full      | [poster-art-failed-390x844-full-chromium-156.png](poster-art-failed-390x844-full-chromium-156.png)                     |
| poster-font-failed          | 390×844   | full      | [poster-font-failed-390x844-full-chromium-156.png](poster-font-failed-390x844-full-chromium-156.png)                   |
| question-save-failed        | 390×844   | full      | [question-save-failed-390x844-full-chromium-156.png](question-save-failed-390x844-full-chromium-156.png)               |
| question-conflict           | 390×844   | full      | [question-conflict-390x844-full-chromium-156.png](question-conflict-390x844-full-chromium-156.png)                     |

额外引擎导出预览：[Chromium](poster-chromium-390x844-generated-full.png)、[WebKit](poster-webkit-390x844-generated-full.png)。报告完整长图包括所有五个视口及320大字、题签/文化展开；字体/图片生成失败保留明确重试入口，存储失败/真实双标签冲突有对应截图。

## 复跑和性能范围

在本仓库根冻结安装、安装测试浏览器、`pnpm build` 后，仅在无未知3100服务时启动 `pnpm start --port 3100`，再运行：

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/d1c/capture.mjs
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/d1c/export-check.mjs
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node docs/qa/d1c/performance.mjs
```

脚本会更新本阶段自己的证据，不改历史目录。[性能记录](performance.json)含每页3轮全新context冷加载和1轮1.6Mbps/150ms/CPU×4诊断（共20样本）；既定单图≤200KiB、字体≤220KiB/1请求、首屏≤650KiB、LCP≤2.5s、CLS≤0.1、24帧程序滚动p95≤35ms，预算违规0。报告冷样本LCP最大44ms、CLS最大0.0000081；各页首个冷样本传输约318–365KiB。封面无滚动范围所以p95为0，不是零成本。PNG生成资源/时间另见导出记录，不能把首屏预算声称为生成后的整页总传输；未测浏览器峰值内存或真实手指INP。
