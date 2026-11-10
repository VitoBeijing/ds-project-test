import { useCallback, useEffect, useRef, useState } from "react";
import { ContentCluster } from "./ContentCluster";
import { DeepReport } from "./DeepReport";
import { HighValueList } from "./HighValueList";
import { StartCollectButton } from "./StartCollectButton";
import { ThemeInput } from "./ThemeInput";
import {
  ApiError,
  buildContentClusters,
  requestJson,
  type CollectResponse,
  type ContentClusterModel,
  type McpStatus,
  type ThemeNote,
  type ThemeNotesResponse,
  type ThemeReportResponse,
} from "./theme";

type LoginState = "checking" | "loggedIn" | "loggedOut" | "error";

interface CollectResult {
  keyword: string;
  clusters: ContentClusterModel[];
  notes: ThemeNote[];
  report: ThemeReportResponse;
}

function loginLabel(loginState: LoginState, username: string | undefined): string {
  switch (loginState) {
    case "checking":
      return "检查登录状态 / 小红书";
    case "loggedIn":
      return username ? `LIVE / 小红书 · ${username}` : "LIVE / 小红书";
    case "loggedOut":
      return "未登录 / 小红书";
    case "error":
      return "登录状态未知 / 小红书";
  }
}

/** 「主题工作台」页面（PRD 命名表页面）。 */
export function ThemeWorkbench() {
  const [keyword, setKeyword] = useState("");
  const [loginState, setLoginState] = useState<LoginState>("checking");
  const [username, setUsername] = useState<string | undefined>();
  const [isCollecting, setIsCollecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<CollectResult | null>(null);
  const latestRequest = useRef(0);

  const checkLogin = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoginState("checking");
    setErrorMessage(null);
    try {
      const status = await requestJson<McpStatus>("/api/mcp/status");
      if (requestId !== latestRequest.current) return;
      setUsername(status.username);
      setLoginState(status.loggedIn ? "loggedIn" : "loggedOut");
    } catch (error: unknown) {
      if (requestId !== latestRequest.current) return;
      setLoginState("error");
      setErrorMessage(error instanceof Error ? error.message : "登录状态暂时无法获取，请稍后重试。");
    }
  }, []);

  useEffect(() => {
    void checkLogin();
  }, [checkLogin]);

  const startCollect = async () => {
    const trimmed = keyword.trim();
    if (trimmed === "") return;

    const requestId = ++latestRequest.current;
    setIsCollecting(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const collected = await requestJson<CollectResponse>("/api/themes/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: trimmed }),
      });
      if (requestId !== latestRequest.current) return;

      const [report, notes] = await Promise.all([
        requestJson<ThemeReportResponse>(`/api/themes/${collected.themeId}/report`),
        requestJson<ThemeNotesResponse>(`/api/themes/${collected.themeId}/notes`),
      ]);
      if (requestId !== latestRequest.current) return;

      setResult({
        keyword: notes.keyword,
        notes: notes.notes,
        clusters: buildContentClusters(notes.notes),
        report,
      });
    } catch (error: unknown) {
      if (requestId !== latestRequest.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setLoginState("loggedOut");
        setErrorMessage(null);
      } else {
        setErrorMessage(error instanceof Error ? error.message : "主题收集失败，请稍后重试。");
      }
    } finally {
      if (requestId === latestRequest.current) setIsCollecting(false);
    }
  };

  const canCollect = keyword.trim() !== "" && loginState === "loggedIn" && !isCollecting;
  const hasContent = result !== null && result.notes.length > 0;

  return (
    <main className="dashboard-shell workbench">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="主题工作台首页">
          <span className="wordmark-icon" aria-hidden="true">深</span>
          <span>灵感采集<span className="wordmark-dot">.</span></span>
        </a>
        <span className="topbar-note">独立创作者的选题台</span>
        <span className="live-indicator"><i /> {loginLabel(loginState, username)}</span>
      </header>

      <section className="workbench-hero" id="top" aria-labelledby="workbench-title">
        <div className="hero-copy">
          <p className="eyebrow"><span>02</span> 主题深挖 / THEME MINING</p>
          <h1 id="workbench-title">主题<br /><em>工作台</em></h1>
          <p className="hero-description">围绕一个主题，检索、聚合、深挖。<br />产出你的下一篇选题依据。</p>
        </div>
        <div className="workbench-mark" aria-hidden="true">
          <span>KEYWORD</span>
          <span>→</span>
          <span>CLUSTERS</span>
          <span>→</span>
          <span>REPORT</span>
        </div>
      </section>

      <section className="collect-panel" aria-labelledby="collect-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COLLECT / 收集</p>
            <h2 id="collect-heading">输入主题，开始收集</h2>
          </div>
        </div>

        <form
          className="collect-form"
          onSubmit={(event) => {
            event.preventDefault();
            void startCollect();
          }}
        >
          <ThemeInput value={keyword} onChange={setKeyword} />
          <StartCollectButton isCollecting={isCollecting} isDisabled={!canCollect} />
        </form>

        {loginState === "loggedOut" && (
          <div className="login-banner" role="status">
            <span className="login-symbol" aria-hidden="true">!</span>
            <div>
              <h3>未登录小红书</h3>
              <p>请先完成小红书登录，再回来开始收集。</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="error-banner" role="alert">
            <span className="error-symbol" aria-hidden="true">!</span>
            <span>{errorMessage}</span>
            {loginState === "error" && (
              <button type="button" onClick={() => void checkLogin()}>重试登录检查</button>
            )}
          </div>
        )}

        {isCollecting && (
          <section className="list-state" aria-live="polite">
            <span className="state-index">SYNCING / 收集中</span>
            <h2>正在检索与挖掘「{keyword.trim()}」…</h2>
            <p>检索、聚类、挖掘通常需要一点时间，请稍候。</p>
          </section>
        )}
      </section>

      {result !== null && result.notes.length === 0 && (
        <section className="list-state workbench-empty" aria-live="polite">
          <span className="state-index">00 / 无信号</span>
          <h2>没有检索到相关内容</h2>
          <p>换个关键词试试，或确认小红书账号已登录。</p>
        </section>
      )}

      {hasContent && result !== null && (
        <>
          <section className="clusters-section" aria-labelledby="clusters-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CLUSTERS / 内容簇</p>
                <h2 id="clusters-heading">
                  「{result.keyword}」的内容簇<span className="heading-count">{result.clusters.length}</span>
                </h2>
              </div>
            </div>
            {result.clusters.map((cluster, index) => (
              <ContentCluster key={cluster.label} cluster={cluster} index={index} />
            ))}
          </section>

          <section className="high-value-section" aria-labelledby="high-value-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">HIGH VALUE / 高价值内容</p>
                <h2 id="high-value-heading">高价值内容列表</h2>
              </div>
            </div>
            <HighValueList notes={result.report.high_value_notes} />
          </section>

          <section className="report-section" aria-labelledby="report-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">REPORT / 深度报告</p>
                <h2 id="report-heading">深度报告</h2>
              </div>
            </div>
            <DeepReport report={result.report} />
          </section>
        </>
      )}

      <footer className="page-footer">
        <span>围绕主题，深挖高价值内容。</span>
        <span>DS BOT STUDIO　© 2026</span>
      </footer>
    </main>
  );
}
