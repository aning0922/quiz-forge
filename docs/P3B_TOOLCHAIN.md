# P3-B 显式包工具入口

本页记录四组合技术验证工具；当前后端准入、完整DB/媒体/浏览器验收以P3B_REVIEW与后续验收为准。authored仅保留内容来源声明，不代表平台审核、图片权利或发布通过。

所有命令从本独立仓库根执行，依赖使用固定锁文件。旧命令不增加版本参数时仍使用原v1入口；旧默认Schema stdout与两基准ZIP字节保留。

```sh
corepack pnpm --silent quizpack:build input.json --product synthetic-product --out output.quizpack --content-version v2
corepack pnpm --silent quizpack:check output.quizpack --product synthetic-product --content-version v2
```

`--content-version v1|v2` 必须作为完整尾随参数；显式v1同样使用新验证身份，但生成的v1归档字节保持旧构建规则。实际manifest/content不匹配所选版本时拒绝，不自动升级、修正或选择最新版本。重复、未知或缺失的版本参数在文件IO前拒绝。新旧两条构建路径共同使用有界文件读取、真实ZIP再验证、no-clobber输出与提交后中断收据；不能覆盖已有文件。

```sh
corepack pnpm --silent quizpack:schema
corepack pnpm --silent quizpack:schema --content-version v2
corepack pnpm --silent quizpack:schema --manifest-content-version v2
```

零参数保留`quizpack-schemas.v1`的旧manifest/content组合输出。第二条保留P3-A的`quizpack-content-schema.v2`，只包含content Schema。第三条明确输出`quizpack-supported-manifest-schema.v1`、`contentSchemaVersion`和对应manifest Schema；也支持v1。两种选择参数不能混用，不把content-only Schema冒称完整包验证器。

四组合均须通过文件集合、真实bytes/hash、图片格式/解码和完整引用检查；报告使用quizpack-validation.v2、validator2.0.0、quizpack-local-supported.v1。技术报告始终importable=false/publishable=false，并保留评分见证、权利、人工审查、真实渲染及数据库/发布未验证项。实际导入与审批是后端独立操作。

原包、content/manifest、图片、解压和执行预算不变。目录与输出路径仍受既有no-follow/no-clobber限制，不接任意代码、HTML或动态模块。源码绑定同时覆盖package/content的实际依赖，main与fixture必须重新构建绑定和封存；单元测试或本地CLI成功不能代替后端媒体隔离验收。
