import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginButton } from "./LoginButton";
import { LoginQrcode } from "./LoginQrcode";

afterEach(() => {
  cleanup();
});

describe("登录按钮", () => {
  it("渲染「登录小红书」并触发登录回调", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<LoginButton onClick={onClick} />);

    const button = screen.getByRole("button", { name: "登录小红书" });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("获取二维码期间展示加载态并禁用", () => {
    render(<LoginButton onClick={() => {}} isLoading />);

    expect(screen.getByRole("button", { name: "正在获取二维码" })).toBeDisabled();
  });
});

describe("登录二维码", () => {
  it("展示二维码图片并触发重取与关闭", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onClose = vi.fn();

    render(
      <LoginQrcode
        image="data:image/png;base64,AAAA"
        onRetry={onRetry}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("img", { name: "小红书登录二维码" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    expect(screen.getByText(/4 分钟后过期/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新获取二维码" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "关闭登录二维码" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
