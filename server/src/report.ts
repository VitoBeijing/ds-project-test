import { DEFAULT_TOP_N, rankHighValueNotes, scoreHighValue } from "./mine.js";
import type {
  ClusterSummary,
  HighValueNote,
  NewCluster,
  NewNote,
  ThemeReport,
} from "./theme-store.js";

/** 内容簇概览：每个簇的名称（代表关键词）与条目数，与收集结果保持一致。 */
export function buildClusterSummary(clusters: readonly NewCluster[]): ClusterSummary[] {
  return clusters.map((cluster) => ({ label: cluster.label, noteCount: cluster.feedIds.length }));
}

/** 最高互动簇：簇内笔记加权 score 之和最大的簇名；无簇返回 undefined。 */
function pickHighestInteractionCluster(
  notes: readonly NewNote[],
  clusters: readonly NewCluster[],
): string | undefined {
  const scoreByFeedId = new Map(notes.map((note) => [note.feedId, scoreHighValue(note)]));
  let best: { label: string; total: number } | undefined;
  for (const cluster of clusters) {
    const total = cluster.feedIds.reduce(
      (sum, feedId) => sum + (scoreByFeedId.get(feedId) ?? 0),
      0,
    );
    if (best === undefined || total > best.total) {
      best = { label: cluster.label, total };
    }
  }
  return best?.label;
}

/** 高价值清单里所有笔记共有的标签（按首条笔记的顺序）；无清单返回空数组。 */
function commonTags(highValueNotes: readonly HighValueNote[]): string[] {
  const [first, ...rest] = highValueNotes;
  if (first === undefined) return [];
  return first.tags.filter((tag) => rest.every((note) => note.tags.includes(tag)));
}

/** 平均互动量：全部笔记（点赞 + 收藏 + 评论）总和的平均值；无笔记返回 0。 */
function averageInteraction(notes: readonly NewNote[]): number {
  if (notes.length === 0) return 0;
  const total = notes.reduce(
    (sum, note) => sum + note.likeCount + note.collectCount + note.commentCount,
    0,
  );
  return total / notes.length;
}

/**
 * 挖掘结论（规则生成，TECH_SPEC v3）：最高互动簇 + 高价值内容共同标签 + 平均互动量。
 * v1 用规则生成；后续可替换为 LLM 语义摘要，签名保持返回 string。
 */
export function buildConclusion(
  notes: readonly NewNote[],
  highValueNotes: readonly HighValueNote[],
  clusters: readonly NewCluster[],
): string {
  const topCluster = pickHighestInteractionCluster(notes, clusters);
  const tags = commonTags(highValueNotes);
  const average = averageInteraction(notes);
  return [
    `最高互动簇：${topCluster ?? "无"}`,
    `高价值内容共同标签：${tags.length > 0 ? tags.join("、") : "无"}`,
    `平均互动量：${average.toFixed(1)}`,
  ].join("；");
}

/** 组装主题深度报告：内容簇概览 + 高价值内容清单 + 挖掘结论。纯函数，输入在内存中。 */
export function buildThemeReport(
  notes: readonly NewNote[],
  clusters: readonly NewCluster[],
  topN = DEFAULT_TOP_N,
): ThemeReport {
  const highValueNotes = rankHighValueNotes(notes, topN);
  return {
    clusterSummary: buildClusterSummary(clusters),
    highValueNotes,
    conclusion: buildConclusion(notes, highValueNotes, clusters),
  };
}
