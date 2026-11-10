import type { Db } from "./store.js";

/** 主题状态（TECH_SPEC v3 themes.status）：收集中 / 完成 / 失败。 */
export type ThemeStatus = "collecting" | "done" | "failed";

/** 待落库笔记（由 theme 服务从检索摘要 + 详情合并而来）。title 必填。 */
export interface NewNote {
  readonly feedId: string;
  readonly title: string;
  readonly author?: string;
  readonly likeCount: number;
  readonly collectCount: number;
  readonly commentCount: number;
  readonly tags: string[];
  readonly publishedAt?: string;
  readonly url: string;
}

/** 待落库内容簇：label 为簇名（标签或「其他」），feedIds 必须都出现在同批笔记里。 */
export interface NewCluster {
  readonly label: string;
  readonly feedIds: string[];
}

/** themes 表记录。 */
export interface StoredTheme {
  readonly id: number;
  readonly keyword: string;
  readonly status: ThemeStatus;
  readonly createdAt: string;
}

/** notes 表记录（tags 已从 JSON 解析为数组）。 */
export interface StoredNote {
  readonly id: number;
  readonly themeId: number;
  readonly feedId: string;
  readonly title: string;
  readonly author: string | null;
  readonly likeCount: number;
  readonly collectCount: number;
  readonly commentCount: number;
  readonly tags: string[];
  readonly publishedAt: string | null;
  readonly url: string | null;
}

/** clusters 表记录，含簇内笔记 id（cluster_notes 关联）。 */
export interface StoredCluster {
  readonly id: number;
  readonly themeId: number;
  readonly label: string;
  readonly noteIds: number[];
}

export interface ThemeStore {
  /** 新建主题（status = collecting），返回自增 id。 */
  createTheme(keyword: string, createdAt: string): number;
  /** 更新主题状态；主题不存在时抛错，不静默。 */
  setThemeStatus(themeId: number, status: ThemeStatus): void;
  /** 读取主题；不存在返回 null。 */
  getTheme(themeId: number): StoredTheme | null;
  /**
   * 单事务写入一批笔记与内容簇：全部成功才落库，任一非法整批回滚。
   * 笔记校验 feedId / title 非空（title 必填）；簇校验簇名与笔记列表非空、
   * 同批簇名不重复、feedIds 都在本批笔记内且单簇内不重复。
   */
  saveNotesAndClusters(themeId: number, notes: NewNote[], clusters: NewCluster[]): void;
  /** 主题下的笔记（按写入顺序）；无数据返回空数组。 */
  listNotes(themeId: number): StoredNote[];
  /** 主题下的内容簇（按写入顺序），含簇内笔记 id；无数据返回空数组。 */
  listClusters(themeId: number): StoredCluster[];
}

/** 主题深挖四表（TECH_SPEC v3「数据结构」）。独立于旧 topics 模块，互不影响。 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS themes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT NOT NULL,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id      INTEGER NOT NULL REFERENCES themes(id),
  feed_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  author        TEXT,
  like_count    INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  tags          TEXT,
  published_at  TEXT,
  url           TEXT,
  UNIQUE (theme_id, feed_id)
);
CREATE TABLE IF NOT EXISTS clusters (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  label    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cluster_notes (
  cluster_id INTEGER NOT NULL REFERENCES clusters(id),
  note_id    INTEGER NOT NULL REFERENCES notes(id)
);
`;

interface ThemeRow {
  id: number;
  keyword: string;
  status: ThemeStatus;
  created_at: string;
}

interface NoteRow {
  id: number;
  theme_id: number;
  feed_id: string;
  title: string;
  author: string | null;
  like_count: number;
  collect_count: number;
  comment_count: number;
  tags: string | null;
  published_at: string | null;
  url: string | null;
}

/** clusters LEFT JOIN cluster_notes：无笔记的簇 note_id 为 null。 */
interface ClusterJoinRow {
  cluster_id: number;
  theme_id: number;
  label: string;
  note_id: number | null;
}

function assertNoteValid(note: NewNote): void {
  if (typeof note.feedId !== "string" || note.feedId.trim() === "") {
    throw new Error("笔记缺少 feedId（来自 search_feeds 结果）");
  }
  if (typeof note.title !== "string" || note.title.trim() === "") {
    throw new Error(`笔记 ${note.feedId} 缺少标题 title（必填字段）`);
  }
}

/** 簇级校验：簇名与笔记列表非空、同批簇名不重复、单簇内笔记不重复。 */
function assertClustersValid(clusters: NewCluster[]): void {
  const labels = new Set<string>();
  for (const cluster of clusters) {
    if (typeof cluster.label !== "string" || cluster.label.trim() === "") {
      throw new Error("内容簇缺少簇名 label");
    }
    if (cluster.feedIds.length === 0) {
      throw new Error(`内容簇「${cluster.label}」没有关联任何笔记`);
    }
    if (labels.has(cluster.label)) {
      throw new Error(`内容簇「${cluster.label}」在同一批里重复出现`);
    }
    labels.add(cluster.label);
    if (new Set(cluster.feedIds).size !== cluster.feedIds.length) {
      throw new Error(`内容簇「${cluster.label}」重复关联了同一笔记`);
    }
  }
}

