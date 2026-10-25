"use strict";

function createEmailSender({ apiKey, from, fetchImpl = globalThis.fetch }) {
  if (!apiKey || !from || typeof fetchImpl !== "function") throw new TypeError("Email sender is not configured");
  return async (email, code) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [email], subject: "TinyPDF verification code / 登录验证码",
        text: `Your TinyPDF verification code is ${code}. It expires in 10 minutes.\nTinyPDF 登录验证码：${code}。10 分钟内有效。如果不是你本人操作，请忽略本邮件。`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Email delivery failed");
  };
}

module.exports = { createEmailSender };
