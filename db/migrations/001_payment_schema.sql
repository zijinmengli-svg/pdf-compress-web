CREATE TABLE IF NOT EXISTS payment_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  billing_enabled boolean NOT NULL DEFAULT false,
  paddle_product_id text NOT NULL,
  paddle_price_id text NOT NULL,
  usd_amount_minor bigint NOT NULL CHECK (usd_amount_minor > 0),
  cny_amount_minor bigint NOT NULL CHECK (cny_amount_minor > 0),
  tax_mode text NOT NULL DEFAULT 'location',
  version bigint NOT NULL DEFAULT 1,
  last_sync_status text NOT NULL DEFAULT 'never',
  last_sync_error text NOT NULL DEFAULT '',
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_setting_audits (
  id uuid PRIMARY KEY,
  admin_session_hash text NOT NULL,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  paddle_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  public_token_hash text NOT NULL UNIQUE,
  job_id text NOT NULL UNIQUE,
  anonymous_identity_hash text NOT NULL,
  payment_status text NOT NULL CHECK (payment_status IN ('not_required', 'unpaid', 'pending', 'paid', 'refund_pending', 'refunded', 'chargeback')),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN ('compressed', 'storing', 'stored', 'available', 'expired', 'failed')),
  paddle_transaction_id text UNIQUE,
  paddle_customer_id text,
  paddle_product_id text,
  paddle_price_id text,
  original_bytes bigint NOT NULL CHECK (original_bytes > 0),
  target_bytes bigint NOT NULL CHECK (target_bytes > 0),
  result_bytes bigint NOT NULL CHECK (result_bytes > 0),
  reached_target boolean NOT NULL,
  language text NOT NULL,
  country text NOT NULL DEFAULT '',
  price_amount_minor bigint NOT NULL CHECK (price_amount_minor > 0),
  price_currency char(3) NOT NULL,
  source text NOT NULL,
  source_category text NOT NULL,
  source_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  compressed_at timestamptz NOT NULL,
  paid_at timestamptz,
  download_url_issued_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders(payment_status, fulfillment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_expiry_idx ON orders(expires_at);

CREATE TABLE IF NOT EXISTS free_grants (
  anonymous_identity_hash text PRIMARY KEY,
  consumed_order_id uuid NOT NULL REFERENCES orders(id),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restore_reason text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_financials (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  transaction_currency char(3) NOT NULL,
  customer_subtotal_minor bigint NOT NULL,
  customer_discount_minor bigint NOT NULL,
  customer_tax_minor bigint NOT NULL,
  customer_total_minor bigint NOT NULL,
  paddle_fee_minor bigint NOT NULL,
  transaction_earnings_minor bigint NOT NULL,
  payout_currency char(3) NOT NULL,
  payout_subtotal_minor bigint NOT NULL,
  payout_tax_minor bigint NOT NULL,
  payout_fee_minor bigint NOT NULL,
  payout_earnings_minor bigint NOT NULL,
  payout_exchange_rate text NOT NULL,
  adjusted_payout_earnings_minor bigint NOT NULL,
  reconciled_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source text NOT NULL,
  provider_event_id text,
  payment_status text NOT NULL,
  fulfillment_status text NOT NULL,
  customer_amount_minor bigint NOT NULL DEFAULT 0,
  customer_currency char(3) NOT NULL,
  revenue_delta_minor bigint NOT NULL DEFAULT 0,
  revenue_currency char(3) NOT NULL DEFAULT 'USD',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS order_events_provider_unique ON order_events(provider_event_id, event_type) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_events_order_time_idx ON order_events(order_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  transaction_id text,
  payload_hash text NOT NULL,
  resource_id text,
  order_hint uuid,
  processing_status text NOT NULL DEFAULT 'queued' CHECK (processing_status IN ('queued', 'processing', 'processed', 'failed', 'ignored')),
  processing_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  processing_result text NOT NULL DEFAULT '',
  safe_error text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS webhook_receipts_claim_idx ON webhook_receipts(processing_status, next_attempt_at);

CREATE TABLE IF NOT EXISTS checkout_attempts (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  attempt_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('created', 'uploading', 'uploaded', 'paddle_creating', 'reconcile_pending', 'ready', 'failed', 'canceled')),
  paddle_transaction_id text UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_safe_error text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_attempts_one_active ON checkout_attempts(order_id) WHERE state IN ('created', 'uploading', 'uploaded', 'paddle_creating', 'reconcile_pending', 'ready');

CREATE TABLE IF NOT EXISTS file_objects (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'r2'),
  bucket text NOT NULL,
  object_key text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 text NOT NULL,
  storage_status text NOT NULL CHECK (storage_status IN ('stored', 'delete_pending', 'deleted', 'delete_failed')),
  stored_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  delete_attempts integer NOT NULL DEFAULT 0,
  last_delete_error text NOT NULL DEFAULT '',
  next_delete_retry_at timestamptz,
  delete_lease_expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS file_objects_cleanup_idx ON file_objects(storage_status, expires_at, next_delete_retry_at);
