import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { createHotTopicService } from "./service.js";
import { createStore, openDb } from "./store.js";

async function withApi(
  run: (baseUrl: string) => Promise<void>,
  options?: { source: string; isLoggedIn: () => Promise<boolean> },
): Promise<void> {
  const db = openDb();
  const store = createStore(db);
  let fetchCount = 0;
  const service = createHotTopicService(
    {
      name: "fixture",
      fetch: async () => {
        fetchCount += 1;
        return [{ title: `主题 ${fetchCount}`, rank: fetchCount }];
      },
    },
    store,
    () => new Date(`2026-11-07T${String(8 + fetchCount).padStart(2, "0")}:00:00.000Z`),
  );
  const server = createServer(createApi(service, store, options));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API server did not start");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  }
}

describe("hot topics API", () => {
  it("GET source 返回当前数据源、登录状态和最近抓取时间", async () => {
    await withApi(async (baseUrl) => {
      await fetch(`${baseUrl}/api/hot-topics/refresh`, { method: "POST" });
      const response = await fetch(`${baseUrl}/api/hot-topics/source`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        source: "fixture",
        loggedIn: true,
        lastFetchedAt: "2026-11-07T09:00:00.000Z",
      });
    }, { source: "fixture", isLoggedIn: async () => true });
  });

  it("GET source 返回未登录状态", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hot-topics/source`);
      expect(await response.json()).toEqual({
        source: "xiaohongshu",
        loggedIn: false,
        lastFetchedAt: null,
      });
    }, { source: "xiaohongshu", isLoggedIn: async () => false });
  });

  it("空数据返回空列表和 null 更新时间", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hot-topics`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ topics: [], fetchedAt: null });
    });
  });

  it("GET 返回已存的最新列表", async () => {
    await withApi(async (baseUrl) => {
      await fetch(`${baseUrl}/api/hot-topics/refresh`, { method: "POST" });
      const response = await fetch(`${baseUrl}/api/hot-topics`);
      expect(await response.json()).toMatchObject({
        topics: [{ title: "主题 1" }],
        fetchedAt: "2026-11-07T09:00:00.000Z",
      });
    });
  });

  it("POST 刷新后返回新列表和更新的 fetchedAt", async () => {
    await withApi(async (baseUrl) => {
      await fetch(`${baseUrl}/api/hot-topics/refresh`, { method: "POST" });
      const response = await fetch(`${baseUrl}/api/hot-topics/refresh`, { method: "POST" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        topics: [{ title: "主题 2" }],
        fetchedAt: "2026-11-07T10:00:00.000Z",
      });
    });
  });
});
