# TinyPDF Bing Growth And Capacity Design

## Intent

Grow TinyPDF to 500 unique overseas users who complete a compressed-PDF download in one calendar month, using Bing organic search rather than paid ads.

## Current Evidence

- Historical Bing traffic produced 81 page views, 74 visitors, 30 successful compressions, and 27 downloads.
- Most existing Bing traffic is domestic. The new program must optimize for English queries and overseas completed downloads.
- Production runs on Render Free from `origin/feat/paddle-single-payment`.
- Render Free provides 0.1 CPU and 512 MB RAM, sleeps after 15 idle minutes, and cannot scale beyond one instance.
- The server currently buffers uploads in memory, accepts two simultaneous upload parsers, and allows five Ghostscript jobs to run concurrently.
- Five English target-size landing pages exist on `main` but are not present in the production branch or live sitemap.

## Success Metric

Primary metric: 500 distinct non-CN visitors with a `download_clicked` event in a rolling 30-day period.

Supporting metrics:

- 5,000 qualified overseas Bing visits per month, based on a conservative 10% visit-to-download target.
- At least 10 useful English pages indexed by Bing.
- At least 80% of Bing landing sessions retain first-touch source, landing page, country, and campaign attribution through download.
- Less than 2% of valid upload attempts receive a busy or capacity error.

## Product And Content Strategy

1. Publish the existing 1 MB, 2 MB, 5 MB, 10 MB, and 20 MB landing pages into the current production branch.
2. Add five intent pages for portfolios, job applications, Figma exports, email attachments, and preserving readable quality.
3. Every page must contain the working compressor, original problem-solving content, canonical metadata, internal links, and a useful FAQ. Pages must not be thin doorway pages.
4. Verify the site in Bing Webmaster Tools, submit the sitemap, and use IndexNow after deploys.
5. Measure overseas Bing downloads, not generic impressions or page views.

## Capacity Strategy

Five hundred monthly downloads is only about 17 downloads per day. At the observed average compression time of roughly 282 seconds, average concurrent work remains well below one job. The average volume is feasible on one instance; burst behavior is the risk.

Before increasing traffic:

- Make upload and compression concurrency configurable.
- Default Render Free to one active Ghostscript job and one in-flight upload.
- Return a retryable `429` response with `Retry-After` when the instance is full.
- Add a bounded in-memory queue only after load tests show that immediate rejection is materially harming valid users.
- Run representative 10 MB, 40 MB, and 100 MB tests while collecting process RSS, job duration, and error rate.

Render Free is acceptable for the first controlled rollout but not a reliable production promise. Move to at least Render `0.5c-512mb` when cold starts or CPU saturation materially reduce conversions. Move to `1c-2g` before allowing multiple server-side Ghostscript jobs or sustained large-file bursts.

## Constraints

- Preserve the current live UI, analytics dashboard, payment-disabled behavior, banner, attribution, and compression fixes.
- Use the current production branch as the merge base. Do not deploy `main` over production.
- Remain free to users and use no paid search advertising in this phase.
- Do not create mass-generated, near-duplicate, or misleading SEO pages.
- Do not claim that IndexNow or sitemap submission guarantees ranking.

## Rollout

1. Establish a production-derived worktree and add regression tests.
2. Ship target-size pages and sitemap changes.
3. Verify Bing indexing and submit URLs through IndexNow.
4. Ship capacity guards and load-test them.
5. Publish one new intent page per week and review Bing query/download data weekly.
6. Upgrade compute only when measured saturation or cold starts justify it.

