import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const latest = {
  topics: [
    {
      id: 1,
      title: "春日通勤穿搭",
      rank: 1,
      heat: 12800,
      category: null,
      source: "fixture",
      fetchedAt: "2026-11-07T08:00:00.000Z",
    },
  ],
  fetchedAt: "2026-11-07T08:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("热点看板", () => {
  it("打开时获取并展示热点主题、热度、排名和更新时间", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(latest));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("春日通勤穿搭")).toBeInTheDocument();
    expect(screen.getByLabelText("排名 1")).toBeInTheDocument();
    expect(screen.getByText("热度 12,800")).toBeInTheDocument();
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/hot-topics");
  });

  it("点击手动刷新按钮后请求最新热点", async () => {
    const user = userEvent.setup();
    const refreshed = { ...latest, topics: [{ ...latest.topics[0], title: "周末城市漫游" }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(latest))
      .mockResolvedValueOnce(Response.json(refreshed));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByText("春日通勤穿搭");
    await user.click(screen.getByRole("button", { name: "手动刷新" }));

    expect(await screen.findByText("周末城市漫游")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/hot-topics/refresh", { method: "POST" });
  });

  it("没有热点时显示明确空状态", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ topics: [], fetchedAt: null })));

    render(<App />);

    expect(await screen.findByText("今天的灵感还在路上")).toBeInTheDocument();
    expect(screen.getByText("暂时没有热点数据，请稍后重试或手动刷新。"))
      .toBeInTheDocument();
  });

  it("API 获取失败时显示错误提示和重试入口", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("网络连接失败"));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
    const retryButton = screen.getByRole("button", { name: "重新加载" });
    fetchMock.mockResolvedValueOnce(Response.json(latest));
    await userEvent.setup().click(retryButton);
    await waitFor(() => expect(screen.getByText("春日通勤穿搭")).toBeInTheDocument());
  });

  it("HTTP 刷新失败时保留当前列表并显示错误", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(latest))
      .mockResolvedValueOnce(Response.json({ error: "刷新失败" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("春日通勤穿搭")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "手动刷新" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("热点暂时无法获取");
    expect(screen.getByText("春日通勤穿搭")).toBeInTheDocument();
  });

  it("初次加载完成前禁用手动刷新", async () => {
    let resolveInitialRequest: (response: Response) => void = () => undefined;
    const initialRequest = new Promise<Response>((resolve) => {
      resolveInitialRequest = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(initialRequest);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const refreshButton = screen.getByRole("button", { name: "手动刷新" });
    expect(refreshButton).toBeDisabled();

    resolveInitialRequest(Response.json(latest));
    expect(await screen.findByText("春日通勤穿搭")).toBeInTheDocument();
    expect(refreshButton).toBeEnabled();
  });

  it("页面打开时定期同步服务端热点", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const refreshedAt = "2026-11-07T09:00:00.000Z";
    const refreshed = {
      fetchedAt: refreshedAt,
      topics: [{ ...latest.topics[0], title: "周末城市漫游", fetchedAt: refreshedAt }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(latest))
      .mockResolvedValue(Response.json(refreshed));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("春日通勤穿搭")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText("周末城市漫游")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("热点列表已更新，1 个话题");
    expect(screen.getByRole("status")).toHaveTextContent(refreshedAt);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("自动同步尚未完成时跳过后续轮询", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let resolvePollingRequest: (response: Response) => void = () => undefined;
    const pollingRequest = new Promise<Response>((resolve) => {
      resolvePollingRequest = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(latest))
      .mockReturnValue(pollingRequest);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvePollingRequest(Response.json(latest));
    await act(async () => {
      await Promise.resolve();
    });
  });
});
