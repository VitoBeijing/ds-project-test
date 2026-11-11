import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginRequiredError } from "./errors.js";
import {
  assertReadOnlyTool,
  DEFAULT_XHS_MCP_URL,
  parseCountText,
  parseLoginQrcode,
  parseLoginStatus,
  parseNoteTags,
  parseSearchFeeds,
  parseFeedDetail,
  READ_ONLY_TOOLS,
  XhsMcpClient,
  type McpHttpResponse,
  type McpTransport,
} from "./xhs-mcp.js";

/**
 * 离线 fixture：对齐 xiaohongshu-mcp（锁定 commit 3b352aa）各工具的真实返回结构。
 * 上游把结构体 json.Marshal 后放进 MCP text 内容返回；User 结构固定序列化
 * nickname / nickName 两个键，按页面来源择一非空。测试不依赖真实网络 / 账号。
 */
const SEARCH_FEEDS_PAYLOAD = {
  feeds: [
    {
      xsecToken: "token-a",
      id: "feed-a",
      modelType: "note",
      index: 0,
      noteCard: {
        type: "normal",
        displayTitle: "秋冬通勤穿搭灵感",
        user: { userId: "user-1", nickname: "", nickName: "穿搭笔记", avatar: "" },
        interactInfo: {
          liked: false,
          likedCount: "1.2万",
          sharedCount: "9",
          commentCount: "345",
          collectedCount: "678",
          collected: false,
        },
        cover: { width: 1080, height: 1440, url: "https://sns.example/cover-a.jpg" },
      },
    },
    {
      xsecToken: "token-b",
      id: "feed-b",
      modelType: "note",
      index: 1,
      noteCard: {
        type: "video",
        displayTitle: "",
        user: { userId: "user-2", nickname: "视频博主", nickName: "", avatar: "" },
        interactInfo: {
          liked: false,
          likedCount: "999+",
          sharedCount: "",
          commentCount: "",
          collectedCount: "",
          collected: false,
        },
        cover: { width: 0, height: 0, url: "", fileId: "", urlPre: "", urlDefault: "", infoList: null },
      },
    },
  ],
  count: 2,
};

const FEED_DETAIL_PAYLOAD = {
  feed_id: "feed-a",
  data: {
    note: {
      noteId: "feed-a",
      xsecToken: "token-a",
      title: "秋冬通勤穿搭灵感",
      desc: "分享 3 套通勤穿搭 #通勤穿搭[话题]# #秋冬穿搭[话题]# #通勤穿搭[话题]# #OOTD#",
      type: "normal",
      time: 1_762_000_000_000,
      ipLocation: "上海",
      user: { userId: "user-1", nickname: "", nickName: "穿搭笔记", avatar: "" },
      interactInfo: {
        liked: false,
        likedCount: "1.2万",
        sharedCount: "9",
        commentCount: "345",
        collectedCount: "678",
        collected: false,
      },
      imageList: [
        { width: 1080, height: 1440, urlDefault: "https://sns.example/a.jpg", urlPre: "", livePhoto: false },
      ],
    },
    comments: {
      list: [
        {
          id: "comment-1",
          noteId: "feed-a",
          content: "第三套太好看了",
          likeCount: "12",
          createTime: 1_762_001_000_000,
          ipLocation: "北京",
          liked: false,
          userInfo: { userId: "user-3", nickname: "", nickName: "路人甲", avatar: "" },
          subCommentCount: "0",
          subComments: null,
          showTags: null,
        },
      ],
      cursor: "",
      hasMore: false,
    },
  },
};

const LOGGED_IN_TEXT = "✅ 已登录\n用户名: 穿搭笔记\n\n你可以使用其他功能了。";
const NOT_LOGGED_IN_TEXT = "❌ 未登录\n\n请使用 get_login_qrcode 工具获取二维码进行登录。";
const LOGIN_EXPIRED_TOOL_ERROR =
  "搜索Feeds失败: 未登录或登录态已失效：请求被重定向到登录页，请重新扫码登录";

/** JSON-RPC tools/call 成功回文（上游 Stateless JSON 模式）。 */
function toolResultBody(text: string, isError = false): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text }],
      ...(isError ? { isError: true } : {}),
    },
  });
}

/** JSON-RPC tools/call 成功回文：直接给定任意 content（get_login_qrcode 含 image 内容用）。 */
function toolResultContentBody(content: unknown[], isError = false): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content,
      ...(isError ? { isError: true } : {}),
    },
  });
}

