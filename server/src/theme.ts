import type { XhsFeedDetail, XhsSearchFeed } from "./xhs-mcp.js";
import type { NewCluster, NewNote, ThemeStore } from "./theme-store.js";

/** 每个主题默认检索的笔记数上限（PRD 未决问题#4 默认值：top 30）。 */
export const DEFAULT_SEARCH_LIMIT = 30;

/** 无标签笔记归入的内容簇名称。 */
export const UNTAGGED_CLUSTER_LABEL = "其他";

/** 数据源最小依赖：XhsMcpClient 的结构子集，单测注入离线 fixture（不依赖真实网络）。 */
export interface XhsDataSource {
  searchFeeds(keyword: string): Promise<XhsSearchFeed[]>;
  getFeedDetail(feedId: string, xsecToken: string): Promise<XhsFeedDetail>;
}

/** 内容簇概览（收集结果用）。 */
export interface ClusterSummary {
  readonly label: string;
  readonly noteCount: number;
}

/** collectTheme 结果：noteCount 为 0 即「检索不到内容」的明确空态。 */
export interface CollectThemeResult {
  readonly themeId: number;
  readonly keyword: string;
  readonly noteCount: number;
  readonly clusters: ClusterSummary[];
}

export interface ThemeService {
  /** 收集一个主题：检索 → 补详情 → 落库（四表）→ 内容簇。失败抛错并把主题标记为 failed。 */
  collectTheme(keyword: string): Promise<CollectThemeResult>;
}

export interface ThemeServiceOptions {
  source: XhsDataSource;
  store: ThemeStore;
  /** 检索规模上限，默认 30。 */
  searchLimit?: number;
  now?: () => Date;
}

/** 按笔记 tags 构建内容簇：每个标签一簇（按首次出现排序）；无标签（或全为空白）归「其他」簇。 */
export function buildClusters(notes: readonly NewNote[]): NewCluster[] {
  const clusters = new Map<string, string[]>();
  for (const note of notes) {
    const labels = note.tags.map((tag) => tag.trim()).filter((tag) => tag !== "");
    const effectiveLabels = labels.length > 0 ? labels : [UNTAGGED_CLUSTER_LABEL];
    for (const label of effectiveLabels) {
      const feedIds = clusters.get(label) ?? [];
      if (!feedIds.includes(note.feedId)) feedIds.push(note.feedId);
      clusters.set(label, feedIds);
    }
  }
  return [...clusters.entries()].map(([label, feedIds]) => ({ label, feedIds }));
}

/** 检索结果按 feedId 去重（保留首个，xsecToken 随首个），避免重复取详情与撞唯一键。 */
function dedupeByFeedId(feeds: readonly XhsSearchFeed[]): XhsSearchFeed[] {
  const seen = new Set<string>();
  const unique: XhsSearchFeed[] = [];
  for (const feed of feeds) {
    if (seen.has(feed.feedId)) continue;
    seen.add(feed.feedId);
    unique.push(feed);
  }
  return unique;
}

/** 详情是权威数据；详情缺标题（视频笔记常见）时回退检索摘要的 displayTitle，作者同理。 */
function toNote(detail: XhsFeedDetail, search: XhsSearchFeed): NewNote {
  return {
    feedId: detail.feedId,
    title: detail.title.trim() !== "" ? detail.title : search.title,
    author: detail.author ?? search.author,
    likeCount: detail.likedCount,
    collectCount: detail.collectedCount,
    commentCount: detail.commentCount,
    tags: detail.tags,
    ...(detail.publishedAt !== undefined && { publishedAt: detail.publishedAt }),
    url: detail.link,
  };
}

/**
 * 主题收集服务（TECH_SPEC v3 WU-2）：关键词 → search_feeds 检索（top N，默认 30）
 * → get_feed_detail 补互动数据 → 落库（themes/notes/clusters/cluster_notes）
 * → 按 tags 构建内容簇。检索不到返回 noteCount 0 的明确空态；任一环节失败把主题
 * 标记为 failed 并原样抛错，不静默、不落半批数据。
 */
export function createThemeService({
  source,
  store,
  searchLimit = DEFAULT_SEARCH_LIMIT,
  now = () => new Date(),
}: ThemeServiceOptions): ThemeService {
  if (!Number.isInteger(searchLimit) || searchLimit <= 0) {
    throw new Error(`searchLimit 需要正整数：${searchLimit}`);
  }

  return {
    async collectTheme(keyword: string): Promise<CollectThemeResult> {
      const trimmedKeyword = keyword.trim();
      if (trimmedKeyword === "") {
        throw new Error("collectTheme 需要非空主题关键词");
      }

      const themeId = store.createTheme(trimmedKeyword, now().toISOString());
      try {
        const feeds = dedupeByFeedId(await source.searchFeeds(trimmedKeyword)).slice(0, searchLimit);
        const notes: NewNote[] = [];
        for (const feed of feeds) {
          notes.push(toNote(await source.getFeedDetail(feed.feedId, feed.xsecToken), feed));
        }
        const clusters = buildClusters(notes);

        store.saveNotesAndClusters(themeId, notes, clusters);
        store.setThemeStatus(themeId, "done");

        return {
          themeId,
          keyword: trimmedKeyword,
          noteCount: notes.length,
          clusters: clusters.map((cluster) => ({
            label: cluster.label,
            noteCount: cluster.feedIds.length,
          })),
        };
      } catch (error) {
        store.setThemeStatus(themeId, "failed");
        throw error;
      }
    },
  };
}
