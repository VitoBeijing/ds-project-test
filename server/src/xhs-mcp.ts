import { LoginRequiredError } from "./errors.js";

/**
 * 只读工具白名单（Issue #18 安全约束：本工作台只接入 xiaohongshu-mcp 的只读工具，
 * 不接发帖 / 评论 / 点赞 / 收藏等写操作）。新增工具须先过安全审查。
 */
export const READ_ONLY_TOOLS = [
  "search_feeds",
  "get_feed_detail",
  "check_login_status",
] as const;

export type ReadOnlyToolName = (typeof READ_ONLY_TOOLS)[number];

const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(READ_ONLY_TOOLS);

/** xiaohongshu-mcp 默认地址。部署上只监听本机回环地址（见 server/mcp/README.md）。 */
export const DEFAULT_XHS_MCP_URL = "http://127.0.0.1:18060/mcp";

/** 单次 MCP 调用超时。工具在服务端驱动真实浏览器，给足余量（上游页级超时为 60 秒）。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** xiaohongshu-mcp 的「未登录 / 登录态失效」错误标记（上游 errors.ErrLoginRequired）。 */
const LOGIN_REQUIRED_MARKER = "未登录或登录态已失效";

/** 笔记链接：小红书网页版 explore 路径。 */
const XHS_NOTE_URL_PREFIX = "https://www.xiaohongshu.com/explore/";

/** 互动数文本：纯数字可带千分位逗号、万 / 亿单位或「+」尾缀（如 "1,234"、"1.2万"、"999+"；空白先剔除）。 */
const COUNT_TEXT_PATTERN = /^([\d.]+)([万亿])?\+?$/;

/** 正文里的话题标签：`#话题[话题]#`、`#地点[LOC]#` 或 `#话题#` 两种写法，方括号是平台标记。 */
const NOTE_TAG_PATTERN = /#([^#\[\]]+)(?:\[[^\]]*\])?#/g;

/** check_login_status 已登录回文中用户名一行的格式。 */
const LOGIN_USERNAME_PATTERN = /用户名[:：]\s*(\S.*)/;

/** 错误信息里随附的响应片段长度上限。 */
const EXCERPT_LENGTH = 200;

/** 检索结果：单条笔记的摘要。xsecToken 是 get_feed_detail 的必填参数，必须原样带回。 */
export interface XhsSearchFeed {
  readonly feedId: string;
  readonly xsecToken: string;
  readonly title: string;
  readonly type?: string;
  readonly author?: string;
  readonly likedCount?: number;
  readonly link: string;
}

/** 笔记详情：互动数据（点赞 / 收藏 / 评论）与话题标签，供内容簇构建与高价值挖掘使用。 */
export interface XhsFeedDetail {
  readonly feedId: string;
  readonly title: string;
  readonly desc?: string;
  readonly type?: string;
  readonly author?: string;
  readonly likedCount: number;
  readonly collectedCount: number;
  readonly commentCount: number;
  readonly tags: string[];
  readonly publishedAt?: string;
  readonly link: string;
}

/** 登录状态（透传 xiaohongshu-mcp check_login_status）。 */
export interface XhsLoginStatus {
  readonly loggedIn: boolean;
  readonly username?: string;
}

/** MCP HTTP 响应。transport 抽象出来供单测离线注入 mock，不依赖真实网络。 */
export interface McpHttpResponse {
  readonly status: number;
  readonly contentType: string;
  text(): Promise<string>;
}

