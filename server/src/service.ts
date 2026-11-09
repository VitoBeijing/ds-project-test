import { LoginRequiredError, type HotTopicProvider } from "./provider.js";
import type { LatestTopics, ProviderTopic, TopicStore } from "./store.js";

export interface HotTopicService {
  refresh(): Promise<LatestTopics>;
}

export interface HotTopicServiceOptions {
  /** 主数据源（真实热点源）。 */
  provider: HotTopicProvider;
  /** 降级数据源：主源非登录类失败时使用，落库保留自身 source（不用样例冒充真实数据）。 */
  fallback?: HotTopicProvider;
  store: TopicStore;
  now?: () => Date;
}

interface FetchedTopics {
  provider: HotTopicProvider;
  topics: ProviderTopic[];
}

/** 「需要登录」不降级（不静默、不用样例冒充）；其余失败降级到 fallback 并留下日志。 */
async function fetchWithFallback(
  provider: HotTopicProvider,
  fallback: HotTopicProvider | undefined,
): Promise<FetchedTopics> {
  try {
    return { provider, topics: await provider.fetch() };
  } catch (error) {
    if (error instanceof LoginRequiredError || fallback === undefined) {
      throw error;
    }
    console.error(
      `真实热点源「${provider.name}」抓取失败，降级使用「${fallback.name}」样例数据`,
      error,
    );
    return { provider: fallback, topics: await fallback.fetch() };
  }
}

/** 抓取、统一 fetchedAt/source 并落库，供 API 与 scheduler 共用；主源非登录类失败时降级到 fallback。 */
export function createHotTopicService({
  provider,
  fallback,
  store,
  now = () => new Date(),
}: HotTopicServiceOptions): HotTopicService {
  let inFlight: Promise<LatestTopics> | undefined;
  const refresh = (): Promise<LatestTopics> => {
    if (inFlight) return inFlight;

    const currentRefresh = (async (): Promise<LatestTopics> => {
      const { provider: activeProvider, topics } = await fetchWithFallback(provider, fallback);
      const fetchedAt = now().toISOString();
      store.replaceTopics(activeProvider.name, topics, fetchedAt);
      return store.listLatest();
    })();
    inFlight = currentRefresh;
    void currentRefresh.then(
      () => {
        if (inFlight === currentRefresh) inFlight = undefined;
      },
      () => {
        if (inFlight === currentRefresh) inFlight = undefined;
      },
    );
    return currentRefresh;
  };

  return { refresh };
}
