#!/usr/bin/env node
/**
 * Zotero MCP server — 通过 Zotero 本地 HTTP API（Zotero 7+，默认 http://127.0.0.1:23119）
 * 只读访问本机 Zotero 文献库：搜索条目、读取元数据与全文、列出分类/标签、导出引用格式。
 *
 * 传输：stdio，newline-delimited JSON-RPC 2.0（MCP）。
 * 环境变量：
 *   ZOTERO_API_BASE  Zotero 本地 API 基地址（默认 http://127.0.0.1:23119）
 *   ZOTERO_LIBRARY   文库路径（默认 users/0，即本机登录用户库；群组库为 groups/<id>）
 */

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "http://127.0.0.1:23119";
const SERVER_NAME = "zotero";
const SERVER_VERSION = "0.1.0";
const REQUEST_TIMEOUT_MS = 20000;
const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];

function normalizeBase(value) {
  const v = (value || "").trim();
  return /^https?:\/\/\S+$/.test(v) ? v.replace(/\/+$/, "") : DEFAULT_BASE;
}

function normalizeLibrary(value) {
  const v = (value || "").trim().replace(/^\/+|\/+$/g, "");
  return /^(users|groups)\/\d+$/.test(v) ? v : "users/0";
}

const API_BASE = normalizeBase(process.env.ZOTERO_API_BASE);
const LIBRARY = normalizeLibrary(process.env.ZOTERO_LIBRARY);

class ZoteroError extends Error {}

async function zFetch(path, { params = {}, headers = {}, redirect = "follow" } = {}) {
  const url = new URL(`${API_BASE}/api/${LIBRARY}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, {
      headers: { "Zotero-API-Version": "3", ...headers },
      redirect,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err?.name === "TimeoutError";
    throw new ZoteroError(
      timeout
        ? `Zotero 本地 API 请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）：${API_BASE}。Zotero 可能正忙，请稍后重试。`
        : `无法连接 Zotero 本地 API（${API_BASE}）：${err.message}\n` +
            `请确认：1) Zotero 桌面端正在运行；2) 已在「Zotero 设置 → 高级」勾选「允许其他应用与本机 Zotero 通信」；3) 端口 23119 未被修改。`,
    );
  }
  if (res.status === 404) {
    const err = new ZoteroError(`Zotero 中未找到对应资源：${path}`);
    err.status = 404;
    throw err;
  }
  // redirect: "manual" 时 3xx 是预期结果（如 /file 端点用 302 返回附件本地路径）
  if (!res.ok && !(redirect === "manual" && res.status >= 300 && res.status < 400)) {
    const body = await res.text().catch(() => "");
    throw new ZoteroError(`Zotero API ${res.status} ${res.statusText}：${path}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  return res;
}

async function zJson(path, options) {
  return (await zFetch(path, options)).json();
}

async function zText(path, options) {
  return (await zFetch(path, options)).text();
}

