# 现有内部预览的纯显示导出

P3-E 前置整理沿共享 display-v1：`layoutPreviewPoster(body, measure)` 只读 DisplayPosterExportBodyV1；`exportDisplayPoster(body, transport, font, signal, current)` 只接纯显示正文、编译 adapter 的 DisplayResourceTransport、受控 DisplayFontDescriptorV1 和当前生成门闩。report 运行代码不再引用 Studio client/media 或 Product 的 draft binding。没有新增公开导出接口或正式报告能力。

`withPreviewFont(font, texts, signal, render)` 逐次读取并核受控字体与 coverage 字节/SHA，保持600字重、唯一 FontFace family、完整字符覆盖和 finally 删除。路径描述只能由项目注册代码构造，不接受请求或 QuizPack 自报字体。现有实际字体文件及许可未修改；许可摘要和精确实现条目由主控登记。

有界读取和图片 hash/decode/尺寸/Blob URL 释放使用 lib/browser/display-*。字体操作将其原15s绝对 deadline 继续传给 portrait transport/读取，子操作不得延长；取消、超时和 PNG 错误 code 保持。1080×1920、人物 contain、浅色正文区域、完整全部维度/披露、measureText 与墨迹边界及内部预览标识均保持；不截字、缩字、替图或回退系统字体。

mock Canvas/FontFace 单测检验边界与释放，不代替实际 PNG 或视觉验收。主控集成后须重新构建并实际运行预览、PNG和截图检查。本目录没有实现 P4 持久消费者控制器，也不授予内容、素材或商业发布批准。
