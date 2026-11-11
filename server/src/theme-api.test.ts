import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { LoginRequiredError } from "./errors.js";
import { createThemeApi, type McpLoginOptions, type McpStatusOptions } from "./theme-api.js";
import { createThemeStore, type ThemeStore } from "./theme-store.js";
import { createThemeService, type ThemeService, type XhsDataSource } from "./theme.js";
import { openDb } from "./store.js";
import type { XhsFeedDetail, XhsSearchFeed } from "./xhs-mcp.js";

const FEEDS: XhsSearchFeed[] = [
  {
    feedId: "feed-a",
    xsecToken: "token-a",
    title: "秋冬通勤穿搭灵感",
    author: "穿搭笔记",
    likedCount: 12000,
    link: "https://www.xiaohongshu.com/explore/feed-a",
  },
  {
    feedId: "feed-b",
    xsecToken: "token-b",
    title: "",
    author: "视频博主",
    likedCount: 999,
    link: "https://www.xiaohongshu.com/explore/feed-b",
  },
  {
    feedId: "feed-c",
    xsecToken: "token-c",
    title: "无标签随手记",
    author: "随手记博主",
    link: "https://www.xiaohongshu.com/explore/feed-c",
  },
];

const DETAILS: Record<string, XhsFeedDetail> = {
  "feed-a": {
    feedId: "feed-a",
    title: "秋冬通勤穿搭灵感",
    desc: "分享 3 套通勤穿搭 #通勤穿搭[话题]# #秋冬穿搭[话题]#",
    author: "穿搭笔记",
    likedCount: 12000,
    collectedCount: 678,
    commentCount: 345,
    tags: ["通勤穿搭", "秋冬穿搭"],
    publishedAt: "2025-11-01T08:00:00.000Z",
    link: "https://www.xiaohongshu.com/explore/feed-a",
  },
  "feed-b": {
    feedId: "feed-b",
    title: "3 套秋冬通勤穿搭（视频版）",
    author: "视频博主",
    likedCount: 999,
    collectedCount: 80,
    commentCount: 56,
    tags: ["通勤穿搭"],
    link: "https://www.xiaohongshu.com/explore/feed-b",
  },
  "feed-c": {
    feedId: "feed-c",
    title: "无标签随手记",
    author: "随手记博主",
    likedCount: 5,
    collectedCount: 2,
    commentCount: 1,
    tags: [],
    link: "https://www.xiaohongshu.com/explore/feed-c",
  },
};

function mockSource(overrides: Partial<XhsDataSource> = {}): XhsDataSource {
  return {
    searchFeeds: vi.fn(async (): Promise<XhsSearchFeed[]> => FEEDS),
    getFeedDetail: vi.fn(async (feedId: string): Promise<XhsFeedDetail> => {
      const detail = DETAILS[feedId];
      if (detail === undefined) throw new Error(`离线 fixture 缺少 ${feedId} 的详情`);
      return detail;
    }),
    ...overrides,
  };
}

interface FixtureOptions {
  service?: ThemeService;
  source?: XhsDataSource;
  mcpStatus?: McpStatusOptions;
  mcpLogin?: McpLoginOptions;
}

