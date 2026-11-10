import { describe, expect, it, vi } from "vitest";
import { LoginRequiredError } from "./errors.js";
import { openDb } from "./store.js";
import { createThemeStore, type NewNote, type ThemeStore } from "./theme-store.js";
import {
  buildClusters,
  createThemeService,
  DEFAULT_SEARCH_LIMIT,
  type XhsDataSource,
} from "./theme.js";
import { XhsMcpClient, type XhsFeedDetail, type XhsSearchFeed } from "./xhs-mcp.js";

// 编译期确认：WU-1 的 XhsMcpClient 可直接作为 collectTheme 的数据源（结构兼容，即插即用）。
// 构造只读配置不发请求；此断言防止上游客户端签名漂移导致 WU-3 接线时才发现不兼容。
const clientSatisfiesDataSource: XhsDataSource = new XhsMcpClient();
void clientSatisfiesDataSource;

/**
 * 离线 fixture：已按 XhsMcpClient 归一化的检索 / 详情结构（对齐 xhs-mcp.test.ts 的上游
 * 真实回文）。数据源用 mock 注入，不依赖真实网络 / Docker / 登录态。
 */
const FIXTURE_FEEDS: XhsSearchFeed[] = [
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
  {
    feedId: "feed-c",
    xsecToken: "token-c",
    title: "无标签随手记",
    author: "随手记博主",
    link: "https://www.xiaohongshu.com/explore/feed-c",
  },
];

