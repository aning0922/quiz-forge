# P3 受控组件与表现合同预案

日期：2026-10-12。状态：**推荐方向已采纳，计划未实现，待 P3 合同审查与冻结**。本文不代表 content.v2、版本分派器、组件 registry、真实预览或兼容测试已经完成；具体字段、长度、引用规则及版本号仍需正式合同审查。本次只整理前置决策，不启动代码开发。

## 来源与目标

- 工程只读分析基线为 `codex/catalog-workspace` 的 `47f5f0e60ddbf52fa08a49ae1011215d24cc786d`；本文新增时同分支为 `1befc1de66572098c9ab18449dcf04b6cafe851d`。
- 直接合同：[P1 content](../src/features/quizpack/v1/content.ts)、[manifest](../src/features/quizpack/v1/manifest.ts)、[compatibility](../src/features/quizpack/v1/compatibility.ts)、[引用验证](../src/features/quizpack/v1/references.ts)、[P1 合同](QUIZPACK_P1.md)。
- 表现来源：[Visual V2-C](VISUAL_V2_C.md)、[研究问题页](../src/features/theme/historical/visual-v2-questions/question.tsx)、[研究结果页](../src/features/theme/historical/visual-v2-c/result.tsx)、[研究海报适配器](../src/features/report/historical-poster-view.ts)。
- 内容来源为独立分支 `codex/first-product-content`，提交 `e8ba8108c30168c8120f0b05354c8821c1d787f9` 的 `docs/FIRST_PRODUCT_CONTENT_DRAFT.md`。四卡阵容已由作者选择，不等于内容、文化、素材、视觉或发布批准。
- 评分边界见[评分预案](SCORING_P3_PREFLIGHT.md)，导入存储边界见[P2-B 预案](STUDIO_P2B_PREFLIGHT.md)。

目标是让四厅分组、题签、逐题中性场景与四卡海报短句有版本化数据来源，同时保持原评分合同和旧 P1 synthetic 包兼容。不重新设计整个 QuizPack、评分或资源系统。

## 采纳方向与排除方案

保留 `quizpack.v1` ZIP 容器及安全限额，新增小范围 `quizpack-content.v2`。v1 的严格结构与原语义保留；新 reader 支持 v1/v2，旧 reader 对未知 v2 明确拒绝。

不在 content.v1 中无版本依据地增加可选 props，不开放 arbitrary JSON，也不按 Product ID 在程序中选择行为。仅增加专用 props union 虽可安全实现，但会使跨封面/题目/恢复的分厅配置重复；本次优先用有限 visual/report 数据，layout props 暂保留原四字段。

新表现套件通过主项目审核、测试并发布到受控 registry。包只引用已存在的三元组，不能提供源码、HTML、CSS、URL 模块、组件注册代码或执行表达式。

## content.v2 的最小数据增量

保留 P1 的 Product、dimensions/questions/rules/results、reportTemplates baseline、resources 和六状态 layouts。初步增加以下严格对象；这是结构草案，不是已实现或最终冻结的 Schema：

```ts
visualPresentation: {
  coverSceneRef: ResourceReference;
  sections: Array<{
    id: StableId;
    name: PlainText;
    chapter: PlainText;
    introduction: PlainText;
    sceneRef: ResourceReference;
  }>;
  questionFrames: Array<{
    questionRef: QuestionReference;
    sectionId: StableId;
    caption: PlainText;
    sceneOverrideRef?: ResourceReference;
  }>;
  resourceDescriptions: Array<{
    resourceRef: ResourceReference;
    alt: PlainText;
  }>;
}

reportPresentation: {
  resultCards: Array<{
    resultRef: ResultReference;
    displayName: PlainText;
    subtitle: PlainText;
    posterLine: { kind: "original"; text: PlainText };
    posterDisclosure: PlainText;
  }>;
}
```

归属决定：

- visualPresentation 随 visualVersion 固定，负责分厅、题签、中性场景与 alt。
- reportPresentation 随 reportVersion 固定，负责卡片显示身份、原创短句及海报说明。
- 人物资源继续由 results[].portraitRef 决定，不增加另一套画作来源；baseline 继续由 reportTemplateRef 绑定。
- 不把海报短句塞进 strengths/reflection；“这张卡可借用的做法”可成为新报告组件版本的固定栏目标题，不能按 Product ID 特判。
- posterLine.kind 首期只允许 original；它是作者声明，不是原创性/商业批准。古典题签与出处结构后置。
- 不增加未经审阅的 era、生平、相似人物排名或文化史实字段来适配旧研究 DTO。