function createResponse(options: {
  status?: number;
  contentType?: string;
  body?: string;
} = {}): McpHttpResponse {
  return {
    status: options.status ?? 200,
    contentType: options.contentType ?? "application/json",
    text: async () => options.body ?? "",
  };
}

/** mock 传输：默认返回 search_feeds 成功回文，可按需替换响应 / 模拟异常；post 始终是可断言的 Mock。 */
function createTransport(options: {
  response?: McpHttpResponse | McpHttpResponse[];
  post?: McpTransport["post"];
} = {}): McpTransport & { post: ReturnType<typeof vi.fn<McpTransport["post"]>> } {
  const responses =
    options.response === undefined
      ? []
      : Array.isArray(options.response)
        ? options.response
        : [options.response];
  let callIndex = 0;
  const defaultPost: McpTransport["post"] = async () => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    return response ?? createResponse({ body: toolResultBody(JSON.stringify(SEARCH_FEEDS_PAYLOAD)) });
  };
  return { post: vi.fn(options.post ?? defaultPost) };
}

function createClient(transport: McpTransport, authToken?: string): XhsMcpClient {
  return new XhsMcpClient({ transport, authToken });
}

/** 取第 n 次 POST 的已解析请求体。 */
function postedRequest(
  transport: { post: ReturnType<typeof vi.fn> },
  index = 0,
): {
  jsonrpc: string;
  id: number;
  method: string;
  params: { name: string; arguments: Record<string, unknown> };
} {
  const [, body] = transport.post.mock.calls[index];
  return JSON.parse(body);
}

