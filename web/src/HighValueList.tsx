import type { HighValueNote } from "./theme";
import { ContentEntry } from "./ContentEntry";

/** 「高价值内容列表」：挖掘出的高价值内容集合，深度报告的核心部分（PRD 命名表组件）。 */

interface HighValueListProps {
  notes: HighValueNote[];
}

export function HighValueList({ notes }: HighValueListProps) {
  if (notes.length === 0) {
    return <p className="muted-note">没有挖掘到高价值内容。</p>;
  }

  return (
    <ol className="high-value-list" aria-label="高价值内容列表">
      {notes.map((note) => (
        <ContentEntry key={note.feedId} entry={note} />
      ))}
    </ol>
  );
}
