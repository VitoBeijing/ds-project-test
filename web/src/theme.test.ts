import { describe, expect, it } from "vitest";
import { buildContentClusters, formatPublishedAt, type ThemeNote } from "./theme";

function note(overrides: Partial<ThemeNote> & { feedId: string }): ThemeNote {
  return {
    id: 1,
    themeId: 1,
    title: "标题",
    author: "作者",
    likeCount: 0,
    collectCount: 0,
    commentCount: 0,
    tags: [],
    publishedAt: null,
    url: null,
    ...overrides,
  };
}

describe("buildContentClusters", () => {
  it("按标签建簇，多标签笔记同时出现在多个簇中", () => {
    const notes = [
      note({ id: 1, feedId: "f1", tags: ["通勤", "春日"] }),
      note({ id: 2, feedId: "f2", tags: ["通勤"] }),
      note({ id: 3, feedId: "f3", tags: ["春日"] }),
    ];

    const clusters = buildContentClusters(notes);

    expect(clusters).toEqual([
      { label: "通勤", notes: [notes[0], notes[1]] },
      { label: "春日", notes: [notes[0], notes[2]] },
    ]);
  });

  it("无标签（或全为空白）的笔记归入「其他」簇", () => {
    const notes = [
      note({ id: 1, feedId: "f1", tags: [] }),
      note({ id: 2, feedId: "f2", tags: ["  "] }),
    ];

    const clusters = buildContentClusters(notes);

    expect(clusters).toEqual([{ label: "其他", notes: [notes[0], notes[1]] }]);
  });

  it("同一簇内按 feedId 去重", () => {
    const notes = [note({ id: 1, feedId: "f1", tags: ["通勤", "通勤"] })];

    const clusters = buildContentClusters(notes);

    expect(clusters[0].notes).toHaveLength(1);
  });

  it("没有笔记时返回空数组", () => {
    expect(buildContentClusters([])).toEqual([]);
  });
});

describe("formatPublishedAt", () => {
  it("把 ISO 时间格式化为中文日期", () => {
    expect(formatPublishedAt("2026-11-07T08:00:00.000Z")).toMatch(/2026/);
    expect(formatPublishedAt("2026-11-07T08:00:00.000Z")).toMatch(/11/);
  });

  it("空值返回占位文案", () => {
    expect(formatPublishedAt(null)).toBe("发布时间未知");
  });

  it("非法时间返回占位文案", () => {
    expect(formatPublishedAt("not-a-date")).toBe("发布时间未知");
  });
});
