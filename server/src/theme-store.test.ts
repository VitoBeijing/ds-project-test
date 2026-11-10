import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./store.js";
import { createThemeStore, type NewNote, type ThemeStore } from "./theme-store.js";

const CREATED_AT = "2026-11-10T08:00:00.000Z";

function note(overrides: Partial<NewNote> = {}): NewNote {
  return {
    feedId: "feed-a",
    title: "秋冬通勤穿搭灵感",
    author: "穿搭笔记",
    likeCount: 12000,
    collectCount: 678,
    commentCount: 345,
    tags: ["通勤穿搭"],
    publishedAt: "2025-11-01T08:00:00.000Z",
    url: "https://www.xiaohongshu.com/explore/feed-a",
    ...overrides,
  };
}

describe("themes / notes / clusters / cluster_notes 表结构", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb();
    createThemeStore(db);
  });

  it("themes 表包含 id / keyword / status / created_at", () => {
    const cols = (db.pragma("table_info(themes)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "keyword", "status", "created_at"]));
  });

  it("notes 表包含笔记全字段", () => {
    const cols = (db.pragma("table_info(notes)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "theme_id",
        "feed_id",
        "title",
        "author",
        "like_count",
        "collect_count",
        "comment_count",
        "tags",
        "published_at",
        "url",
      ]),
    );
  });

  it("clusters 表包含 id / theme_id / label，cluster_notes 表包含 cluster_id / note_id", () => {
    const clusterCols = (db.pragma("table_info(clusters)") as { name: string }[]).map((c) => c.name);
    expect(clusterCols).toEqual(expect.arrayContaining(["id", "theme_id", "label"]));
    const linkCols = (db.pragma("table_info(cluster_notes)") as { name: string }[]).map(
      (c) => c.name,
    );
    expect(linkCols).toEqual(expect.arrayContaining(["cluster_id", "note_id"]));
  });

  it("数据库层拒绝同一主题下重复的 feed_id", () => {
    const store = createThemeStore(db);
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    const insert = db.prepare(
      "INSERT INTO notes (theme_id, feed_id, title) VALUES (?, ?, '标题')",
    );
    insert.run(themeId, "feed-a");
    expect(() => insert.run(themeId, "feed-a")).toThrow();
  });

  it("对同一个库文件重复 createThemeStore 不报错，且已有数据保留", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-theme-store-"));
    try {
      const file = join(dir, "test.db");
      const first = openDb(file);
      const firstStore = createThemeStore(first);
      const themeId = firstStore.createTheme("通勤穿搭", CREATED_AT);
      firstStore.saveNotesAndClusters(themeId, [note()], [
        { label: "通勤穿搭", feedIds: ["feed-a"] },
      ]);
      first.close();

      const second = openDb(file);
      const secondStore = createThemeStore(second);
      expect(secondStore.listNotes(themeId)).toHaveLength(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("theme store", () => {
  let store: ThemeStore;
  beforeEach(() => {
    store = createThemeStore(openDb());
  });

  it("createTheme 新建 collecting 状态的主题并可读回", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(themeId).toBeGreaterThan(0);
    expect(store.getTheme(themeId)).toEqual({
      id: themeId,
      keyword: "通勤穿搭",
      status: "collecting",
      createdAt: CREATED_AT,
    });
  });

  it("createTheme 空关键词抛错", () => {
    expect(() => store.createTheme("  ", CREATED_AT)).toThrow(/关键词/);
  });

  it("getTheme 不存在时返回 null", () => {
    expect(store.getTheme(999)).toBeNull();
  });

  it("setThemeStatus 更新主题状态", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    store.setThemeStatus(themeId, "done");
    expect(store.getTheme(themeId)?.status).toBe("done");
  });

  it("setThemeStatus 主题不存在时抛错", () => {
    expect(() => store.setThemeStatus(999, "failed")).toThrow(/不存在/);
  });

  it("saveNotesAndClusters 落库后可读回笔记与簇", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    store.saveNotesAndClusters(
      themeId,
      [
        note(),
        note({
          feedId: "feed-b",
          title: "视频笔记",
          author: undefined,
          tags: [],
          publishedAt: undefined,
          url: "https://www.xiaohongshu.com/explore/feed-b",
        }),
      ],
      [
        { label: "通勤穿搭", feedIds: ["feed-a"] },
        { label: "其他", feedIds: ["feed-b"] },
      ],
    );

    const notes = store.listNotes(themeId);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({
      id: notes[0].id,
      themeId,
      feedId: "feed-a",
      title: "秋冬通勤穿搭灵感",
      author: "穿搭笔记",
      likeCount: 12000,
      collectCount: 678,
      commentCount: 345,
      tags: ["通勤穿搭"],
      publishedAt: "2025-11-01T08:00:00.000Z",
      url: "https://www.xiaohongshu.com/explore/feed-a",
    });
    expect(notes[1]).toMatchObject({ feedId: "feed-b", author: null, tags: [], publishedAt: null });

    const clusters = store.listClusters(themeId);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ themeId, label: "通勤穿搭" });
    expect(clusters[0].noteIds).toEqual([notes[0].id]);
    expect(clusters[1]).toMatchObject({ label: "其他" });
    expect(clusters[1].noteIds).toEqual([notes[1].id]);
  });

  it("同一笔记可属于多个簇（多标签）", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    store.saveNotesAndClusters(
      themeId,
      [note()],
      [
        { label: "通勤穿搭", feedIds: ["feed-a"] },
        { label: "秋冬穿搭", feedIds: ["feed-a"] },
      ],
    );

    const clusters = store.listClusters(themeId);
    expect(clusters.map((cluster) => cluster.label)).toEqual(["通勤穿搭", "秋冬穿搭"]);
    expect(clusters.every((cluster) => cluster.noteIds.length === 1)).toBe(true);
  });

  it("不同主题的笔记与簇相互隔离", () => {
    const themeA = store.createTheme("通勤穿搭", CREATED_AT);
    const themeB = store.createTheme("咖啡探店", CREATED_AT);
    store.saveNotesAndClusters(themeA, [note()], [{ label: "通勤穿搭", feedIds: ["feed-a"] }]);
    store.saveNotesAndClusters(
      themeB,
      [note({ feedId: "feed-x" })],
      [{ label: "咖啡探店", feedIds: ["feed-x"] }],
    );

    expect(store.listNotes(themeA).map((n) => n.feedId)).toEqual(["feed-a"]);
    expect(store.listNotes(themeB).map((n) => n.feedId)).toEqual(["feed-x"]);
  });

  it("空笔记 + 空簇是合法的空态写入", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    store.saveNotesAndClusters(themeId, [], []);
    expect(store.listNotes(themeId)).toEqual([]);
    expect(store.listClusters(themeId)).toEqual([]);
  });

  it("笔记缺少标题时抛错并整批回滚", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(
        themeId,
        [note(), note({ feedId: "feed-b", title: "  " })],
        [{ label: "通勤穿搭", feedIds: ["feed-a", "feed-b"] }],
      ),
    ).toThrow(/标题/);
    expect(store.listNotes(themeId)).toEqual([]);
    expect(store.listClusters(themeId)).toEqual([]);
  });

  it("笔记缺少 feedId 时抛错", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(themeId, [note({ feedId: "" })], []),
    ).toThrow(/feedId/);
  });

  it("簇引用本批之外的笔记时抛错并整批回滚", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(themeId, [note()], [
        { label: "通勤穿搭", feedIds: ["feed-a", "feed-unknown"] },
      ]),
    ).toThrow(/未落库/);
    expect(store.listNotes(themeId)).toEqual([]);
  });

  it("簇名为空时抛错", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(themeId, [note()], [{ label: " ", feedIds: ["feed-a"] }]),
    ).toThrow(/簇名/);
  });

  it("空簇（未关联任何笔记）抛错并整批回滚", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(themeId, [note()], [{ label: "通勤穿搭", feedIds: [] }]),
    ).toThrow(/没有关联任何笔记/);
    expect(store.listNotes(themeId)).toEqual([]);
  });

  it("同一批里簇名重复抛错", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(themeId, [note()], [
        { label: "通勤穿搭", feedIds: ["feed-a"] },
        { label: "通勤穿搭", feedIds: ["feed-a"] },
      ]),
    ).toThrow(/重复出现/);
  });

  it("单簇内重复关联同一笔记抛错", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    expect(() =>
      store.saveNotesAndClusters(themeId, [note()], [
        { label: "通勤穿搭", feedIds: ["feed-a", "feed-a"] },
      ]),
    ).toThrow(/重复关联/);
  });
});

