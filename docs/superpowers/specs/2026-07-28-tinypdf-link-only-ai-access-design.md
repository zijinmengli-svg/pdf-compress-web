# TinyPDF Default English and Link-Only AI Access Design

Date: 2026-07-28

## Goal

Make English the default TinyPDF experience, keep Chinese available through an explicit language link, allow AI search products to discover and recommend TinyPDF pages, and prevent unsupported direct use of the compression capability outside the website.

AI crawler traffic must not inflate TinyPDF product analytics. Real users who click recommendations or links from `libindesign.cn` must remain attributable through the full compression funnel.

## Approved Routes

- `/` — default English homepage
- `/faq` — English FAQ
- `/zh/` — Chinese homepage
- `/zh/faq` — Chinese FAQ
- `/en` and `/en/` — permanent redirect to `/`
- `/en/faq` — permanent redirect to `/faq`

Canonical, `hreflang`, sitemap, footer, and language-switch links use these routes. The `x-default` alternate points to `/`.

## Public AI Discovery Boundary

AI search and recommendation crawlers may read public homepages, FAQ pages, `robots.txt`, `sitemap.xml`, and `llms.txt`.

TinyPDF does not provide:

- a public compression API;
- OpenAPI or action definitions for compression;
- an MCP compression tool;
- a supported way for an AI platform to upload, compress, poll, or download a PDF on a user's behalf.

Visible homepage and FAQ copy, plus `llms.txt`, state that AI platforms may recommend the official TinyPDF link, but the user must open TinyPDF and manually upload and compress the file on the website. Machine-facing discovery content must not publish compression endpoint parameters or invocation examples.

## Browser Session Protection

A real browser navigation to a supported homepage creates a short-lived signed web session. Identified crawlers can read the HTML but do not receive a usable compression session.

The page obtains a temporary request token bound to the signed session. Compression creation requires all of the following:

- a valid, unexpired signed web-session cookie;
- a valid temporary request token bound to that session;
- a same-origin `Origin` or `Referer`;
- `Sec-Fetch-Site` compatible with a same-origin browser request;
- a user agent that is not classified as a crawler or automation client.

Created jobs are bound to the web session. Progress events and downloads require the same session and the matching job access token. A job identifier alone is not sufficient.

The production cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure`. Local development supports HTTP without weakening production cookie settings. The session lasts two hours and is renewed by a normal page load.

Rejected requests return a stable `403 WEBSITE_SESSION_REQUIRED` response directing the user to open or refresh TinyPDF. Rejected calls do not create jobs or enter the product funnel.

This protection closes the supported public-call path. It is not a claim of cryptographic browser attestation; a determined attacker that fully emulates a browser may still require an external challenge such as Cloudflare Turnstile in a later hardening phase.

## Crawler and Indexing Policy

`robots.txt` allows approved AI search and user agents to crawl public pages while disallowing `/api/` and `/admin`. Training-oriented agents remain fully blocked.

All API responses include an `X-Robots-Tag` value that prevents indexing, following, and archiving. Security does not rely on robots directives; the web-session checks enforce access.

`llms.txt` contains only:

- the product purpose;
- official English and Chinese public URLs;
- supported file and size facts already visible on the site;
- the link-only recommendation policy;
- the statement that no public compression API or AI action is offered.

## Analytics and Attribution

Crawler and automated traffic is excluded at the server boundary:

- crawler page loads do not create product page views or client IDs;
- crawler requests to `/api/track` are acknowledged without persisting events;
- rejected direct compression requests do not create product events;
- accepted compression events are associated with a valid web session.

Real users clicking AI recommendations are recorded normally. Their referrer and UTM values are preserved through page view, upload, compression, and download events.

Attribution for the owner's personal site is exact:

- a browser referrer whose hostname is exactly `libindesign.cn` or ends with `.libindesign.cn` is normalized to source `libindesign.cn` and channel `owned_referral`;
- `www.libindesign.cn` is included by the subdomain rule;
- a matching explicit UTM source is preserved according to normal UTM precedence;
- a missing referrer, manually typed TinyPDF URL, bookmark, or unknown origin remains `Direct`;
- the system never infers `libindesign.cn` merely from a missing or unrecognized source.

The original landing attribution is stored with the web session and copied to job analytics so compression success and download events retain the landing source.

## User Experience

The existing desktop compression workflow remains visually and functionally unchanged apart from:

- English becoming the root experience;
- Chinese moving to `/zh/`;
- language links pointing to the matching alternate page;
- a concise visible statement that TinyPDF works through its website and has no public compression API.

Mobile continues to receive basic responsive presentation only. No mobile-specific compression features are added.

If a session expires, the page shows a localized instruction to refresh and try again. Normal users do not see a CAPTCHA or extra confirmation step.

## Error Handling

- Missing or invalid web session: `403 WEBSITE_SESSION_REQUIRED`
- Invalid job ownership or access token: `403 JOB_ACCESS_DENIED`
- Crawler or unsupported automated compression request: `403 WEBSITE_SESSION_REQUIRED`
- Expired page token: localized refresh-and-retry message

Error responses do not expose token details or validation internals.

## Verification

Automated tests cover:

- English root and FAQ content, metadata, and canonical URLs;
- Chinese `/zh/` routes and language alternates;
- permanent redirects from legacy `/en` routes;
- sitemap, robots, and `llms.txt`;
- crawler page loads not generating analytics;
- crawler `/api/track` events not being persisted;
- direct compression requests without a web session being rejected;
- valid same-origin web sessions reaching the existing compression validation path;
- job progress and download being inaccessible from another session;
- exact `libindesign.cn` and subdomain attribution;
- direct and unknown traffic remaining `Direct`;
- landing attribution surviving compression and download events;
- the complete existing regression suite.

Browser verification covers the English root, Chinese language switch, desktop layout, and basic 390px responsive presentation.
