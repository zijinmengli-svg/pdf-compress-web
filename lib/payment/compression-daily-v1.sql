CREATE TABLE IF NOT EXISTS compression_daily_claims (
  scope text NOT NULL,
  starts_at timestamptz NOT NULL,
  job_id text NOT NULL,
  spent boolean NOT NULL DEFAULT false,
  PRIMARY KEY (scope, starts_at)
);
CREATE INDEX IF NOT EXISTS compression_daily_claims_job_idx ON compression_daily_claims(job_id);
