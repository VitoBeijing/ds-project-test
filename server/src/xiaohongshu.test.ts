import { describe, expect, it, vi } from "vitest";
import { LoginRequiredError } from "./provider.js";
import { DEFAULT_XHS_PROFILE_PATH } from "./session.js";
import { extractHotTopics, parseHeat, XiaohongshuProvider } from "./xiaohongshu.js";

const XHS_EXPLORE_URL = "https://www.xiaohongshu.com/explore";

/** 离线 fixture：与 Provider 内选择器定义对应的小红书「发现」页热搜列表 HTML，不依赖真实网络 / 账号。 */
const FIXTURE_HTML = `<!DOCTYPE html>
<html>
  <body>
    <div class="side-bar">
      <div class="hot-list">
        <div class="hot-item">
          <span class="hot-rank">1</span>
          <span class="hot-title">秋冬穿搭灵感</span>
          <span class="hot-heat">482.3万</span>
        </div>
        <div class="hot-item">
          <span class="hot-rank">2</span>
          <span class="hot-title">citywalk 路线分享</span>
        </div>
        <div class="hot-item">
          <span class="hot-title">露营好物清单</span>
          <span class="hot-heat">320000</span>
        </div>
        <div class="hot-item">
          <span class="hot-rank">4</span>
          <a class="hot-title" href="/search_result?keyword=咖啡探店">咖啡 探店地图</a>
        </div>
        <div class="hot-item">
          <span class="hot-rank">5</span>
          <span class="hot-title">国庆出行攻略</span>
          <span class="hot-heat">1.2亿</span>
        </div>
        <div class="hot-item">
          <span class="hot-rank">6</span>
          <span class="hot-title">旅行<em>避雷</em>指南与<strong>平价</strong>住宿</span>
        </div>
        <div class="hot-item">
          <span class="hot-rank">7</span>
          <span class="hot-title">周中灵感 &amp; 摸鱼</span>
          <span class="hot-heat"><i class="icon-fire"></i>88.6万</span>
        </div>
        <div class="hot-item">
          <span class="hot-rank">8</span>
          <span class="hot-title">  </span>
        </div>
      </div>
    </div>
  </body>
</html>`;

/** 字段映射期望：主题名→title、排名→rank、热度→heat（万 / 亿换算）；嵌套标签与 HTML 实体正确还原；空主题名条目跳过。 */
const EXPECTED_TOPICS = [
  { title: "秋冬穿搭灵感", rank: 1, heat: 4823000 },
  { title: "citywalk 路线分享", rank: 2 },
  { title: "露营好物清单", rank: 3, heat: 320000 },
  { title: "咖啡 探店地图", rank: 4 },
  { title: "国庆出行攻略", rank: 5, heat: 120000000 },
  { title: "旅行避雷指南与平价住宿", rank: 6 },
  { title: "周中灵感 & 摸鱼", rank: 7, heat: 886000 },
];

function createScrapePage({
  html = FIXTURE_HTML,
  url = XHS_EXPLORE_URL,
  status = 200,
}: {
  html?: string;
  url?: string;
  status?: number;
} = {}) {
  return {
    goto: vi.fn(async () => ({ status: () => status })),
    waitForSelector: vi.fn(async () => undefined),
    url: () => url,
    content: vi.fn(async () => html),
  };
}

function createScrapeContext({
  cookies = [{ name: "web_session", value: "session-token" }],
  page = createScrapePage(),
}: {
  cookies?: Array<{ name: string; value: string }>;
  page?: ReturnType<typeof createScrapePage>;
} = {}) {
  return {
    cookies: vi.fn(async () => cookies),
    close: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
  };
}

