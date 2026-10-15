# P3-C 合同与共享底座审查

日期2026-10-16。基线P3-B交付59a83e01f2a99a834a7349ced713ba5fed55b93c，其普通38789883159与媒体38789883025均实际success；运行实现及技术验收分别见P3B_ACCEPTANCE。新分支codex/fixed-revision-preview，主控接续原两条独立Sol/high与Astra/high聊天。

两线只读预研核实：import read的writeCredentials会要求import:create，临时评分须studio:read加独立来源/CSRF；固定revision读取不能重判当前归档策略资格；合法asset alias保留首来源；私有blob读取需真实共享锁及实际任务/FD生命周期，清理只在自有server真实退出后。界面不能复用旧固定李白/分数/年代或不存在的字段，海报明确完整1–4维容量与缺字失败。

Astra两轮草案意见补齐同revision内requestId/答案快照/导出代次，以及最小DTO不是对授权运营员保密的权限含义。正式合同进一步冻结封套预算、响应正文全程持槽、真实close/进程组退出的私有清理proof。最终独审确认可进入共享底座，无架构阻断；productId UUID笔误按现有受限字符串Schema纠正。

[PREVIEW_P3C](PREVIEW_P3C.md)是冻结设计，不是实现证据。主控接续严格机器DTO/错误/预算、纯registry接口、真实字体/覆盖descriptor及边界测试，之后两线实施。不用占位hash联调，不将旧演示或Schema通过当六状态真实预览。

## 首个共享底座准备

主控交严格入口/揭晓/资源/导出DTO、固定绑定与版本descriptor、96KiB专用只读评分JSON reader、八个有限HTTP错误、同源URL编码及纯projection接口。旧4KiB写reader不改。阶段组件运行Schema原本精确，但继承v2 component(id:string)会使TS字段宽化；新增类型断言实际发现后，preview独立as-const六ID机器表恢复编译时精确state类型，不改旧v2行为。

独立导出DTO保留binding/requestId/answersHash/logicHash/selectedResultRef/reportTemplateRef与ready poster，不能仅把原图和卡名送去导出而丢失结果身份。HTTP错误的requestId是服务端观察ID；成功评分回显客户端关联ID，错误依客户端当前请求闭包/代次处理，不能混用两者。

真实Noto Serif SC子集固定Google Fonts commit8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5，OFL及源hash核验、固定fonttools4.61.1/brotli1.2.0，1097字符cmap缺失0；218976字节woff2，fontSHA ff31970785d40d8ca32980632e6ce68766e79551d22f6617ef83b1853f63e89f。两次独立目录重建的font/manifest逐字节相同，来源/复现见public/assets/fonts/preview-v1/README.md。没有将cmap验证当作新PNG或视觉验收。

最初共享URL往严格scope传入完整binding被拒，定向测试复现；path factory改为显式选择scope字段，resource query仍严格验证完整绑定和Ref。共享底座独立审查进行中，当前没有A/B服务或UI实现。

## 共享底座整改复审通过

独审实际复现两项P2：继承完整content/v2 Schema导致node:util进入浏览器依赖；仅有常量未执行完整响应封套字节上限。主控改为中立标量与独立有限display-shapes，旧v1/v2不改；响应Schema实际校验完整序列化UTF-8。主控53定向、类型/lint/格式及真实platform=browser打包通过，输出1555082未压缩字节（两个入口，非最终页面负载）。根直接import esbuild首次不可用，不当通过；实际通过使用已固定tsx的esbuild0.28.2依赖，没有增加依赖。

Astra以最新副本独立浏览器打包成功、30定向通过（含额外六组中文/引号/换行转义的入口524288与揭晓262144精确上限/+1）、TypeScript组件类型零诊断。独审在自己工作树重建font/manifest逐字节一致，并核实际cmap1097字符、静态600字重和许可证/文件/字表hash。两项P2关闭，确认可交A/B实施；真实服务、评分投影、六状态/PNG及整体验收仍待完成。
