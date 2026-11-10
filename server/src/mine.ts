import type { HighValueNote, NewNote } from "./theme-store.js";

/** 高价值判定权重（TECH_SPEC v3「高价值内容挖掘」）：点赞×1 + 收藏×2 + 评论×3。 */
export const WEIGHT_LIKE = 1;
export const WEIGHT_COLLECT = 2;
export const WEIGHT_COMMENT = 3;

/** 高价值清单默认条数（top N，默认 10，可调）。 */
export const DEFAULT_TOP_N = 10;

/** 加权评分：score = like_count*1 + collect_count*2 + comment_count*3。 */
export function scoreHighValue(note: {
  readonly likeCount: number;
  readonly collectCount: number;
  readonly commentCount: number;
}): number {
  return (
    note.likeCount * WEIGHT_LIKE +
    note.collectCount * WEIGHT_COLLECT +
    note.commentCount * WEIGHT_COMMENT
  );
}

/** 按加权 score 降序从笔记中挑出 top N 条高价值内容。topN 传 0 返回空数组（合法空态）。 */
export function rankHighValueNotes(
  notes: readonly NewNote[],
  topN = DEFAULT_TOP_N,
): HighValueNote[] {
  if (!Number.isInteger(topN) || topN < 0) {
    throw new Error(`topN 需要非负整数：${topN}`);
  }

  return notes
    .map((note) => ({
      feedId: note.feedId,
      title: note.title,
      author: note.author ?? null,
      likeCount: note.likeCount,
      collectCount: note.collectCount,
      commentCount: note.commentCount,
      score: scoreHighValue(note),
      tags: note.tags,
      publishedAt: note.publishedAt ?? null,
      url: note.url,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topN);
}
