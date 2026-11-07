import { MAX_REFRESH_INTERVAL_MINUTES } from "./config.js";

const DEFAULT_INTERVAL_MINUTES = 60;

/** 立即运行一次后按分钟间隔运行；返回停止定时任务的函数。 */
export function startScheduler(
  refresh: () => Promise<unknown>,
  intervalMinutes = DEFAULT_INTERVAL_MINUTES,
  onError: (error: unknown) => void = (error) => console.error("热点自动刷新失败", error),
): () => Promise<void> {
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes <= 0 ||
    intervalMinutes > MAX_REFRESH_INTERVAL_MINUTES
  ) {
    throw new Error(
      `REFRESH_INTERVAL_MINUTES 必须大于 0 且不超过 ${MAX_REFRESH_INTERVAL_MINUTES}`,
    );
  }

  let currentRefresh: Promise<void> | undefined;
  const run = (): Promise<void> => {
    if (currentRefresh) return currentRefresh;
    currentRefresh = refresh()
      .then(() => undefined)
      .catch((error: unknown) => onError(error))
      .finally(() => {
        currentRefresh = undefined;
      });
    return currentRefresh;
  };

  void run();
  const timer = setInterval(() => void run(), intervalMinutes * 60 * 1000);
  return async () => {
    clearInterval(timer);
    await currentRefresh;
  };
}
