import { useCallback, useEffect, useRef, useState } from "react";
import { HotTopicList } from "./HotTopicList";
import { ManualRefreshButton } from "./ManualRefreshButton";
import type { LatestTopics } from "./topics";

const EMPTY_TOPICS: LatestTopics = { topics: [], fetchedAt: null };
const TOPICS_POLL_INTERVAL_MS = 60_000;

async function readTopics(path: string, init?: RequestInit): Promise<LatestTopics> {
  const response = init ? await fetch(path, init) : await fetch(path);
  if (!response.ok) throw new Error("热点暂时无法获取，请稍后重试。");
  return (await response.json()) as LatestTopics;
}

function formatLastUpdated(value: string | null): string {
  if (!value) return "尚未更新";
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

export default function App() {
  const [data, setData] = useState<LatestTopics>(EMPTY_TOPICS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const isRefreshingRef = useRef(false);
  const isLoadingTopicsRef = useRef(false);

  const loadTopics = useCallback(async () => {
    if (isLoadingTopicsRef.current) return;
    isLoadingTopicsRef.current = true;
    const requestId = ++latestRequest.current;
    setErrorMessage(null);
    try {
      const latest = await readTopics("/api/hot-topics");
      if (requestId === latestRequest.current) setData(latest);
    } catch (error: unknown) {
      if (requestId === latestRequest.current) {
        setErrorMessage(error instanceof Error ? error.message : "热点暂时无法获取，请稍后重试。");
      }
    } finally {
      isLoadingTopicsRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopics();
    const intervalId = window.setInterval(() => {
      if (!isRefreshingRef.current) void loadTopics();
    }, TOPICS_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadTopics]);

  const refreshTopics = async () => {
    const requestId = ++latestRequest.current;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setErrorMessage(null);
    try {
      const latest = await readTopics("/api/hot-topics/refresh", { method: "POST" });
      if (requestId === latestRequest.current) setData(latest);
    } catch (error: unknown) {
      if (requestId === latestRequest.current) {
        setErrorMessage(error instanceof Error ? error.message : "刷新失败，请稍后重试。");
      }
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  };

  const topicCount = String(data.topics.length).padStart(2, "0");

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="灵感采集首页">
          <span className="wordmark-icon" aria-hidden="true">采</span>
          <span>灵感采集<span className="wordmark-dot">.</span></span>
        </a>
        <span className="topbar-note">独立创作者的每日选题台</span>
        <span className="live-indicator"><i /> LIVE / 小红书</span>
      </header>

      <section className="hero" id="top" aria-labelledby="dashboard-title">
        <div className="hero-copy">
          <p className="eyebrow"><span>01</span> 热点获取 / DAILY PULSE</p>
          <h1 id="dashboard-title">热点<br /><em>看板</em></h1>
          <p className="hero-description">捕捉此刻正在发生的灵感。<br />从今天的热门话题，找到你的下一篇。</p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring orbit-ring-outer" />
          <div className="orbit-ring orbit-ring-inner" />
          <span className="orbit-star">✳</span>
          <span className="orbit-note">FIND<br />YOUR<br />ANGLE</span>
          <span className="orbit-coordinate">31°13′ N<br />121°28′ E</span>
        </div>
      </section>

      <section className="topics-section" aria-labelledby="topics-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TRENDING NOW <span className="heading-period">/ 今日趋势</span></p>
            <h2 id="topics-heading">正在升温的话题<span className="heading-count">{topicCount}</span></h2>
          </div>
          <ManualRefreshButton
            isRefreshing={isRefreshing}
            isDisabled={isLoading}
            onRefresh={() => void refreshTopics()}
          />
        </div>

        <div className="feed-meta">
          <span>主题 / 热度 / 更新时间</span>
          <span className="sr-only" role="status" aria-atomic="true">
            热点列表已更新，{data.topics.length} 个话题；更新时间 {data.fetchedAt ?? "未知"}
          </span>
          <span>最近更新　{formatLastUpdated(data.fetchedAt)}</span>
        </div>

        {errorMessage && (
          <div className="error-banner" role="alert">
            <span className="error-symbol" aria-hidden="true">!</span>
            <span>{errorMessage}</span>
            {!isLoading && (
              <button type="button" onClick={() => void loadTopics()}>重新加载</button>
            )}
          </div>
        )}

        {isLoading ? (
          <section className="list-state" aria-live="polite">
            <span className="state-index">正在同步 / SYNCING</span>
            <h2>正在寻找今日热点…</h2>
          </section>
        ) : (
          <HotTopicList topics={data.topics} />
        )}
        <footer className="feed-footer">
          <span>数据源 / Fixture</span>
          <span>{data.topics.length} 个主题已收录</span>
        </footer>
      </section>

      <footer className="page-footer">
        <span>每日灵感，从这里开始。</span>
        <span>DS BOT STUDIO　© 2026</span>
      </footer>
    </main>
  );
}
