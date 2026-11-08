import type { HotTopic } from "./topics";
import { HotTopicItem } from "./HotTopicItem";

interface HotTopicListProps {
  topics: HotTopic[];
}

export function HotTopicList({ topics }: HotTopicListProps) {
  if (topics.length === 0) {
    return (
      <section className="list-state" aria-live="polite">
        <span className="state-index">00 / 等待信号</span>
        <h2>今天的灵感还在路上</h2>
        <p>暂时没有热点数据，请稍后重试或手动刷新。</p>
      </section>
    );
  }

  return (
    <ol className="topic-list" aria-label="热点列表">
      {topics.map((topic, index) => (
        <HotTopicItem key={topic.id} topic={topic} position={index + 1} />
      ))}
    </ol>
  );
}
