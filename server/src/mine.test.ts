import { describe, expect, it } from "vitest";
import { DEFAULT_TOP_N, rankHighValueNotes, scoreHighValue } from "./mine.js";
import type { NewNote } from "./theme-store.js";

function note(overrides: Partial<NewNote> = {}): NewNote {
  return {
    feedId: "feed-a",
    title: "笔记 a",
    likeCount: 100,
    collectCount: 50,
    commentCount: 10,
    tags: ["通勤穿搭"],
    url: "https://www.xiaohongshu.com/explore/feed-a",
    ...overrides,
  };
}

describe("scoreHighValue", () => {
  it("按点赞×1 + 收藏×2 + 评论×3 加权", () => {
    expect(scoreHighValue({ likeCount: 100, collectCount: 50, commentCount: 10 })).toBe(230);
  });

  it("收藏权重高于点赞，评论权重最高", () => {
    const like = scoreHighValue({ likeCount: 1, collectCount: 0, commentCount: 0 });
    const collect = scoreHighValue({ likeCount: 0, collectCount: 1, commentCount: 0 });
    const comment = scoreHighValue({ likeCount: 0, collectCount: 0, commentCount: 1 });
    expect(like).toBe(1);
    expect(collect).toBe(2);
    expect(comment).toBe(3);
  });

  it("零互动记 0 分", () => {
    expect(scoreHighValue({ likeCount: 0, collectCount: 0, commentCount: 0 })).toBe(0);
  });
});

describe("rankHighValueNotes", () => {
  it("按加权 score 降序排序并保留 score 字段", () => {
    const ranked = rankHighValueNotes([
      note({ feedId: "low", likeCount: 1, collectCount: 0, commentCount: 0 }),
      note({ feedId: "high", likeCount: 0, collectCount: 0, commentCount: 10 }),
      note({ feedId: "mid", likeCount: 0, collectCount: 5, commentCount: 0 }),
    ]);

    expect(ranked.map((item) => item.feedId)).toEqual(["high", "mid", "low"]);
    expect(ranked.map((item) => item.score)).toEqual([30, 10, 1]);
  });

  it("默认取 top 10", () => {
    expect(DEFAULT_TOP_N).toBe(10);
    const notes = Array.from({ length: 15 }, (_, index) =>
      note({ feedId: `feed-${index}`, likeCount: index }),
    );
    expect(rankHighValueNotes(notes)).toHaveLength(10);
  });

  it("topN 可调，只返回前 N 条", () => {
    const notes = Array.from({ length: 5 }, (_, index) =>
      note({ feedId: `feed-${index}`, likeCount: index }),
    );
    expect(rankHighValueNotes(notes, 2).map((item) => item.feedId)).toEqual([
      "feed-4",
      "feed-3",
    ]);
  });

  it("topN 传 0 返回空数组（合法空态）", () => {
    expect(rankHighValueNotes([note()], 0)).toEqual([]);
  });

  it("笔记不足 topN 时全量返回", () => {
    const ranked = rankHighValueNotes([note()], 5);
    expect(ranked).toHaveLength(1);
  });

  it("空笔记返回空数组", () => {
    expect(rankHighValueNotes([])).toEqual([]);
  });

  it("topN 非法时抛错", () => {
    expect(() => rankHighValueNotes([note()], -1)).toThrow(/非负整数/);
    expect(() => rankHighValueNotes([note()], 1.5)).toThrow(/非负整数/);
  });
});