建议 sections 为1–8，questionFrames 精确覆盖题目且最多100，resultCards 精确覆盖结果且最多32，resourceDescriptions 最多64；短名称/题签另设有限长度，posterLine可限120 code points，alt可限240。具体长度、必填性和文本规范在P3审查冻结，仍受原content字节/深度等限额，不自动扩容。

资源purpose暂保持cover/portrait/decoration：厅景使用decoration。所有引用复用精确 `{id,productId,version}`，不接受文件路径、网络URL或动态资源模块。

## 引用与行为不变量

1. section ID唯一；questionFrames对问题完整且恰一次引用。分厅仅影响显示，不跳题、筛题或改变选项；首款按冻结问题顺序连续分厅，不用index/3推断。
2. sceneOverrideRef只替换当前题的中性场景；缺省使用所属section.sceneRef，不根据答案切换场景。
3. cover/question/resume所用资源不允许portrait purpose；技术字段检查不能证明图像确实中性，仍需人工验收。
4. 资源描述精确引用；非装饰性展示需明确alt，不从文件名生成历史事实。
5. resultCards精确覆盖全部结果、无重复，不反向修改result ID、规则、目标或分数。
6. 新字段参与引用与资源使用闭合检查；不能接受新场景却判unused，也不能遗漏嵌套的跨Product/版本引用。
7. layout.resourceRefs与实际状态使用的表现资源一致。builder可从明确引用图生成汇总，不能猜测或修复缺失身份。
8. 包内不接受href、storageNamespace、CSS class/style、React名称、import路径或字体URL。

## 评分投影与报告绑定

logicHash只覆盖影响算术的投影：逻辑身份、engine/version、维度ID、问题/选项ID与归属、贡献、边界、profiles、resultOrder。visualPresentation、layouts、图片/alt、reportPresentation、baseline及reportTemplateRef不进入算术投影；运营分类/标签和显示文案同样不决定算术。

完整内容hash仍覆盖所有字段，用来绑定审核、预览及后续发布。题干文案改变即使不改变算术hash，也必须改变完整内容证据并重新审核；算术相同不等于测评语义批准。

[评分预案](SCORING_P3_PREFLIGHT.md)中的reportTemplateRef保留为评分完成后的外层报告绑定：适配器从已选中结果读取，不能因此把报告引用纳入logicHash。v1/v2逻辑相同时，不因content schema标识或表现变化而改变原始和、精确归一化、距离和selectedResultRef；视觉/报告/完整内容hash按实际变化。

## registry 与版本边界

注册项由主项目静态代码提供，至少固定：id、componentVersion、propsSchemaVersion、支持状态、content schema支持集合、engine支持集合、view DTO版本、严格props解析器、受控DTO adapter及组件实现。服务端adapter与客户端组件登记应分离，防止服务端代码进入浏览器。

建议保留P1六项 `@1.0.0 / propsSchemaVersion 1.0.0`；新套件可沿用六个受控ID并整体注册componentVersion 2.0.0。若props仍是原四字段，propsSchemaVersion可保持1.0.0；组件版本变化不自动表示props结构变化。具体三元组由P3冻结。

暂保留root componentVersion作为整套组件版本的既有约束：新六状态及reportTemplate统一版本，不顺手开放任意版本混搭。v1/v2分别使用封闭状态允许表，未知ID/版本/props/状态/引擎组合明确拒绝，不回退最新版。

P1 compatibility policy只是解析合同声明。P3另验证组件实际存在、props与DTO可解析、资源可取得、运行器可渲染；`compatibility:passed`不等于`renderReady:true`。字体仍由受控应用登记及组件发布固定，包内字体/远端字体URL继续拒绝。

## 研究组件的复用边界

现有问题页读取旧演示题/localStorage并按index/3分厅；CandidateImage拼接固定public路径；CandidateResult固定导入李白fixture；研究海报适配器只接受synthetic-preview及单一李白画作登记。这些入口不能直接登记为正式运行器。

保留研究路由的原行为，提取可以复用的构图/样式/交互视图，改为只接收受控DTO。正式组件不依赖historical fixture、不从包构造URL、不读数据库/Key/模型、不计算得分。导航和答题由应用层受控回调提供，localStorage演示不能取得正式完成权威。

## 六状态与数据权限

