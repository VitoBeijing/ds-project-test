import { describe, expect, it, vi } from "vitest";
import { createXhsSessionManager, DEFAULT_XHS_PROFILE_PATH } from "./session.js";

function createContext(cookies: Array<{ name: string; value: string }>) {
  return {
    cookies: vi.fn(async () => cookies),
    close: vi.fn(async () => undefined),
    newPage: vi.fn(async () => ({ goto: vi.fn(async () => undefined) })),
    on: vi.fn(),
  };
}

describe("Xiaohongshu session", () => {
  it("uses the persistent profile under server/data/xhs-profile", () => {
    expect(DEFAULT_XHS_PROFILE_PATH).toMatch(/server\/data\/xhs-profile$/);
  });

  it("recognizes an existing web_session cookie and closes the context", async () => {
    const context = createContext([{ name: "web_session", value: "session-token" }]);
    const launch = vi.fn(async () => context);
    const session = createXhsSessionManager({ launchPersistentContext: launch });

    await expect(session.isLoggedIn()).resolves.toBe(true);
    expect(launch).toHaveBeenCalledWith(DEFAULT_XHS_PROFILE_PATH, { headless: true });
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("returns false when the profile has no web_session cookie", async () => {
    const context = createContext([{ name: "webId", value: "browser-id" }]);
    const session = createXhsSessionManager({
      launchPersistentContext: vi.fn(async () => context),
    });

    await expect(session.isLoggedIn()).resolves.toBe(false);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("opens a headed browser at Xiaohongshu for manual login", async () => {
    const context = createContext([]);
    context.on.mockImplementation((_event, callback: () => void) => callback());
    const launch = vi.fn(async () => context);
    const session = createXhsSessionManager({ launchPersistentContext: launch });

    await session.openLogin();

    expect(launch).toHaveBeenCalledWith(DEFAULT_XHS_PROFILE_PATH, { headless: false });
    expect(context.newPage).toHaveBeenCalledOnce();
  });
});