/** notes.tags 列（JSON 数组文本）→ string[]；null 视作空数组，非法内容抛错不静默。 */
function parseTags(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`notes.tags 不是合法的 JSON 数组：${raw}`);
  }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) {
    throw new Error(`notes.tags 不是合法的 JSON 数组：${raw}`);
  }
  return parsed;
}

function toStoredTheme(row: ThemeRow): StoredTheme {
  return { id: row.id, keyword: row.keyword, status: row.status, createdAt: row.created_at };
}

function toStoredNote(row: NoteRow): StoredNote {
  return {
    id: row.id,
    themeId: row.theme_id,
    feedId: row.feed_id,
    title: row.title,
    author: row.author,
    likeCount: row.like_count,
    collectCount: row.collect_count,
    commentCount: row.comment_count,
    tags: parseTags(row.tags),
    publishedAt: row.published_at,
    url: row.url,
  };
}

/** 打开主题深挖四表（themes / notes / clusters / cluster_notes），已存在则跳过。 */
export function createThemeStore(db: Db): ThemeStore {
  db.exec(SCHEMA);

  const insertTheme = db.prepare(
    "INSERT INTO themes (keyword, status, created_at) VALUES (@keyword, 'collecting', @createdAt)",
  );
  const updateThemeStatus = db.prepare("UPDATE themes SET status = @status WHERE id = @id");
  const selectTheme = db.prepare<{ id: number }, ThemeRow>(
    "SELECT id, keyword, status, created_at FROM themes WHERE id = @id",
  );
  const insertNote = db.prepare(`
    INSERT INTO notes (
      theme_id, feed_id, title, author,
      like_count, collect_count, comment_count, tags, published_at, url
    ) VALUES (
      @themeId, @feedId, @title, @author,
      @likeCount, @collectCount, @commentCount, @tags, @publishedAt, @url
    )
  `);
  const selectNotes = db.prepare<{ themeId: number }, NoteRow>(`
    SELECT id, theme_id, feed_id, title, author,
      like_count, collect_count, comment_count, tags, published_at, url
    FROM notes
    WHERE theme_id = @themeId
    ORDER BY id ASC
  `);
  const insertCluster = db.prepare(
    "INSERT INTO clusters (theme_id, label) VALUES (@themeId, @label)",
  );
  const insertClusterNote = db.prepare(
    "INSERT INTO cluster_notes (cluster_id, note_id) VALUES (@clusterId, @noteId)",
  );
  const selectClusters = db.prepare<{ themeId: number }, ClusterJoinRow>(`
    SELECT c.id AS cluster_id, c.theme_id, c.label, cn.note_id
    FROM clusters c
    LEFT JOIN cluster_notes cn ON cn.cluster_id = c.id
    WHERE c.theme_id = @themeId
    ORDER BY c.id ASC, cn.note_id ASC
  `);

  const saveAll = db.transaction((themeId: number, notes: NewNote[], clusters: NewCluster[]) => {
    for (const note of notes) assertNoteValid(note);
    assertClustersValid(clusters);

    const noteIdsByFeedId = new Map<string, number>();
    for (const note of notes) {
      const info = insertNote.run({
        themeId,
        feedId: note.feedId,
        title: note.title,
        author: note.author ?? null,
        likeCount: note.likeCount,
        collectCount: note.collectCount,
        commentCount: note.commentCount,
        tags: JSON.stringify(note.tags),
        publishedAt: note.publishedAt ?? null,
        url: note.url,
      });
      noteIdsByFeedId.set(note.feedId, Number(info.lastInsertRowid));
    }
    for (const cluster of clusters) {
      const info = insertCluster.run({ themeId, label: cluster.label });
      const clusterId = Number(info.lastInsertRowid);
      for (const feedId of cluster.feedIds) {
        const noteId = noteIdsByFeedId.get(feedId);
        if (noteId === undefined) {
          throw new Error(`内容簇「${cluster.label}」引用了未落库的笔记：${feedId}`);
        }
        insertClusterNote.run({ clusterId, noteId });
      }
    }
  });

  return {
    createTheme(keyword, createdAt) {
      const trimmed = keyword.trim();
      if (trimmed === "") {
        throw new Error("主题关键词不能为空");
      }
      const info = insertTheme.run({ keyword: trimmed, createdAt });
      return Number(info.lastInsertRowid);
    },

    setThemeStatus(themeId, status) {
      const info = updateThemeStatus.run({ id: themeId, status });
      if (info.changes !== 1) {
        throw new Error(`主题 ${themeId} 不存在，无法更新状态为 ${status}`);
      }
    },

    getTheme(themeId) {
      const row = selectTheme.get({ id: themeId });
      return row === undefined ? null : toStoredTheme(row);
    },

    saveNotesAndClusters: (themeId, notes, clusters) => saveAll(themeId, notes, clusters),

    listNotes(themeId) {
      return selectNotes.all({ themeId }).map(toStoredNote);
    },

    listClusters(themeId) {
      const clusters: StoredCluster[] = [];
      for (const row of selectClusters.all({ themeId })) {
        const current = clusters[clusters.length - 1];
        if (current === undefined || current.id !== row.cluster_id) {
          clusters.push({ id: row.cluster_id, themeId: row.theme_id, label: row.label, noteIds: [] });
        }
        if (row.note_id !== null) {
          clusters[clusters.length - 1].noteIds.push(row.note_id);
        }
      }
      return clusters;
    },
  };
}
