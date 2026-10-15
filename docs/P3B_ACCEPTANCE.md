# P3-B 完整包准入技术验收

日期：2026-10-16。运行实现 c419aa6a6244d58f0c2b7543cbc08122eeabf877；最终测试修订 afaa43ec09a5cb8ff8df2d54ad1819440dedf8b5。本文记录真实本地验收，准确head远端普通与媒体CI均已成功，Astra独立最终核验通过，本批技术出口完成。

## 已实现

显式支持 quizpack.v1 容器中 content.v1/v2 与 synthetic/authored 四组合，两个既定评分引擎及精确受控组件版本。完整包构建、验证、媒体隔离、可信候选、私有归档和首个不可变草稿 revision1 共用固定内容与资源证据；不允许包携带源代码或动态模块。CLI须显式指定新版，旧默认Schema输出、旧包字节与原错误行为保持兼容。详见 [准入合同](PACK_ADMISSION_P3B.md)、[工具链](P3B_TOOLCHAIN.md)及[数据实现](P3B_DATA_ADMISSION.md)。

新报告/身份/归档策略分别为 quizpack-validation.v2、quizpack-validation-identity.v2、quizpack-private-archive.v3。旧历史保留原证据并只读，恢复旧记录不重签新身份；旧成功应用key先重放原回执，新key不能将旧ready直接应用。跨策略相同包版本保持一致的canonical归属；不同原始ZIP不能占用已存在的包版本。相同资源声明和blob复用保留最初来源。

0015迁移要求真实静止、旧写者停止、没有残留操作或未确认媒体任务；不改历史状态、ACK或保留额伪造静止。当前策略pending上限20，全部历史1024行和全体磁盘预算仍单独受限。旧策略早期拒绝发生在私有文件IO之前；历史静止检查只读取有限控制字段。

## 实际验证

| 检查               | 实际结果与覆盖                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 格式 / lint / 类型 | 集成实现全部通过；最终测试修订另有定向格式/lint/类型检查                                        |
| 单元测试           | 108文件1363项通过；最终CLI五项单独再通过，7.45秒                                                |
| PostgreSQL         | fresh主控实例37文件355项通过；f11后主控8项、环境修复后A9项增量通过；最终远端完整37文件356项通过 |
| 真实驱动           | ESM/CJS合计46项通过                                                                             |
| 生产构建           | 零warning，65trace /12960路径 /0私有违规                                                        |
| macOS main媒体     | 66项连续三轮全通过，实际sealed，操作均停止、无控制残留                                          |
| macOS fixture媒体  | 独立66×3封存通过，真实Next入口16观察通过，包含八个完整包组合正例                                |
| PostgreSQL服务专项 | A在独立fresh库14项及媒体UNKNOWN3项通过；媒体边界使用明确mock，不能当原生隔离证据                |
| 生产Chromium E2E   | fresh库222通过、10既有跳过，2.2分钟；authored/v2真实归档5个资源声明                             |
| 移动图检           | 32张320/375/390/430真实图已独立逐张复核通过，详见[P3B_VISUAL_CHECK](P3B_VISUAL_CHECK.md)        |
| CI / 独立审查      | afaa43e普通38788800066及媒体38788800035实际success；Astra最终出口通过，无剩余P1/P2              |

生产浏览器中的五个资源引用包含共享字节的中性场景，保留五条声明但实际blob去重为四份。素材为独立合成测试像素，authored字段用于准入测试，不代表真实历史人物题库或素材已经批准。只读历史正文仍可查看；正式renderer和消费者评分尚待P3-C/P4。

## 部署及隔离证据

主部署绑定1059个source、740个artifact，33196291字节。sourceBundle为 b25e04ed307ca76b75fd2f5826a912119328da192920021a79208a151a6af111，deployment为 c902f006a5d4d1786e9e6372e96d59f5e97e70bd170c754272eeef2e55cc661a，runtimeBundle为 c81dd27dd79d23a05235e7a924c320b035b2fcc533a7c165ef2773bc53ddb3f7。最终测试/文档修订不改变该运行闭包，未将其冒称为重新构建。

首次绑定因生成webpack cache单文件超16MiB失败；仅将19个生成cache文件87267387字节迁到私有保留目录，1567个非cache文件/目录条目逐一保持字节或身份一致，未放宽限制。随后绑定及封存成功。fixture另有独立deployment48b3c8289df926560567093c58f98ccc76681cae022fb13649b323aba4b307a4，不能混用其seal作main证据。

最终浏览器进程退出后，按B3→B2顺序精确清理夹具并停止e7d实例；主控普通/驱动889实例和独立开发/审查自有实例均停止。旧失败和UNKNOWN现场保留，不强制清理。有限摘要见 [集成记录](qa/p3b-integration.json)。

## 下一步与人工闸门

[Draft PR #16](https://github.com/aning0922/quiz-forge/pull/16)堆叠于#15，未合并main。阶段技术出口完成后接续固定revision真实六状态预览，再完成同Product返修追加revision、具体内容/素材审核与版本封存、Key/会话/不可变报告及首款P5内测。历史四卡与folio/cabinet方向保持既定选择。

本批不包含预览renderer、重新导入追加修订、内容/素材批准、ProductVersion发布、AccessKey或正式消费者报告。仓库public不等于main合并、生产迁移、部署或商业发布授权；正式内容和九张素材需向作者提交可审核实物。