describe("XhsMcpClient", () => {
  beforeEach(() => {
    // 屏蔽宿主机环境变量，默认值断言不受影响；个别用例再显式 stub 成目标值
    vi.stubEnv("XHS_MCP_URL", "");
    vi.stubEnv("XHS_MCP_AUTH_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("默认指向本机 xiaohongshu-mcp（部署上只监听 127.0.0.1）", () => {
    expect(new XhsMcpClient().url).toBe("http://127.0.0.1:18060/mcp");
    expect(DEFAULT_XHS_MCP_URL).toBe("http://127.0.0.1:18060/mcp");
  });

  it("mcpUrl 取 XHS_MCP_URL 环境变量；非法地址在构造时抛明确错误", () => {
    vi.stubEnv("XHS_MCP_URL", "http://127.0.0.1:19090/mcp");
    expect(new XhsMcpClient({ transport: createTransport() }).url).toBe("http://127.0.0.1:19090/mcp");

    expect(() => new XhsMcpClient({ mcpUrl: "not a url" })).toThrow(/不是合法地址/);
    expect(() => new XhsMcpClient({ mcpUrl: "ftp://127.0.0.1:18060/mcp" })).toThrow(/http/);
  });

  it("配置了令牌时按 Bearer 鉴权，未配置时不带 Authorization 头", async () => {
    const withToken = createTransport({
      response: createResponse({ body: toolResultBody(LOGGED_IN_TEXT) }),
    });
    await createClient(withToken, "secret-token").checkLoginStatus();
    expect(withToken.post.mock.calls[0][2].Authorization).toBe("Bearer secret-token");

    const withoutToken = createTransport({
      response: createResponse({ body: toolResultBody(LOGGED_IN_TEXT) }),
    });
    await createClient(withoutToken).checkLoginStatus();
    expect(withoutToken.post.mock.calls[0][2].Authorization).toBeUndefined();
  });

  it("search_feeds 发送 tools/call 请求并归一化字段（feedId / xsecToken / title / author / likedCount / link）", async () => {
    const transport = createTransport();
    const feeds = await createClient(transport).searchFeeds("通勤穿搭");

    const [url, body, headers] = transport.post.mock.calls[0];
    expect(url).toBe(DEFAULT_XHS_MCP_URL);
    expect(JSON.parse(body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_feeds", arguments: { keyword: "通勤穿搭" } },
    });
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json, text/event-stream");

    expect(feeds).toEqual([
      {
        feedId: "feed-a",
        xsecToken: "token-a",
        title: "秋冬通勤穿搭灵感",
        type: "normal",
        author: "穿搭笔记",
        likedCount: 12000,
        link: "https://www.xiaohongshu.com/explore/feed-a",
      },
      {
        feedId: "feed-b",
        xsecToken: "token-b",
        title: "",
        type: "video",
        author: "视频博主",
        likedCount: 999,
        link: "https://www.xiaohongshu.com/explore/feed-b",
      },
    ]);
  });

  it("search_feeds 检索不到内容时返回空列表（合法空态，不报错）", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(JSON.stringify({ feeds: [], count: 0 })) }),
    });

    await expect(createClient(transport).searchFeeds("冷门关键词")).resolves.toEqual([]);
  });

  it("search_feeds 工具报错时抛出带服务端信息的明确错误", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody("搜索Feeds失败: 没有捕获到 feeds 数据", true) }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(
      /没有捕获到 feeds 数据/,
    );
  });

  it("未登录（登录态失效）时抛「需要登录」，不静默", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(LOGIN_EXPIRED_TOOL_ERROR, true) }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(LoginRequiredError);
    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow("需要登录");
  });

  it("空关键词不发起 MCP 调用，直接抛参数错误", async () => {
    const transport = createTransport();

    await expect(createClient(transport).searchFeeds("   ")).rejects.toThrow(/非空关键词/);
    expect(transport.post).not.toHaveBeenCalled();
  });

  it("回文不是合法 JSON 时抛出明确错误（目标可能不是 MCP 服务）", async () => {
    const transport = createTransport({
      response: createResponse({ body: "<html>502 Bad Gateway</html>" }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(/无法解析/);
  });

  it("回文缺少 feeds 数组时抛出结构错误，不静默返回空", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(JSON.stringify({ count: 0 })) }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(/缺少 feeds 数组/);
  });

  it("条目缺少 id 或 xsecToken 时抛出明确错误，不静默跳过（缺 xsecToken 无法取详情）", async () => {
    const missingId = createTransport({
      response: createResponse({
        body: toolResultBody(JSON.stringify({ feeds: [{ xsecToken: "token-a", noteCard: {} }], count: 1 })),
      }),
    });
    await expect(createClient(missingId).searchFeeds("通勤穿搭")).rejects.toThrow(/第 0 条缺少 id/);

    const missingToken = createTransport({
      response: createResponse({
        body: toolResultBody(JSON.stringify({ feeds: [{ id: "feed-a", noteCard: {} }], count: 1 })),
      }),
    });
    await expect(createClient(missingToken).searchFeeds("通勤穿搭")).rejects.toThrow(
      /第 0 条缺少 xsecToken/,
    );
  });

  it("get_feed_detail 携带 feed_id 与 xsec_token 调用，并归一化详情（互动数 / 标签 / 发布时间 / 链接）", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(JSON.stringify(FEED_DETAIL_PAYLOAD)) }),
    });

    const detail = await createClient(transport).getFeedDetail("feed-a", "token-a");

    expect(postedRequest(transport).params).toEqual({
      name: "get_feed_detail",
      arguments: { feed_id: "feed-a", xsec_token: "token-a" },
    });
    expect(detail).toEqual({
      feedId: "feed-a",
      title: "秋冬通勤穿搭灵感",
      desc: FEED_DETAIL_PAYLOAD.data.note.desc,
      type: "normal",
      author: "穿搭笔记",
      likedCount: 12000,
      collectedCount: 678,
      commentCount: 345,
      tags: ["通勤穿搭", "秋冬穿搭", "OOTD"],
      publishedAt: "2025-11-01T12:26:40.000Z",
      link: "https://www.xiaohongshu.com/explore/feed-a",
    });
  });

  it("get_feed_detail 互动数缺失 / 不可解析时按 0 处理", () => {
    const detail = parseFeedDetail(
      {
        note: {
          noteId: "feed-b",
          title: "只有标题的笔记",
          type: "video",
          interactInfo: { likedCount: "赞", commentCount: "", collectedCount: "" },
        },
      },
      "feed-b",
    );

    expect(detail).toMatchObject({
      feedId: "feed-b",
      title: "只有标题的笔记",
      likedCount: 0,
      collectedCount: 0,
      commentCount: 0,
      tags: [],
    });
  });

  it("get_feed_detail 缺参数时不发起 MCP 调用，直接抛参数错误", async () => {
    const transport = createTransport();

    await expect(createClient(transport).getFeedDetail("feed-a", "  ")).rejects.toThrow(
      /feed_id 与 xsec_token/,
    );
    expect(transport.post).not.toHaveBeenCalled();
  });

  it("get_feed_detail 未登录（登录态失效）时抛「需要登录」", async () => {
    const transport = createTransport({
      response: createResponse({
        body: toolResultBody(
          "获取Feed详情失败: 未登录或登录态已失效：请求被重定向到登录页，请重新扫码登录",
          true,
        ),
      }),
    });

    await expect(createClient(transport).getFeedDetail("feed-a", "token-a")).rejects.toThrow(
      LoginRequiredError,
    );
  });

  it("get_feed_detail 回文缺少 note 对象时抛出结构错误", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(JSON.stringify({ comments: null })) }),
    });

    await expect(createClient(transport).getFeedDetail("feed-a", "token-a")).rejects.toThrow(
      /缺少 note 对象|note 不是对象/,
    );
  });

  it("check_login_status 透传登录状态：已登录带用户名", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(LOGGED_IN_TEXT) }),
    });

    await expect(createClient(transport).checkLoginStatus()).resolves.toEqual({
      loggedIn: true,
      username: "穿搭笔记",
    });
    expect(postedRequest(transport).params).toEqual({
      name: "check_login_status",
      arguments: {},
    });
  });

  it("check_login_status 未登录时返回 loggedIn: false（明确状态而非报错）", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody(NOT_LOGGED_IN_TEXT) }),
    });

    await expect(createClient(transport).checkLoginStatus()).resolves.toEqual({ loggedIn: false });
  });

  it("check_login_status 工具报错时抛出带服务端信息的明确错误", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody("检查登录状态失败: 打开浏览器超时", true) }),
    });

    await expect(createClient(transport).checkLoginStatus()).rejects.toThrow(/打开浏览器超时/);
  });

  it("check_login_status 回文无法识别时不猜测状态，抛出明确错误", async () => {
    const transport = createTransport({
      response: createResponse({ body: toolResultBody("服务维护中") }),
    });

    await expect(createClient(transport).checkLoginStatus()).rejects.toThrow(/无法识别.*登录状态/);
  });

  it("get_login_qrcode 未登录时返回二维码 data URL", async () => {
    const transport = createTransport({
      response: createResponse({
        body: toolResultContentBody([
          { type: "text", text: "请用小红书 App 在 2026-11-11 15:00:00 前扫码登录 👇" },
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" },
        ]),
      }),
    });

    await expect(createClient(transport).getLoginQrcode()).resolves.toEqual({
      loggedIn: false,
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    });
    expect(postedRequest(transport).params).toEqual({
      name: "get_login_qrcode",
      arguments: {},
    });
  });

  it("get_login_qrcode 已登录时只返回登录态", async () => {
    const transport = createTransport({
      response: createResponse({
        body: toolResultContentBody([{ type: "text", text: "你当前已处于登录状态" }]),
      }),
    });

    await expect(createClient(transport).getLoginQrcode()).resolves.toEqual({ loggedIn: true });
  });

  it("get_login_qrcode 工具报错时抛出带服务端信息的明确错误", async () => {
    const transport = createTransport({
      response: createResponse({
        body: toolResultContentBody(
          [{ type: "text", text: "获取登录扫码图片失败: 打开浏览器超时" }],
          true,
        ),
      }),
    });

    await expect(createClient(transport).getLoginQrcode()).rejects.toThrow(/打开浏览器超时/);
  });

  it("get_login_qrcode 回文缺少 image 内容时不静默，抛出明确错误", async () => {
    const transport = createTransport({
      response: createResponse({
        body: toolResultContentBody([{ type: "text", text: "请扫码登录" }]),
      }),
    });

    await expect(createClient(transport).getLoginQrcode()).rejects.toThrow(/无法识别/);
  });

  it("MCP 返回 JSON-RPC 错误时抛出带错误信息的明确错误", async () => {
    const transport = createTransport({
      response: createResponse({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "tool not found: search_feeds" },
        }),
      }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(
      /MCP 调用 search_feeds 失败：tool not found/,
    );
  });

  it("HTTP 401 时提示检查 AUTH_TOKEN 配置", async () => {
    const transport = createTransport({
      response: createResponse({
        status: 401,
        body: JSON.stringify({ error: "未授权", code: "UNAUTHORIZED" }),
      }),
    });

    await expect(createClient(transport).checkLoginStatus()).rejects.toThrow(
      /HTTP 401.*XHS_MCP_AUTH_TOKEN/,
    );
  });

  it("HTTP 5xx 时抛出带状态码与响应片段的明确错误", async () => {
    const transport = createTransport({
      response: createResponse({ status: 503, body: "Service Unavailable" }),
    });

    await expect(createClient(transport).checkLoginStatus()).rejects.toThrow(/HTTP 503/);
  });

  it("无法连接 MCP 服务时抛出带地址与部署指引的错误", async () => {
    const transport = createTransport({
      post: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });

    await expect(createClient(transport).checkLoginStatus()).rejects.toThrow(
      new RegExp(`无法连接 xiaohongshu-mcp（${DEFAULT_XHS_MCP_URL.replace(/[/\\]/g, "\\$&")}）`),
    );
  });

  it("调用超时时抛出超时错误", async () => {
    const transport = createTransport({
      post: vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(/超时/);
  });

  it("SSE（text/event-stream）回文也能按 id 匹配解析", async () => {
    const sseBody = [
      "event: message",
      `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}`,
      "",
      `data: ${toolResultBody(JSON.stringify({ feeds: [], count: 0 }))}`,
      "",
    ].join("\n");
    const transport = createTransport({
      response: createResponse({ contentType: "text/event-stream", body: sseBody }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).resolves.toEqual([]);
  });

  it("工具执行失败但未带回文本时给出明确错误（不静默）", async () => {
    const transport = createTransport({
      response: createResponse({
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [], isError: true } }),
      }),
    });

    await expect(createClient(transport).searchFeeds("通勤穿搭")).rejects.toThrow(/执行失败/);
  });

  it("多次调用的 JSON-RPC id 递增", async () => {
    const transport = createTransport({
      response: [
        createResponse({ body: toolResultBody(LOGGED_IN_TEXT) }),
        createResponse({ body: toolResultBody(NOT_LOGGED_IN_TEXT) }),
      ],
    });
    const client = createClient(transport);

    await client.checkLoginStatus();
    await client.checkLoginStatus();

    expect(postedRequest(transport, 0).id).toBe(1);
    expect(postedRequest(transport, 1).id).toBe(2);
  });
});