const FIXTURE_DETAILS: Record<string, XhsFeedDetail> = {
  "feed-a": {
    feedId: "feed-a",
    title: "秋冬通勤穿搭灵感",
    desc: "分享 3 套通勤穿搭 #通勤穿搭[话题]# #秋冬穿搭[话题]#",
    type: "normal",
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
    type: "video",
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

interface FixtureOptions {
  feeds?: XhsSearchFeed[];
  details?: Record<string, XhsFeedDetail>;
  searchLimit?: number;
}

/** 组装被测服务：真实 SQLite store + mock 数据源（XhsMcpClient 的结构子集）。 */
function createFixture(options: FixtureOptions = {}) {
  const feeds = options.feeds ?? FIXTURE_FEEDS;
  const details = options.details ?? FIXTURE_DETAILS;
  const searchFeeds = vi.fn(async (): Promise<XhsSearchFeed[]> => feeds);
  const getFeedDetail = vi.fn(async (feedId: string): Promise<XhsFeedDetail> => {
    const detail = details[feedId];
    if (detail === undefined) throw new Error(`离线 fixture 缺少 ${feedId} 的详情`);
    return detail;
  });
  const store: ThemeStore = createThemeStore(openDb());
  const service = createThemeService({
    source: { searchFeeds, getFeedDetail } satisfies XhsDataSource,
    store,
    searchLimit: options.searchLimit,
    now: () => new Date("2026-11-10T08:00:00.000Z"),
  });
  return { service, store, searchFeeds, getFeedDetail };
}

describe("collectTheme", () => {
  it("全链路：检索 → 补详情 → 落库（四表）→ 内容簇", async () => {
    const { service, store, getFeedDetail } = createFixture();

    const result = await service.collectTheme("通勤穿搭");

    expect(getFeedDetail).toHaveBeenCalledTimes(3);
    expect(result.themeId).toBeGreaterThan(0);
    expect(result.keyword).toBe("通勤穿搭");
    expect(result.noteCount).toBe(3);
    expect(result.clusters).toEqual([
      { label: "通勤穿搭", noteCount: 2 },
      { label: "秋冬穿搭", noteCount: 1 },
      { label: "其他", noteCount: 1 },
    ]);

    expect(store.getTheme(result.themeId)).toMatchObject({
      keyword: "通勤穿搭",
      status: "done",
      createdAt: "2026-11-10T08:00:00.000Z",
    });

    const notes = store.listNotes(result.themeId);
    expect(notes.map((n) => n.feedId)).toEqual(["feed-a", "feed-b", "feed-c"]);
    expect(notes[0]).toMatchObject({
      title: "秋冬通勤穿搭灵感",
      author: "穿搭笔记",
      likeCount: 12000,
      collectCount: 678,
      commentCount: 345,
      tags: ["通勤穿搭", "秋冬穿搭"],
      publishedAt: "2025-11-01T08:00:00.000Z",
      url: "https://www.xiaohongshu.com/explore/feed-a",
    });

    const clusters = store.listClusters(result.themeId);
    expect(clusters.map((c) => c.label)).toEqual(["通勤穿搭", "秋冬穿搭", "其他"]);
    const noteIdByFeedId = new Map(notes.map((n) => [n.feedId, n.id]));
    expect(clusters[0].noteIds).toEqual([
      noteIdByFeedId.get("feed-a"),
      noteIdByFeedId.get("feed-b"),
    ]);
    expect(clusters[2].noteIds).toEqual([noteIdByFeedId.get("feed-c")]);
  });

  it("默认只取检索结果前 30 条（top 30）补详情", async () => {
    const feeds = Array.from({ length: 35 }, (_, index): XhsSearchFeed => ({
      feedId: `feed-${index}`,
      xsecToken: `token-${index}`,
      title: `笔记 ${index}`,
      link: `https://www.xiaohongshu.com/explore/feed-${index}`,
    }));
    const details = Object.fromEntries(
      feeds.map((feed): [string, XhsFeedDetail] => [
        feed.feedId,
        {
          feedId: feed.feedId,
          title: feed.title,
          likedCount: 1,
          collectedCount: 1,
          commentCount: 1,
          tags: ["通勤穿搭"],
          link: feed.link,
        },
      ]),
    );
    const { service, store, getFeedDetail } = createFixture({ feeds, details });

    const result = await service.collectTheme("通勤穿搭");

    expect(getFeedDetail).toHaveBeenCalledTimes(DEFAULT_SEARCH_LIMIT);
    expect(result.noteCount).toBe(DEFAULT_SEARCH_LIMIT);
    expect(store.listNotes(result.themeId)).toHaveLength(DEFAULT_SEARCH_LIMIT);
  });

  it("searchLimit 可调小检索规模", async () => {
    const { service, store, getFeedDetail } = createFixture({ searchLimit: 2 });

    const result = await service.collectTheme("通勤穿搭");

    expect(getFeedDetail).toHaveBeenCalledTimes(2);
    expect(result.noteCount).toBe(2);
    expect(store.listNotes(result.themeId)).toHaveLength(2);
  });

  it("检索结果里重复的 feedId 去重后再补详情", async () => {
    const { service, getFeedDetail } = createFixture({
      feeds: [FIXTURE_FEEDS[0], FIXTURE_FEEDS[1], FIXTURE_FEEDS[0]],
    });

    const result = await service.collectTheme("通勤穿搭");

    expect(getFeedDetail).toHaveBeenCalledTimes(2);
    expect(result.noteCount).toBe(2);
  });

  it("检索不到内容时返回明确空态（noteCount 0、无簇），不静默", async () => {
    const { service, store, getFeedDetail } = createFixture({ feeds: [] });

    const result = await service.collectTheme("查无此主题");

    expect(result).toMatchObject({ keyword: "查无此主题", noteCount: 0, clusters: [] });
    expect(getFeedDetail).not.toHaveBeenCalled();
    expect(store.getTheme(result.themeId)).toMatchObject({ status: "done" });
    expect(store.listNotes(result.themeId)).toEqual([]);
    expect(store.listClusters(result.themeId)).toEqual([]);
  });

  it("关键词先去首尾空白再检索与落库", async () => {
    const { service, store, searchFeeds } = createFixture();

    const result = await service.collectTheme("  通勤穿搭  ");

    expect(searchFeeds).toHaveBeenCalledWith("通勤穿搭");
    expect(store.getTheme(result.themeId)?.keyword).toBe("通勤穿搭");
  });

  it("空白关键词直接抛错，不创建主题", async () => {
    const { service, store, searchFeeds } = createFixture();

    await expect(service.collectTheme("  ")).rejects.toThrow(/非空主题关键词/);
    expect(searchFeeds).not.toHaveBeenCalled();
    expect(store.getTheme(1)).toBeNull();
  });

  it("检索失败（如登录态失效）时主题标记 failed，错误原样抛出", async () => {
    const store = createThemeStore(openDb());
    const service = createThemeService({
      source: {
        searchFeeds: vi.fn().mockRejectedValue(new LoginRequiredError()),
        getFeedDetail: vi.fn(),
      },
      store,
    });

    await expect(service.collectTheme("通勤穿搭")).rejects.toThrow("需要登录");
    expect(store.getTheme(1)).toMatchObject({ keyword: "通勤穿搭", status: "failed" });
    expect(store.listNotes(1)).toEqual([]);
  });

  it("补详情中途失败时主题标记 failed，且不落任何笔记", async () => {
    const store = createThemeStore(openDb());
    const getFeedDetail = vi.fn(async (feedId: string): Promise<XhsFeedDetail> => {
      if (feedId === "feed-b") throw new Error("笔记已删除");
      const detail = FIXTURE_DETAILS[feedId];
      if (detail === undefined) throw new Error(`离线 fixture 缺少 ${feedId} 的详情`);
      return detail;
    });
    const service = createThemeService({
      source: { searchFeeds: vi.fn(async () => FIXTURE_FEEDS), getFeedDetail },
      store,
    });

    await expect(service.collectTheme("通勤穿搭")).rejects.toThrow("笔记已删除");
    expect(store.getTheme(1)).toMatchObject({ status: "failed" });
    expect(store.listNotes(1)).toEqual([]);
    expect(store.listClusters(1)).toEqual([]);
  });

  it("详情标题为空时回退检索摘要的标题（视频笔记 displayTitle 常为空）", async () => {
    const { service, store } = createFixture({
      feeds: [FIXTURE_FEEDS[0]],
      details: { "feed-a": { ...FIXTURE_DETAILS["feed-a"], title: "" } },
    });

    await service.collectTheme("通勤穿搭");

    expect(store.listNotes(1)[0]?.title).toBe("秋冬通勤穿搭灵感");
  });

  it("详情与检索摘要都没有标题时按必填校验失败，主题标记 failed", async () => {
    const { service, store } = createFixture({
      feeds: [{ ...FIXTURE_FEEDS[0], title: "" }],
      details: { "feed-a": { ...FIXTURE_DETAILS["feed-a"], title: " " } },
    });

    await expect(service.collectTheme("通勤穿搭")).rejects.toThrow(/标题/);
    expect(store.getTheme(1)).toMatchObject({ status: "failed" });
    expect(store.listNotes(1)).toEqual([]);
  });
  it("searchLimit 非正整数时构造服务直接抛错", () => {
    const source: XhsDataSource = { searchFeeds: vi.fn(), getFeedDetail: vi.fn() };
    expect(() =>
      createThemeService({ source, store: createThemeStore(openDb()), searchLimit: 0 }),
    ).toThrow(/正整数/);
    expect(() =>
      createThemeService({ source, store: createThemeStore(openDb()), searchLimit: 1.5 }),
    ).toThrow(/正整数/);
  });

  it("topN 非正整数时构造服务直接抛错", () => {
    const source: XhsDataSource = { searchFeeds: vi.fn(), getFeedDetail: vi.fn() };
    expect(() =>
      createThemeService({ source, store: createThemeStore(openDb()), topN: 0 }),
    ).toThrow(/正整数/);
    expect(() =>
      createThemeService({ source, store: createThemeStore(openDb()), topN: 1.5 }),
    ).toThrow(/正整数/);
  });

  it("收集完成后生成并落库深度报告（簇概览 + 高价值清单 + 结论）", async () => {
    const { service, store } = createFixture();

    const result = await service.collectTheme("通勤穿搭");

    const report = store.getReport(result.themeId);
    expect(report).not.toBeNull();
    expect(report?.clusterSummary).toEqual([
      { label: "通勤穿搭", noteCount: 2 },
      { label: "秋冬穿搭", noteCount: 1 },
      { label: "其他", noteCount: 1 },
    ]);
    expect(report?.highValueNotes.map((item) => item.feedId)).toEqual([
      "feed-a",
      "feed-b",
      "feed-c",
    ]);
    expect(report?.highValueNotes[0]).toMatchObject({ feedId: "feed-a", score: 14391 });
    expect(report?.conclusion).toBe(
      "最高互动簇：通勤穿搭；高价值内容共同标签：无；平均互动量：4722.0",
    );
  });
});

describe("buildClusters", () => {
  function draftNote(feedId: string, tags: string[]): NewNote {
    return {
      feedId,
      title: `笔记 ${feedId}`,
      likeCount: 1,
      collectCount: 1,
      commentCount: 1,
      tags,
      url: `https://www.xiaohongshu.com/explore/${feedId}`,
    };
  }

  it("按标签建簇，多标签笔记同时进入多个簇", () => {
    const clusters = buildClusters([
      draftNote("a", ["通勤穿搭", "秋冬穿搭"]),
      draftNote("b", ["通勤穿搭"]),
    ]);
    expect(clusters).toEqual([
      { label: "通勤穿搭", feedIds: ["a", "b"] },
      { label: "秋冬穿搭", feedIds: ["a"] },
    ]);
  });

  it("无标签（或标签全为空白）的笔记归入「其他」簇", () => {
    const clusters = buildClusters([draftNote("a", []), draftNote("b", ["  "])]);
    expect(clusters).toEqual([{ label: "其他", feedIds: ["a", "b"] }]);
  });

  it("簇按标签首次出现的顺序排列", () => {
    const clusters = buildClusters([
      draftNote("a", ["秋冬穿搭"]),
      draftNote("b", ["通勤穿搭"]),
      draftNote("c", ["秋冬穿搭", "通勤穿搭"]),
    ]);
    expect(clusters.map((cluster) => cluster.label)).toEqual(["秋冬穿搭", "通勤穿搭"]);
  });

  it("空输入返回空数组", () => {
    expect(buildClusters([])).toEqual([]);
  });
});
