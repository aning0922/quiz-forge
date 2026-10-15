# P3-B 准入后台视觉检查

日期：2026-10-16。主控fresh数据库、生产构建、独占3100上的Chromium实际截图。运行实现c419aa6，E2E夹具/断言更新至f11cbae。各状态分别使用320×900、375×900、390×900、430×900 CSS px，deviceScaleFactor=1、fullPage；不是移动实机检查。

独立包工具聊天实际使用view_image逐张检查全部32图，主控补查ready320及代表异常状态。截图及尺寸/hash清单见[产物目录](qa/p3b-2026-10-16/manifest.json)。

| 文件前缀                           | 四宽实际图检结论                                                  |
| ---------------------------------- | ----------------------------------------------------------------- |
| validations-ready                  | 长ID/hash换行完整；归档5/5、待首稿导入、平台未审核/不可发布均清楚 |
| validations-unknown-empty-get      | 原请求仍待核实，空查询不被解释为回滚；没有重新提交假入口          |
| validations-persisted-before-fetch | 刷新保留未知原请求，无虚假成功                                    |
| validations-read-only-unknown      | 仅核实/刷新，无可见写入入口                                       |
| validations-disabled-prepared      | 继续按钮禁用，取消未发送准备可辨认，不冒称服务器已执行            |
| validations-archived-unknown       | 归档限制与原请求读取清楚，未知警示仍保留                          |
| imports-received                   | 明确区分接收、验证、归档与草稿应用，received不代表批准            |
| imports-disabled-read-only-empty   | 关闭/只读/空历史分别说明，无虚构启用按钮                          |

32图均未发现明显横向溢出、遮挡、裁切或固定跳转链接拼接伪影。320导航和长摘要正常换行，按钮/分页位于卡片内；相关浏览器布局与交互断言通过。五资源声明均来自专用合成像素，不是正式人物素材。

本页是助手视觉与工程状态检查，不替代作者对内容、风格、人物素材权利或发布的批准，也不将旧D1消费者演示当成P3-C固定修订预览。
