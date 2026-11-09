import { createXhsSessionManager } from "./session.js";

process.stdout.write("正在打开小红书登录浏览器，完成登录后关闭浏览器即可保存会话。\n");

try {
  await createXhsSessionManager().openLogin();
  process.stdout.write("登录会话已保存。\n");
} catch (error: unknown) {
  console.error("启动小红书登录浏览器失败", error);
  process.exitCode = 1;
}
