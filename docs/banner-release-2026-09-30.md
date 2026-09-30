# Configurable image banner — 2026-09-30

Scope: image banner only. No compression, payment, referral or Sketch UI changes.

Admin `/admin.html` → 顶部 Banner: upload a static PNG/JPEG exactly 1920×40px, at most 1MB; enter an HTTPS destination; enable and save. Default disabled. The public image scales at 48:1, opens a new tab on click, and has an independent close control. Closing is remembered per browser tab session and configuration version. Updating configuration makes the new version visible again.

Persistence uses the existing DATABASE_URL, with additive `site_banner` and `banner_click_events` tables. No R2 or ephemeral-file storage. Keep database backups as for existing analytics. A database outage hides the public banner and reports an admin error; compression does not depend on banner availability.

Click metrics count accepted clicks, not unique visitors. Duplicate request UUIDs are ignored; same-origin signed website session required, 30 requests/minute/session. Browser blocking/network failures can undercount. Admin shows all-time and current-version counts. Re-saving creates a new version. Click events also enter existing analytics best-effort. This is not a fraud-proof reward system.

Validation: `npm test`, `node test/banner.test.js`, `node test/banner-routes.test.js`. Database tests use pg-mem, not a live PostgreSQL instance. Browser checks used the actual Node server with an isolated in-memory test DB: login, save, homepage ratio, click count, close/reload. Production DB persistence still needs deployment smoke verification.

Rollback: disable in admin for immediate removal on next page load, or redeploy prior commit `29ab23982e461ff537463562d7082e11c67de258`. Tables are additive and need not be deleted. The unfinished Sketch changes remain in the original separate worktree and are not part of this release.
