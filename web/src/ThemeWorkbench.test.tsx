import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeWorkbench } from "./ThemeWorkbench";

const loggedInStatus = { source: "xiaohongshu", loggedIn: true, username: "穿搭薯" };

const report = {
  themeId: 1,
  keyword: "春日通勤穿搭",
  cluster_summary: [
    { label: "通勤", noteCount: 2 },
    { label: "春日", noteCount: 1 },
    { label: "其他", noteCount: 1 },
  ],
  high_value_notes: [
    {
      feedId: "f1",
      title: "春日通勤穿搭合集",
      author: "穿搭薯",
      likeCount: 1200,
      collectCount: 300,
      commentCount: 45,
      score: 1935,
      tags: ["通勤", "春日"],
      publishedAt: "2026-11-07T08:00:00.000Z",
      url: "https://www.xiaohongshu.com/explore/f1",
    },
    {
      feedId: "f2",
      title: "一周通勤不重样",
      author: "上班族阿梨",
      likeCount: 800,
      collectCount: 210,
      commentCount: 30,
      score: 1310,
      tags: ["通勤"],
      publishedAt: "2026-11-06T09:00:00.000Z",
      url: "https://www.xiaohongshu.com/explore/f2",
    },
  ],
  conclusion: "最高互动簇：通勤；高价值内容共同标签：通勤；平均互动量：886.7",
};

const notesResponse = {
  themeId: 1,
  keyword: "春日通勤穿搭",
  notes: [
    {
      id: 1,
      themeId: 1,
      feedId: "f1",
      title: "春日通勤穿搭合集",
      author: "穿搭薯",
      likeCount: 1200,
      collectCount: 300,
      commentCount: 45,
      tags: ["通勤", "春日"],
      publishedAt: "2026-11-07T08:00:00.000Z",
      url: "https://www.xiaohongshu.com/explore/f1",
    },
    {
      id: 2,
      themeId: 1,
      feedId: "f2",
      title: "一周通勤不重样",
      author: "上班族阿梨",
      likeCount: 800,
      collectCount: 210,
      commentCount: 30,
      tags: ["通勤"],
      publishedAt: "2026-11-06T09:00:00.000Z",
      url: "https://www.xiaohongshu.com/explore/f2",
    },
    {
      id: 3,
      themeId: 1,
      feedId: "f3",
      title: "春日配色灵感",
      author: null,
      likeCount: 60,
      collectCount: 12,
      commentCount: 3,
      tags: [],
      publishedAt: null,
      url: null,
    },
  ],
};

type FetchMock = ReturnType<typeof vi.fn>;

