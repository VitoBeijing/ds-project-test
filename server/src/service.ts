import type { HotTopicProvider } from "./provider.js";
import type { LatestTopics, TopicStore } from "./store.js";

export interface HotTopicService {
  refresh(): Promise<LatestTopics>;
}

/** 抓取、统一 fetchedAt/source 并落库，供 API 与 scheduler 共用。 */
export function createHotTopicService(
  provider: HotTopicProvider,
  store: TopicStore,
  now: () => Date = () => new Date(),
): HotTopicService {
  let inFlight: Promise<LatestTopics> | undefined;
  const refresh = (): Promise<LatestTopics> => {
    if (inFlight) return inFlight;

    const currentRefresh = (async (): Promise<LatestTopics> => {
      const topics = await provider.fetch();
      const fetchedAt = now().toISOString();
      store.replaceTopics(provider.name, topics, fetchedAt);
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
