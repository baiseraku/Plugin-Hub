# zotero 插件

让 ZCode 直接读取本机 Zotero 文献库：搜索文献、读元数据与 PDF 全文、浏览分类/标签、导出 BibTeX / CSL-JSON。

## 依赖

- **Zotero 7+ 桌面端正在运行**（本机已验证 Zotero 9.0.6）。
- Zotero 设置 → 高级 → 勾选「允许其他应用与本机 Zotero 通信」（I allow other applications on this computer to communicate with Zotero）。
- 本地 API 默认地址 `http://127.0.0.1:23119`，无需 API key、无需联网。

## 结构

```text
zotero/
  .zcode-plugin/plugin.json   # 插件清单（含 userConfig：API 地址 / 文库）
  .mcp.json                   # MCP server 启动配置
  mcp/zotero-server.mjs       # MCP server（Node，零依赖，只读）
  skills/zotero/SKILL.md      # 使用指导（agent 侧）
```

## 工具（MCP）

`zotero_status`、`zotero_search`、`zotero_get_item`、`zotero_list_collections`、
`zotero_list_tags`、`zotero_get_fulltext`、`zotero_recent` —— 全部只读。

## 限制

- Zotero 本地 API 为只读，插件不能写入文库（添加/修改/删除条目）；入库请由用户在 Zotero 中手动操作。
- 运行依赖 ZCode 自带运行时（`/Applications/ZCode.app/...`）；若 ZCode 安装位置不同，需改 `.mcp.json` 中的 command 路径。
- 群组库支持填 `userConfig.zotero_library = groups/<id>`，本机未实测。