function successFetch(): FetchMock {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/mcp/status") return Response.json(loggedInStatus);
    if (url === "/api/themes/collect") return Response.json({ themeId: 1 }, { status: 201 });
    if (url === "/api/themes/1/report") return Response.json(report);
    if (url === "/api/themes/1/notes") return Response.json(notesResponse);
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("主题工作台", () => {
  it("打开时检查并展示小红书登录状态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(loggedInStatus)));

    render(<ThemeWorkbench />);

    expect(await screen.findByText(/LIVE \/ 小红书 · 穿搭薯/)).toBeInTheDocument();
  });

  it("未登录时显示登录提示与登录入口，并禁用开始收集按钮", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ source: "xiaohongshu", loggedIn: false })),
    );

    render(<ThemeWorkbench />);

    expect(await screen.findByText("未登录小红书")).toBeInTheDocument();
    expect(screen.getByText(/登录后才能收集内容/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录小红书" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始收集" })).toBeDisabled();
  });

  it("输入关键词并点击开始收集后展示内容簇、内容条目、高价值列表与深度报告", async () => {
    const user = userEvent.setup();
    const fetchMock = successFetch();

    render(<ThemeWorkbench />);
    await screen.findByText(/LIVE/);

    await user.type(screen.getByLabelText("主题关键词"), "春日通勤穿搭");
    await user.click(screen.getByRole("button", { name: "开始收集" }));

    // 内容簇
    expect(await screen.findByRole("heading", { name: "通勤" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "春日" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "其他" })).toBeInTheDocument();

    // 内容条目：标题、作者、互动数据、发布时间、原文链接
    expect(screen.getAllByRole("heading", { name: "春日通勤穿搭合集" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("赞 1,200").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("藏 300").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("评 45").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("@穿搭薯").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "查看原文 ↗" }).length).toBeGreaterThanOrEqual(2);

    // 高价值列表：可观察的排序依据（价值分）
    expect(screen.getAllByText("价值分 1,935").length).toBeGreaterThanOrEqual(1);

    // 深度报告：内容簇概览、高价值内容清单、挖掘结论
    expect(screen.getByRole("heading", { name: "深度报告" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "内容簇概览" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "高价值内容清单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "挖掘结论" })).toBeInTheDocument();
    expect(screen.getByText(/最高互动簇：通勤/)).toBeInTheDocument();

    // 请求契约
    const collectCall = fetchMock.mock.calls.find(([url]) => url === "/api/themes/collect");
    expect(collectCall).toBeDefined();
    expect(collectCall![1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(collectCall![1]!.body))).toEqual({ keyword: "春日通勤穿搭" });
  });

  it("检索不到内容时显示明确空状态而不是白屏", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mcp/status") return Response.json(loggedInStatus);
        if (url === "/api/themes/collect") return Response.json({ themeId: 1 }, { status: 201 });
        if (url === "/api/themes/1/report") {
          return Response.json({
            themeId: 1,
            keyword: "无结果主题",
            cluster_summary: [],
            high_value_notes: [],
            conclusion: "最高互动簇：无；高价值内容共同标签：无；平均互动量：0.0",
          });
        }
        if (url === "/api/themes/1/notes") {
          return Response.json({ themeId: 1, keyword: "无结果主题", notes: [] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<ThemeWorkbench />);
    await screen.findByText(/LIVE/);
    await user.type(screen.getByLabelText("主题关键词"), "无结果主题");
    await user.click(screen.getByRole("button", { name: "开始收集" }));

    expect(await screen.findByText("没有检索到相关内容")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "深度报告" })).not.toBeInTheDocument();
  });

  it("收集返回 401 时显示登录提示", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mcp/status") return Response.json(loggedInStatus);
        if (url === "/api/themes/collect") {
          return Response.json({ error: "未登录或登录态已失效" }, { status: 401 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<ThemeWorkbench />);
    await screen.findByText(/LIVE/);
    await user.type(screen.getByLabelText("主题关键词"), "春日通勤穿搭");
    await user.click(screen.getByRole("button", { name: "开始收集" }));

    expect(await screen.findByText("未登录小红书")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录小红书" })).toBeInTheDocument();
  });

  it("点击登录按钮展示二维码，扫码成功后自动切换为已登录", async () => {
    const user = userEvent.setup();
    let loggedIn = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mcp/status") {
          return Response.json({
            source: "xiaohongshu",
            loggedIn,
            ...(loggedIn ? { username: "穿搭薯" } : {}),
          });
        }
        if (url === "/api/mcp/login-qrcode") {
          return Response.json({ loggedIn: false, image: "data:image/png;base64,AAAA" });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<ThemeWorkbench />);

    const loginButton = await screen.findByRole("button", { name: "登录小红书" });
    await user.click(loginButton);

    expect(await screen.findByRole("img", { name: "小红书登录二维码" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );

    loggedIn = true;
    expect(
      await screen.findByText(/LIVE \/ 小红书 · 穿搭薯/, undefined, { timeout: 3_000, interval: 200 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "小红书登录二维码" })).not.toBeInTheDocument();
  });

  it("收集失败时显示错误提示", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mcp/status") return Response.json(loggedInStatus);
        if (url === "/api/themes/collect") {
          return Response.json({ error: "主题收集失败" }, { status: 500 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<ThemeWorkbench />);
    await screen.findByText(/LIVE/);
    await user.type(screen.getByLabelText("主题关键词"), "春日通勤穿搭");
    await user.click(screen.getByRole("button", { name: "开始收集" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("主题收集失败");
  });

  it("报告获取失败时显示错误提示", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mcp/status") return Response.json(loggedInStatus);
        if (url === "/api/themes/collect") return Response.json({ themeId: 1 }, { status: 201 });
        if (url === "/api/themes/1/report") {
          return Response.json({ error: "报告尚未生成" }, { status: 404 });
        }
        if (url === "/api/themes/1/notes") {
          return Response.json({ themeId: 1, keyword: "春日通勤穿搭", notes: [] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<ThemeWorkbench />);
    await screen.findByText(/LIVE/);
    await user.type(screen.getByLabelText("主题关键词"), "春日通勤穿搭");
    await user.click(screen.getByRole("button", { name: "开始收集" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("报告尚未生成");
  });
});
