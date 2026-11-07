import express, { type Express } from "express";
import type { HotTopicService } from "./service.js";
import type { TopicStore } from "./store.js";

/** 创建热点获取 REST API。 */
export function createApi(service: HotTopicService, store: TopicStore): Express {
  const app = express();

  app.get("/api/hot-topics", (_request, response) => {
    response.json(store.listLatest());
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
