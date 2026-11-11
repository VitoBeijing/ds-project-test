/** 「登录按钮」：触发在页内展示登录二维码（PRD 命名表组件）。 */

interface LoginButtonProps {
  onClick: () => void;
  isLoading?: boolean;
}

export function LoginButton({ onClick, isLoading = false }: LoginButtonProps) {
  return (
    <button className="login-button" type="button" onClick={onClick} disabled={isLoading}>
      <span className={isLoading ? "login-button-icon is-spinning" : "login-button-icon"} aria-hidden="true">
        {isLoading ? "⟳" : "▣"}
      </span>
      {isLoading ? "正在获取二维码" : "登录小红书"}
    </button>
  );
}