function totalResults(res) {
  const n = Number.parseInt(res.headers.get("Total-Results") ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

// ---------- 输出格式化 ----------

const truncate = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function firstYear(data) {
  const m = String(data.date || "").match(/\d{4}/);
  return m ? m[0] : "";
}

function creatorLabel(data, max = 2) {
  const names = (data.creators || [])
    .map((c) => c.lastName || c.name || "")
    .filter(Boolean);
  if (!names.length) return "";
  if (names.length > max) return `${names.slice(0, max).join(", ")} 等`;
  return names.join(", ");
}

function noteExcerpt(data) {
  const text = String(data.note || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, 72);
}

function itemLine(item) {
  const d = item.data || {};
  const title = d.title || (d.itemType === "note" ? `笔记：${noteExcerpt(d) || "(空)"}` : "(无标题)");
  const parts = [
    item.key,
    d.itemType || "?",
    firstYear(d) || "无年份",
    truncate(title, 96),
  ];
  const author = creatorLabel(d);
  if (author) parts.push(author);
  if (d.publicationTitle) parts.push(truncate(d.publicationTitle, 48));
  if (d.DOI) parts.push(`DOI ${d.DOI}`);
  return `- ${parts.join(" | ")}`;
}

function itemLines(items, { total = null, title = "结果" } = {}) {
  if (!items.length) return "没有匹配的条目。";
  const header = total !== null && total > items.length
    ? `${title}（显示 ${items.length} / 共 ${total} 条）：`
    : `${title}（${items.length} 条）：`;
  return [header, ...items.map(itemLine)].join("\n");
}

function isTopLevel(item) {
  const t = item.data?.itemType;
  return t !== "attachment";
}

function childLine(child) {
  const d = child.data || {};
  const bits = [child.key, d.itemType || "?"];
  if (d.contentType) bits.push(d.contentType);
  if (d.title) bits.push(truncate(d.title, 48));
  if (d.linkMode === "linked_url" && d.url) bits.push(`链接 ${truncate(d.url, 60)}`);
  return `- ${bits.filter(Boolean).join(" | ")}`;
}

// ---------- 工具实现 ----------

async function toolStatus() {
  const [itemsRes, colsRes, tagsRes] = await Promise.all([
    zFetch("/items", { params: { limit: 1 } }),
    zFetch("/collections", { params: { limit: 1 } }),
    zFetch("/tags", { params: { limit: 1 } }),
  ]);
  const version = itemsRes.headers.get("X-Zotero-Version") || "unknown";
  const lines = [
    "Zotero 本地 API 连接正常。",
    `- 服务地址：${API_BASE}（Zotero ${version}，API v3）`,
    `- 文库：${LIBRARY}${LIBRARY === "users/0" ? "（本机用户库）" : ""}`,
    `- 条目总数：${totalResults(itemsRes) ?? "未知"}`,
    `- 分类（collection）数：${totalResults(colsRes) ?? "未知"}`,
    `- 标签数：${totalResults(tagsRes) ?? "未知"}`,
    "- 注意：本地 API 为只读，插件不能添加、修改或删除 Zotero 中的条目。",
  ];
  return lines.join("\n");
}

async function toolSearch(args) {
  const query = String(args.query || "").trim();
  if (!query) throw new ZoteroError("缺少参数 query（搜索关键词）。");
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const overfetch = Math.min(limit * 3, 100);
  const params = {
    q: query,
    qmode: args.qmode === "titleCreatorYear" ? "titleCreatorYear" : "everything",
    tag: args.tag,
    sort: args.sort,
    direction: args.direction,
  };
  const scope = args.collection
    ? `分类 ${args.collection}`
    : "全库（顶层条目，不含附件）";
  let items;
  let total = null;
  if (args.collection) {
    const collectionKey = String(args.collection).trim();
    // 存在性校验：Zotero 对不存在的 collection key 会在 items 端点静默返回全库结果
    try {
      await zJson(`/collections/${encodeURIComponent(collectionKey)}`);
    } catch (err) {
      if (err?.status === 404) {
        throw new ZoteroError(
          `分类「${collectionKey}」不存在（用 zotero_list_collections 查看有效分类 key）。`,
        );
      }
      throw err;
    }
    // collection 范围同样通过 overfetch + 过滤附件来保持与全库搜索一致的“仅顶层条目”语义
    const res = await zFetch(`/collections/${encodeURIComponent(collectionKey)}/items`, {
      params: { ...params, limit: overfetch },
    });
    items = (await res.json()).filter(isTopLevel).slice(0, limit);
  } else {
    const res = await zFetch("/items/top", { params: { ...params, limit } });
    total = totalResults(res);
    items = await res.json();
  }
  const footer = items.length
    ? "\n\n提示：用 zotero_get_item key=<KEY> 查看完整元数据；用 zotero_get_fulltext key=<KEY> 读取 PDF 全文。"
    : "";
  return `搜索「${query}」——范围：${scope}，模式：${params.qmode}\n${itemLines(items, { total, title: "匹配条目" })}${footer}`;
}

async function toolGetItem(args) {
  const key = String(args.key || "").trim();
  if (!key) throw new ZoteroError("缺少参数 key（Zotero 条目的 8 位 key）。");
  const format = String(args.format || "json").toLowerCase();
  if (format === "bibtex" || format === "csljson") {
    const text = (await zText(`/items/${encodeURIComponent(key)}`, { params: { format } })).trim();
    if (!text) {
      throw new ZoteroError(
        `条目 ${key} 无法导出 ${format} 引用（该条目类型可能不支持引用格式，如笔记或附件）。`,
      );
    }
    return `${key} 的 ${format} 输出：\n\n${text}`;
  }
  if (format !== "json") {
    throw new ZoteroError(`不支持的 format：「${format}」（可用：json、bibtex、csljson）。`);
  }
  const item = await zJson(`/items/${encodeURIComponent(key)}`);
  const data = item.data || {};
  const sections = [`条目 ${key}（${data.itemType || "?"}）完整元数据：`, JSON.stringify(data, null, 2)];
  try {
    const children = await zJson(`/items/${encodeURIComponent(key)}/children`, { params: { limit: 50 } });
    if (children.length) {
      sections.push("", `子条目（${children.length}）：`, ...children.map(childLine));
      const pdf = children.find((c) => c.data?.contentType === "application/pdf");
      if (pdf) {
        sections.push("", `该条目含 PDF 附件（${pdf.key}）；用 zotero_get_fulltext key=${pdf.key} 获取本地路径与全文。`);
      }
    }
  } catch (err) {
    sections.push("", `（读取子条目失败：${err.message}）`);
  }
  return sections.join("\n");
}

async function toolListCollections() {
  const collections = await zJson("/collections", { params: { limit: 100 } });
  if (!collections.length) return "文库中没有任何分类（collection）。";
  const byParent = new Map();
  for (const c of collections) {
    const parent = c.data?.parentCollection || "";
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(c);
  }
  const lines = [];
  const walk = (parent, depth) => {
    for (const c of byParent.get(parent) || []) {
      const meta = c.meta || {};
      const stats = [
        meta.numItems !== undefined ? `${meta.numItems} 条目` : null,
        meta.numCollections ? `${meta.numCollections} 子分类` : null,
      ].filter(Boolean).join(", ");
      lines.push(`${"  ".repeat(depth)}- ${c.key} | ${c.data?.name || "(未命名)"}${stats ? `（${stats}）` : ""}`);
      walk(c.key, depth + 1);
    }
  };
  walk("", 0);
  return `分类共 ${collections.length} 个：\n${lines.join("\n")}\n\n提示：用 zotero_search collection=<KEY> query=<关键词> 在指定分类内搜索；用 zotero_get_item 或 zotero_search 查看条目。`;
}

async function toolListTags(args) {
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
  const filter = args.filter ? String(args.filter).toLowerCase() : "";
  const tags = await zJson("/tags", { params: { limit: 500 } });
  const filtered = tags.filter((t) => !filter || String(t.tag || "").toLowerCase().includes(filter));
  if (!filtered.length) return filter ? `没有匹配「${args.filter}」的标签。` : "文库中没有任何标签。";
  const shown = filtered.slice(0, limit);
  const lines = shown.map((t) => `- ${t.tag}${t.meta?.numItems !== undefined ? `（${t.meta.numItems} 条目）` : ""}`);
  const more = filtered.length > shown.length ? `\n（仅显示前 ${shown.length} / 共 ${filtered.length} 个）` : "";
  return `标签共 ${filtered.length} 个：\n${lines.join("\n")}${more}\n\n提示：用 zotero_search tag="<标签>" query=<关键词> 过滤条目。`;
}

function decodeFileUrl(location) {
  if (!location || !location.startsWith("file://")) return null;
  let raw;
  try {
    raw = new URL(location).pathname;
  } catch {
    raw = location.replace(/^file:\/\//, "");
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // 路径含未转义的 % 时按原文返回
  }
}

async function resolvePdfAttachment(key) {
  const item = await zJson(`/items/${encodeURIComponent(key)}`);
  const t = item.data?.itemType;
  if (t === "attachment") return item;
  const children = await zJson(`/items/${encodeURIComponent(key)}/children`, { params: { limit: 50 } });
  const pdf = children.find((c) => c.data?.contentType === "application/pdf");
  if (pdf) return pdf;
  const textish = children.find((c) => (c.data?.contentType || "").startsWith("text/"));
  if (textish) return textish;
  const kinds = children.filter((c) => c.data?.itemType === "attachment")
    .map((c) => `${c.key}（${c.data?.contentType || c.data?.linkMode || "未知类型"}）`);
  throw new ZoteroError(
    kinds.length
      ? `条目 ${key} 没有 PDF 附件。现有附件：${kinds.join("、")}。`
      : `条目 ${key} 没有任何附件（可能是纯元数据条目，或附件尚未下载到本机）。`,
  );
}

async function toolGetFulltext(args) {
  const key = String(args.key || "").trim();
  if (!key) throw new ZoteroError("缺少参数 key（条目或附件的 Zotero key）。");
  const maxChars = Math.min(Math.max(Number(args.max_chars) || 40000, 1000), 200000);
  const attachment = await resolvePdfAttachment(key);
  const attKey = attachment.key;
  const contentType = attachment.data?.contentType || "";
  const sections = [
    `附件：${attKey}（${contentType || attachment.data?.linkMode || "未知类型"}）${attachment.data?.title ? `「${truncate(attachment.data.title, 60)}」` : ""}`,
  ];
  let localPath = null;
  try {
    const res = await zFetch(`/items/${encodeURIComponent(attKey)}/file`, { redirect: "manual" });
    const location = res.headers.get("location");
    localPath = res.status === 302 ? decodeFileUrl(location) : null;
    if (!localPath) {
      // 少数实现直接返回文件内容而非重定向
      localPath = null;
    }
  } catch (err) {
    sections.push(`本地文件路径：不可用（${err.message}）`);
  }
  if (localPath) {
    sections.push(`本地文件：${localPath}`, "（可直接用 Read 工具读取该文件；PDF 建议配合 pdf 技能做解析。）");
  } else if (!sections.some((s) => s.startsWith("本地文件路径"))) {
    sections.push("本地文件：不可用（附件可能未下载到本机，或为链接附件）。");
  }
  try {
    const ft = await zJson(`/items/${encodeURIComponent(attKey)}/fulltext`);
    const content = String(ft.content || "");
    const pages = ft.totalPages ? `，共 ${ft.totalPages} 页（已索引 ${ft.indexedPages ?? "?"} 页）` : "";
    if (!content.trim()) {
      sections.push("", `Zotero 尚未索引该附件的全文内容${pages}。可尝试用上面的本地文件路径直接读取。`);
    } else {
      const cut = content.length > maxChars;
      sections.push(
        "",
        `—— 全文${pages}（${cut ? `前 ${maxChars} / 共 ${content.length} 字符` : `共 ${content.length} 字符`}）——`,
        cut ? content.slice(0, maxChars) : content,
        ...(cut ? ["", `（已截断；需要更多内容可提高 max_chars，或直接读取本地文件。）`] : []),
      );
    }
  } catch (err) {
    sections.push("", `读取全文索引失败：${err.message}`);
    if (localPath) sections.push("可改用上面的本地文件路径直接读取。");
  }
  return sections.join("\n");
}

async function toolRecent(args) {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 100);
  const sort = ["dateAdded", "dateModified"].includes(args.sort) ? args.sort : "dateAdded";
  const res = await zFetch("/items/top", { params: { limit, sort, direction: "desc" } });
  const items = await res.json();
  return `最近${sort === "dateAdded" ? "添加" : "修改"}的条目（${items.length} 条）：\n${items.map(itemLine).join("\n")}\n\n提示：用 zotero_get_item key=<KEY> 查看完整元数据。`;
}

// ---------- MCP 工具注册 ----------

const TOOLS = [
  {
    name: "zotero_status",
    description:
      "检查 Zotero 桌面端本地 API 连接状态，返回 Zotero 版本与文库的条目、分类、标签数量。检索文献前可用它确认连接是否正常。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolStatus,
  },
  {
    name: "zotero_search",
    description:
      "在 Zotero 文献库中搜索条目，返回 key、类型、年份、标题、作者、期刊与 DOI（默认只返回顶层条目：文献与独立笔记，不含附件）。取得 key 后用 zotero_get_item 看完整元数据，或 zotero_get_fulltext 读全文。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词（如主题、标题词、作者名）" },
        qmode: {
          type: "string",
          enum: ["everything", "titleCreatorYear"],
          description: "搜索范围：everything=所有元数据字段，含标题/作者/摘要/笔记文字（默认，不含 PDF 正文）；titleCreatorYear=仅标题/作者/年份",
        },
        collection: { type: "string", description: "限定在某个分类内搜索，值为分类 key（见 zotero_list_collections）" },
        tag: { type: "string", description: "按标签过滤，值为标签名（见 zotero_list_tags）" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "返回条数上限，默认 20" },
        sort: {
          type: "string",
          enum: ["dateAdded", "dateModified", "title", "creator", "date"],
          description: "排序字段，默认 dateModified",
        },
        direction: { type: "string", enum: ["asc", "desc"], description: "排序方向，默认 desc（新→旧）" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: toolSearch,
  },
  {
    name: "zotero_get_item",
    description:
      "读取单条文献的完整元数据（标题、作者、期刊、摘要、标签、分类、附件列表等）。format=bibtex 或 csljson 时导出对应引用格式，可直接用于参考文献。",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "条目的 Zotero key（8 位字母数字，如 YHR55NZN）" },
        format: { type: "string", enum: ["json", "bibtex", "csljson"], description: "输出格式，默认 json" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    handler: toolGetItem,
  },
  {
    name: "zotero_list_collections",
    description: "列出 Zotero 文库的全部分类（collection）及其层级与条目数量，用于了解文库结构或定位检索范围。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolListCollections,
  },
  {
    name: "zotero_list_tags",
    description: "列出 Zotero 文库的标签及其条目数量，可按子串过滤。用于了解文库主题分布或精确过滤检索。",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "标签名子串过滤（不区分大小写），可选" },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "返回条数上限，默认 100" },
      },
      additionalProperties: false,
    },
    handler: toolListTags,
  },
  {
    name: "zotero_get_fulltext",
    description:
      "获取某条文献（或附件）的全文：自动定位其 PDF 附件，返回 Zotero 索引的全文文本与本机 PDF 文件路径。key 可以是文献条目 key 或附件 key。",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "文献条目或附件的 Zotero key" },
        max_chars: { type: "integer", minimum: 1000, maximum: 200000, description: "全文返回的最大字符数，默认 40000" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    handler: toolGetFulltext,
  },
  {
    name: "zotero_recent",
    description: "列出最近添加到 Zotero 文库（或最近修改）的顶层条目（含独立笔记，不含附件）。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "返回条数上限，默认 10" },
        sort: { type: "string", enum: ["dateAdded", "dateModified"], description: "按添加时间（默认）或修改时间排序" },
      },
      additionalProperties: false,
    },
    handler: toolRecent,
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

