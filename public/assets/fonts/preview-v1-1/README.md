# 历史人物内部预览字体 1.0.1

沿用 preview-v1 同一固定 Google Fonts 源、SIL OFL 1.1、fonttools4.61.1/brotli1.2.0和600静态字重。保留旧1.0.0产物，本版只新增实际预览UI所需“护歇登稍繁绑航营”八字，覆盖1105字符；实际cmap逐字符核验无缺字。不是任意中文全字库，也不替代页面/PNG图检。

从仓库根执行（完整固定源TTF仍在私有缓存，不入Git）：

```sh
.cache/p3c-font-tools/bin/python scripts/build-preview-font.py --source-font '.cache/p3c-font-source/NotoSerifSC[wght].ttf' --font-version 1.0.1 --descriptor src/features/product/preview/font.generated.ts
corepack pnpm exec prettier --write src/features/product/preview/font.generated.ts
```

生成的纯TS descriptor与公开JSON由同一次实际字体构建产生，避免不同Node/Playwright/浏览器loader的JSON import语义差异。单元测试直接核公开font/coverage/license SHA与TS常量及manifest一致。字体220972字节，SHA256 7b33efc0771d2b0aef14474f66f280eccc7f39996738e497fdf322973bb19a29；字表SHA256 5e4828a70bb752096bdb008bcc9b02467ee32b4734d9217c182fcdcda2ab030a。完整来源与license SHA见manifest，原始来源说明见../preview-v1/README.md。
