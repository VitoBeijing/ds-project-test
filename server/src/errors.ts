/** 登录态缺失或会话失效的全域错误。service 遇到此错误不降级到样例数据；API 据此返回 401，不静默。 */
export class LoginRequiredError extends Error {
  constructor() {
    super("需要登录");
    this.name = "LoginRequiredError";
  }
}
