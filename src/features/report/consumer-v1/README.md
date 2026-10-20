# P4 消费者纯海报实现

interfaces.ts 提供 ExportConsumerPosterV1；export.ts 实现 exportConsumerPosterV1。输入为稳定 DisplayPosterExportBodyV1、DisplayResourceTransport、精确 DisplayFontDescriptorV1、取消信号及当前授权代次检查。不接受 Key、恢复链接或客户端分数，也不证明输入已持久化；host须先验证唯一锁定报告。

| 文件           | 实际职责                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------- |
| layout.ts      | layoutConsumerPosterV1，独立布局与“内测报告／已完成”标记，完整维度/正文，不裁字、缩字或静默选维度 |
| export.ts      | 1080×1920，固定字体/资源校验、有界绘制与编码、取消和代次检查，不持久化PNG                         |
| layout.test.ts | 独立标记、完整维度、边界与长文案超限失败                                                          |
| export.test.ts | 固定输入、尺寸、取消、迟到编码、失败与资源释放；mock canvas而非视觉证据                           |

原样复用旧withPreviewFont的固定字体/覆盖校验及wrapPosterText纯换行能力；root需在新descriptor固定完整复用闭包。旧文件不变，不调用layoutPreviewPoster或沿用PREVIEW_MARK。字体缺失/覆盖不足明确不可用，无系统字体/latest回退。

导出只读显示快照，不评分、改报告、调用AI或补造人物事实。素材/排版/编码失败只影响海报，已保存报告仍可读。PNG不含Key、恢复链接、公开分享授权或发布资格。不同浏览器编码字节不承诺完全一致。

2026-10-18：tests/browser/consumer-display.ts在真实Chromium156.0.8078.4以既有合成像素/固定字体生成1080×1920PNG，并验证错误资源hash、缺字体和失效代次均拒绝。实际PNG已查看，未见文字裁切/重叠；原图与结果位于本worktree忽略目录 .cache/p4-consumer-display/1792332467748/。完整组件验证及45图范围见theme/consumer-v1/README.md。该纯显示证据不证明实际Key/session/report持久化或正式人物素材质量；当前未接业务HTTP/DB/3100。