describe("XiaohongshuProvider", () => {
  it("name 为 'xiaohongshu'", () => {
    expect(new XiaohongshuProvider().name).toBe("xiaohongshu");
  });

  it("复用 WU-5 的持久化 profile 以 headless 浏览器抓取，结束后关闭上下文", async () => {
    const context = createScrapeContext();
    const launch = vi.fn(async () => context);
    const provider = new XiaohongshuProvider({ launchPersistentContext: launch });

    await provider.fetch();

    expect(launch).toHaveBeenCalledWith(DEFAULT_XHS_PROFILE_PATH, { headless: true });
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("登录态下抓取「发现」页并映射字段（主题名→title、排名→rank、热度→heat）", async () => {
    const page = createScrapePage();
    const context = createScrapeContext({ page });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    const topics = await provider.fetch();

    expect(page.goto).toHaveBeenCalledWith(XHS_EXPLORE_URL, { waitUntil: "domcontentloaded" });
    expect(page.waitForSelector).toHaveBeenCalledWith(".hot-item");
    expect(topics).toEqual(EXPECTED_TOPICS);
  });

  it("category 暂空（US-4 后置）", async () => {
    const context = createScrapeContext();
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    const topics = await provider.fetch();

    for (const topic of topics) {
      expect(topic.category).toBeUndefined();
    }
  });

  it("profile 无 web_session（未登录）时抛「需要登录」，不打开页面也不静默", async () => {
    const context = createScrapeContext({ cookies: [{ name: "webId", value: "browser-id" }] });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    await expect(provider.fetch()).rejects.toThrow("需要登录");
    await expect(provider.fetch()).rejects.toThrow(LoginRequiredError);
    expect(context.newPage).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it("页面返回 401（会话失效）时抛「需要登录」", async () => {
    const context = createScrapeContext({ page: createScrapePage({ status: 401 }) });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    await expect(provider.fetch()).rejects.toThrow(LoginRequiredError);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("被跳转到登录页（会话失效）时抛「需要登录」", async () => {
    const context = createScrapeContext({
      page: createScrapePage({ url: "https://www.xiaohongshu.com/login?source=explore" }),
    });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    await expect(provider.fetch()).rejects.toThrow(LoginRequiredError);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("页面返回其他 4xx/5xx 时抛出带状态码的明确错误", async () => {
    const context = createScrapeContext({ page: createScrapePage({ status: 503 }) });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    await expect(provider.fetch()).rejects.toThrow("503");
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("页面解析不到任何热点条目时抛出明确错误，不静默返回空列表", async () => {
    const context = createScrapeContext({
      page: createScrapePage({ html: "<html><body>页面结构已变化</body></html>" }),
    });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });

    await expect(provider.fetch()).rejects.toThrow(/未从小红书页面解析到任何热点条目/);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("上下文关闭失败时记录日志，但不吞掉原始「需要登录」错误", async () => {
    const context = createScrapeContext({ cookies: [{ name: "webId", value: "browser-id" }] });
    context.close.mockImplementation(async () => {
      throw new Error("Target closed");
    });
    const provider = new XiaohongshuProvider({
      launchPersistentContext: vi.fn(async () => context),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(provider.fetch()).rejects.toThrow(LoginRequiredError);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("关闭小红书浏览器上下文失败"),
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("extractHotTopics", () => {
  it("映射主题名、排名、热度（万 / 亿换算），条目缺排名时按页面序号", () => {
    expect(extractHotTopics(FIXTURE_HTML)).toEqual(EXPECTED_TOPICS);
  });

  it("每条热点满足「热度或排名」至少其一", () => {
    for (const topic of extractHotTopics(FIXTURE_HTML)) {
      expect(topic.rank != null || topic.heat != null).toBe(true);
    }
  });

  it("解析不到任何条目时抛出明确错误", () => {
    expect(() => extractHotTopics("<html><body></body></html>")).toThrow(
      /未从小红书页面解析到任何热点条目/,
    );
  });
});

describe("parseHeat", () => {
  it.each([
    ["482.3万", 4823000],
    ["1.2亿", 120000000],
    ["320000", 320000],
    ["1,234,567", 1234567],
    ["", undefined],
    ["热度上升", undefined],
  ])("把 %j 解析为 %s", (text, expected) => {
    expect(parseHeat(text)).toBe(expected);
  });
});
