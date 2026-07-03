# TinyPDF Simple Analytics Admin Design

## Goal

Build a lightweight first-party analytics admin inside the existing TinyPDF site so the owner can understand traffic quality, acquisition sources, user flow, compression outcomes, and uploaded-file categories without relying on confusing third-party dashboards.

The first version must stay simple, zero-cost, and deploy with the current Node/static site.

## Placement

- Public tool: `https://tinypdf.cn/`
- Admin page: `https://tinypdf.cn/admin`
- Admin APIs: `/api/admin/*`
- Storage: local server file under `data/analytics-events.jsonl`

This is not a separate website, database service, or new domain. It is an internal admin page added to the current app.

## Access Control

The admin is protected by a single password stored in the server environment variable `ADMIN_PASSWORD`.

Flow:

1. Visitor opens `/admin`.
2. Page asks for password.
3. Server validates the password.
4. Browser receives an admin session cookie.
5. Admin APIs only return data when the session cookie is valid.

If `ADMIN_PASSWORD` is not configured in production, admin login should be unavailable rather than open.

## Event Storage

Use newline-delimited JSON:

```text
data/analytics-events.jsonl
```

Each line is one event object. Appending is simple, reliable enough for the current traffic level, and easy to inspect or migrate later.

Recommended event shape:

```json
{
  "ts": "2026-07-03T12:00:00.000Z",
  "event": "file_selected",
  "sessionId": "anon-session-id",
  "clientId": "anon-client-id",
  "path": "/",
  "referrer": "https://dev.to/...",
  "utm": {
    "source": "devto",
    "medium": "post",
    "campaign": "launch"
  },
  "userAgent": "browser user agent",
  "country": "US",
  "device": "desktop",
  "browser": "Chrome",
  "data": {
    "fileName": "portfolio-final.pdf",
    "fileCategory": "design",
    "fileBytes": 1234567
  }
}
```

## Tracked Events

First version events:

- `page_view`: real browser homepage visit.
- `file_selected`: user selected a PDF in the browser.
- `compress_started`: user submitted compression.
- `compress_success`: compression finished successfully.
- `compress_error`: compression failed.
- `download_clicked`: user clicked the download button.
- `session_end`: page unload or periodic final heartbeat, used to estimate dwell time.

Server-side compression events should be the source of truth for success, errors, file size, target size, result size, target reached, and rasterization.

Client-side events should cover user flow steps that happen before upload or outside the server job lifecycle, such as file selection and download click.

## File Name And Classification

The first version records the uploaded file name because the owner needs to understand whether users are compressing design files, presentations, resumes, forms, or other resources.

Do record:

- Original uploaded file name.
- File size.
- Target compression size.
- Rule-based file category.

Do not record:

- PDF file contents.
- Compressed output file contents.
- PDF page count.
- PDF dimensions.
- Extracted PDF text.
- Email, name, or account identifiers.

Classification is based only on the file name, using simple keyword rules:

- `presentation`: `presentation`, `slides`, `slide`, `deck`, `keynote`, `ppt`
- `design`: `portfolio`, `design`, `figma`, `mockup`, `ui`, `ux`, `brochure`
- `resume`: `resume`, `cv`
- `document`: `form`, `application`, `report`, `invoice`, `contract`
- `academic`: `paper`, `thesis`, `assignment`, `research`
- `scan`: `scan`, `scanned`
- `other`: no rule matched

## Admin Dashboard

The first admin page should show:

- Overview cards:
  - Today page views.
  - 7-day page views.
  - 30-day page views.
  - Today compression count.
  - Today download count.
  - Compression success rate.
- Acquisition:
  - Source domains.
  - Direct traffic.
  - UTM source / medium / campaign.
- Funnel:
  - Page view.
  - File selected.
  - Compression started.
  - Compression success.
  - Download clicked.
- Behavior quality:
  - Average dwell time.
  - Bounce estimate.
- Compression analytics:
  - Upload size buckets.
  - Target size buckets.
  - Result size buckets.
  - Reached target rate.
  - Rasterized rate.
  - Error reasons.
- File analytics:
  - File category distribution.
  - Common file-name keywords.
  - Recent uploaded file names.
- Recent events:
  - Latest 100 events with timestamp, event, source, country, device, category, and key parameters.

## Privacy Copy Update

The privacy page should mention that TinyPDF records operational analytics, including uploaded file names, file sizes, target sizes, compression results, and browser interaction events, to improve the service.

It should also state that TinyPDF does not store PDF file contents or compressed PDF outputs for analytics.

## Implementation Notes

Keep implementation inside the existing native Node server and static frontend style.

Expected files:

- `server-simple.js`: analytics event append, admin auth, admin summary APIs.
- `public/app-simple.js`: client behavior events.
- `public/admin.html`: admin UI.
- `public/admin.js`: dashboard fetching and rendering.
- `public/styles.css`: admin styles, reusing existing visual language.
- `public/privacy.html`: privacy copy update.
- `test/analytics-admin.test.js`: focused tests for classification, event append, summary aggregation, and auth behavior.

## Non-Goals

Do not add:

- A paid analytics vendor.
- A new database service.
- User accounts.
- Full session replay.
- Heatmaps.
- PDF content parsing.
- PDF page or dimension analysis.
- A complex BI-style dashboard.

## Migration Path

If traffic grows and JSONL becomes slow, migrate the same event shape to SQLite. The admin UI and event names should remain stable so the migration is mostly a storage-layer change.
