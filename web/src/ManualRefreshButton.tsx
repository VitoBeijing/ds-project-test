interface ManualRefreshButtonProps {
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function ManualRefreshButton({ isRefreshing, onRefresh }: ManualRefreshButtonProps) {
  return (
    <button
      className="refresh-button"
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
    >
      <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">
        ↻
      </span>
      {isRefreshing ? "正在更新" : "手动刷新"}
    </button>
  );
}
