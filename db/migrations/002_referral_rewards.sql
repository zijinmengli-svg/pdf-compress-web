CREATE TABLE IF NOT EXISTS reward_wallets (
  id uuid PRIMARY KEY,
  wallet_hash text NOT NULL UNIQUE,
  legacy_identity_hash text,
  first_successful_download_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_wallets_legacy_identity_idx ON reward_wallets(legacy_identity_hash);

CREATE TABLE IF NOT EXISTS referral_invite_codes (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES reward_wallets(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_invite_codes_wallet_unique ON referral_invite_codes(wallet_id);

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY,
  inviter_wallet_id uuid NOT NULL REFERENCES reward_wallets(id),
  invitee_wallet_id uuid NOT NULL UNIQUE REFERENCES reward_wallets(id),
  invite_code_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('opened', 'started', 'compressed', 'downloaded', 'rewarded', 'blocked', 'cap_reached')),
  first_compression_job_id text,
  first_download_token_id text,
  first_download_at timestamptz,
  blocked_reason text NOT NULL DEFAULT '',
  risk jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_inviter_status_idx ON referrals(inviter_wallet_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS referrals_status_time_idx ON referrals(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES reward_wallets(id) ON DELETE CASCADE,
  grant_type text NOT NULL CHECK (grant_type IN ('welcome', 'referral_inviter', 'referral_friend', 'admin')),
  amount integer NOT NULL CHECK (amount > 0),
  remaining_amount integer NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  expires_at timestamptz NOT NULL,
  source_referral_id uuid REFERENCES referrals(id),
  source_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_ledger_wallet_active_idx ON reward_ledger(wallet_id, status, expires_at, created_at);
CREATE INDEX IF NOT EXISTS reward_ledger_expiry_idx ON reward_ledger(status, expires_at);

CREATE TABLE IF NOT EXISTS reward_ledger_events (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES reward_wallets(id) ON DELETE CASCADE,
  ledger_id uuid REFERENCES reward_ledger(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('granted', 'spent', 'expired', 'revoked')),
  amount integer NOT NULL CHECK (amount > 0),
  job_id text,
  download_token_id text,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_ledger_events_wallet_time_idx ON reward_ledger_events(wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referral_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  daily_reward_cap integer NOT NULL DEFAULT 50 CHECK (daily_reward_cap >= 0 AND daily_reward_cap <= 500),
  reward_per_side integer NOT NULL DEFAULT 1 CHECK (reward_per_side = 1),
  reward_expiry_days integer NOT NULL DEFAULT 90 CHECK (reward_expiry_days = 90),
  wallet_cookie_days integer NOT NULL DEFAULT 365 CHECK (wallet_cookie_days = 365),
  max_referrals_per_inviter integer NOT NULL DEFAULT 20 CHECK (max_referrals_per_inviter = 20),
  timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK (timezone = 'Asia/Shanghai'),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO referral_settings(singleton, enabled, daily_reward_cap, reward_per_side, reward_expiry_days, wallet_cookie_days, max_referrals_per_inviter, timezone)
VALUES (true, false, 50, 1, 90, 365, 20, 'Asia/Shanghai')
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS referral_daily_counters (
  calendar_date date PRIMARY KEY,
  valid_friend_count integer NOT NULL DEFAULT 0 CHECK (valid_friend_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referral_audit_log (
  id uuid PRIMARY KEY,
  admin_session_hash text NOT NULL,
  action text NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_audit_log_time_idx ON referral_audit_log(created_at DESC);
