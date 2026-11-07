import { describe, expect, it, vi } from "vitest";
import { createStore, openDb } from "./store.js";
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
    const service = createHotTopicService(provider, store, now);

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

  it("抓取失败时拒绝并保留已存列表", async () => {
    const store = createStore(openDb());
    store.saveTopics("test-source", [{ title: "旧主题", rank: 1 }], "2026-11-07T09:00:00.000Z");
    const service = createHotTopicService(
      { name: "test-source", fetch: vi.fn().mockRejectedValue(new Error("source down")) },
      store,
    );

    await expect(service.refresh()).rejects.toThrow("source down");
    expect(store.listLatest().topics.map((topic) => topic.title)).toEqual(["旧主题"]);
  });
});
