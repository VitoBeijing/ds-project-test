/** 「登录二维码」：在页内展示小红书登录二维码，扫码成功后由上层轮询状态自动关闭（PRD 命名表组件）。 */

interface LoginQrcodeProps {
  image: string;
  onRetry: () => void;
  onClose: () => void;
}

export function LoginQrcode({ image, onRetry, onClose }: LoginQrcodeProps) {
  return (
    <div className="login-qrcode" role="dialog" aria-label="小红书登录二维码">
      <div className="login-qrcode-head">
        <div>
          <p className="eyebrow">LOGIN / 登录</p>
          <h3>扫码登录小红书</h3>
        </div>
        <button className="login-qrcode-close" type="button" onClick={onClose} aria-label="关闭登录二维码">
          ×
        </button>
      </div>
      <img className="login-qrcode-img" src={image} alt="小红书登录二维码" width={200} height={200} />
      <p className="login-qrcode-hint">用小红书 App 扫码。登录成功后页面会自动刷新状态。</p>
      <p className="login-qrcode-expire">二维码约 4 分钟后过期，过期后请重新获取。</p>
      <button className="login-qrcode-retry" type="button" onClick={onRetry}>
        重新获取二维码
      </button>
    </div>
  );
}
