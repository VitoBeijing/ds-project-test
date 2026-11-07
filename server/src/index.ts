import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPort, readRefreshIntervalMinutes } from "./config.js";
import { createApi } from "./api.js";
import { FixtureProvider } from "./provider.js";
import { startScheduler } from "./scheduler.js";
import { createHotTopicService } from "./service.js";
import { createStore, openDb } from "./store.js";

const port = readPort(process.env.PORT);
const intervalMinutes = readRefreshIntervalMinutes(process.env.REFRESH_INTERVAL_MINUTES);
const defaultDatabasePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/topics.db",
);
const databasePath = process.env.DATABASE_PATH ?? defaultDatabasePath;
mkdirSync(dirname(databasePath), { recursive: true });
const db = openDb(databasePath);
const store = createStore(db);
const service = createHotTopicService(new FixtureProvider(), store);
const stopScheduler = startScheduler(service.refresh, intervalMinutes);
const server = createApi(service, store).listen(port, "127.0.0.1", () => {
  process.stdout.write(`热点获取 API 已启动：http://localhost:${port}\n`);
});

let isShuttingDown = false;
function shutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  void Promise.allSettled([stopScheduler(), serverClosed]).then((results) => {
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      console.error("关闭热点获取服务失败", failures);
      process.exitCode = 1;
    }
    db.close();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
