import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createStore, openDb, type Db, type TopicStore } from "./store.js";

const T1 = "2026-11-07T08:00:00.000Z";
const T2 = "2026-11-07T09:00:00.000Z";

describe("topics 表结构", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb();
  });

  it("包含 title / rank / heat / category / source / fetched_at 列", () => {
    const cols = (db.pragma("table_info(topics)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "title", "rank", "heat", "category", "source", "fetched_at"]),
    );
  });

  it("对同一个库文件重复 openDb 不报错，且已有数据保留", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-store-"));
    try {
      const file = join(dir, "test.db");
      const first = openDb(file);
      createStore(first).saveTopics("fixture", [{ title: "夏日穿搭", rank: 1 }], T1);
      first.close();

      const second = openDb(file);
      expect(createStore(second).listLatest().topics).toHaveLength(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("数据库层拒绝 rank 与 heat 同时为空", () => {
    expect(() =>
      db
        .prepare("INSERT INTO topics (title, source, fetched_at) VALUES ('x', 'fixture', ?)")
        .run(T1),
    ).toThrow();
  });

  it("数据库层拒绝重复的 (title, source)", () => {
    const ins = db.prepare(
      "INSERT INTO topics (title, rank, source, fetched_at) VALUES ('x', 1, 'fixture', ?)",
    );
    ins.run(T1);
    expect(() => ins.run(T2)).toThrow();
  });
});

describe("store", () => {
  let store: TopicStore;
  beforeEach(() => {
    store = createStore(openDb());
  });

  it("空态：没有数据时返回 { topics: [], fetchedAt: null }", () => {
    expect(store.listLatest()).toEqual({ topics: [], fetchedAt: null });
  });

  it("写入后可读回，每条含主题名、热度/排名、更新时间", () => {
    store.saveTopics(
      "fixture",
      [
        { title: "夏日穿搭", rank: 1, heat: 980000 },
        { title: "露营装备", heat: 500000 },
        { title: "咖啡探店", rank: 3 },
      ],
      T1,
    );

    const { topics, fetchedAt } = store.listLatest();
    expect(fetchedAt).toBe(T1);
    expect(topics).toHaveLength(3);
    for (const t of topics) {
      expect(t.title).toBeTruthy();
      expect(t.rank != null || t.heat != null).toBe(true);
      expect(t.fetchedAt).toBe(T1);
      expect(t.source).toBe("fixture");
    }
  });

  it("未提供的 rank / heat / category 以 null 返回", () => {
    store.saveTopics("fixture", [{ title: "夏日穿搭", rank: 1 }], T1);
    expect(store.listLatest().topics[0]).toMatchObject({
      title: "夏日穿搭",
      rank: 1,
      heat: null,
      category: null,
    });
  });

  it("按排名升序、无排名的在后并按热度降序", () => {
    store.saveTopics(
      "fixture",
      [
        { title: "C", heat: 100 },
        { title: "B", rank: 2 },
        { title: "A", rank: 1 },
        { title: "D", heat: 900 },
      ],
      T1,
    );
    expect(store.listLatest().topics.map((t) => t.title)).toEqual(["A", "B", "D", "C"]);
  });

  it("去重：同一 (title, source) 再次写入只更新，不新增行", () => {
    store.saveTopics("fixture", [{ title: "夏日穿搭", rank: 5, heat: 1 }], T1);
    store.saveTopics("fixture", [{ title: "夏日穿搭", rank: 1, heat: 999 }], T2);

    const { topics, fetchedAt } = store.listLatest();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ rank: 1, heat: 999, fetchedAt: T2 });
    expect(fetchedAt).toBe(T2);
  });

  it("同名主题来自不同 source 视为不同条目", () => {
    store.saveTopics("fixture", [{ title: "夏日穿搭", rank: 1 }], T1);
    store.saveTopics("other", [{ title: "夏日穿搭", rank: 2 }], T1);
    expect(store.listLatest().topics).toHaveLength(2);
  });

  it("只返回最近一次抓取的列表，更新时间取最新 fetched_at", () => {
    store.saveTopics("fixture", [{ title: "旧话题", rank: 1 }], T1);
    store.saveTopics("fixture", [{ title: "新话题", rank: 1 }], T2);

    const { topics, fetchedAt } = store.listLatest();
    expect(fetchedAt).toBe(T2);
    expect(topics.map((t) => t.title)).toEqual(["新话题"]);
  });

  it("保存 category（US-4 预留字段）", () => {
    store.saveTopics("fixture", [{ title: "夏日穿搭", rank: 1, category: "穿搭" }], T1);
    expect(store.listLatest().topics[0].category).toBe("穿搭");
  });

  it("rank 与 heat 都缺失时抛错，且整批回滚", () => {
    expect(() =>
      store.saveTopics("fixture", [{ title: "合法", rank: 1 }, { title: "非法" }], T1),
    ).toThrow(/rank 与 heat/);
    expect(store.listLatest()).toEqual({ topics: [], fetchedAt: null });
  });

  it("主题名为空时抛错", () => {
    expect(() => store.saveTopics("fixture", [{ title: "  ", rank: 1 }], T1)).toThrow(/title/);
  });

  it("写入空数组是空操作", () => {
    store.saveTopics("fixture", [], T1);
    expect(store.listLatest()).toEqual({ topics: [], fetchedAt: null });
  });
});
