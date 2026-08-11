CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_state (
  id text PRIMARY KEY,
  chain text NOT NULL DEFAULT 'main',
  best_height bigint NOT NULL DEFAULT -1,
  best_hash char(64),
  raw_height bigint NOT NULL DEFAULT -1,
  raw_hash char(64),
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'ready', 'error', 'reorg')),
  target_height bigint,
  started_at timestamptz,
  indexed_at timestamptz,
  raw_indexed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sync_state (id) VALUES ('ravencoin-mainnet')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS raw_height bigint NOT NULL DEFAULT -1;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS raw_hash char(64);
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS raw_indexed_at timestamptz;
UPDATE sync_state SET raw_height = best_height, raw_hash = best_hash, raw_indexed_at = indexed_at
WHERE raw_height < best_height;

CREATE TABLE IF NOT EXISTS blocks (
  height bigint PRIMARY KEY,
  hash char(64) NOT NULL UNIQUE,
  previous_hash char(64),
  time timestamptz NOT NULL,
  size integer NOT NULL DEFAULT 0,
  weight integer,
  tx_count integer NOT NULL DEFAULT 0,
  confirmations integer NOT NULL DEFAULT 0,
  difficulty numeric(30, 8),
  version bigint,
  merkle_root char(64),
  nonce numeric(20, 0),
  bits varchar(16),
  chainwork text,
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blocks_time_idx ON blocks (time DESC);

CREATE TABLE IF NOT EXISTS transactions (
  txid char(64) PRIMARY KEY,
  block_height bigint NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  block_hash char(64) NOT NULL,
  tx_index integer NOT NULL,
  time timestamptz NOT NULL,
  size integer,
  vsize integer,
  weight integer,
  version integer,
  locktime bigint,
  total_input_rvn numeric(28, 8),
  total_output_rvn numeric(28, 8) NOT NULL DEFAULT 0,
  fee_rvn numeric(28, 8),
  UNIQUE (block_height, tx_index)
);

CREATE INDEX IF NOT EXISTS transactions_block_idx ON transactions (block_height DESC, tx_index);

CREATE TABLE IF NOT EXISTS tx_outputs (
  txid char(64) NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
  vout_index integer NOT NULL,
  value_rvn numeric(28, 8) NOT NULL DEFAULT 0,
  script_type text,
  script_hex text,
  asset_name text,
  asset_amount numeric(38, 8),
  asset_type text,
  spent_by_txid char(64) REFERENCES transactions(txid) ON DELETE SET NULL,
  spent_by_vin integer,
  PRIMARY KEY (txid, vout_index)
);


CREATE TABLE IF NOT EXISTS output_addresses (
  txid char(64) NOT NULL,
  vout_index integer NOT NULL,
  address text NOT NULL,
  PRIMARY KEY (txid, vout_index, address),
  FOREIGN KEY (txid, vout_index) REFERENCES tx_outputs(txid, vout_index) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS output_addresses_address_idx ON output_addresses (address, txid);

CREATE TABLE IF NOT EXISTS tx_inputs (
  txid char(64) NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
  vin_index integer NOT NULL,
  prev_txid char(64),
  prev_vout integer,
  coinbase text,
  sequence numeric(20, 0),
  addresses text[] NOT NULL DEFAULT '{}',
  value_rvn numeric(28, 8),
  asset_name text,
  asset_amount numeric(38, 8),
  PRIMARY KEY (txid, vin_index)
);


CREATE TABLE IF NOT EXISTS address_transactions (
  address text NOT NULL,
  txid char(64) NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
  block_height bigint NOT NULL,
  tx_index integer NOT NULL,
  PRIMARY KEY (address, txid)
);

CREATE INDEX IF NOT EXISTS address_transactions_recent_idx ON address_transactions (address, block_height DESC, tx_index DESC);
CREATE INDEX IF NOT EXISTS address_transactions_window_idx ON address_transactions (block_height DESC, address);

CREATE TABLE IF NOT EXISTS address_activity (
  id bigserial PRIMARY KEY,
  address text NOT NULL,
  txid char(64) NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
  block_height bigint NOT NULL,
  tx_index integer NOT NULL,
  io_index integer NOT NULL,
  direction text NOT NULL CHECK (direction IN ('receive', 'send')),
  asset_name text NOT NULL DEFAULT 'RVN',
  amount numeric(38, 8) NOT NULL,
  UNIQUE (address, txid, direction, io_index, asset_name)
);


CREATE TABLE IF NOT EXISTS address_balances (
  address text NOT NULL,
  asset_name text NOT NULL DEFAULT 'RVN',
  balance numeric(38, 8) NOT NULL DEFAULT 0,
  received numeric(38, 8) NOT NULL DEFAULT 0,
  sent numeric(38, 8) NOT NULL DEFAULT 0,
  updated_height bigint NOT NULL,
  PRIMARY KEY (address, asset_name)
);

CREATE INDEX IF NOT EXISTS address_balances_rich_list_idx ON address_balances (balance DESC, address) WHERE asset_name = 'RVN' AND balance > 0;

-- These indexes duplicate primary-key access paths or are unused by current explorer queries.
-- Removing them during historical synchronization avoids maintaining millions of unnecessary entries.
DROP INDEX IF EXISTS transactions_time_idx;
DROP INDEX IF EXISTS tx_outputs_unspent_idx;
DROP INDEX IF EXISTS tx_outputs_asset_idx;
DROP INDEX IF EXISTS tx_inputs_previous_idx;
DROP INDEX IF EXISTS address_activity_history_idx;
DROP INDEX IF EXISTS address_activity_asset_idx;
DROP INDEX IF EXISTS address_balances_asset_idx;
DROP INDEX IF EXISTS address_balances_rvn_idx;

CREATE TABLE IF NOT EXISTS assets (
  name text PRIMARY KEY,
  amount numeric(38, 8) NOT NULL DEFAULT 0,
  units smallint NOT NULL DEFAULT 0,
  reissuable boolean NOT NULL DEFAULT false,
  has_ipfs boolean NOT NULL DEFAULT false,
  ipfs_hash text,
  txid_hash text,
  created_height bigint,
  created_hash char(64),
  last_seen_height bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_name_pattern_idx ON assets (name text_pattern_ops);
CREATE INDEX IF NOT EXISTS assets_created_idx ON assets (created_height DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS asset_sync_queue (
  asset_name text PRIMARY KEY,
  seen_height bigint,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_transfers (
  id bigserial PRIMARY KEY,
  asset_name text NOT NULL,
  txid char(64) NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
  block_height bigint NOT NULL,
  tx_index integer NOT NULL,
  vout_index integer NOT NULL,
  transfer_type text NOT NULL DEFAULT 'transfer',
  amount numeric(38, 8) NOT NULL,
  from_addresses text[] NOT NULL DEFAULT '{}',
  to_addresses text[] NOT NULL DEFAULT '{}',
  UNIQUE (txid, vout_index, asset_name)
);

CREATE INDEX IF NOT EXISTS asset_transfers_asset_recent_idx ON asset_transfers (asset_name, block_height DESC, tx_index DESC);
CREATE INDEX IF NOT EXISTS asset_transfers_tx_idx ON asset_transfers (txid);

INSERT INTO schema_migrations (version) VALUES (1)
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES (2)
ON CONFLICT (version) DO NOTHING;
