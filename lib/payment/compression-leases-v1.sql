ALTER TABLE compression_daily_claims ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE prepaid_job_reservations ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS compression_daily_expired_idx
  ON compression_daily_claims(lease_expires_at) WHERE NOT spent AND lease_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS compression_paid_expired_idx
  ON prepaid_job_reservations(lease_expires_at) WHERE status='reserved' AND lease_expires_at IS NOT NULL;
