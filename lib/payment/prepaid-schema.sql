-- Additive prepaid schema for the deployed auth_accounts identity.
-- Apply after lib/auth/schema.sql; do not apply the preview branch's email_accounts migrations.
CREATE TABLE IF NOT EXISTS reward_wallets (
  id uuid PRIMARY KEY,
  wallet_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES reward_wallets(id) ON DELETE RESTRICT,
  grant_type text NOT NULL CHECK (grant_type IN ('welcome', 'purchase', 'admin')),
  amount integer NOT NULL CHECK (amount > 0),
  remaining_amount integer NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  expires_at timestamptz NOT NULL,
  source_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'frozen', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_ledger_wallet_active_idx ON reward_ledger(wallet_id, status, expires_at, created_at);

CREATE TABLE IF NOT EXISTS reward_ledger_events (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES reward_wallets(id) ON DELETE RESTRICT,
  ledger_id uuid REFERENCES reward_ledger(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('granted', 'spent', 'expired', 'frozen', 'restored', 'revoked')),
  amount integer NOT NULL CHECK (amount > 0),
  job_id text,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_purchases (
  transaction_id text PRIMARY KEY,
  wallet_hash text NOT NULL REFERENCES reward_wallets(wallet_hash) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES auth_accounts(id) ON DELETE RESTRICT,
  paddle_price_id text NOT NULL,
  paddle_product_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  customer_amount_minor bigint NOT NULL CHECK (customer_amount_minor > 0),
  customer_currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refund_pending', 'refund_review', 'refunded')),
  refund_adjustment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_purchases_account_idx ON credit_purchases(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_purchases_wallet_idx ON credit_purchases(wallet_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS prepaid_webhook_receipts (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  transaction_id text,
  resource_id text,
  payload_hash text NOT NULL,
  processing_status text NOT NULL DEFAULT 'queued' CHECK (processing_status IN ('queued', 'processing', 'processed', 'failed')),
  processing_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  safe_error text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS prepaid_webhook_claim_idx ON prepaid_webhook_receipts(processing_status, next_attempt_at);
