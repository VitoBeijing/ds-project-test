import type { ProviderTopic } from "./store.js";

/** 热点数据源适配接口。每个来源实现自己的抓取逻辑，返回原始热点列表（不含 fetchedAt/source，由 service 统一归一）。 */
export interface HotTopicProvider {
  readonly name: string;
  fetch(): Promise<ProviderTopic[]>;
}

/** 样例热点：数据形状合法、无外部依赖，用于在真实数据源接入前保证「列表非空 + 字段完整」可验收。 */
const FIXTURE_TOPICS: readonly ProviderTopic[] = [
  { title: "夏日穿搭", rank: 1, heat: 980000, category: "穿搭" },
  { title: "露营装备", heat: 500000, category: "户外" },
  { title: "咖啡探店", rank: 3, category: "美食" },
  { title: "通勤妆容", rank: 2, heat: 760000 },
  { title: "周末去哪儿", heat: 320000, category: "出行" },
];

/** 样例数据源：返回非空、字段合法的小红书主题热点。 */
export class FixtureProvider implements HotTopicProvider {
  readonly name = "fixture";

  async fetch(): Promise<ProviderTopic[]> {
    return FIXTURE_TOPICS.map((topic) => ({ ...topic }));
  }
}
