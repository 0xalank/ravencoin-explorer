\set ON_ERROR_STOP on
SET statement_timeout = 0;
SET enable_seqscan = off;

CREATE TEMP TABLE reversal_txids (txid char(64) PRIMARY KEY);
\copy reversal_txids (txid) FROM '/tmp/rvn-confirmed-txids.txt'
ANALYZE reversal_txids;

COPY (
  SELECT
    trim(origin.txid) AS origin_txid,
    origin.vout_index AS origin_vout_index,
    origin_address.address AS origin_output_address,
    origin.value_rvn AS origin_value_rvn,
    trim(origin.spent_by_txid) AS spent_by_txid,
    origin.spent_by_vin,
    spending.block_height AS spent_height,
    child.vout_index AS spent_vout_index,
    child_address.address AS spent_output_address,
    child.value_rvn AS spent_value_rvn,
    child.script_type AS spent_script_type
  FROM reversal_txids r
  CROSS JOIN LATERAL (
    SELECT txid, vout_index, value_rvn, spent_by_txid, spent_by_vin
    FROM tx_outputs
    WHERE txid = r.txid AND spent_by_txid IS NOT NULL
    OFFSET 0
  ) origin
  LEFT JOIN LATERAL (
    SELECT address
    FROM output_addresses
    WHERE txid = origin.txid AND vout_index = origin.vout_index
    OFFSET 0
  ) origin_address ON true
  JOIN transactions spending ON spending.txid = origin.spent_by_txid
  CROSS JOIN LATERAL (
    SELECT txid, vout_index, value_rvn, script_type
    FROM tx_outputs
    WHERE txid = origin.spent_by_txid
    OFFSET 0
  ) child
  LEFT JOIN LATERAL (
    SELECT address
    FROM output_addresses
    WHERE txid = child.txid AND vout_index = child.vout_index
    OFFSET 0
  ) child_address ON true
  ORDER BY origin.txid, origin.vout_index, child.vout_index, child_address.address
) TO '/tmp/rvn-reversed-transactions-spends.csv'
WITH (FORMAT csv, HEADER true);
