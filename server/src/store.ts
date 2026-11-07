import Database from "better-sqlite3";

/** 数据库连接类型，供上层模块（service / api）引用。 */
export type Db = Database.Database;

/** 原始热点，不含 fetchedAt / source（由 service 统一归一）。与 TECH_SPEC「Provider 适配层」一致。 */
export interface ProviderTopic {
  title: string;
  rank?: number;
  heat?: number;
  category?: string;
}

/** 热点条目（对外形态，对应 TECH_SPEC 的 Topic 响应）。 */
export interface Topic {
  id: number;
  title: string;
  rank: number | null;
  heat: number | null;
  category: string | null;
  source: string;
  /** 更新时间：本次抓取时间（ISO 8601）。 */
  fetchedAt: string;
}

export interface LatestTopics {
  topics: Topic[];
  /** 最近一次抓取时间；没有任何数据时为 null，前端据此显示空状态。 */
  fetchedAt: string | null;
}

export interface TopicStore {
  /**
   * 写入一批热点。同一 (title, source) 已存在时更新其 rank/heat/category/fetched_at，不产生重复行。
   * 每条热点的 rank 与 heat 至少其一非空，否则整批回滚并抛错。
   */
  saveTopics(source: string, topics: ProviderTopic[], fetchedAt: string): void;
  /** 返回最近一次抓取的热点列表（按排名升序、热度降序）；无数据返回 { topics: [], fetchedAt: null }。 */
  listLatest(): LatestTopics;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  rank        INTEGER,
  heat        INTEGER,
  category    TEXT,
  source      TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  UNIQUE (title, source),
  CHECK (rank IS NOT NULL OR heat IS NOT NULL)
);
`;

/** 打开数据库并确保 `topics` 表存在。path 默认为内存库（测试用）。 */
export function openDb(path = ":memory:"): Db {
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}

interface TopicRow {
  id: number;
  title: string;
  rank: number | null;
  heat: number | null;
  category: string | null;
  source: string;
  fetched_at: string;
}

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    title: row.title,
    rank: row.rank,
    heat: row.heat,
    category: row.category,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

function assertValid(topic: ProviderTopic): void {
  if (typeof topic.title !== "string" || topic.title.trim() === "") {
    throw new Error("热点缺少主题名 title");
  }
  if (topic.rank == null && topic.heat == null) {
    throw new Error(`热点「${topic.title}」的 rank 与 heat 至少需要其一`);
  }
}

export function createStore(db: Db): TopicStore {
  const upsert = db.prepare(`
    INSERT INTO topics (title, rank, heat, category, source, fetched_at)
    VALUES (@title, @rank, @heat, @category, @source, @fetchedAt)
    ON CONFLICT (title, source) DO UPDATE SET
      rank = excluded.rank,
      heat = excluded.heat,
      category = excluded.category,
      fetched_at = excluded.fetched_at
  `);

  const latest = db.prepare<[], TopicRow>(`
    SELECT id, title, rank, heat, category, source, fetched_at
    FROM topics
    WHERE fetched_at = (SELECT MAX(fetched_at) FROM topics)
    ORDER BY rank IS NULL, rank ASC, heat DESC, id ASC
  `);

  const saveAll = db.transaction(
    (source: string, topics: ProviderTopic[], fetchedAt: string) => {
      for (const topic of topics) {
        assertValid(topic);
        upsert.run({
          title: topic.title,
          rank: topic.rank ?? null,
          heat: topic.heat ?? null,
          category: topic.category ?? null,
          source,
          fetchedAt,
        });
      }
    },
  );

  return {
    saveTopics: (source, topics, fetchedAt) => saveAll(source, topics, fetchedAt),
    listLatest() {
      const rows = latest.all();
      if (rows.length === 0) return { topics: [], fetchedAt: null };
      return { topics: rows.map(toTopic), fetchedAt: rows[0].fetched_at };
    },
  };
}
