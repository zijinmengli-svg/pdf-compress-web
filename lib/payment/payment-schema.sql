-- Product-neutral payment order storage. Existing TinyPDF credit grants remain in reward_ledger.
CREATE TABLE IF NOT EXISTS payment_orders (
  order_id text PRIMARY KEY,
  product_key text NOT NULL,
  offer_key text NOT NULL,
  subject_namespace text NOT NULL,
  subject_id text NOT NULL,
  subject_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  price_id text NOT NULL,
  product_id text NOT NULL,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  paid_quantity integer CHECK (paid_quantity > 0),
  entitlement_units integer NOT NULL CHECK (entitlement_units > 0),
  customer_amount_minor bigint CHECK (customer_amount_minor > 0),
  customer_currency char(3),
  transaction_id text,
  refund_adjustment_id text,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'refund_pending', 'refund_review', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, environment, transaction_id)
);
CREATE INDEX IF NOT EXISTS payment_orders_subject_idx ON payment_orders(product_key, subject_namespace, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON payment_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_order_events (
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  event_id text NOT NULL,
  order_id text REFERENCES payment_orders(order_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, environment, event_id)
);
