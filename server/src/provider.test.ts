import { describe, expect, it } from "vitest";
import { FixtureProvider } from "./provider.js";

describe("FixtureProvider", () => {
  it("name 为 'fixture'", () => {
    expect(new FixtureProvider().name).toBe("fixture");
  });

  it("fetch() 返回非空列表", async () => {
    const topics = await new FixtureProvider().fetch();
    expect(topics.length).toBeGreaterThan(0);
  });

  it("每条主题名非空，且 rank 与 heat 至少其一非空", async () => {
    const topics = await new FixtureProvider().fetch();
    for (const topic of topics) {
      expect(typeof topic.title).toBe("string");
      expect(topic.title.trim()).not.toBe("");
      expect(topic.rank != null || topic.heat != null).toBe(true);
    }
  });

  it("每次 fetch 返回新对象，调用方改动不影响后续结果", async () => {
    const provider = new FixtureProvider();
    const first = await provider.fetch();
    first[0].title = "";
    first.length = 0;

    const second = await provider.fetch();
    expect(second.length).toBeGreaterThan(0);
    expect(second[0].title.trim()).not.toBe("");
  });
});
