import type { XhsFeedDetail, XhsSearchFeed } from "./xhs-mcp.js";
import { DEFAULT_TOP_N } from "./mine.js";
import { buildThemeReport } from "./report.js";
import type { ClusterSummary, NewCluster, NewNote, ThemeStore } from "./theme-store.js";

export type { ClusterSummary } from "./theme-store.js";

/** 每个主题默认检索的笔记数上限（PRD 未决问题#4 默认值：top 30）。 */
export const DEFAULT_SEARCH_LIMIT = 30;

/** 无标签笔记归入的内容簇名称。 */
export const UNTAGGED_CLUSTER_LABEL = "其他";

/** 数据源最小依赖：XhsMcpClient 的结构子集，单测注入离线 fixture（不依赖真实网络）。 */
export interface XhsDataSource {
  searchFeeds(keyword: string): Promise<XhsSearchFeed[]>;
  getFeedDetail(feedId: string, xsecToken: string): Promise<XhsFeedDetail>;
}

/** collectTheme 结果：noteCount 为 0 即「检索不到内容」的明确空态。 */
export interface CollectThemeResult {
  readonly themeId: number;
  readonly keyword: string;
  readonly noteCount: number;
  readonly clusters: ClusterSummary[];
}

export interface ThemeService {
  /** 收集一个主题：检索 → 补详情 → 落库（五表）→ 内容簇 → 高价值挖掘 + 报告。失败抛错并把主题标记为 failed。 */
  collectTheme(keyword: string): Promise<CollectThemeResult>;
}

export interface ThemeServiceOptions {
  source: XhsDataSource;
  store: ThemeStore;
  /** 检索规模上限，默认 30。 */
  searchLimit?: number;
  /** 高价值清单条数（top N），默认 10。 */
  topN?: number;
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

/** 从正文派生标题时的截断长度（约 40 字）。 */
const MAX_DERIVED_TITLE_LENGTH = 40;

/** 话题标记形如 `#标签#` 或 `#标签[话题]#`，派生标题时先剥离。 */
const TOPIC_TAG_PATTERN = /#([^#\[\]]+)(?:\[[^\]]*\])?#/g;

/**
 * 标题回退链：详情标题 → 检索摘要标题 → 从正文派生（剥离话题标记与换行后取首段并截断）。
 * 三者皆空返回 null，由 collectTheme 跳过该笔记，避免单条坏数据让整次收集失败。
 */
function toNote(detail: XhsFeedDetail, search: XhsSearchFeed): NewNote | null {
  const title = resolveTitle(detail, search);
  if (title === "") return null;
  return {
    feedId: detail.feedId,
    title,
    author: detail.author ?? search.author,
    likeCount: detail.likedCount,
    collectCount: detail.collectedCount,
    commentCount: detail.commentCount,
    tags: detail.tags,
    ...(detail.publishedAt !== undefined && { publishedAt: detail.publishedAt }),
    url: detail.link,
  };
}

/** 详情是权威数据；详情缺标题时回退检索摘要（先 trim），再回退正文派生。 */
function resolveTitle(detail: XhsFeedDetail, search: XhsSearchFeed): string {
  const detailTitle = detail.title.trim();
  if (detailTitle !== "") return detailTitle;
  const searchTitle = search.title.trim();
  if (searchTitle !== "") return searchTitle;
  return deriveTitleFromDesc(detail.desc);
}

/** 从正文派生标题：取首个非空段落，剥离话题标记，折叠空白后截断到约 40 字。 */
function deriveTitleFromDesc(desc?: string): string {
  if (desc === undefined) return "";
  const firstParagraph = desc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (firstParagraph === undefined) return "";
  const stripped = firstParagraph
    .replace(TOPIC_TAG_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped === "") return "";
  return stripped.length <= MAX_DERIVED_TITLE_LENGTH
    ? stripped
    : stripped.slice(0, MAX_DERIVED_TITLE_LENGTH);
}

/**
 * 主题收集服务（TECH_SPEC v3 WU-2 + WU-3）：关键词 → search_feeds 检索（top N，默认 30）
 * → get_feed_detail 补互动数据 → 落库（themes/notes/clusters/cluster_notes）
 * → 按 tags 构建内容簇 → 高价值挖掘 + 深度报告落库（reports）。检索不到返回 noteCount 0
 * 的明确空态；任一环节失败把主题标记为 failed 并原样抛错，不静默、不落半批数据。
 */
export function createThemeService({
  source,
  store,
  searchLimit = DEFAULT_SEARCH_LIMIT,
  topN = DEFAULT_TOP_N,
  now = () => new Date(),
}: ThemeServiceOptions): ThemeService {
  if (!Number.isInteger(searchLimit) || searchLimit <= 0) {
    throw new Error(`searchLimit 需要正整数：${searchLimit}`);
  }
  if (!Number.isInteger(topN) || topN <= 0) {
    throw new Error(`topN 需要正整数：${topN}`);
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
          const note = toNote(await source.getFeedDetail(feed.feedId, feed.xsecToken), feed);
          if (note === null) {
            console.warn(`跳过无标题笔记，feedId=${feed.feedId}`);
            continue;
          }
          notes.push(note);
        }
        const clusters = buildClusters(notes);
        const report = buildThemeReport(notes, clusters, topN);

        store.saveNotesAndClusters(themeId, notes, clusters);
        store.saveReport(themeId, report, now().toISOString());
        store.setThemeStatus(themeId, "done");

        return {
          themeId,
          keyword: trimmedKeyword,
          noteCount: notes.length,
          clusters: report.clusterSummary,
        };
      } catch (error) {
        store.setThemeStatus(themeId, "failed");
        throw error;
      }
    },
  };
}
