import { describe, expect, it, vi } from "vitest";
import { createStore, openDb } from "./store.js";
import { LoginRequiredError } from "./provider.js";
import { createHotTopicService } from "./service.js";

describe("hot topic service", () => {
  it("抓取、统一来源和时间戳后落库并返回最新列表", async () => {
    const store = createStore(openDb());
    const provider = {
      name: "test-source",
      fetch: vi.fn().mockResolvedValue([
        { title: "主题 A", rank: 1 },
        { title: "主题 B", heat: 900 },
      ]),
    };
    const now = vi.fn(() => new Date("2026-11-07T10:00:00.000Z"));
    const service = createHotTopicService({ provider, store, now });

    const result = await service.refresh();

    expect(provider.fetch).toHaveBeenCalledOnce();
    expect(result.fetchedAt).toBe("2026-11-07T10:00:00.000Z");
    expect(result.topics).toHaveLength(2);
    expect(result.topics[0]).toMatchObject({
      title: "主题 A",
      source: "test-source",
      fetchedAt: result.fetchedAt,
    });
  });

  it("并发刷新共用一次抓取，避免较旧结果覆盖新结果", async () => {
    let finishFetch: ((topics: { title: string; rank: number }[]) => void) | undefined;
    const provider = {
      name: "test-source",
      fetch: vi.fn(
        () =>
          new Promise<{ title: string; rank: number }[]>((resolve) => {
            finishFetch = resolve;
          }),
      ),
    };
    const store = createStore(openDb());
    const service = createHotTopicService({ provider, store });
    const firstRefresh = service.refresh();
    const concurrentRefresh = service.refresh();

    expect(provider.fetch).toHaveBeenCalledOnce();
    finishFetch?.([{ title: "最新主题", rank: 1 }]);
    const [firstResult, concurrentResult] = await Promise.all([firstRefresh, concurrentRefresh]);
    expect(firstResult).toEqual(concurrentResult);
    expect(store.listLatest().topics.map((topic) => topic.title)).toEqual(["最新主题"]);
  });

  it("空抓取会清除旧列表并返回空态", async () => {
    const store = createStore(openDb());
    store.saveTopics("test-source", [{ title: "旧主题", rank: 1 }], "2026-11-07T09:00:00.000Z");
    const service = createHotTopicService({
      provider: { name: "test-source", fetch: vi.fn().mockResolvedValue([]) },
      store,
    });

    const result = await service.refresh();

    expect(result).toEqual({ topics: [], fetchedAt: null });
    expect(store.listLatest()).toEqual({ topics: [], fetchedAt: null });
  });

  it("抓取失败时拒绝并保留已存列表", async () => {
    const store = createStore(openDb());
    store.saveTopics("test-source", [{ title: "旧主题", rank: 1 }], "2026-11-07T09:00:00.000Z");
    const service = createHotTopicService({
      provider: { name: "test-source", fetch: vi.fn().mockRejectedValue(new Error("source down")) },
      store,
    });

    await expect(service.refresh()).rejects.toThrow("source down");
    expect(store.listLatest().topics.map((topic) => topic.title)).toEqual(["旧主题"]);
  });

  it("主源非登录类失败时降级到 fallback，并按 fallback 来源落库（不用样例冒充真实数据）", async () => {
    const store = createStore(openDb());
    const fallback = {
      name: "fixture",
      fetch: vi.fn().mockResolvedValue([{ title: "样例主题", rank: 1 }]),
    };
    const provider = {
      name: "xiaohongshu",
      fetch: vi.fn().mockRejectedValue(new Error("页面结构变化")),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createHotTopicService({ provider, fallback, store });

    try {
      const result = await service.refresh();

      expect(result.topics[0]).toMatchObject({ title: "样例主题", source: "fixture" });
      expect(fallback.fetch).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("降级"),
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("主源抛「需要登录」时不降级，错误直接抛出", async () => {
    const store = createStore(openDb());
    const fallback = {
      name: "fixture",
      fetch: vi.fn().mockResolvedValue([{ title: "样例主题", rank: 1 }]),
    };
    const provider = {
      name: "xiaohongshu",
      fetch: vi.fn().mockRejectedValue(new LoginRequiredError()),
    };
    const service = createHotTopicService({ provider, fallback, store });

    await expect(service.refresh()).rejects.toThrow("需要登录");
    expect(fallback.fetch).not.toHaveBeenCalled();
    expect(store.listLatest()).toEqual({ topics: [], fetchedAt: null });
  });

  it("未配置 fallback 时主源失败直接抛出", async () => {
    const store = createStore(openDb());
    const provider = {
      name: "xiaohongshu",
      fetch: vi.fn().mockRejectedValue(new Error("网络错误")),
    };
    const service = createHotTopicService({ provider, store });

    await expect(service.refresh()).rejects.toThrow("网络错误");
  });
});
