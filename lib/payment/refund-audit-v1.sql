CREATE TABLE IF NOT EXISTS payment_refund_requests (
  id uuid PRIMARY KEY,
  order_id text NOT NULL REFERENCES payment_orders(order_id) ON DELETE RESTRICT,
  admin_actor text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('duplicate','service_not_delivered','other')),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_refund_requests_order_idx ON payment_refund_requests(order_id, created_at DESC);
