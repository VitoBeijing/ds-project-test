import type { NoteLike } from "./theme";
import { formatPublishedAt } from "./theme";

/** 「内容条目」：单条内容（笔记），展示标题、作者、互动数据、发布时间、原文链接。 */

interface ContentEntryProps {
  entry: NoteLike;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function ContentEntry({ entry }: ContentEntryProps) {
  return (
    <li className="content-entry">
      <div className="content-entry-head">
        <h4 className="content-entry-title">{entry.title}</h4>
        {entry.author && <span className="content-entry-author">@{entry.author}</span>}
      </div>
      <p className="content-entry-meta">
        <span>赞 {formatCount(entry.likeCount)}</span>
        <span aria-hidden="true">·</span>
        <span>藏 {formatCount(entry.collectCount)}</span>
        <span aria-hidden="true">·</span>
        <span>评 {formatCount(entry.commentCount)}</span>
        {entry.score !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <span className="content-entry-score">价值分 {formatCount(entry.score)}</span>
          </>
        )}
      </p>
      <div className="content-entry-foot">
        <span className="content-entry-time">{formatPublishedAt(entry.publishedAt)}</span>
        {entry.url ? (
          <a className="content-entry-link" href={entry.url} target="_blank" rel="noreferrer">
            查看原文 ↗
          </a>
        ) : (
          <span className="content-entry-link is-missing">原文链接缺失</span>
        )}
      </div>
    </li>
  );
}
