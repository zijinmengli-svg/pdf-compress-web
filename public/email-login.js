(function () {
  "use strict";

  const button = document.getElementById("email-login-button");
  if (!button) return;
  const zh = document.documentElement.lang.toLowerCase().startsWith("zh");
  const text = (cn, en) => zh ? cn : en;
  let account = null;
  let available = null;
  let dialog = null;
  let logoutDialog = null;
  let sentEmail = "";
  let sending = false;
  let verifying = false;
  let cooldownUntil = 0;
  let cooldownTimer = null;

  async function request(path, { method = "GET", body } = {}) {
    const headers = {};
    if (method !== "GET") {
      const configResponse = await fetch("/api/config", { credentials: "same-origin", cache: "no-store" });
      if (!configResponse.ok) throw new Error(text("页面会话已过期，请刷新后重试。", "Session expired. Refresh and try again."));
      const config = await configResponse.json();
      headers["Content-Type"] = "application/json";
      headers["X-TinyPDF-Web-Token"] = config.webRequestToken || "";
    }
    const response = await fetch(path, {
      method, headers, credentials: "same-origin", cache: "no-store",
      ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        INVALID_EMAIL: text("请输入有效邮箱地址。", "Enter a valid email address."),
        INVALID_CODE: text("验证码错误或已过期。", "Invalid or expired verification code."),
        RATE_LIMITED: text("请求过于频繁，请稍后再试。", "Too many requests. Please wait and retry."),
        EMAIL_DELIVERY_FAILED: text("验证码发送失败，请稍后再试。", "Verification email could not be sent"),
        WEBSITE_SESSION_REQUIRED: text("页面会话已过期，请刷新后重试。", "Session expired. Refresh and try again."),
        AUTH_UNAVAILABLE: text("邮箱登录暂时不可用，请稍后再试。", "Email sign-in is temporarily unavailable."),
      };
      throw new Error(messages[result.code] || result.message || text("操作失败，请重试。", "Request failed. Please retry."));
    }
    return result;
  }

  function updateButton() {
    button.textContent = account ? text("我的账户", "My account") : text("登录", "Login");
    button.setAttribute("aria-label", account ? text("我的账户", "My account") : text("邮箱登录", "Sign in with email"));
  }

  async function refresh() {
    try {
      const result = await request("/api/auth/me");
      available = result.available !== false;
      account = result.authenticated ? { id: result.id, email: result.email } : null;
    } catch { available = false; account = null; }
    updateButton();
  }

  function createDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "email-login-dialog";
    dialog.setAttribute("aria-labelledby", "email-login-title");
    dialog.innerHTML = `<div class="email-login-panel">
      <button type="button" class="email-login-close" id="email-login-close" aria-label="${text("关闭", "Close")}">×</button>
      <p class="email-login-kicker">TinyPDF ACCOUNT</p>
      <h2 id="email-login-title">${text("邮箱登录", "Sign in with email")}</h2>
      <p id="email-login-intro">${text("无需密码，输入邮箱验证码即可登录。压缩仍可免登录使用。", "No password needed. Enter an email code to sign in. You can still compress without an account.")}</p>
      <div id="email-login-form">
        <label for="email-login-address">${text("邮箱地址", "Email address")}</label>
        <input id="email-login-address" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" />
        <button type="button" id="email-login-send">${text("发送验证码", "Send code")}</button>
        <div id="email-login-code-section" hidden>
          <label for="email-login-code">${text("6 位验证码", "6-digit code")}</label>
          <input id="email-login-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
          <p>${text("验证码 10 分钟内有效。", "The code is valid for 10 minutes.")}</p>
        </div>
        <button type="button" id="email-login-verify">${text("登录", "Sign in")}</button>
      </div>
      <div id="email-login-account" class="email-login-account" hidden>
        <div class="email-login-identity">
          <span class="email-login-avatar" aria-hidden="true">T</span>
          <div class="email-login-identity-fields">
            <p class="email-login-field-name">${text("登录邮箱", "Email address")}</p>
            <p id="email-login-current-email"></p>
          </div>
        </div>
        <div class="email-login-id-block">
          <p class="email-login-field-name">${text("账号 ID", "Account ID")}</p>
          <code id="email-login-current-id"></code>
        </div>
        <nav class="email-login-account-nav" aria-label="${text("账户菜单", "Account menu")}">
          <a href="/contact">${text("联系我们", "Contact us")}<span aria-hidden="true">↗</span></a>
          <a href="/privacy">${text("隐私条款", "Privacy policy")}<span aria-hidden="true">↗</span></a>
          <button type="button" id="email-login-logout">${text("退出登录", "Sign out")}<span aria-hidden="true">→</span></button>
        </nav>
      </div>
      <p id="email-login-message" role="status" aria-live="polite"></p>
    </div>`;
    document.body.appendChild(dialog);
    const element = id => dialog.querySelector(`#${id}`);
    const email = element("email-login-address");
    const code = element("email-login-code");
    const message = element("email-login-message");
    const send = element("email-login-send");
    const verify = element("email-login-verify");
    const normalEmail = () => email.value.trim().toLowerCase();
    const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    function updateControls() {
      const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      send.disabled = sending || verifying || available === false || !validEmail(normalEmail()) || seconds > 0;
      send.textContent = sending ? text("发送中…", "Sending…") : seconds ? text(`${seconds} 秒后重发`, `Resend in ${seconds}s`) : sentEmail && sentEmail === normalEmail() ? text("重新发送", "Resend code") : text("发送验证码", "Send code");
      verify.disabled = sending || verifying || sentEmail !== normalEmail() || !/^\d{6}$/.test(code.value);
      verify.textContent = verifying ? text("登录中…", "Signing in…") : text("登录", "Sign in");
    }
    email.addEventListener("input", () => {
      if (normalEmail() !== sentEmail) { code.value = ""; element("email-login-code-section").hidden = true; }
      updateControls();
    });
    code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 6); updateControls(); });
    email.addEventListener("keydown", event => { if (event.key === "Enter" && !send.disabled) { event.preventDefault(); send.click(); } });
    code.addEventListener("keydown", event => { if (event.key === "Enter" && !verify.disabled) { event.preventDefault(); verify.click(); } });
    send.addEventListener("click", async () => {
      if (send.disabled) return;
      const requestedEmail = normalEmail();
      sending = true; message.textContent = ""; updateControls();
      try {
        await request("/api/auth/request-code", { method: "POST", body: { email: requestedEmail } });
        if (normalEmail() !== requestedEmail) return;
        sentEmail = requestedEmail;
        cooldownUntil = Date.now() + 60_000;
        element("email-login-code-section").hidden = false;
        message.textContent = text("验证码已发送，请查收邮箱和垃圾邮件。", "Code sent. Check your inbox and spam folder.");
        code.focus();
      } catch (error) { message.textContent = error.message; }
      finally { sending = false; updateControls(); }
    });
    verify.addEventListener("click", async () => {
      if (verify.disabled) return;
      verifying = true; message.textContent = ""; updateControls();
      try {
        const result = await request("/api/auth/verify", { method: "POST", body: { email: sentEmail, code: code.value } });
        account = result.account; code.value = ""; dialog.close(); updateButton();
      } catch (error) { message.textContent = error.message; }
      finally { verifying = false; updateControls(); }
    });
    element("email-login-logout").addEventListener("click", () => {
      dialog.close();
      createLogoutDialog().showModal();
    });
    element("email-login-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    });
    dialog.updateControls = updateControls;
    dialog.message = message;
    return dialog;
  }

  function createLogoutDialog() {
    if (logoutDialog) return logoutDialog;
    logoutDialog = document.createElement("dialog");
    logoutDialog.className = "email-logout-dialog";
    logoutDialog.setAttribute("aria-labelledby", "email-logout-title");
    logoutDialog.innerHTML = `<div class="email-logout-panel">
      <button type="button" class="email-login-close" id="email-logout-close" aria-label="${text("关闭", "Close")}">×</button>
      <p class="email-login-kicker">TinyPDF ACCOUNT</p>
      <h2 id="email-logout-title">${text("确认退出登录", "Confirm sign out")}</h2>
      <p>${text("退出后需要重新使用邮箱验证码登录。", "You'll need an email code to sign in again.")}</p>
      <div class="email-logout-actions">
        <button type="button" id="email-logout-cancel">${text("取消", "Cancel")}</button>
        <button type="button" id="email-logout-confirm">${text("确认退出", "Sign out")}</button>
      </div>
      <p id="email-logout-message" role="status" aria-live="polite"></p>
    </div>`;
    document.body.appendChild(logoutDialog);
    const cancel = logoutDialog.querySelector("#email-logout-cancel");
    const confirm = logoutDialog.querySelector("#email-logout-confirm");
    const status = logoutDialog.querySelector("#email-logout-message");
    let signingOut = false;
    cancel.addEventListener("click", () => logoutDialog.close());
    logoutDialog.querySelector("#email-logout-close").addEventListener("click", () => logoutDialog.close());
    logoutDialog.addEventListener("close", () => {
      status.textContent = "";
      if (account && !signingOut) button.click();
    });
    confirm.addEventListener("click", async () => {
      if (signingOut) return;
      signingOut = true;
      cancel.disabled = true;
      confirm.disabled = true;
      status.textContent = "";
      try {
        await request("/api/auth/logout", { method: "POST" });
        account = null;
        updateButton();
        logoutDialog.close();
      } catch (error) { status.textContent = error.message; }
      finally { signingOut = false; cancel.disabled = false; confirm.disabled = false; }
    });
    return logoutDialog;
  }

  button.addEventListener("click", () => {
    const current = createDialog();
    current.dataset.view = account ? "account" : "login";
    current.querySelector("#email-login-title").textContent = account
      ? text("我的账户", "My account") : text("邮箱登录", "Sign in with email");
    current.querySelector("#email-login-form").hidden = Boolean(account);
    current.querySelector("#email-login-account").hidden = !account;
    current.querySelector("#email-login-intro").hidden = Boolean(account);
    current.querySelector("#email-login-current-email").textContent = account?.email || "";
    current.querySelector("#email-login-current-id").textContent = account?.id || "";
    current.message.textContent = !account && available === false
      ? text("邮箱登录暂时不可用，请稍后再试。", "Email sign-in is temporarily unavailable.") : "";
    current.updateControls();
    current.showModal();
    if (!account) current.querySelector("#email-login-address").focus();
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(current.updateControls, 1000);
  });

  updateButton();
  refresh();
})();
