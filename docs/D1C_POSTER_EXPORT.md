# D1-C PNG 导出实现与边界

2026-10-11（Asia/Shanghai）。沿用批准的「风骨映月」全画与下层深青金色文字。本阶段固定合成展示，不是付费测评结果。

## 方案选择

| 方式           | 一致性、字体与维护                                                                                                                                                                                    | 决定                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 受控Canvas 2D  | 固定1080×1920物理像素，本地FontFace与字形表，按实际measureText排版，只绘只读DTO；无第三方runtime依赖。布局需与画作配方维护。                                                                          | 本轮采用，适合一个受控收藏配方。         |
| SVG/Canvas合成 | 纯SVG可作为几何装饰；把HTML/CSS经foreignObject合成会增加字体、图片和浏览器序列化边界。                                                                                                                | 保留未来其他主题配方；本轮无需引入。     |
| DOM转图        | [html-to-image](https://github.com/bubkoo/html-to-image)（仓库MIT）等实现会复制DOM、嵌入字体/图片再经SVG绘制，可覆盖已有复杂DOM但CSS继承、资源嵌入、图层和大DOM成本更高；新增依赖需要固定版本与审计。 | 本轮不采用，不将整页导航或按钮截进成品。 |

依据：[Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)规定PNG支持、null失败与origin-clean限制；[FontFace.load](https://developer.mozilla.org/en-US/docs/Web/API/FontFace/load)可显式等待字体加载。导出器只允许代码内登记的同源图，不使用QuizPack、查询参数或用户输入的URL。没有新增生产依赖、安装脚本或候选库。

## 展示契约与排版

`historicalDisplayFixture` 固定组合 `HistoricalReportView`、`ResultAtlasView`、视觉文案与题签，并有displayId。揭晓、报告、海报都读取它。`createHistoricalPosterView`仅选择身份、受控画作、同一题签、两至三项明确引用的维度原值、品牌和演示说明；没有答案、Key、Session、访问URL或个人字段。它是内部展示适配，未冻结QuizPack或ReportSnapshot Schema，也不证明评分或匹配权威。未来正式不可变快照必须另经授权接入，不能信任展示ID作为版本/身份验证。

导出器再次拒绝未知/变造画作、缺字段、重复维度、非有限/越界数值、缺演示说明及超范围文案。姓名/称号/两行题签按Canvas实测宽度换行，有限缩字号后仍超过底边则明确失败，不截字或静默改变分数。保持完整人物原图等比缩放，不裁脸或手；深青透明渐变接到底部文字区，外框由Canvas绘制。背景最终不透明，半透明渐变正确合成到画作上；不是透明PNG剪影，原已批准画作本身为不透明WebP。

固定PNG为1080×1920。单画布RGBA约8,294,400B，编码后尺寸实际记录在验收产物；图像与编码还需浏览器额外内存，未宣称测得峰值。结束编码立即清画布，UI只持有一个Blob/File与对象URL；重新生成/卸载释放旧URL，挂起任务结束后不更新卸载组件，不无限保留历史图片。资源/字体/编码10s超时和失败可重试；字体成功后复用，不重复累积FontFace。

## 字体与素材

使用V2-C同一 `serif-600.woff2`（138,168B、Noto Serif SC、OFL1.1）与登记字表；总控用隔离fonttools4.61.1/brotli1.2.0实际核验cmap包含全部800字符，无字表缺字。导出对全部实绘字符（中文、品牌、数字、固定标签）做覆盖检查；字表外字符明示失败，无悄悄系统替代。当前子集不覆盖任意中文或所有ASCII标点，小数点等未登记字符须另补受控字库后才可输出，不改写原值。长文检查夹具只用受控字表，不能冒充任意字符都已支持。

导出源为 `figure-960.webp` 199,972B，等比缩至PNG；它没有恢复不存在的高精度像素，生成1080像素宽不等于人物原画为1080。AI角色/四厅图仍pending/not-approved，文学文案和文化解释仍待审读。当前古诗来自[南通大学《李白〈行路难〉（其一）鉴赏》正文](https://sxss.ntu.edu.cn/2018/0301/c6266a165818/page.htm)，本轮重新核对末两句；引用只为文化题签，不推断用户经历/未来，也不复制鉴赏正文。

## 下载与分享

先点生成，再通过新的用户点击下载或分享已生成的File，避免异步绘制丢失分享所需的transient activation。[Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)要求安全上下文、用户激活与权限策略；[canShare](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare)用于探测文件分享能力。成功生成只说PNG可用；download仅说发起下载；share返回仅说流程返回，取消、拒绝、不支持分别提示。不称已存入相册。

- iPhone/iOS Safari：能力探测通过可用系统分享菜单；也可打开生成Blob图片后长按。菜单、相册与文件保存因系统/浏览器版本不同，必须在设备上确认。
- Android Chrome：可用download或支持PNG的系统文件分享；下载位置和图库是否收录由设备决定。未支持分享时仍保留下载/打开图片入口。
- 桌面浏览器：download与Blob预览可独立使用；分享能力缺失有明确提示。

Playwright Chromium/Pixel仿真和WebKit引擎测试（结果在D1C_ACCEPTANCE中）不等于真机Chrome或Safari，不证明菜单/系统相册最终行为。历史WebKit分享bug只能作为回归线索，不能据此断言当前Safari一定有该bug。

## 可复跑验证

纯函数单测包含正常、长文、超纵向预算、缺字段/未知/原型属性/变造URL、非法维度、字表内外字符。E2E真实绘图并解码预览1080×1920、下载PNG并读取signature/IHDR、检查实绘值与报告一致，图片/字体失败和重试、失败重生成无旧下载、长姓名/称号/原创题句、重复生成及分享取消/不支持。编码失败、卸载和URL回收由额外故障注入/源审查补充。测试模拟share只验证应用分支，不冒充系统菜单通过。

`/studies/visual-v2-c/poster/checks?sample=long|original|unknown|glyph` 是固定合成排版/错误夹具，枚举外值回默认；不会把查询中的任意文案、URL或角色放入海报。它不改变主体验的固定报告，未知人物示例仍fail-closed。
