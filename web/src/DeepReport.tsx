import type { ThemeReportResponse } from "./theme";

/** 「深度报告」：收集 + 挖掘的成果，含内容簇概览、高价值内容清单、挖掘结论。 */

interface DeepReportProps {
  report: ThemeReportResponse;
}

export function DeepReport({ report }: DeepReportProps) {
  return (
    <div className="deep-report">
      <section className="report-block" aria-labelledby="report-clusters">
        <h3 id="report-clusters">内容簇概览</h3>
        {report.cluster_summary.length === 0 ? (
          <p className="muted-note">暂无内容簇。</p>
        ) : (
          <ul className="cluster-summary-list">
            {report.cluster_summary.map((cluster) => (
              <li key={cluster.label}>
                <span>{cluster.label}</span>
                <span className="cluster-summary-count">{cluster.noteCount} 条</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="report-block" aria-labelledby="report-high-value">
        <h3 id="report-high-value">高价值内容清单</h3>
        {report.high_value_notes.length === 0 ? (
          <p className="muted-note">暂无高价值内容。</p>
        ) : (
          <ol className="report-high-value-list">
            {report.high_value_notes.map((note, index) => (
              <li key={note.feedId}>
                <span className="report-high-value-rank">{String(index + 1).padStart(2, "0")}</span>
                <div className="report-high-value-copy">
                  <h4>{note.title}</h4>
                  {note.url && (
                    <a href={note.url} target="_blank" rel="noreferrer">
                      查看原文 ↗
                    </a>
                  )}
                </div>
                <span className="report-high-value-score">
                  价值分 {note.score.toLocaleString("zh-CN")}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="report-block" aria-labelledby="report-conclusion">
        <h3 id="report-conclusion">挖掘结论</h3>
        <p className="report-conclusion">{report.conclusion}</p>
      </section>
    </div>
  );
}
