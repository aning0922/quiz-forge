# 首款素材来源与使用依据

记录日期：2026-10-18。该记录补充首款八张已确认原图的来源证据，独立于作者的内测视觉批准和今后的商业发布决定；不改写旧manifest中的pending/commercialApproval历史。具体八图SHA和字节见[内测基线](qa/historical-internal-baseline-2026-10-18.json)。

## 原始产物

李白和四厅于2026-10-11由内置image_gen按项目原创提示生成，来源记录分别在visual-v2-b及visual-v2-questions的manifest和对应prompts。既有WebP仅为原输出编码转换；此次内测沿用作者实际看过并已确认的WebP字节，不重新转换。四厅提示记录inputImages=[]，没有外部参考图；李白manifest记录no reference image。现存李白原PNG重新核对sourceSha通过。

苏轼、陶渊明、白居易于2026-10-16由内置image_gen生成，原始PNG没有转换或修饰。审阅包manifest、完整prompts及三份原generated文件均已核对；三份原文件SHA与批准的PNG完全一致。提示未指定第三方画作、在世作者风格、游戏角色或外部参考图。三份新PNG和审阅原文件继续在本地私有材料中，本记录不将它们上传公共Git。

上述人物为历史文化题材的原创艺术演绎，来源材料不声称可考证的历史肖像或服饰复原。批准覆盖的是具体八张成图及内容，不把生成方法本身当成作者审美批准。

## 供应方公开条款依据

已实际读取2026-01-01生效的[OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/) Content部分：在用户与OpenAI之间、适用法律允许范围内，输出归用户，OpenAI转让自身可能拥有的输出权利；该条款同时保留对输入权利、第三方权利和输出非唯一性的限制。EEA/英国/瑞士的[Europe Terms](https://openai.com/policies/terms-of-use/)也有相应输出归属条款，不在此推断账号居住地。

商业服务的[OpenAI Services Agreement](https://openai.com/policies/services-agreement/) 4.1亦规定Customer的输出归属，4.3–4.4保留客户使用责任及非唯一性。官方[商业输出FAQ](https://help.openai.com/en/articles/6783457-what-is-chatgpt)明确说明，遵守条款和政策时，输出可重印、销售和商品化，免费/付费计划均适用。

本项目据这些供应方公开规则、项目原创生成记录及实际文件对应关系，记录OpenAI一方输出使用权的依据。此为证据与工程准入判断，不认证法律上的独占版权、保证第三方无权利，也没有核查账号单独签署的非标准协议。不能将本记录写成“OpenAI认证此商品”或用户已批准商业发布。

后续包中commercialUse/redistribution若以此为来源声明，应明确指向该依据及八图对应生成证据；平台授权状态仍unverified，author内测批准另走精确review账本。对真实来源不符、外部图片、缺来源或非标准限制，不沿用本记录。此次不会为内测而放宽现有包Schema或用虚构许可使验证通过。

## 字体与证据摘要

现用historical-preview-serif@1.0.1的OFL1.1文件随字体保留；允许随软件嵌入和再分发的条件以原许可证为准，不单独售卖字体。文件和coverage摘要沿既有受控descriptor，许可证SHA为`5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6`（4350字节）。字体原文、原作者版权和名称规则继续保留。

| 现有来源文件                                                      | 字节 | SHA-256                                                          |
| ----------------------------------------------------------------- | ---: | ---------------------------------------------------------------- |
| public/assets/themes/historical/visual-v2-b/manifest.json         | 3401 | c5c4aab506e09d549a1052838e1070e9f47559ad7bd837f82474ebe5074bdc26 |
| public/assets/themes/historical/visual-v2-questions/manifest.json | 2829 | 6ea02cf1175b136daca05d5ddfdff1227ffba4be8b177911e66ce719eb1ba7be |
| docs/VISUAL_V2_B_PROMPTS.json                                     | 4743 | 264f51e44123925bf01f3bd86914a6ed6e69614eac049538cf4d5be32abdea4c |
| docs/VISUAL_V2_QUESTIONS_PROMPTS.json                             | 6245 | 75487236308e5f5dddc3c9352b7a23aa9aca4e3c15ce64e0721cb72a12a00b22 |

私有三图审阅manifest/prompts及原文件摘要已在基线JSON逐项保存。原版权/授权声明与作者审核、自动包验证、版本封存、公开发布分别保留真实范围；本记录仅补使用依据，不产生发布资格。
