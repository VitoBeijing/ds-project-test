import { describe, expect, it } from "vitest";
import { readPort, readRefreshIntervalMinutes } from "./config.js";

describe("server config", () => {
  it("端口缺省时使用 3000", () => {
    expect(readPort(undefined)).toBe(3000);
  });

  it.each(["1.5", "0", "65536", "NaN"])("拒绝非法端口 %s", (value) => {
    expect(() => readPort(value)).toThrow(/PORT/);
  });

  it("刷新间隔缺省时使用 60 分钟", () => {
    expect(readRefreshIntervalMinutes(undefined)).toBe(60);
  });

  it.each(["0", "NaN", "35792"])("拒绝非法刷新间隔 %s", (value) => {
    expect(() => readRefreshIntervalMinutes(value)).toThrow(/REFRESH_INTERVAL_MINUTES/);
  });
});
