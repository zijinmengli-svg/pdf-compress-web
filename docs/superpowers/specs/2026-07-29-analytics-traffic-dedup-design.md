# TinyPDF Analytics Traffic Deduplication Design

Date: 2026-07-29

## Goal

Keep every raw analytics event for audit and export, while changing the admin dashboard's primary traffic metrics to show deduplicated, bot-filtered effective traffic. The fix must remove the observed automated DEV campaign burst without discarding legitimate compression or download activity.

## Confirmed Failure Pattern

The exported monthly analytics contain one uncertain Italian DEV visit followed by 19 automated-looking US visits:

- all 19 use desktop Chrome;
- all have an empty referrer;
- every visit creates a new client and session identifier;
- the visits arrive serially during a 66-minute window;
- 13 sessions end after exactly 28 or 29 seconds and six end without a session event;
- none selects a file, starts compression, completes compression, or downloads a file.

The current dashboard trusts client-generated identifiers and only rejects known bot User-Agent strings. A browser automation service using an ordinary Chrome User-Agent and a clean browser context therefore appears as a new visitor on every run.

## Selected Approach

Use reversible filtering at summary time, strengthened by new server-side and client-side signals.

Raw JSONL storage and CSV export remain unchanged in meaning: they continue to include every accepted event. The admin summary calculates a separate effective event view, and the dashboard uses that effective view for page views, visitors, trends, sources, and promotion attribution.

This is preferred over deleting events during ingestion because false positives remain inspectable and the filter can be improved retroactively.

## Event Signals

### Anonymous server fingerprint

For new events, the server adds `trafficFingerprint`, an HMAC digest derived from:

- the best available client IP header;
- the normalized User-Agent.

The digest uses `ANALYTICS_FINGERPRINT_SECRET`, falling back to the existing web-session secret. Only a truncated HMAC is stored; the raw IP address is never written to analytics.

If no usable IP is available, the fingerprint is empty and the summary falls back to existing client and session identifiers.

### Human interaction

The homepage sends one `human_interaction` event per session after the first genuine user action:

- pointer or touch input;
- keyboard input;
- a meaningful scroll.

Existing product events such as `file_selected`, `compress_started`, `compress_success`, and `download_clicked` also prove engagement. Duration alone never proves human activity because the observed automation consistently remained open for about 29 seconds.

## Traffic Classification

Classification is implemented as a pure analytics function so it can be regression-tested with real-shaped event fixtures.

### Canonical visitor

Use the following order:

1. `trafficFingerprint`;
2. `clientId`;
3. `sessionId`.

### Reload deduplication

For effective page-view metrics, count at most one page view for the same canonical visitor, path, and attribution within a rolling 30-minute window. Raw page-view counts remain available separately.

### Fingerprint burst detection

Exclude page views from a fingerprint window when all of the following are true:

- at least four distinct client IDs appear within 60 minutes;
- the events share the same attribution and page path;
- the window has no human interaction or product event.

If a session has a product event, it is never removed by traffic filtering.

### Legacy burst detection

Historical events do not have a server fingerprint. For those events, group page views by:

- UTM source, campaign, and content;
- country;
- device and browser;
- referrer.

Mark a rolling 90-minute cluster as automated only when all conditions hold:

- at least eight distinct client IDs occur;
- the referrer is empty;
- the cluster has no human interaction or product event;
- at least 80% of sessions either end between 25 and 35 seconds or have no `session_end`.

This rule catches the confirmed 19-visit burst while avoiding small campaigns and preserving any cohort that produces real interaction.

## Summary Contract

`summarizeAnalytics()` continues to return the existing fields, but the existing traffic fields become effective values:

- `overview.todayPageViews`;
- `overview.pageViews7d`;
- `overview.pageViews30d`;
- `overview.uniqueVisitors7d`;
- `overview.uniqueVisitors30d`;
- daily trends;
- source and promotion traffic;
- funnel `page_view`.

It also adds:

- `overview.rawPageViews30d`;
- `overview.rawUniqueVisitors30d`;
- `trafficQuality.excludedPageViews30d`;
- `trafficQuality.excludedVisitors30d`;
- `trafficQuality.reasons`;
- raw and excluded visits per promotion row.

Compression, error, and download metrics continue to use the original events. CSV export continues to export raw events.

## Admin Presentation

The four main cards display effective values.

Page-view and visitor cards show a footnote such as:

`原始 61，已过滤 19 次异常访问`

The promotion table displays:

- effective visits;
- effective visitors;
- filtered visits;
- compression;
- downloads.

This makes a row such as the DEV campaign auditable without allowing bot traffic to dominate the main totals.

## Failure Handling

- Missing fingerprint: use legacy identifiers and classification.
- Missing or malformed timestamps: keep the raw event but do not use it in time-window classification.
- Missing `session_end`: treat duration as unknown, not zero.
- Any product interaction: preserve the session in effective traffic.
- Classifier failure: fall back to unfiltered traffic and expose an empty exclusion summary rather than breaking the admin API.

## Testing

Add regression tests before implementation:

1. The 19-session US Chrome pattern is excluded from effective traffic.
2. Raw traffic remains 19 higher than effective traffic.
3. The uncertain isolated Italian visit remains.
4. A legitimate campaign burst with `human_interaction` remains.
5. A session with file selection or compression remains even if its surrounding signature looks suspicious.
6. Repeated reloads from one fingerprint within 30 minutes count as one effective page view.
7. The same fingerprint after 30 minutes counts as another effective page view when it is not part of an automated burst.
8. Promotion rows expose raw, effective, and filtered visits.
9. CSV export still contains all raw events.
10. Server fingerprints are stable for the same IP and User-Agent, change when either input changes, and never expose the IP.

## Out of Scope

- Deleting or rewriting the production JSONL file.
- Changing compression, job security, or download behavior.
- Replacing GA4 reporting.
- Changing the dashboard's UTC day boundary; timezone correction is a separate issue.

## Success Criteria

- The exported July data recalculates from 61 raw page views and 47 raw visitors to 42 effective page views and 28 effective visitors when the 19 confirmed automated sessions are filtered.
- The admin dashboard visibly reports the 19 excluded visits.
- All existing analytics, session-security, compression, and integration tests pass.
- Raw CSV export remains byte-for-byte equivalent in event coverage.
