export interface HotTopic {
  id: number;
  title: string;
  rank: number | null;
  heat: number | null;
  category: string | null;
  source: string;
  fetchedAt: string;
}

export interface LatestTopics {
  topics: HotTopic[];
  fetchedAt: string | null;
}
