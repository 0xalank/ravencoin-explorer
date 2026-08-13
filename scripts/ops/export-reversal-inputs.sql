\set ON_ERROR_STOP on
SET statement_timeout = 0;
SET enable_seqscan = off;

CREATE TEMP TABLE reversal_txids (txid char(64) PRIMARY KEY);
\copy reversal_txids (txid) FROM '/tmp/rvn-confirmed-txids.txt'
ANALYZE reversal_txids;

COPY (
  SELECT
    trim(i.txid) AS txid,
    i.vin_index,
    trim(i.prev_txid) AS prev_txid,
    i.prev_vout,
    address.input_address,
    i.value_rvn,
    i.asset_name,
    i.asset_amount
  FROM reversal_txids r
  CROSS JOIN LATERAL (
    SELECT txid, vin_index, prev_txid, prev_vout, addresses, value_rvn, asset_name, asset_amount
    FROM tx_inputs
    WHERE txid = r.txid
    OFFSET 0
  ) i
  LEFT JOIN LATERAL unnest(i.addresses) address(input_address) ON true
  ORDER BY i.txid, i.vin_index, address.input_address
) TO '/tmp/rvn-reversed-transactions-inputs.csv'
WITH (FORMAT csv, HEADER true);
