/** 「开始收集按钮」：触发按关键词检索聚合（PRD 命名表组件）。 */

interface StartCollectButtonProps {
  isCollecting: boolean;
  isDisabled: boolean;
}

export function StartCollectButton({ isCollecting, isDisabled }: StartCollectButtonProps) {
  return (
    <button className="collect-button" type="submit" disabled={isCollecting || isDisabled}>
      <span className={isCollecting ? "collect-icon is-spinning" : "collect-icon"} aria-hidden="true">
        {isCollecting ? "⟳" : "→"}
      </span>
      {isCollecting ? "正在收集" : "开始收集"}
    </button>
  );
}
