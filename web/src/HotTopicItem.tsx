import type { HotTopic } from "./topics";

interface HotTopicItemProps {
  topic: HotTopic;
  position: number;
}

function formatFetchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function HotTopicItem({ topic, position }: HotTopicItemProps) {
  return (
    <li className="topic-row">
      <span className="topic-rank" aria-label={`排名 ${topic.rank ?? position}`}>
        {topic.rank ?? String(position).padStart(2, "0")}
      </span>
      <div className="topic-copy">
        <h3>{topic.title}</h3>
        <p>
          <span>{topic.heat !== null ? `热度 ${topic.heat.toLocaleString("zh-CN")}` : "热度暂缺"}</span>
          <span aria-hidden="true"> · </span>
          <span>更新于 {formatFetchedAt(topic.fetchedAt)}</span>
        </p>
      </div>
      <span className="topic-mark" aria-hidden="true">↗</span>
    </li>
  );
}
