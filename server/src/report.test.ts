import { describe, expect, it } from "vitest";
import {
  buildClusterSummary,
  buildConclusion,
  buildThemeReport,
} from "./report.js";
import type { NewCluster, NewNote } from "./theme-store.js";

function note(feedId: string, tags: string[], counts: [number, number, number]): NewNote {
  const [likeCount, collectCount, commentCount] = counts;
  return {
    feedId,
    title: `笔记 ${feedId}`,
    author: "作者",
    likeCount,
    collectCount,
    commentCount,
    tags,
    url: `https://www.xiaohongshu.com/explore/${feedId}`,
  };
}

const NOTES: NewNote[] = [
  note("feed-a", ["通勤穿搭", "秋冬穿搭"], [12000, 678, 345]),
  note("feed-b", ["通勤穿搭"], [999, 80, 56]),
  note("feed-c", [], [5, 2, 1]),
];

const CLUSTERS: NewCluster[] = [
  { label: "通勤穿搭", feedIds: ["feed-a", "feed-b"] },
  { label: "秋冬穿搭", feedIds: ["feed-a"] },
  { label: "其他", feedIds: ["feed-c"] },
];

describe("buildClusterSummary", () => {
  it("把簇映射为 { label, noteCount }", () => {
    expect(buildClusterSummary(CLUSTERS)).toEqual([
      { label: "通勤穿搭", noteCount: 2 },
      { label: "秋冬穿搭", noteCount: 1 },
      { label: "其他", noteCount: 1 },
    ]);
  });

  it("空簇列表返回空数组", () => {
    expect(buildClusterSummary([])).toEqual([]);
  });
});

describe("buildConclusion", () => {
  it("规则生成最高互动簇 + 共同标签 + 平均互动量", () => {
    const highValueNotes = [
      { feedId: "feed-a", title: "a", author: "作者", likeCount: 12000, collectCount: 678, commentCount: 345, score: 14391, tags: ["通勤穿搭", "秋冬穿搭"], publishedAt: null, url: "https://www.xiaohongshu.com/explore/feed-a" },
      { feedId: "feed-b", title: "b", author: "作者", likeCount: 999, collectCount: 80, commentCount: 56, score: 1327, tags: ["通勤穿搭"], publishedAt: null, url: "https://www.xiaohongshu.com/explore/feed-b" },
    ];
    expect(buildConclusion(NOTES, highValueNotes, CLUSTERS)).toBe(
      "最高互动簇：通勤穿搭；高价值内容共同标签：通勤穿搭；平均互动量：4722.0",
    );
  });

  it("空笔记 / 空簇返回明确的「无」结论", () => {
    expect(buildConclusion([], [], [])).toBe(
      "最高互动簇：无；高价值内容共同标签：无；平均互动量：0.0",
    );
  });
});

describe("buildThemeReport", () => {
  it("组装簇概览 + 高价值清单（含 score）+ 结论", () => {
    const report = buildThemeReport(NOTES, CLUSTERS, 2);

    expect(report.clusterSummary).toEqual([
      { label: "通勤穿搭", noteCount: 2 },
      { label: "秋冬穿搭", noteCount: 1 },
      { label: "其他", noteCount: 1 },
    ]);
    expect(report.highValueNotes.map((item) => item.feedId)).toEqual(["feed-a", "feed-b"]);
    expect(report.highValueNotes[0]).toMatchObject({
      feedId: "feed-a",
      likeCount: 12000,
      collectCount: 678,
      commentCount: 345,
      score: 14391,
      tags: ["通勤穿搭", "秋冬穿搭"],
    });
    expect(report.conclusion).toBe(
      "最高互动簇：通勤穿搭；高价值内容共同标签：通勤穿搭；平均互动量：4722.0",
    );
  });

  it("空态报告：无簇、无高价值、结论为无", () => {
    const report = buildThemeReport([], []);
    expect(report).toEqual({
      clusterSummary: [],
      highValueNotes: [],
      conclusion: "最高互动簇：无；高价值内容共同标签：无；平均互动量：0.0",
    });
  });
});
