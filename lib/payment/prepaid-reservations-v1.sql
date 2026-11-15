CREATE TABLE IF NOT EXISTS prepaid_job_reservations (
  job_id text PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES reward_wallets(id) ON DELETE RESTRICT,
  ledger_id uuid NOT NULL REFERENCES reward_ledger(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('reserved', 'spent', 'released', 'review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prepaid_job_reservations_status_idx ON prepaid_job_reservations(status, created_at);
