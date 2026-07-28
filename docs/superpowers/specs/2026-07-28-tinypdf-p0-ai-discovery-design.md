# TinyPDF P0 AI Discovery Design

Date: 2026-07-28

## Goal

Make `tinypdf.cn` easier for Chinese search engines and AI search products to crawl, understand, and recommend, while preserving the current desktop-first PDF compression workflow.

## Approved Scope

- The desktop web experience is the only maintained product workflow.
- Mobile receives basic responsive presentation only: readable wrapping, no overlap, and no horizontal overflow.
- Do not add mobile-only presets, upload variants, transfer-to-desktop flows, or separate mobile functionality.
- The `.cn` root becomes the Chinese default experience.
- The existing English experience remains available under `/en/`.
- Compression behavior, upload limits, job processing, advertising hooks, analytics admin, and legal behavior stay unchanged unless a P0 requirement needs a narrow integration change.

## Chosen Approach

Use separate, crawlable static language URLs:

- `/` — Chinese homepage
- `/faq` — Chinese FAQ
- `/en/` — English homepage
- `/en/faq` — English FAQ

Each page has its own visible HTML copy, `lang`, title, description, canonical URL, and `hreflang` links. The two homepages share the existing stylesheet, compression script, and a small tested language dictionary for runtime status, validation, and button text.

This is preferred over a client-only language toggle because crawlers can discover stable language URLs without executing JavaScript. It is preferred over changing the root to a mixed bilingual page because each page keeps a clear search intent.

## Crawl Policy

The repository-controlled `robots.txt` will:

- Allow `OAI-SearchBot`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, and `Bytespider`.
- Continue blocking training-oriented `GPTBot` and `ClaudeBot`.
- Allow ordinary crawlers while disallowing `/admin`.
- Point to the canonical sitemap.

Cloudflare Managed robots, AI Crawl Control, WAF rules, and bot logs remain an external deployment setting. The code change removes repository-side conflicts but cannot prove that Cloudflare is not overriding them.

## Homepage Content

The Chinese homepage states the product entity and its limitation directly:

- TinyPDF 指定大小 PDF 压缩工具
- Compress one PDF toward a target size in MB.
- Preserve page count, page dimensions, and layout whenever possible.
- Free, no account required, one file up to 100MB.
- Temporary server processing; files are removed after about one hour.
- Very small targets can reduce quality and may not be reached exactly.

The English homepage preserves the same product facts. Neither language version claims lossless compression, guaranteed target attainment, speed, ratings, or user counts.

## Runtime Localization

`public/i18n.js` exposes a small Chinese/English dictionary. `public/app-simple.js` selects the language from `<html lang>` and uses the dictionary for:

- upload and validation messages;
- progress and result states;
- metrics;
- quality warnings;
- primary buttons;
- runtime upload-limit copy.

The compression API remains language-neutral and keeps existing English server messages as a safe fallback. The client maps known states and displays unknown server errors without hiding them.

## Analytics

The client adds `landingLanguage` to landing, file-selection, target-entry, compression-start, and session-end events. Existing server-side `compress_success`, `compress_error`, and `download_clicked` events remain the source of truth for completed funnel stages.

No PDF content is logged. This P0 pass does not redesign the existing analytics data model or admin dashboard.

## Responsive Behavior

The existing desktop layout and visual language remain unchanged. Basic narrow-screen rules:

- hero text wraps instead of using ellipsis;
- the top bar and footer can wrap with clear spacing;
- the form remains a single column;
- primary controls fit the viewport;
- no new mobile-only controls or behavior are introduced.

## Verification

- Automated integration checks for language routes, canonical/hreflang metadata, robots rules, sitemap entries, and responsive CSS.
- Unit checks for both language dictionaries and fallbacks.
- Existing full test suite.
- Local server inspection at desktop and 390px widths in the in-app browser.
- Confirm no text clipping, horizontal overflow, broken form controls, or missing static assets.

