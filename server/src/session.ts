import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";

/** 小红书登录态 cookie 名。 */
const SESSION_COOKIE_NAME = "web_session";
/** 小红书「发现」页：未登录时展示登录入口，登录后展示热搜列表（登录入口与真实热点抓取共用）。 */
export const XHS_EXPLORE_URL = "https://www.xiaohongshu.com/explore";

/** profile 中是否存在有效的 web_session cookie（登录入口与真实热点抓取共用此判定）。 */
export function hasWebSessionCookie(cookies: Array<{ name: string; value: string }>): boolean {
  return cookies.some(
    (cookie) => cookie.name === SESSION_COOKIE_NAME && cookie.value.length > 0,
  );
}

export const DEFAULT_XHS_PROFILE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/xhs-profile",
);

interface SessionContext {
  cookies(): Promise<Array<{ name: string; value: string }>>;
  close(): Promise<void>;
  newPage(): Promise<{ goto(url: string): Promise<unknown> }>;
  once(event: "close", listener: () => void): void;
}

interface SessionManagerOptions {
  profilePath?: string;
  launchPersistentContext?: (
    userDataDir: string,
    options: { headless: boolean },
  ) => Promise<SessionContext>;
}

export interface XhsSessionManager {
  isLoggedIn(): Promise<boolean>;
  openLogin(): Promise<void>;
}

function launchContext(userDataDir: string, options: { headless: boolean }): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, options);
}

/** 管理小红书手动登录与持久化浏览器会话。 */
export function createXhsSessionManager({
  profilePath = DEFAULT_XHS_PROFILE_PATH,
  launchPersistentContext = launchContext,
}: SessionManagerOptions = {}): XhsSessionManager {
  async function openContext(headless: boolean): Promise<SessionContext> {
    mkdirSync(profilePath, { recursive: true });
    return launchPersistentContext(profilePath, { headless });
  }

  let loginStatusCheck: Promise<boolean> | undefined;

  function isLoggedIn(): Promise<boolean> {
    if (loginStatusCheck) return loginStatusCheck;

    const currentCheck = (async (): Promise<boolean> => {
      const context = await openContext(true);
      try {
        return hasWebSessionCookie(await context.cookies());
      } finally {
        await context.close();
      }
    })();
    loginStatusCheck = currentCheck;
    void currentCheck.then(
      () => {
        if (loginStatusCheck === currentCheck) loginStatusCheck = undefined;
      },
      () => {
        if (loginStatusCheck === currentCheck) loginStatusCheck = undefined;
      },
    );
    return currentCheck;
  }

  return {
    isLoggedIn,

    async openLogin(): Promise<void> {
      const context = await openContext(false);
      try {
        const closed = new Promise<void>((resolveClose) => context.once("close", resolveClose));
        const page = await context.newPage();
        await page.goto(XHS_EXPLORE_URL);
        await closed;
      } catch (error: unknown) {
        await context.close();
        throw error;
      }
    },
  };
}
