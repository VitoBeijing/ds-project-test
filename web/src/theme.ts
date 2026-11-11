/** 主题深挖前端模型与工具（对应 server/src/theme-api.ts 四个端点）。 */

/** GET /api/mcp/status 响应。 */
export interface McpStatus {
  source: string;
  loggedIn: boolean;
  username?: string;
}

/** GET /api/mcp/login-qrcode 响应：未登录带图片 data URL，已登录只有登录态。 */
export interface LoginQrcodeResponse {
  loggedIn: boolean;
  image?: string;
}

/** POST /api/themes/collect 成功响应。 */
export interface CollectResponse {
  themeId: number;
}

/** 深度报告里的内容簇概览（cluster_summary）。 */
export interface ClusterSummary {
  label: string;
  noteCount: number;
}

/** GET /api/themes/:id/notes 的内容条目。 */
export interface ThemeNote {
  id: number;
  themeId: number;
  feedId: string;
  title: string;
  author: string | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  tags: string[];
  publishedAt: string | null;
  url: string | null;
}

/** GET /api/themes/:id/notes 响应。 */
export interface ThemeNotesResponse {
  themeId: number;
  keyword: string;
  notes: ThemeNote[];
}

/** 高价值内容清单条目（high_value_notes）。 */
export interface HighValueNote {
  feedId: string;
  title: string;
  author: string | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  score: number;
  tags: string[];
  publishedAt: string | null;
  url: string | null;
}

/** GET /api/themes/:id/report 响应。 */
export interface ThemeReportResponse {
  themeId: number;
  keyword: string;
  cluster_summary: ClusterSummary[];
  high_value_notes: HighValueNote[];
  conclusion: string;
}

/** 内容条目展示所需的最小字段集；ThemeNote / HighValueNote 都可满足。 */
export interface NoteLike {
  title: string;
  author: string | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  publishedAt: string | null;
  url: string | null;
  score?: number;
}

/** 内容簇：簇名 + 簇内内容条目。 */
export interface ContentClusterModel {
  label: string;
  notes: ThemeNote[];
}

/** 无标签笔记归入的内容簇名称（与 server/src/theme.ts 保持一致）。 */
export const UNTAGGED_CLUSTER_LABEL = "其他";

/** HTTP 错误：携带状态码，供登录态（401）与其它错误区分。 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ErrorBody {
  error?: unknown;
}

/** 请求 JSON 接口；非 2xx 时解析 `{ error }` 并抛出 ApiError。 */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(path, init) : await fetch(path);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = (body as ErrorBody | null)?.error;
    throw new ApiError(typeof message === "string" ? message : "请求失败，请稍后重试。", response.status);
  }
  return body as T;
}

/** 按笔记 tags 构建内容簇（与 server/src/theme.ts buildClusters 逻辑一致）。 */
export function buildContentClusters(notes: readonly ThemeNote[]): ContentClusterModel[] {
  const clusters = new Map<string, ThemeNote[]>();
  for (const note of notes) {
    const labels = note.tags.map((tag) => tag.trim()).filter((tag) => tag !== "");
    const effectiveLabels = labels.length > 0 ? labels : [UNTAGGED_CLUSTER_LABEL];
    for (const label of effectiveLabels) {
      const clusterNotes = clusters.get(label) ?? [];
      if (!clusterNotes.some((item) => item.feedId === note.feedId)) clusterNotes.push(note);
      clusters.set(label, clusterNotes);
    }
  }
  return [...clusters.entries()].map(([label, notes]) => ({ label, notes }));
}

/** 发布时间展示：ISO 字符串 → 中文日期；空值或非法返回占位文案。 */
export function formatPublishedAt(value: string | null): string {
  if (!value) return "发布时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "发布时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