async function callTool(name, args) {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
  }
  try {
    const text = await tool.handler(args || {});
    return { content: [{ type: "text", text }], isError: false };
  } catch (err) {
    const text = err instanceof ZoteroError ? err.message : `工具执行失败：${err?.message || err}`;
    return { content: [{ type: "text", text }], isError: true };
  }
}

// ---------- JSON-RPC 主循环 ----------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
async function handleMessage(message) {
  const { id, method, params } = message;
  if (id === undefined || id === null) return; // 通知，无需响应
  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion)
            ? params.protocolVersion
            : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        };
        break;
      case "tools/call":
        result = await callTool(params?.name, params?.arguments);
        break;
      default:
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (err) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: err?.message || String(err) } });
  }
}

let pendingRequests = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pendingRequests === 0) process.exit(0);
}

export async function main() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // 忽略无法解析的行
    }
    pendingRequests += 1;
    handleMessage(message)
      .catch((err) => {
        if (message?.id !== undefined) {
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: err?.message || String(err) } });
        }
      })
      .finally(() => {
        pendingRequests -= 1;
        maybeExit();
      });
  });
  // stdin 关闭（会话结束）时，等进行中的请求写完响应再退出，避免吞掉响应
  rl.on("close", () => {
    stdinClosed = true;
    maybeExit();
  });
}

// 直接运行（node zotero-server.mjs）时自行启动；由 ZCode 插件 host（zcode.cjs __zcode-plugin-host）
// 加载时，host 要求本模块导出 main() 并由 host 调用，此时不自动启动。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`zotero MCP server failed to start: ${err?.message || err}\n`);
    process.exit(1);
  });
}