describe("只读工具白名单（Issue #18 安全约束）", () => {
  it("只接入 search_feeds / get_feed_detail / check_login_status / get_login_qrcode 四个只读工具", () => {
    expect([...READ_ONLY_TOOLS]).toEqual([
      "search_feeds",
      "get_feed_detail",
      "check_login_status",
      "get_login_qrcode",
    ]);
  });

  it("白名单外的工具（发帖 / 评论 / 点赞 / 收藏等写操作）被运行时守卫拒绝", () => {
    expect(() => assertReadOnlyTool("publish_content")).toThrow(/不在只读白名单/);
    expect(() => assertReadOnlyTool("post_comment")).toThrow(/不在只读白名单/);
    expect(() => assertReadOnlyTool("like_feed")).toThrow(/不在只读白名单/);
    expect(() => assertReadOnlyTool("favorite_feed")).toThrow(/不在只读白名单/);
    expect(() => assertReadOnlyTool("search_feeds")).not.toThrow();
    expect(() => assertReadOnlyTool("get_login_qrcode")).not.toThrow();
  });
});

describe("parseLoginQrcode（直接单测解析）", () => {
  it("未登录回文返回二维码 data URL（mimeType 缺失时默认 image/png）", () => {
    expect(
      parseLoginQrcode({
        content: [
          { type: "text", text: "请扫码登录" },
          { type: "image", mimeType: "image/png", data: "AAAA" },
        ],
      }),
    ).toEqual({ loggedIn: false, image: "data:image/png;base64,AAAA" });

    expect(
      parseLoginQrcode({
        content: [{ type: "image", data: "BBBB" }],
      }),
    ).toEqual({ loggedIn: false, image: "data:image/png;base64,BBBB" });
  });

  it("已登录回文只返回登录态", () => {
    expect(
      parseLoginQrcode({
        content: [{ type: "text", text: "你当前已处于登录状态" }],
      }),
    ).toEqual({ loggedIn: true });
  });

  it("无法识别的回文抛出明确错误，不猜测", () => {
    expect(() => parseLoginQrcode({ content: [] })).toThrow(/无法识别/);
  });
});