describe("reports 表与报告存取", () => {
  let db: Db;
  let store: ThemeStore;
  beforeEach(() => {
    db = openDb();
    store = createThemeStore(db);
  });

  it("reports 表包含 theme_id / cluster_summary / high_value_notes / conclusion / generated_at", () => {
    const cols = (db.pragma("table_info(reports)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "theme_id",
        "cluster_summary",
        "high_value_notes",
        "conclusion",
        "generated_at",
      ]),
    );
  });

  it("saveReport 落库后可读回完整报告", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    store.saveReport(
      themeId,
      {
        clusterSummary: [{ label: "通勤穿搭", noteCount: 1 }],
        highValueNotes: [
          {
            feedId: "feed-a",
            title: "秋冬通勤穿搭灵感",
            author: "穿搭笔记",
            likeCount: 12000,
            collectCount: 678,
            commentCount: 345,
            score: 14391,
            tags: ["通勤穿搭"],
            publishedAt: "2025-11-01T08:00:00.000Z",
            url: "https://www.xiaohongshu.com/explore/feed-a",
          },
        ],
        conclusion: "最高互动簇：通勤穿搭；高价值内容共同标签：通勤穿搭；平均互动量：1.0",
      },
      "2026-11-10T08:00:00.000Z",
    );

    expect(store.getReport(themeId)).toEqual({
      themeId,
      clusterSummary: [{ label: "通勤穿搭", noteCount: 1 }],
      highValueNotes: [
        {
          feedId: "feed-a",
          title: "秋冬通勤穿搭灵感",
          author: "穿搭笔记",
          likeCount: 12000,
          collectCount: 678,
          commentCount: 345,
          score: 14391,
          tags: ["通勤穿搭"],
          publishedAt: "2025-11-01T08:00:00.000Z",
          url: "https://www.xiaohongshu.com/explore/feed-a",
        },
      ],
      conclusion: "最高互动簇：通勤穿搭；高价值内容共同标签：通勤穿搭；平均互动量：1.0",
      generatedAt: "2026-11-10T08:00:00.000Z",
    });
  });

  it("getReport 不存在时返回 null", () => {
    expect(store.getReport(999)).toBeNull();
  });

  it("saveReport 覆盖同一主题的旧报告", () => {
    const themeId = store.createTheme("通勤穿搭", CREATED_AT);
    store.saveReport(
      themeId,
      { clusterSummary: [], highValueNotes: [], conclusion: "旧" },
      CREATED_AT,
    );
    store.saveReport(
      themeId,
      { clusterSummary: [], highValueNotes: [], conclusion: "新" },
      CREATED_AT,
    );
    expect(store.getReport(themeId)?.conclusion).toBe("新");
  });
});
