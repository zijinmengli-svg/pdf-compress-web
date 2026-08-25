(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TinyPDFWebRequest = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SESSION_ERROR_CODES = new Set(["WEBSITE_SESSION_REQUIRED", "JOB_ACCESS_DENIED"]);

  async function readPayload(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function postCompressionWithSession({ body, getToken, refreshToken, extraHeaders = {}, fetchImpl = fetch }) {
    const send = () => fetchImpl("/api/jobs", {
      method: "POST",
      headers: {
        ...extraHeaders,
        "X-TinyPDF-Web-Token": getToken() || "",
      },
      body,
    });

    let response = await send();
    let payload = await readPayload(response);
    if (!response.ok && SESSION_ERROR_CODES.has(payload.code) && refreshToken) {
      const refreshedToken = await refreshToken();
      if (refreshedToken) {
        response = await send();
        payload = await readPayload(response);
      }
    }
    return { response, payload };
  }

  return { postCompressionWithSession };
});
