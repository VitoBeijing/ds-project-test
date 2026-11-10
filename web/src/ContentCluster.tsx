import type { ContentClusterModel } from "./theme";
import { ContentEntry } from "./ContentEntry";

/** 「内容簇」：主题下聚合的内容集合容器（PRD 命名表组件）。 */

interface ContentClusterProps {
  cluster: ContentClusterModel;
  index: number;
}

export function ContentCluster({ cluster, index }: ContentClusterProps) {
  return (
    <section className="content-cluster" aria-labelledby={`cluster-${index}`}>
      <header className="content-cluster-head">
        <h3 id={`cluster-${index}`}>{cluster.label}</h3>
        <span className="content-cluster-count">{cluster.notes.length} 条</span>
      </header>
      <ul className="content-entry-list" aria-label={`内容簇「${cluster.label}」`}>
        {cluster.notes.map((note) => (
          <ContentEntry key={note.id} entry={note} />
        ))}
      </ul>
    </section>
  );
}
