# P2-A Studio 浏览器检查

2026-10-12（Asia/Shanghai）。浏览器 Chromium 156.0.8078.4，生产 Next 构建，精确 loopback 端口3100、reuseExistingServer=false。页面实现提交8aba454，截图测试修正530e2e5。总控实际查看下列图片；这是助手的界面检查，不是作者最终审美批准或生产认证验收。

## 正常登录与会话

独立 studio-auth 项目通过真实 PostgreSQL test 实例和私有合成凭证完成运营者、只读角色登录及退出。未使用模拟登录成功响应。320/375/390/430 CSS px × 900px，deviceScaleFactor=1，均通过无横向溢出、凭证输入字号至少16px、输入与退出目标至少44px的实际浏览器断言。正文沿Studio的16px基础样式呈现，已在截图中检查可读性。

总控逐张查看8张图：四种宽度的空输入登录页与已登录运营会话页。标题、说明、标识、角色及北京时间到期字段可读，按钮未遮挡，窄屏长说明正常换行；320px页首环境说明自然换行，其他宽度同排。界面与消费者研究页面分开，没有未实现的工作区/导入/发布按钮。

本机产物目录（忽略，不入Git）：`test-results/studio-auth-real-operator--aa9fb-and-safe-mobile-UI-captures-studio-auth/`，文件 `studio-login-{320,375,390,430}.png`、`studio-session-{320,375,390,430}.png`。只读角色另由真实浏览器验证标识/角色和退出，未保存专门的只读截图。

## 加载、失败与不可用

390×844 的 `studio-login-loading.png` 用可控延迟暂缓真实 preauth 请求，空输入、禁用状态与“正在准备”说明均清楚；它是 UI 加载状态检查，不冒称真实网络故障。释放后执行真实非法合成输入，同尺寸的 `studio-login-error.png` 显示统一失败与重新准备操作，截图前确认输入已清空。两图均已实际查看，无遮挡或横向溢出；PNG实际尺寸已读取核验。

初次全量运行中，该截图用例因立即 unroute 与等待中的 route.continue 竞争失败；188项通过、1项失败、10项既有跳过。efae26c（集成为530e2e5）仅修正测试路由生命周期；随后 studio-auth 三项实际全部通过，未吞掉拦截器异常。后续全量收口结果以P2A_ACCEPTANCE为准。

总控随后用受管CLI停止自己的55423 test实例，启动同一生产构建，真实访问 `/studio/login`：显示“Studio 暂不可用”，不创建会话、不给出假登录按钮。对 preauth API 的真实请求返回503/STUDIO_UNAVAILABLE及 `Cache-Control: no-store, max-age=0`。390×900无横向溢出，图片 `.cache/p2a-visual/studio-unavailable-390.png` 已实际查看；检查后服务器停止、数据库恢复供剩余验证。

## 敏感产物与限制

认证项目trace/video/自动失败截图均关闭，无HAR；所有手工截图只包含空输入或非敏感合成标识。原始凭证、Cookie、CSRF、配置与连接串没有绘制到截图。E2E helper生成的0600凭证文件按本轮runId清理。

尚未进行真实iOS/Android设备验收。P2-A只有本机运营认证视图，不代表Product工作区、正式商品体验、内容效度、素材授权、商业发布或消费者完成流程已通过。
