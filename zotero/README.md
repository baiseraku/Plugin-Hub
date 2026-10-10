# zotero 插件

让 ZCode 直接读写本机 Zotero 文献库：搜索文献、读元数据与 PDF 全文、添加文献（DOI/BibTeX）、修改/删除条目、管理分类标签、导出 BibTeX / CSL-JSON。

## 依赖

- **Zotero 7+ 桌面端正在运行**（本机已验证 Zotero 9.0.6）。
- Zotero 设置 → 高级 → 勾选「允许其他应用与本机 Zotero 通信」。
- **写操作（修改/删除/分类/笔记）需要额外安装 Zotero 插件**：
  [Local Write API](https://github.com/dzackgarza/zotero-local-write-api)（开源，在 Zotero 官方本地端口上注册写端点）。
  安装：在其 [Releases](https://github.com/dzackgarza/zotero-local-write-api/releases) 下载 `local-write-api-*.xpi`，Zotero → 工具 → 插件 → 从文件安装插件。
  未安装时：检索、阅读、「添加文献」（内置导入通道）仍可用，修改/删除/分类不可用（工具会给出提示）。
- 本地 API 默认地址 `http://127.0.0.1:23119`，无需 API key、无需联网。

## 结构

```text
zotero/
  .zcode-plugin/plugin.json   # 插件清单（userConfig：API 地址 / 文库 / 写端点令牌）
  .mcp.json                   # MCP server 启动配置
  mcp/zotero-server.mjs       # MCP server（Node，零依赖）
  skills/zotero/SKILL.md      # 使用指导（agent 侧）
```

## 工具（MCP）

**检索与阅读**：`zotero_status`、`zotero_search`、`zotero_get_item`、`zotero_list_collections`、
`zotero_list_tags`、`zotero_get_fulltext`、`zotero_recent`、`zotero_selected_target`

**添加与管理**（依赖 Local Write API）：`zotero_add_items`、`zotero_update_items`、
`zotero_delete_items`、`zotero_create_collection`、`zotero_add_note`

## 能力边界

- 添加文献：`identifiers`（DOI/ISBN/arXiv/PMID，去重+抓附件）与 `bibtex` 通道需插件；`text` 通道（Zotero 内置导入）无需插件，但条目只能进入 Zotero 界面**当前选中**的分类。
- 删除为移入回收站（可在 Zotero 恢复），不会彻底删除。
- 搜索不覆盖 PDF 正文（Zotero 本地搜索限制）；读正文用 `zotero_get_fulltext`。
- 运行依赖 ZCode 自带运行时（`/Applications/ZCode.app/...`）；ZCode 安装位置不同时需改 `.mcp.json` 中 command 路径。
- 群组库支持填 `userConfig.zotero_library = groups/<id>`，本机未实测。
