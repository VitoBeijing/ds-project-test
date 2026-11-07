import { afterEach, describe, expect, it, vi } from "vitest";
import { startScheduler } from "./scheduler.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduler", () => {
  it("启动时立即刷新，并默认每 60 分钟刷新一次", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startScheduler(refresh);

    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("按配置的分钟间隔刷新并可停止", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startScheduler(refresh, 5);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