async function withThemeApi(
  run: (baseUrl: string, store: ThemeStore) => Promise<void>,
  options: FixtureOptions = {},
): Promise<void> {
  const db = openDb();
  const store = createThemeStore(db);
  const service =
    options.service ??
    createThemeService({
      source: options.source ?? mockSource(),
      store,
      now: () => new Date("2026-11-10T08:00:00.000Z"),
    });
  const server = createServer(
    createThemeApi({
      themeService: service,
      themeStore: store,
      mcpStatus: options.mcpStatus ?? {
        source: "fixture",
        checkLoginStatus: async () => ({ loggedIn: false }),
      },
      mcpLogin: options.mcpLogin ?? {
        getLoginQrcode: async () => ({ loggedIn: false, image: "data:image/png;base64,AAAA" }),
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("theme API server did not start");
  try {
    await run(`http://127.0.0.1:${address.port}`, store);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  }
}

describe("theme deep-dive API", () => {
  it("POST collect 触发全链路并返回 themeId，随后可读回报告与笔记", async () => {
    await withThemeApi(async (baseUrl) => {
      const collectResponse = await fetch(`${baseUrl}/api/themes/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "通勤穿搭" }),
      });
      expect(collectResponse.status).toBe(201);
      const { themeId } = (await collectResponse.json()) as { themeId: number };
      expect(themeId).toBeGreaterThan(0);

      const reportResponse = await fetch(`${baseUrl}/api/themes/${themeId}/report`);
      expect(reportResponse.status).toBe(200);
      const report = (await reportResponse.json()) as Record<string, unknown>;
      expect(report).toMatchObject({
        themeId,
        keyword: "通勤穿搭",
      });
      expect(report.cluster_summary).toEqual([
        { label: "通勤穿搭", noteCount: 2 },
        { label: "秋冬穿搭", noteCount: 1 },
        { label: "其他", noteCount: 1 },
      ]);
      expect(Array.isArray(report.high_value_notes)).toBe(true);
      expect(report.high_value_notes).toHaveLength(3);
      expect((report.high_value_notes as { feedId: string }[])[0]?.feedId).toBe("feed-a");
      expect(report.conclusion).toContain("最高互动簇：通勤穿搭");

      const notesResponse = await fetch(`${baseUrl}/api/themes/${themeId}/notes`);
      expect(notesResponse.status).toBe(200);
      expect(await notesResponse.json()).toMatchObject({
        themeId,
        keyword: "通勤穿搭",
        notes: [
          { feedId: "feed-a", likeCount: 12000, collectCount: 678, commentCount: 345 },
          { feedId: "feed-b", likeCount: 999 },
          { feedId: "feed-c", likeCount: 5 },
        ],
      });
    });
  });

  it("POST collect 空态：检索不到内容也生成空报告", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/themes/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "查无此主题" }),
      });
      expect(response.status).toBe(201);
      const { themeId } = (await response.json()) as { themeId: number };

      const reportResponse = await fetch(`${baseUrl}/api/themes/${themeId}/report`);
      expect(reportResponse.status).toBe(200);
      expect(await reportResponse.json()).toMatchObject({
        cluster_summary: [],
        high_value_notes: [],
        conclusion: "最高互动簇：无；高价值内容共同标签：无；平均互动量：0.0",
      });
    }, { source: mockSource({ searchFeeds: vi.fn(async () => []) }) });
  });

  it("POST collect 缺少 / 空白 keyword 返回 400", async () => {
    await withThemeApi(async (baseUrl) => {
      for (const body of [{}, { keyword: "" }, { keyword: "  " }]) {
        const response = await fetch(`${baseUrl}/api/themes/collect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toHaveProperty("error");
      }
    });
  });

  it("POST collect 遇到需要登录返回 401", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/themes/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "通勤穿搭" }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "需要登录" });
    }, { source: mockSource({ searchFeeds: vi.fn().mockRejectedValue(new LoginRequiredError()) }) });
  });

  it("POST collect 其他失败返回 500", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/themes/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "通勤穿搭" }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "主题收集失败" });
    }, { source: mockSource({ searchFeeds: vi.fn().mockRejectedValue(new Error("MCP 挂了")) }) });
  });

  it("GET report 主题不存在返回 404", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/themes/999/report`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "主题不存在" });
    });
  });

  it("GET report 主题存在但报告未生成返回 404", async () => {
    await withThemeApi(async (baseUrl, store) => {
      const themeId = store.createTheme("通勤穿搭", "2026-11-10T08:00:00.000Z");
      const response = await fetch(`${baseUrl}/api/themes/${themeId}/report`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "报告尚未生成" });
    });
  });

  it("GET notes 主题不存在返回 404；非法 id 返回 400", async () => {
    await withThemeApi(async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/themes/999/notes`);
      expect(missing.status).toBe(404);

      const invalid = await fetch(`${baseUrl}/api/themes/abc/notes`);
      expect(invalid.status).toBe(400);
    });
  });

  it("GET mcp/status 返回数据源与登录状态", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ source: "fixture", loggedIn: false });
    }, {
      mcpStatus: { source: "fixture", checkLoginStatus: async () => ({ loggedIn: false }) },
    });
  });

  it("GET mcp/status 已登录时透传用户名", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        source: "xiaohongshu",
        loggedIn: true,
        username: "穿搭笔记",
      });
    }, {
      mcpStatus: {
        source: "xiaohongshu",
        checkLoginStatus: async () => ({ loggedIn: true, username: "穿搭笔记" }),
      },
    });
  });

  it("GET mcp/status 检查登录失败时不抛错，返回未登录", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ source: "xiaohongshu", loggedIn: false });
    }, {
      mcpStatus: {
        source: "xiaohongshu",
        checkLoginStatus: async () => {
          throw new Error("MCP 不可用");
        },
      },
    });
  });

  it("GET mcp/login-qrcode 未登录时返回二维码 data URL", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/login-qrcode`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        loggedIn: false,
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      });
    }, {
      mcpLogin: {
        getLoginQrcode: async () => ({
          loggedIn: false,
          image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        }),
      },
    });
  });

  it("GET mcp/login-qrcode 已登录时只返回登录态", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/login-qrcode`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ loggedIn: true });
    }, {
      mcpLogin: {
        getLoginQrcode: async () => ({ loggedIn: true }),
      },
    });
  });

  it("GET mcp/login-qrcode 获取二维码失败时返回 500，不静默", async () => {
    await withThemeApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/login-qrcode`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "获取登录二维码失败" });
    }, {
      mcpLogin: {
        getLoginQrcode: async () => {
          throw new Error("MCP 挂了");
        },
      },
    });
  });
});
