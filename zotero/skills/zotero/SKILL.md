---
name: zotero
description: 通过本机 Zotero 文献库检索、添加与管理文献：搜索条目、读取完整元数据、获取 PDF 全文、添加文献（DOI/BibTeX 导入）、修改/删除条目、管理分类与标签、导出 BibTeX/CSL-JSON。当用户提到 Zotero、「我的文献库/文库」「库里的文献」、查文献、找参考文献、看某篇文献的摘要或全文、把某篇文献加进 Zotero、修改或删除库里的文献、按分类/标签找文章、导出引用格式时使用本技能。需要 Zotero 桌面端正在运行。
---

# Zotero 文献库

通过 `zotero` MCP 工具集访问本机 Zotero 文库（本地 HTTP API，默认 `127.0.0.1:23119`）。所有条目的稳定标识是 8 位 `key`，后续操作用它精确定位。

## 工具速查

**检索与阅读（基础能力，无需额外插件）**

| 工具 | 用途 |
| --- | --- |
| `zotero_status` | 检查连接、文库概况、写能力状态 |
| `zotero_search` | 关键词搜索（元数据字段，不含 PDF 正文） |
| `zotero_get_item` | 单条完整元数据；`format=bibtex`/`csljson` 导出引用 |
| `zotero_list_collections` | 分类树与各分类条目数 |
| `zotero_list_tags` | 标签及条目数 |
| `zotero_get_fulltext` | 定位 PDF 附件，返回索引全文与本机文件路径 |
| `zotero_recent` | 最近添加/修改的条目 |
| `zotero_selected_target` | Zotero 界面当前选中的分类（内置导入通道的落点） |

**添加与管理（写操作，需要 Zotero 的 Local Write API 插件；未装时只有 `zotero_add_items` 的 `text` 通道可用）**

| 工具 | 用途 |
| --- | --- |
| `zotero_add_items` | 添加文献：`identifiers`（DOI/ISBN/arXiv/PMID）或 `bibtex` 或 `text` |
| `zotero_update_items` | 修改字段 / 增删标签 / 加入移出分类 |
| `zotero_delete_items` | 移入回收站（可恢复） |
| `zotero_create_collection` | 新建分类 |
| `zotero_add_note` | 给文献添加笔记 |

## 典型工作流

1. **找文献**：`zotero_search query="<主题词>"`。不理想时换 `qmode="titleCreatorYear"`，或先 `zotero_list_collections` / `zotero_list_tags` 了解结构再按 `collection` / `tag` 过滤。
2. **看摘要与元数据**：`zotero_get_item key="<KEY>"`，返回完整 JSON（含 `abstractNote`、`creators`、`tags` 等）与子附件列表。
3. **读全文**：`zotero_get_fulltext key="<KEY>"`。返回索引全文与本机 PDF 路径；文本被截断时可提高 `max_chars`，或直接用 Read 工具读该 PDF 路径（长文档配合 pdf 技能）。
4. **写引用**：`zotero_get_item key="<KEY>" format="bibtex"`（或 `csljson`），多个条目需逐条获取。

### 添加文献

- **首选**：`zotero_add_items identifiers=["10.xxxx/yyyy"]` — Zotero 自行抓取元数据与可用 PDF 附件，并按 DOI 等自动去重（库中已有则跳过）；`collection="<分类key>"` 可指定分类。
- 用户提供 BibTeX 时：`zotero_add_items bibtex="<BibTeX 文本>"`，可含多条，逐条导入。
- **未装插件的降级通道**：`zotero_add_items text="<BibTeX/RIS/CSL-JSON 文本>"` 走 Zotero 内置导入，条目会进入 **Zotero 界面当前选中的分类**——可先用 `zotero_selected_target` 确认落点，落点不对时提示用户先在 Zotero 里选中目标分类。

### 管理文献（需 Local Write API 插件）

- 改字段：`zotero_update_items keys=["<KEY>"] fields={"title":"...","date":"2024"}`（字段名用 Zotero 的：title、date、DOI、publicationTitle、abstractNote、extra 等）。
- 标签：`add_tags` / `remove_tags`；分类：`add_to_collections` / `remove_from_collections`（分类 key 见 `zotero_list_collections`）。以上参数可组合，一次对多条 `keys` 执行。
- 删除：`zotero_delete_items keys=[...]` — 移入回收站、可恢复；**执行前先向用户确认目标条目**。
- 笔记：`zotero_add_note key="<KEY>" note="..."`；新分类：`zotero_create_collection name="..."`。

## 注意

- **搜索范围**：`zotero_search` 覆盖条目的元数据字段（标题、作者、摘要、笔记文字等），**不检索 PDF 正文**。需要按正文内容判断时，先搜索候选项再用 `zotero_get_fulltext` 读全文核对。
- **写操作边界**：Zotero 官方本地 API 只读；改/删/分类等写操作依赖 Zotero 插件「Local Write API」（工具报错信息里含安装指引）。删除是移入回收站（可恢复）；字段修改直接生效，执行前与用户确认。
- 连接失败时按 `zotero_status` 的提示排查：Zotero 是否运行、设置 → 高级里「允许其他应用与本机 Zotero 通信」是否勾选。
- 条目 key 只在本机有效，不要当作 DOI 之类的对外引用标识；对外引用用 `format=bibtex` 的输出。
