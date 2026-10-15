# 历史人物内部预览字体 v1

本目录为自托管 Noto Serif SC 600 静态子集，修改后字体族名为 QuizForge Historical Preview Serif；保留原字体版权元数据与随附 SIL OFL 1.1。源文件从 Google Fonts 仓库准确 commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` 获取，文件和许可证 SHA256 见 manifest.json；原25,125,512字节TTF只保存在私有构建缓存，不提交。

字符集合是已选定四卡草案准确来源 `03fdc240c924e2fe7379534176e11d1e6ab3bc58:docs/FIRST_PRODUCT_CONTENT_DRAFT.md` 的所有非控制字符、旧V2-C字表、可打印ASCII及内部预览固定文案的去重排序并集，共1097字符。实际输出cmap逐字符验证缺字0，包括原先缺少的“守序织传周归邀”。这是固定子集，不承诺任意中文、新增文案或未来内容自动覆盖。

生成工具固定fonttools 4.61.1及brotli 1.2.0，使用项目私有venv，不改全局Python配置。先从下列准确来源下载并核SHA，然后从仓库根运行：

```sh
.cache/p3c-font-tools/bin/python scripts/build-preview-font.py --source-font '.cache/p3c-font-source/NotoSerifSC[wght].ttf'
```

[固定源TTF](https://github.com/google/fonts/blob/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf)；[固定许可证](https://github.com/google/fonts/blob/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoserifsc/OFL.txt)。生成器拒绝非固定版本工具、错误源hash、错误许可证或缺失glyph；不自行访问网络。

两次独立输出目录重建所得woff2和manifest逐字节相同：218,976字节，font SHA256 ff31970785d40d8ca32980632e6ce68766e79551d22f6617ef83b1853f63e89f；coverage文件SHA256 93b66c1df1442554a1d85471cdc6499a584445ff2ece42574b82f52fa0875d29。当前只确认来源、覆盖与可重建；真实页面/海报加载、排版和视觉检查待P3-C实现完成后验收，不能用cmap代替PNG检查。
