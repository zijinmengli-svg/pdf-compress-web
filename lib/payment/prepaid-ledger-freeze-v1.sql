-- Older preview schemas did not support reversible refund freezes.
ALTER TABLE reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_status_check;
ALTER TABLE reward_ledger ADD CONSTRAINT reward_ledger_status_check
  CHECK (status IN ('active', 'consumed', 'expired', 'frozen', 'revoked'));
ALTER TABLE reward_ledger_events DROP CONSTRAINT IF EXISTS reward_ledger_events_event_type_check;
ALTER TABLE reward_ledger_events ADD CONSTRAINT reward_ledger_events_event_type_check
  CHECK (event_type IN ('granted', 'spent', 'expired', 'frozen', 'restored', 'revoked'));
