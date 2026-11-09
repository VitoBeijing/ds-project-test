import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { LoginRequiredError, type HotTopicProvider } from "./provider.js";
import { DEFAULT_XHS_PROFILE_PATH, hasWebSessionCookie, XHS_EXPLORE_URL } from "./session.js";
import type { ProviderTopic } from "./store.js";

/** 会话失效时小红书会把请求重定向到登录页。 */
const LOGIN_URL_PATTERN = /\/login/i;

/** 与下方 HOT_ITEM_OPEN_TAG_SOURCE 对应的条目 CSS 选择器，用于等待页面渲染完成。 */
const HOT_ITEM_SELECTOR = ".hot-item";

/**
 * 选择器集中定义（TECH_SPEC：页面结构变化时只改这里）。
 * 条目块取「相邻两个 hot-item 开标签之间的内容」，避免条目内嵌套标签被提前截断；
 * 字段用标签名反向引用匹配同种闭标签，允许字段内嵌套高亮 / 图标等子元素。
 */
const HOT_ITEM_OPEN_TAG_SOURCE = String.raw`<div\b[^>]*\sclass="[^"]*\bhot-item(?![\w-])[^"]*"[^>]*>`;
const TITLE_PATTERN = /<(\w+)\b[^>]*\sclass="[^"]*\bhot-title(?![\w-])[^"]*"[^>]*>([\s\S]*?)<\/\1\s*>/i;
const RANK_PATTERN = /<(\w+)\b[^>]*\sclass="[^"]*\bhot-rank(?![\w-])[^"]*"[^>]*>([\s\S]*?)<\/\1\s*>/i;
const HEAT_PATTERN = /<(\w+)\b[^>]*\sclass="[^"]*\bhot-heat(?![\w-])[^"]*"[^>]*>([\s\S]*?)<\/\1\s*>/i;

const HEAT_TEXT_PATTERN = /^([\d.]+)([万亿])?$/;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

interface ScrapeResponse {
  status(): number;
}

interface ScrapePage {
  goto(url: string, options: { waitUntil: "domcontentloaded" }): Promise<ScrapeResponse | null>;
  waitForSelector(selector: string): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
}

interface ScrapeContext {
  cookies(): Promise<Array<{ name: string; value: string }>>;
  newPage(): Promise<ScrapePage>;
  close(): Promise<void>;
}

export interface XiaohongshuProviderOptions {
  /** 持久化登录 profile，与 WU-5 登录入口共用。 */
  profilePath?: string;
  launchPersistentContext?: (
    userDataDir: string,
    options: { headless: boolean },
  ) => Promise<ScrapeContext>;
}

function launchContext(
  userDataDir: string,
  options: { headless: boolean },
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, options);
}

/** 解析热度文本（如 "482.3万"、"1.2亿"、"320000"）为整数；无法解析时返回 undefined（热度留空，仍满足「热度或排名」）。 */
export function parseHeat(text: string): number | undefined {
  const match = HEAT_TEXT_PATTERN.exec(text.replace(/[,\s，]/g, ""));
  if (!match) return undefined;
  const unit = match[2] === "亿" ? 1e8 : match[2] === "万" ? 1e4 : 1;
  const heat = Number(match[1]) * unit;
  return Number.isFinite(heat) ? Math.round(heat) : undefined;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code: string) => {
      const codePoint = Number(code);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (match, entity: string) => HTML_ENTITIES[entity] ?? match);
}

/** 取字段元素的文本：剥掉内部标签、解码 HTML 实体并折叠空白；取不到或为空时返回 undefined。 */
function elementText(block: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(block);
  if (!match) return undefined;
  const text = decodeHtmlEntities(match[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

/** 排名→rank；条目未带排名元素时按页面序号（热搜列表的位次即排名）。 */
function parseRank(text: string | undefined, ordinal: number): number {
  if (text === undefined) return ordinal;
  const rank = Number(text.replace(/[^\d]/g, ""));
  return Number.isInteger(rank) && rank > 0 ? rank : ordinal;
}

/**
 * 从「发现」页 HTML 提取热点并做字段映射：主题名→title、排名→rank、热度→heat；
 * category 暂空（US-4 后置）。解析不到任何条目时抛出明确错误，不静默。
 */
export function extractHotTopics(html: string): ProviderTopic[] {
  const openTags = [...html.matchAll(new RegExp(HOT_ITEM_OPEN_TAG_SOURCE, "gi"))];
  const topics: ProviderTopic[] = [];

  openTags.forEach((openTag, index) => {
    const blockStart = (openTag.index ?? 0) + openTag[0].length;
    const nextOpenTag = openTags[index + 1];
    const block = html.slice(blockStart, nextOpenTag?.index ?? html.length);

    const title = elementText(block, TITLE_PATTERN);
    if (title === undefined) return;

    const rankText = elementText(block, RANK_PATTERN);
    const heatText = elementText(block, HEAT_PATTERN);
    const heat = heatText === undefined ? undefined : parseHeat(heatText);

    topics.push({
      title,
      rank: parseRank(rankText, index + 1),
      ...(heat !== undefined ? { heat } : {}),
    });
  });

  if (topics.length === 0) {
    throw new Error("未从小红书页面解析到任何热点条目：页面结构可能已变化，请检查 Provider 内的选择器定义");
  }
  return topics;
}

/** 关闭浏览器上下文；失败只记录日志，不吞掉 / 替换抓取流程已抛出的原始错误（如「需要登录」）。 */
async function closeQuietly(context: ScrapeContext): Promise<void> {
  try {
    await context.close();
  } catch (error: unknown) {
    console.error("关闭小红书浏览器上下文失败", error);
  }
}

/** 真实热点源：用持久化登录会话（WU-5 profile）抓取小红书「发现」页热搜；未登录 / 会话失效抛「需要登录」，不静默。 */
export class XiaohongshuProvider implements HotTopicProvider {
  readonly name = "xiaohongshu";

  private readonly profilePath: string;
  private readonly launchPersistentContext: (
    userDataDir: string,
    options: { headless: boolean },
  ) => Promise<ScrapeContext>;

  constructor({
    profilePath = DEFAULT_XHS_PROFILE_PATH,
    launchPersistentContext = launchContext,
  }: XiaohongshuProviderOptions = {}) {
    this.profilePath = profilePath;
    this.launchPersistentContext = launchPersistentContext;
  }

  async fetch(): Promise<ProviderTopic[]> {
    mkdirSync(this.profilePath, { recursive: true });
    const context = await this.launchPersistentContext(this.profilePath, { headless: true });
    try {
      if (!hasWebSessionCookie(await context.cookies())) {
        throw new LoginRequiredError();
      }

      const page = await context.newPage();
      const response = await page.goto(XHS_EXPLORE_URL, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      if (status === 401 || status === 403) {
        throw new LoginRequiredError();
      }
      if (LOGIN_URL_PATTERN.test(page.url())) {
        throw new LoginRequiredError();
      }
      if (status >= 400) {
        throw new Error(`小红书「发现」页返回状态 ${status}，抓取失败`);
      }
      await page.waitForSelector(HOT_ITEM_SELECTOR);

      return extractHotTopics(await page.content());
    } finally {
      await closeQuietly(context);
    }
  }
}