| 状态     | 允许的DTO与动作                                   | 禁止内容/权限                      |
| -------- | ------------------------------------------------- | ---------------------------------- |
| cover    | 介绍、中性封面、分厅摘要、开始动作                | 人物候选/alt、目标或贡献           |
| question | 当前题/选项、进度、当前厅/题签/场景、受控答题回调 | 整包规则、结果、访问凭证           |
| resume   | 已授权进度摘要、中性场景、受控继续/重启动作       | 全部结果或凭证、数据库调用         |
| result   | 已确定卡片、对应画作、真实评分投影                | 改分数/改选结果                    |
| report   | 已确定结果、真实维度、完整baseline                | 固定fixture结论、重新评分/模型调用 |
| poster   | 当前结果脱敏DTO、原创短句、说明、已解析资源       | Key、答案、恢复会话信息、任意URL   |

确认提交属于question内部交互；加载/错误/冲突/缺图/减少动态是组件状态，不扩展顶层六状态。

揭晓前需检查序列化DTO、图片预加载和网络请求，不能只用CSS隐藏人物。消费者问题页不接收完整content、所有resultCards或资源alt；后台运营结构预览与消费者投影分开。

## v1兼容与版本分派

- 保留v1 parser、JSON Schema和引用语义。新manifest reader可识别已实现的content.v1/v2，容器仍为quizpack.v1，ZIP与文件安全profile不变。
- CLI的既有schema输出不能静默替换为不同文档；增加明确版本选择或独立入口，实际变更另做兼容审查。
- P3需为旧六个三元组实现真实基础渲染：旧heading/body、线性题序、baseline报告；没有新短句则不显示槽位。
- 不要求旧包补四厅/题签/海报短句，不猜每三题一厅，不补默认李白、时代或古典题签。
- 旧synthetic像素继续标为测试夹具，不能冒充正式人物立绘。当前仅有兼容声明不表示旧运行器已经实现。

## P2-B2现在需要保留的存储边界

**B2当前只接受v1。version dispatcher未实现时，对v2和其他未知版本明确拒绝；不为前向兼容接收未验证内容。**

- 数据库schemaVersion使用有界文本并与JSON内版本一致，服务端支持列表决定可接收版本；不要将DB CHECK/enum写死为content.v1。
- 保留原archive、原字节hash、完整有界JSON、canonical hash和实际schemaVersion，不能只拆出v1字段后丢弃版本信息。
- 不按固定四props重建JSON，不把P1六个组件ID做成DB枚举。组件引用保留三元组和policy/registry证据，不只存ID或latest。
- content/visual/report/resource版本分别保留；私有资源按Product/resource/version及blob绑定，不识别room-1、figure、人物名或public路径。
- 包身份同版本不同hash拒绝不变；表现升级创建新包版本，不覆盖旧v1记录。旧验证报告不改写，新增支持后产生新的validator/policy证据。

## P2-C结构预览与P3真实渲染

P2-C展示候选内容、引用、资源事实和验证状态，供运营审读；可以列出分厅映射和短句，但不要求执行被声明组件，也不能声称完整效果验证。

P3建立registry、受控DTO、确定性评分/见证与六状态真实渲染。预览中的完成不等于P4的Key消费或正式报告封存。素材pending可作为受授权内部审查对象，但不能因预览成功变为商用批准。

## 待执行兼容与验收

| 类别     | 必验                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 旧合同   | 两个P1 fixture原样构建/验证/基础预览；研究路由语义不变                     |
| 新合同   | 未知字段、越界数组、HTML/代码/URL拒绝；未知三元组/跨状态使用拒绝           |
| 引用     | 分厅/题签完整，无重复/错题/跨Product或版本；新资源引用闭合                 |
| 评分隔离 | 仅改场景/alt/题签/短句，精确评分及结果不变，表现证据正确失效               |
| 四卡     | 名称/称号/画作/短句对应正确；缺图明确不可用，不借其他人物替代              |
| 揭晓隔离 | 封面/题目/恢复无人物资源、alt、预加载或结果配置泄漏                        |
| 执行边界 | 无任意导航/存储键/CSS；组件不消费Key、改分数或运行包内代码                 |
| 浏览器   | 六状态320/375/390/430及桌面、长文案/错误/缺图/缺字/字体失败/减少动态/focus |

人物形象、封面中性、场景是否诱导、文化合宜性、原创短句、素材/字体权利、真实PNG与实机体验仍需相应人工验收。自动兼容和截图断言不构成批准。

下一步为P3合同审查：冻结新增字段/长度/必填性、引用图、组件三元组与DTO版本、分派接口和证据结构后再实施。本文不授予真实内容、素材、main合并、生产迁移/部署或商业发布批准。
