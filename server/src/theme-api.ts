import express, { type Express } from "express";
import { LoginRequiredError } from "./errors.js";
import type { ThemeService } from "./theme.js";
import type { ThemeStore } from "./theme-store.js";
import type { XhsLoginStatus } from "./xhs-mcp.js";

export interface McpStatusOptions {
  source: string;
  checkLoginStatus: () => Promise<XhsLoginStatus>;
}

export interface ThemeApiOptions {
  themeService: ThemeService;
  themeStore: ThemeStore;
  mcpStatus: McpStatusOptions;
}

/** 请求体 { keyword } 的 keyword 字段：非空字符串，否则返回 undefined。 */
function readKeyword(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const keyword = (body as Record<string, unknown>).keyword;
  if (typeof keyword !== "string" || keyword.trim() === "") return undefined;
  return keyword;
}

/** 路径参数 id：正整数，否则返回 null。 */
function parseThemeId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 创建主题深挖 REST API（TECH_SPEC v3「HTTP 接口」四个端点）。 */
export function createThemeApi({ themeService, themeStore, mcpStatus }: ThemeApiOptions): Express {
  const app = express();
  app.use(express.json());

  app.post("/api/themes/collect", async (request, response) => {
    const keyword = readKeyword(request.body);
    if (keyword === undefined) {
      response.status(400).json({ error: "请求体需要 keyword 字段（非空字符串）" });
      return;
    }
    try {
      const result = await themeService.collectTheme(keyword);
      response.status(201).json({ themeId: result.themeId });
    } catch (error: unknown) {
      if (error instanceof LoginRequiredError) {
        response.status(401).json({ error: error.message });
        return;
      }
      console.error("主题收集失败", error);
      response.status(500).json({ error: "主题收集失败" });
    }
  });

  app.get("/api/themes/:id/report", (request, response) => {
    const themeId = parseThemeId(request.params.id);
    if (themeId === null) {
      response.status(400).json({ error: "主题 id 必须是正整数" });
      return;
    }
    const theme = themeStore.getTheme(themeId);
    if (theme === null) {
      response.status(404).json({ error: "主题不存在" });
      return;
    }
    const report = themeStore.getReport(themeId);
    if (report === null) {
      response.status(404).json({ error: "报告尚未生成" });
      return;
    }
    response.json({
      themeId: report.themeId,
      keyword: theme.keyword,
      cluster_summary: report.clusterSummary,
      high_value_notes: report.highValueNotes,
      conclusion: report.conclusion,
    });
  });

  app.get("/api/themes/:id/notes", (request, response) => {
    const themeId = parseThemeId(request.params.id);
    if (themeId === null) {
      response.status(400).json({ error: "主题 id 必须是正整数" });
      return;
    }
    const theme = themeStore.getTheme(themeId);
    if (theme === null) {
      response.status(404).json({ error: "主题不存在" });
      return;
    }
    response.json({ themeId, keyword: theme.keyword, notes: themeStore.listNotes(themeId) });
  });

  app.get("/api/mcp/status", async (_request, response) => {
    let status: XhsLoginStatus;
    try {
      status = await mcpStatus.checkLoginStatus();
    } catch (error: unknown) {
      console.error("检查小红书登录状态失败", error);
      status = { loggedIn: false };
    }
    response.json({
      source: mcpStatus.source,
      loggedIn: status.loggedIn,
      ...(status.username !== undefined && { username: status.username }),
    });
  });

  return app;
}
