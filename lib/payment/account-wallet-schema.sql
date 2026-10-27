-- Additive mapping: production auth_accounts remains the only account authority.
CREATE TABLE IF NOT EXISTS account_wallets (
  account_id uuid PRIMARY KEY REFERENCES auth_accounts(id) ON DELETE RESTRICT,
  wallet_hash text NOT NULL UNIQUE REFERENCES reward_wallets(wallet_hash),
  created_at timestamptz NOT NULL DEFAULT now()
);
