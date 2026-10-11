# OSS-R 隔离夹具

这些文件是研究报告的自编、合成输入夹具，不属于运行时产品代码，也不安装第三方依赖。

`ink-roundtrip.mjs` 验证指定的 inkjs 发布包能在选择之前保存状态、重新创建故事、恢复状态并走向同一选择结果。先以 `npm pack --ignore-scripts inkjs@2.4.0` 取得 tarball，在忽略目录解压，再运行：

```sh
node docs/oss-r/ink-roundtrip.mjs \
  /absolute/path/to/.cache/research/oss-r/unpacked/ink/package
```

预期 JSON 中 `output` 的值为 `"B result\n"`：这是一个以单个换行符结束的字符串在 JSON 中的转义表示，并非两个文字字符反斜线和 `n`。夹具只验证基础选择和状态回放；不代表对恶意输入、随机、循环、跨版本恢复或生产安全配额的验收。
