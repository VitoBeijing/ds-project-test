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
    await stop();
  });

  it("停止时等待正在运行的刷新完成", async () => {
    let finishRefresh: (() => void) | undefined;
    const refresh = vi.fn(
      () => new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
    );
    const stop = startScheduler(refresh);
    let isStopped = false;
    const stopping = stop().then(() => {
      isStopped = true;
    });

    expect(isStopped).toBe(false);
    finishRefresh?.();
    await stopping;
    expect(isStopped).toBe(true);
  });

  it("拒绝会溢出 Node 定时器上限的间隔", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    expect(() => startScheduler(refresh, 35_792)).toThrow(/REFRESH_INTERVAL_MINUTES/);
  });

  it("按配置的分钟间隔刷新并可停止", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startScheduler(refresh, 5);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await stop();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
