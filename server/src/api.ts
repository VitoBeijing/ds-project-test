import express, { type Express } from "express";
import type { HotTopicService } from "./service.js";
import type { TopicStore } from "./store.js";

export interface SourceStatusOptions {
  source: string;
  isLoggedIn: () => Promise<boolean>;
}

/** 创建热点获取 REST API。 */
export function createApi(
  service: HotTopicService,
  store: TopicStore,
  sourceStatus: SourceStatusOptions = { source: "fixture", isLoggedIn: async () => false },
): Express {
  const app = express();

  app.get("/api/hot-topics", (_request, response) => {
    response.json(store.listLatest());
  });

  app.get("/api/hot-topics/source", async (_request, response) => {
    let loggedIn = false;
    try {
      loggedIn = await sourceStatus.isLoggedIn();
    } catch (error: unknown) {
      console.error("检查小红书登录状态失败", error);
    }
    response.json({
      source: sourceStatus.source,
      loggedIn,
      lastFetchedAt: store.listLatest().fetchedAt,
    });
  });

  app.post("/api/hot-topics/refresh", async (_request, response) => {
    try {
      response.json(await service.refresh());
    } catch (error: unknown) {
      console.error("热点刷新失败", error);
      response.status(500).json({ error: "热点刷新失败" });
    }
  });

  return app;
}
