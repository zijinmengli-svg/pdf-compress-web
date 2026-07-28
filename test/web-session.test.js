"use strict";

const assert = require("assert");
const {
  createWebSession,
  verifyWebSession,
  requestTokenFor,
  verifyRequestToken,
  isAutomatedUserAgent,
  isSameOriginRequest,
  createJobAccess,
  verifyJobAccess,
  normalizeLandingAttribution,
} = require("../lib/web-session");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL - ${name} :: ${error.message}`);
  }
}

check("exact libindesign referrals are owned while direct and lookalike hosts are not", () => {
  const owned = normalizeLandingAttribution("https://www.libindesign.cn/projects/tinypdf?from=portfolio", {});
  const subdomain = normalizeLandingAttribution("https://work.libindesign.cn/tinypdf", {});
  const direct = normalizeLandingAttribution("", {});
  const invalid = normalizeLandingAttribution("not a url", {});
  const lookalike = normalizeLandingAttribution("https://libindesign.cn.evil.example/", {});

  assert.deepStrictEqual(
    { source: owned.source, category: owned.sourceCategory, referrer: owned.referrer },
    {
      source: "libindesign.cn",
      category: "owned_referral",
      referrer: "https://www.libindesign.cn/projects/tinypdf",
    }
  );
  assert.strictEqual(subdomain.source, "libindesign.cn");
  assert.strictEqual(subdomain.sourceCategory, "owned_referral");
  assert.strictEqual(direct.source, "Direct");
  assert.strictEqual(direct.sourceCategory, "direct");
  assert.strictEqual(invalid.source, "Direct");
  assert.strictEqual(lookalike.source, "libindesign.cn.evil.example");
  assert.notStrictEqual(lookalike.sourceCategory, "owned_referral");
});

check("UTM source takes precedence without inventing an owned referral", () => {
  const attributed = normalizeLandingAttribution("https://www.libindesign.cn/projects/tinypdf", {
    source: "newsletter",
    medium: "email",
    campaign: "launch",
  });
  assert.strictEqual(attributed.source, "newsletter");
  assert.strictEqual(attributed.sourceCategory, "campaign");
  assert.deepStrictEqual(attributed.utm, {
    source: "newsletter",
    medium: "email",
    campaign: "launch",
    content: "",
    term: "",
  });
});

check("signed website sessions verify only with the right secret and lifetime", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const created = createWebSession("test-secret", {
    referrer: "https://libindesign.cn/projects/tinypdf",
    utm: {},
  }, now);

  const valid = verifyWebSession(created.value, "test-secret", new Date("2026-07-28T01:00:00.000Z"));
  assert.ok(valid);
  assert.strictEqual(valid.sid, created.claims.sid);
  assert.strictEqual(valid.attribution.source, "libindesign.cn");
  assert.strictEqual(
    verifyWebSession(created.value, "wrong-secret", new Date("2026-07-28T01:00:00.000Z")),
    null
  );
  assert.strictEqual(
    verifyWebSession(created.value, "test-secret", new Date("2026-07-28T03:00:00.000Z")),
    null
  );
});

check("request tokens are bound to the signed session value", () => {
  const first = createWebSession("test-secret", { referrer: "", utm: {} });
  const second = createWebSession("test-secret", { referrer: "", utm: {} });
  const token = requestTokenFor(first.value, "test-secret");
  assert.strictEqual(verifyRequestToken(first.value, token, "test-secret"), true);
  assert.strictEqual(verifyRequestToken(second.value, token, "test-secret"), false);
  assert.strictEqual(verifyRequestToken(first.value, "invalid", "test-secret"), false);
});

check("automation detection separates crawlers from ordinary browsers", () => {
  assert.strictEqual(
    isAutomatedUserAgent("Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)"),
    true
  );
  assert.strictEqual(
    isAutomatedUserAgent("Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)"),
    true
  );
  assert.strictEqual(isAutomatedUserAgent("curl/8.7.1"), true);
  assert.strictEqual(
    isAutomatedUserAgent("Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36"),
    false
  );
});

check("same-origin validation requires browser fetch metadata and matching host", () => {
  assert.strictEqual(isSameOriginRequest({
    headers: {
      host: "tinypdf.cn",
      origin: "https://tinypdf.cn",
      "sec-fetch-site": "same-origin",
      "x-forwarded-proto": "https",
    },
  }), true);
  assert.strictEqual(isSameOriginRequest({
    headers: {
      host: "127.0.0.1:3487",
      referer: "http://127.0.0.1:3487/",
      "sec-fetch-site": "same-origin",
    },
  }), true);
  assert.strictEqual(isSameOriginRequest({
    headers: {
      host: "tinypdf.cn",
      origin: "https://evil.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-proto": "https",
    },
  }), false);
  assert.strictEqual(isSameOriginRequest({
    headers: {
      host: "tinypdf.cn",
      origin: "https://tinypdf.cn",
      "sec-fetch-site": "cross-site",
      "x-forwarded-proto": "https",
    },
  }), false);
});

check("job access requires both the creating session and random access token", () => {
  const first = createWebSession("test-secret", { referrer: "", utm: {} });
  const second = createWebSession("test-secret", { referrer: "", utm: {} });
  const jobAccess = createJobAccess(first.claims);
  const job = { ...jobAccess };

  assert.strictEqual(verifyJobAccess(job, first.claims, jobAccess.accessToken), true);
  assert.strictEqual(verifyJobAccess(job, second.claims, jobAccess.accessToken), false);
  assert.strictEqual(verifyJobAccess(job, first.claims, "wrong-token"), false);
});

console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