/** JSON-RPC 2.0 传输层：POST 一条请求，拿回一条响应。 */
export interface McpTransport {
  post(
    url: string,
    body: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<McpHttpResponse>;
}

/** 默认传输：Node 20 全局 fetch。 */
async function fetchTransport(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<McpHttpResponse> {
  const response = await fetch(url, { method: "POST", body, headers, signal });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text: () => response.text(),
  };
}

interface JsonRpcErrorShape {
  readonly code?: unknown;
  readonly message?: unknown;
}

interface JsonRpcMessage {
  readonly id?: unknown;
  readonly error?: JsonRpcErrorShape;
  readonly result?: unknown;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > EXCERPT_LENGTH ? `${compact.slice(0, EXCERPT_LENGTH)}…` : compact;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 互动数文本 → 整数；无法解析时返回 undefined（"1.2万"→12000、"1.2亿"→120000000、"999+"→999）。 */
export function parseCountText(text: string): number | undefined {
  const match = COUNT_TEXT_PATTERN.exec(text.replace(/[,\s，]/g, ""));
  if (!match) return undefined;
  const unit = match[2] === "亿" ? 1e8 : match[2] === "万" ? 1e4 : 1;
  const count = Number(match[1]) * unit;
  return Number.isFinite(count) ? Math.round(count) : undefined;
}

/** 从正文提取话题标签（`#通勤穿搭[话题]#` → "通勤穿搭"），去重且保持出现顺序；无标签返回空数组。 */
export function parseNoteTags(desc: string): string[] {
  const tags: string[] = [];
  for (const match of desc.matchAll(NOTE_TAG_PATTERN)) {
    const tag = match[1].trim();
    if (tag !== "" && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** 解析 check_login_status 回文（上游返回人类可读文本）：已登录带用户名，未登录明确返回 false。 */
export function parseLoginStatus(text: string): XhsLoginStatus {
  if (text.includes("未登录")) return { loggedIn: false };
  if (text.includes("已登录")) {
    const username = LOGIN_USERNAME_PATTERN.exec(text)?.[1]?.trim();
    return username === undefined || username === "" ? { loggedIn: true } : { loggedIn: true, username };
  }
  throw new Error(`无法识别 check_login_status 返回的登录状态：${excerpt(text)}`);
}

function noteUrl(feedId: string): string {
  return `${XHS_NOTE_URL_PREFIX}${feedId}`;
}

/** 读取笔记作者：上游 User 结构同时序列化 nickname / nickName 两个键，按页面来源择一非空。 */
function readAuthor(user: unknown): string | undefined {
  if (!isJsonObject(user)) return undefined;
  return readString(user.nickname) ?? readString(user.nickName);
}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new Error(`${what} 不是对象：xiaohongshu-mcp 响应结构可能已变化`);
  }
  return value;
}

/**
 * 归一化 search_feeds 结果（上游 FeedsListResponse：`{feeds: Feed[], count}`）。
 * 空结果是合法状态（返回空数组）；条目缺少 id / xsecToken 时抛明确错误，不静默跳过
 * （缺 xsecToken 的条目无法继续取详情）。
 */
export function parseSearchFeeds(payload: unknown): XhsSearchFeed[] {
  const root = requireObject(payload, "search_feeds 结果");
  const feeds = root.feeds;
  if (!Array.isArray(feeds)) {
    throw new Error("search_feeds 结果缺少 feeds 数组：xiaohongshu-mcp 响应结构可能已变化");
  }

  return feeds.map((feed, index) => {
    const feedObject = requireObject(feed, `search_feeds 第 ${index} 条`);
    const feedId = readString(feedObject.id);
    const xsecToken = readString(feedObject.xsecToken);
    if (feedId === undefined || xsecToken === undefined) {
      throw new Error(
        `search_feeds 第 ${index} 条缺少 ${feedId === undefined ? "id" : "xsecToken"}，无法继续获取详情`,
      );
    }

    const noteCard = isJsonObject(feedObject.noteCard) ? feedObject.noteCard : {};
    const user = isJsonObject(noteCard.user) ? noteCard.user : {};
    const interactInfo = isJsonObject(noteCard.interactInfo) ? noteCard.interactInfo : {};
    const type = readString(noteCard.type);
    const author = readAuthor(user);
    const likedCountText = readString(interactInfo.likedCount);
    const likedCount = likedCountText === undefined ? undefined : parseCountText(likedCountText);

    return {
      feedId,
      xsecToken,
      title: readString(noteCard.displayTitle) ?? "",
      ...(type !== undefined && { type }),
      ...(author !== undefined && { author }),
      ...(likedCount !== undefined && { likedCount }),
      link: noteUrl(feedId),
    };
  });
}

/**
 * 归一化 get_feed_detail 结果（上游 FeedDetailResponse：`{note: FeedDetail, comments}`）。
 * 互动数缺失 / 不可解析时按 0 处理（建库默认值同为 0）；话题标签从正文提取（上游详情不含标签列表）。
 */
export function parseFeedDetail(payload: unknown, requestedFeedId: string): XhsFeedDetail {
  const root = requireObject(payload, "get_feed_detail 结果");
  const note = requireObject(root.note, "get_feed_detail 结果的 note");
  const user = isJsonObject(note.user) ? note.user : {};
  const interactInfo = isJsonObject(note.interactInfo) ? note.interactInfo : {};
  const desc = readString(note.desc);
  const type = readString(note.type);
  const author = readAuthor(user);
  const time = typeof note.time === "number" && Number.isFinite(note.time) ? note.time : 0;
  const feedId = readString(note.noteId) ?? requestedFeedId;

  return {
    feedId,
    title: readString(note.title) ?? "",
    ...(desc !== undefined && { desc }),
    ...(type !== undefined && { type }),
    ...(author !== undefined && { author }),
    likedCount: parseCountText(readString(interactInfo.likedCount) ?? "") ?? 0,
    collectedCount: parseCountText(readString(interactInfo.collectedCount) ?? "") ?? 0,
    commentCount: parseCountText(readString(interactInfo.commentCount) ?? "") ?? 0,
    tags: desc === undefined ? [] : parseNoteTags(desc),
    ...(time > 0 && { publishedAt: new Date(time).toISOString() }),
    link: noteUrl(feedId),
  };
}

/** 把工具层错误文本转成对应错误：登录态失效 → LoginRequiredError，其余原样给出明确信息。 */
function toolError(message: string): Error {
  return message.includes(LOGIN_REQUIRED_MARKER) ? new LoginRequiredError() : new Error(message);
}

/** 拼接 MCP 工具结果里的全部文本内容（上游把 JSON / 状态文本放在 text 内容里返回）。 */
function extractTextContent(result: Record<string, unknown>): string {
  const content = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isJsonObject)
    .map((item) => (typeof item.text === "string" ? item.text : undefined))
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

/** 校验 MCP 地址格式，尽早暴露配置错误。 */
function validateMcpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`XHS_MCP_URL / mcpUrl 不是合法地址：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`XHS_MCP_URL / mcpUrl 必须是 http(s) 地址：${url}`);
  }
  return url;
}

/** 白名单守卫：只允许调用只读工具（Issue #18 安全约束的运行时兜底）。 */
export function assertReadOnlyTool(name: string): void {
  if (!READ_ONLY_TOOL_NAMES.has(name)) {
    throw new Error(
      `工具 ${name} 不在只读白名单内：本工作台只接入 search_feeds / get_feed_detail / check_login_status`,
    );
  }
}

function parseJsonRpcBody(body: string): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`无法解析 xiaohongshu-mcp 响应（目标可能不是 MCP 服务）：${excerpt(body)}`);
  }
  return requireObject(parsed, "xiaohongshu-mcp 响应");
}

/** 解析响应消息：JSON 模式整体解析；SSE 模式按 data: 行找 id 匹配的那条（MCP 规范允许两种）。 */
async function parseJsonRpcMessage(response: McpHttpResponse, requestId: number): Promise<JsonRpcMessage> {
  const body = await response.text();
  if (!response.contentType.includes("text/event-stream")) {
    return parseJsonRpcBody(body);
  }

  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const message = parseJsonRpcBody(line.slice("data:".length).trim());
    if (message.id === requestId) return message;
  }
  throw new Error(`SSE 响应里没有找到 id 为 ${requestId} 的结果`);
}

export interface XhsMcpClientOptions {
  /** MCP 服务地址，默认取 XHS_MCP_URL 环境变量，再退回本机默认地址。 */
  mcpUrl?: string;
  /** AUTH_TOKEN 令牌（服务端开启鉴权时必填），默认取 XHS_MCP_AUTH_TOKEN 环境变量。 */
  authToken?: string;
  /** 传输层，默认全局 fetch；单测注入 mock 用。 */
  transport?: McpTransport;
  /** 单次调用超时（毫秒）。 */
  requestTimeoutMs?: number;
}

/**
 * xiaohongshu-mcp 数据源客户端（主题深挖）：封装 search_feeds（关键词检索）、
 * get_feed_detail（详情 / 互动数据）、check_login_status（登录状态透传）三个只读工具。
 *
 * 走 MCP Streamable HTTP 传输（JSON-RPC 2.0）。上游（commit 3b352aa）以 Stateless 模式
 * 挂载 /mcp，可跳过 initialize 握手直接 tools/call，故不维护会话。
 * 未登录 / 调用失败抛明确错误，不静默。
 */
export class XhsMcpClient {
  readonly url: string;

  private readonly authToken: string | undefined;
  private readonly transport: McpTransport;
  private readonly requestTimeoutMs: number;
  private nextRequestId = 1;

  constructor({
    mcpUrl = process.env.XHS_MCP_URL?.trim() || DEFAULT_XHS_MCP_URL,
    authToken = process.env.XHS_MCP_AUTH_TOKEN?.trim() || undefined,
    transport = { post: fetchTransport },
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  }: XhsMcpClientOptions = {}) {
    this.url = validateMcpUrl(mcpUrl);
    this.authToken = authToken;
    this.transport = transport;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /** 关键词检索小红书笔记。检索不到时返回空数组（合法空态）；未登录 / 失败抛明确错误。 */
  async searchFeeds(keyword: string): Promise<XhsSearchFeed[]> {
    const trimmed = keyword.trim();
    if (trimmed === "") {
      throw new Error("search_feeds 需要非空关键词");
    }
    const payload = await this.callTool("search_feeds", { keyword: trimmed });
    return parseSearchFeeds(parseJsonPayload("search_feeds", payload));
  }

  /** 获取笔记详情与互动数据（点赞 / 收藏 / 评论）。feedId 与 xsecToken 都来自检索结果。 */
  async getFeedDetail(feedId: string, xsecToken: string): Promise<XhsFeedDetail> {
    const trimmedFeedId = feedId.trim();
    const trimmedToken = xsecToken.trim();
    if (trimmedFeedId === "" || trimmedToken === "") {
      throw new Error("get_feed_detail 需要 feed_id 与 xsec_token（均来自 search_feeds 结果）");
    }
    const payload = await this.callTool("get_feed_detail", {
      feed_id: trimmedFeedId,
      xsec_token: trimmedToken,
    });
    return parseFeedDetail(parseJsonPayload("get_feed_detail", payload), trimmedFeedId);
  }

  /** 登录状态透传：已登录返回账号昵称，未登录返回 false；服务异常抛明确错误。 */
  async checkLoginStatus(): Promise<XhsLoginStatus> {
    const payload = await this.callTool("check_login_status", {});
    return parseLoginStatus(payload);
  }

  private async callTool(tool: ReadOnlyToolName, args: Record<string, unknown>): Promise<string> {
    assertReadOnlyTool(tool);

    const requestId = this.nextRequestId++;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: { name: tool, arguments: args },
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.authToken !== undefined) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    let response: McpHttpResponse;
    try {
      response = await this.transport.post(
        this.url,
        request,
        headers,
        AbortSignal.timeout(this.requestTimeoutMs),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`调用 xiaohongshu-mcp 超时（${Math.round(this.requestTimeoutMs / 1000)} 秒）：工具 ${tool}`);
      }
      throw new Error(
        `无法连接 xiaohongshu-mcp（${this.url}）：${errorMessage(error)}。请确认服务已按 server/mcp/README.md 启动`,
      );
    }

    if (response.status === 401) {
      throw new Error(
        `xiaohongshu-mcp 鉴权失败（HTTP 401）：请检查服务端 AUTH_TOKEN 与客户端 XHS_MCP_AUTH_TOKEN 是否一致`,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`xiaohongshu-mcp 返回 HTTP ${response.status}：${excerpt(await response.text())}`);
    }

    const message = await parseJsonRpcMessage(response, requestId);
    if (message.error !== undefined) {
      throw toolError(`MCP 调用 ${tool} 失败：${readString(message.error.message) ?? "未知错误"}`);
    }
    if (!isJsonObject(message.result)) {
      throw new Error(`MCP 调用 ${tool} 返回了无法识别的结果`);
    }

    const text = extractTextContent(message.result);
    if (message.result.isError === true) {
      throw toolError(text === "" ? `工具 ${tool} 执行失败（服务端未返回详细信息）` : text);
    }
    if (text === "") {
      throw new Error(`工具 ${tool} 返回了空内容`);
    }
    return text;
  }
}

/** 工具回文按 JSON 解析（search_feeds / get_feed_detail 的内容是 JSON 文本）。 */
function parseJsonPayload(tool: string, payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`无法解析 ${tool} 返回的 JSON：${excerpt(payload)}`);
  }
}
