# Plugin Hub

ZCode 插件仓库，以「目录型插件市场」形式分发：在 ZCode 中把本仓库添加为插件市场源，即可查看并安装其中的插件。

## 收录插件

| 插件 | 版本 | 说明 |
|---|---|---|
| [zotero](./zotero/) | 0.1.0 | 连接本机 Zotero 文献库（本地 API，只读）：搜索文献、读取元数据与 PDF 全文、列出分类/标签、导出 BibTeX/CSL-JSON |

## 在 ZCode 中使用

1. 打开 **插件市场 → 添加 → 添加插件市场**；
2. 填入本仓库地址（`baiseraku/Plugin-Hub` 或 `https://github.com/baiseraku/Plugin-Hub`）；
3. 添加后在 **个人** 中找到对应插件，点击安装。

## 插件依赖

- **zotero**：需要 Zotero 7+ 桌面端正在运行，并在 Zotero「设置 → 高级」中勾选「允许其他应用与本机 Zotero 通信」。详见 [zotero/README.md](./zotero/README.md)。