describe("parseNoteTags", () => {
  it("提取 `#话题[话题]#` 与 `#话题#` 两种写法的话题标签", () => {
    expect(parseNoteTags("分享 3 套穿搭 #通勤穿搭[话题]# #秋冬穿搭[话题]#")).toEqual([
      "通勤穿搭",
      "秋冬穿搭",
    ]);
    expect(parseNoteTags("好物推荐 #OOTD#")).toEqual(["OOTD"]);
  });

  it("去重且保持出现顺序；无标签时返回空数组", () => {
    expect(parseNoteTags("#A# 中间文字 #A# #B#")).toEqual(["A", "B"]);
    expect(parseNoteTags("没有任何话题标签")).toEqual([]);
    expect(parseNoteTags("单个 # 不成对")).toEqual([]);
  });
});

describe("parseCountText", () => {
  it.each([
    ["1.2万", 12000],
    ["1.2亿", 120000000],
    ["345", 345],
    ["1,234", 1234],
    ["999+", 999],
    ["", undefined],
    ["赞", undefined],
  ])("把 %j 解析为 %s", (text, expected) => {
    expect(parseCountText(text)).toBe(expected);
  });
});

describe("parseLoginStatus", () => {
  it("已登录回文解析出用户名；无用户名时只返回登录态", () => {
    expect(parseLoginStatus(LOGGED_IN_TEXT)).toEqual({ loggedIn: true, username: "穿搭笔记" });
    expect(parseLoginStatus("✅ 已登录\n\n你可以使用其他功能了。")).toEqual({ loggedIn: true });
  });

  it("未登录回文返回 false", () => {
    expect(parseLoginStatus(NOT_LOGGED_IN_TEXT)).toEqual({ loggedIn: false });
  });

  it("无法识别的回文抛出明确错误，不猜测", () => {
    expect(() => parseLoginStatus("服务维护中")).toThrow(/无法识别/);
  });
});

