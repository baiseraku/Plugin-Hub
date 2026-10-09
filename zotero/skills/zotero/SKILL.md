---
name: zotero
description: 通过本机 Zotero 文献库检索与引用文献：搜索条目、读取完整元数据、获取 PDF 全文、浏览分类与标签、导出 BibTeX/CSL-JSON。当用户提到 Zotero、「我的文献库/文库」「库里的文献」、查文献、找参考文献、看某篇文献的摘要或全文、按分类/标签找文章、导出引用格式时使用本技能。需要 Zotero 桌面端正在运行。
---

# Zotero 文献库

通过 `zotero` MCP 工具集只读访问本机 Zotero 文库（本地 HTTP API，默认 `127.0.0.1:23119`）。所有条目的稳定标识是 8 位 `key`，后续操作用它精确定位。

## 工具速查

| 工具 | 用途 |
| --- | --- |
| `zotero_status` | 检查连接、看文库条目/分类/标签数量 |
| `zotero_search` | 关键词搜索（默认覆盖元数据字段：标题、作者、摘要、笔记文字；不含 PDF 正文），可限定分类、标签 |
| `zotero_get_item` | 单条完整元数据；`format=bibtex`/`csljson` 导出引用 |
| `zotero_list_collections` | 分类树与各分类条目数 |
| `zotero_list_tags` | 标签及条目数（可按子串过滤） |
| `zotero_get_fulltext` | 定位 PDF 附件，返回索引全文与本机文件路径 |
| `zotero_recent` | 最近添加/修改的条目 |

## 典型工作流

1. **找文献**：`zotero_search query="<主题词>"`。结果不理想时换 `qmode="titleCreatorYear"` 收窄到标题/作者/年份，或先 `zotero_list_collections` / `zotero_list_tags` 了解文库结构再按 `collection` / `tag` 过滤。
2. **看摘要与元数据**：拿到 key 后 `zotero_get_item key="<KEY>"`，返回完整 JSON（含 `abstractNote`、`creators`、`tags`、分类等）；子附件列表也一并给出。
3. **读全文**：`zotero_get_fulltext key="<KEY>"`（key 用文献条目即可，会自动找 PDF）。返回 Zotero 索引的文本和本机 PDF 路径；文本被截断时可提高 `max_chars`，或直接用 Read 工具读取返回的本地 PDF 路径（长文档建议配合 pdf 技能）。
4. **写引用**：`zotero_get_item key="<KEY>" format="bibtex"`（或 `csljson`）。多个条目的引用格式需逐条获取。

## 注意

- **搜索范围**：`zotero_search` 覆盖条目的元数据字段（标题、作者、摘要、笔记文字等），**不检索 PDF 正文**。需要按正文内容判断时，先搜索候选项再用 `zotero_get_fulltext` 读全文核对。
- **只读**：Zotero 本地 API 不支持写入，无法添加/修改/删除条目。用户要入库文献时需要提供 BibTeX 等，由用户在 Zotero 中手动导入。
- 连接失败时按 `zotero_status` 的提示排查：Zotero 是否运行、设置 → 高级里「允许其他应用与本机 Zotero 通信」是否勾选。
- 条目 key 只在本机有效，不要把它当作 DOI 之类的对外引用标识；对外引用用 `format=bibtex` 的输出。
