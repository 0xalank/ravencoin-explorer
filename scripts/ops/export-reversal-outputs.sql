\set ON_ERROR_STOP on
SET statement_timeout = 0;
SET enable_seqscan = off;

CREATE TEMP TABLE reversal_txids (txid char(64) PRIMARY KEY);
\copy reversal_txids (txid) FROM '/tmp/rvn-confirmed-txids.txt'
ANALYZE reversal_txids;

COPY (
  SELECT
    trim(o.txid) AS txid,
    o.vout_index,
    a.address AS output_address,
    o.value_rvn,
    o.script_type,
    o.asset_name,
    o.asset_amount,
    o.asset_type
  FROM reversal_txids r
  CROSS JOIN LATERAL (
    SELECT txid, vout_index, value_rvn, script_type, asset_name, asset_amount, asset_type
    FROM tx_outputs
    WHERE txid = r.txid
    OFFSET 0
  ) o
  LEFT JOIN LATERAL (
    SELECT address
    FROM output_addresses
    WHERE txid = o.txid AND vout_index = o.vout_index
    OFFSET 0
  ) a ON true
  ORDER BY o.txid, o.vout_index, a.address
) TO '/tmp/rvn-reversed-transactions-outputs.csv'
WITH (FORMAT csv, HEADER true);