describe("parseSearchFeeds / parseFeedDetail（直接单测归一化）", () => {
  it("search_feeds 空结果返回空数组（合法空态）", () => {
    expect(parseSearchFeeds({ feeds: [], count: 0 })).toEqual([]);
  });

  it("search_feeds 结果不是对象时抛出明确错误", () => {
    expect(() => parseSearchFeeds(null)).toThrow(/search_feeds 结果.*不是对象/);
    expect(() => parseSearchFeeds("[]")).toThrow(/不是对象/);
  });

  it("feed_detail 正文缺省时 tags 为空、发布时间缺省时不带 publishedAt", () => {
    const detail = parseFeedDetail({ note: { noteId: "feed-c", title: "纯标题" } }, "feed-c");

    expect(detail).toEqual({
      feedId: "feed-c",
      title: "纯标题",
      likedCount: 0,
      collectedCount: 0,
      commentCount: 0,
      tags: [],
      link: "https://www.xiaohongshu.com/explore/feed-c",
    });
  });

  it("get_feed_detail 的 data 包装层被正确解包（feedId / title / desc / tags / 互动三数）", () => {
    const detail = parseFeedDetail(
      {
        feed_id: "feed-a",
        data: {
          note: {
            noteId: "feed-a",
            title: "春季穿搭",
            desc: "#ootd日常穿搭[话题]# #男友穿搭[话题]#",
            type: "normal",
            time: 1_773_655_242_000,
            user: { nickname: "宋栩笙笙Nie" },
            interactInfo: { likedCount: "843", collectedCount: "511", commentCount: "15" },
          },
        },
      },
      "feed-a",
    );

    expect(detail).toMatchObject({
      feedId: "feed-a",
      title: "春季穿搭",
      desc: "#ootd日常穿搭[话题]# #男友穿搭[话题]#",
      type: "normal",
      author: "宋栩笙笙Nie",
      likedCount: 843,
      collectedCount: 511,
      commentCount: 15,
      tags: ["ootd日常穿搭", "男友穿搭"],
    });
  });

  it("无 data 包装的旧形状仍可解析（兼容旧响应结构）", () => {
    const detail = parseFeedDetail(
      {
        note: {
          noteId: "feed-legacy",
          title: "旧形状笔记",
          desc: "#通勤穿搭[话题]#",
          type: "normal",
          user: { nickName: "旧作者" },
          interactInfo: { likedCount: "10", collectedCount: "20", commentCount: "30" },
        },
      },
      "feed-legacy",
    );

    expect(detail).toMatchObject({
      feedId: "feed-legacy",
      title: "旧形状笔记",
      desc: "#通勤穿搭[话题]#",
      author: "旧作者",
      likedCount: 10,
      collectedCount: 20,
      commentCount: 30,
      tags: ["通勤穿搭"],
    });
  });

  it("feed_detail 回文缺少 note 时抛出明确错误", () => {
    expect(() => parseFeedDetail({}, "feed-a")).toThrow(/note/);
  });
});
