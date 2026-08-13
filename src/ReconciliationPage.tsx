import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Database, Download,
  FileCheck2, FileJson2, Filter, GitCompareArrows, Search, ShieldCheck, XCircle,
} from 'lucide-react'
import { CopyButton, ErrorState, LoadingState, PageHeader } from './components'
import { useApi } from './lib/api'
import { useI18n } from './lib/i18n'
import { Link } from './lib/router'
import type { ReversalInput, ReversalOutput, ReversalSearchResult, ReversalTransaction } from './types'

const PAGE_SIZE = 50

interface ReversalFilters {
  q: string
  from: string
  to: string
  onward: string
  status: string
  reason: string
}

const EMPTY_FILTERS: ReversalFilters = { q: '', from: '', to: '', onward: '', status: '', reason: '' }

function readLocationState() {
  const params = new URLSearchParams(window.location.search)
  const parsedOffset = Number(params.get('offset') ?? 0)
  return {
    filters: {
      q: params.get('q') ?? params.get('txid') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      onward: params.get('onward') ?? '',
      status: params.get('status') ?? '',
      reason: params.get('reason') ?? '',
    },
    offset: Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0,
  }
}

function normalizedFilters(filters: ReversalFilters): ReversalFilters {
  return Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, value.trim()])) as unknown as ReversalFilters
}

function queryString(filters: ReversalFilters, offset?: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.onward) params.set('onward', filters.onward)
  if (filters.status) params.set('status', filters.status)
  if (filters.reason) params.set('reason', filters.reason)
  if (offset != null) {
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(offset))
  }
  return params.toString()
}

function exactRvn(value: string | null | undefined, locale: string) {
  if (value == null || !/^\d+(?:\.\d+)?$/.test(value)) return '—'
  const [whole, rawFraction = ''] = value.split('.')
  const fraction = rawFraction.replace(/0+$/, '')
  const groupedWhole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole))
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
  return `${groupedWhole}${fraction ? `${decimal}${fraction}` : ''} RVN`
}

function translatedReason(reason: string | null, t: (key: string, values?: Record<string, string | number>) => string) {
  if (!reason) return '—'
  const key = `reversal.reason.${reason}`
  const translated = t(key)
  return translated === key ? reason : translated
}

function evidenceValue(
  valueRvn: string | null,
  assetName: string | null,
  assetAmount: string | null,
  locale: string,
  unavailable: string,
) {
  if (assetName) return `${assetAmount ?? unavailable} ${assetName}`
  return valueRvn == null ? unavailable : exactRvn(valueRvn, locale)
}

function AddressLink({ address }: { address: string }) {
  return <Link className="reversal-address" href={`/address/${encodeURIComponent(address)}`}>{address}</Link>
}

function CanonicalEvidence({
  inputs,
  outputs,
  source,
  destination,
  locale,
  t,
}: {
  inputs: ReversalInput[]
  outputs: ReversalOutput[]
  source: string
  destination: string
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
}) {
  return <div className="reversal-evidence-grid">
    <section className="reversal-evidence-section">
      <h4>{t('reversal.row.inputs')} <span>{inputs.length}</span></h4>
      <div className="reversal-evidence-table-wrap">
        <table className="reversal-evidence-table">
          <thead><tr><th>{t('reversal.row.vin')}</th><th>{t('reversal.row.inputAddress')}</th><th>{t('reversal.row.previousOutput')}</th><th>{t('field.value')}</th></tr></thead>
          <tbody>{inputs.map((input) => <tr className={source && input.inputAddress === source ? 'reversal-evidence-match' : undefined} key={`${input.txid}-${input.vinIndex}`}>
            <td>#{input.vinIndex}</td>
            <td>{input.inputAddress ? <AddressLink address={input.inputAddress} /> : <span>{t('reversal.row.noAddress')}</span>}</td>
            <td><Link className="reversal-prevout" href={`/tx/${input.prevTxid}`}>{input.prevTxid}</Link><span className="reversal-vout-index">:{input.prevVout}</span></td>
            <td>{evidenceValue(input.valueRvn, input.assetName, input.assetAmount, locale, t('reversal.row.unavailable'))}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="reversal-evidence-section">
      <h4>{t('reversal.row.outputs')} <span>{outputs.length}</span></h4>
      <div className="reversal-evidence-table-wrap">
        <table className="reversal-evidence-table">
          <thead><tr><th>{t('reversal.row.vout')}</th><th>{t('reversal.row.outputAddress')}</th><th>{t('reversal.row.script')}</th><th>{t('field.value')}</th></tr></thead>
          <tbody>{outputs.map((output) => <tr className={destination && output.outputAddress === destination ? 'reversal-evidence-match' : undefined} key={`${output.txid}-${output.voutIndex}`}>
            <td>#{output.voutIndex}</td>
            <td>{output.outputAddress ? <AddressLink address={output.outputAddress} /> : <span>{t('reversal.row.noAddress')}</span>}</td>
            <td>{output.scriptType ?? t('reversal.row.unavailable')}</td>
            <td>{evidenceValue(output.valueRvn, output.assetName, output.assetAmount, locale, t('reversal.row.unavailable'))}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </div>
}

function ReversalResultRow({
  row,
  source,
  destination,
  onward,
  locale,
  t,
}: {
  row: ReversalTransaction
  source: string
  destination: string
  onward: string
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
}) {
  const canonical = row.evidenceCoverage === 'canonical-exact'
  const number = (value: number) => new Intl.NumberFormat(locale).format(value)
  return <article className="reversal-result">
    <div className="reversal-result-heading">
      <div className="reversal-result-identity">
        <span className={`reversal-status reversal-status--${canonical ? 'confirmed' : 'unreplayable'}`}>
          {canonical ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
          {canonical ? t('reversal.status.confirmed') : t('reversal.status.notReplayable')}
        </span>
        <span className={`reversal-coverage reversal-coverage--${canonical ? 'canonical' : 'summary'}`}>
          {canonical ? <ShieldCheck aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          {canonical ? t('reversal.coverage.canonicalBadge') : t('reversal.coverage.forkBadge')}
        </span>
        {row.fromForgedBlock && <span className="reversal-forged-label">{t('reversal.row.forgedBranch')}</span>}
      </div>
      <div className="reversal-result-txid">
        <span>{t('field.txid')}</span>
        <div>{canonical ? <Link href={`/tx/${row.txid}`}>{row.txid}</Link> : <code>{row.txid}</code>}<CopyButton value={row.txid} /></div>
      </div>
    </div>

    <div className="reversal-result-facts">
      <div><span>{t('reversal.row.forkHeight')}</span><strong>#{number(row.exploitChainHeight)}</strong></div>
      <div><span>{t('reversal.row.confirmedHeight')}</span><strong>{row.confirmedHeight == null ? '—' : <Link href={`/block/${row.confirmedHeight}`}>#{number(row.confirmedHeight)}</Link>}</strong></div>
      <div><span>{t('reversal.row.grossOutput')}</span><strong>{exactRvn(row.totalOutputRvn, locale)}</strong></div>
      {destination && <div className={canonical ? 'reversal-matched-value' : 'reversal-candidate-value'}>
        <span>{canonical ? t('reversal.row.matchedDestination') : t('reversal.row.candidateDestination')}</span>
        <strong>{canonical ? exactRvn(row.matchedOutputRvn, locale) : destination}</strong>
      </div>}
      {onward && canonical && <div className="reversal-onward-value">
        <span>{t('reversal.row.matchedOnward')}</span>
        <strong>{exactRvn(row.matchedOnwardOutputRvn, locale)}</strong>
      </div>}
      {!canonical && <div className="reversal-reason"><span>{t('reversal.row.reason')}</span><strong>{translatedReason(row.notReplayableReason, t)}</strong></div>}
    </div>

    <details className="reversal-evidence">
      <summary><Database aria-hidden="true" /><span>{t('reversal.row.showEvidence')}</span><small>{canonical ? t('reversal.coverage.canonicalBadge') : t('reversal.coverage.forkBadge')}</small></summary>
      {canonical && row.inputs && row.outputs
        ? <><CanonicalEvidence inputs={row.inputs} outputs={row.outputs} source={source} destination={destination} locale={locale} t={t} />
          {row.onwardSpends?.length ? <section className="reversal-onward-evidence"><h4>{t('reversal.row.onwardEvidence')} <span>{row.onwardSpends.length}</span></h4><p>{t('reversal.coverage.onward')}</p><div className="reversal-evidence-table-wrap"><table className="reversal-evidence-table"><thead><tr><th>{t('reversal.row.originOutput')}</th><th>{t('field.txid')}</th><th>{t('reversal.row.outputAddress')}</th><th>{t('field.value')}</th></tr></thead><tbody>{row.onwardSpends.map((spend) => <tr className={onward && spend.spentOutputAddress === onward ? 'reversal-evidence-match' : undefined} key={`${spend.originTxid}-${spend.originVoutIndex}-${spend.spentByTxid}-${spend.spentVoutIndex}-${spend.spentOutputAddress ?? ''}`}><td>#{spend.originVoutIndex} · {exactRvn(spend.originValueRvn, locale)}</td><td><Link className="reversal-prevout" href={`/tx/${spend.spentByTxid}`}>{spend.spentByTxid}</Link><span className="reversal-vout-index">:{spend.spentVoutIndex}</span></td><td>{spend.spentOutputAddress ? <AddressLink address={spend.spentOutputAddress} /> : t('reversal.row.noAddress')}</td><td>{exactRvn(spend.spentValueRvn, locale)}</td></tr>)}</tbody></table></div></section> : null}</>
        : <div className="reversal-candidate-addresses">
          <p>{t('reversal.coverage.fork')}</p>
          <h4>{t('reversal.row.candidateDestination')}</h4>
          <div>{row.outputAddresses.map((address) => <AddressLink address={address} key={address} />)}</div>
        </div>}
    </details>
  </article>
}

export function ReconciliationPage() {
  const { t, locale } = useI18n()
  const initial = useMemo(readLocationState, [])
  const [draft, setDraft] = useState<ReversalFilters>(initial.filters)
  const [filters, setFilters] = useState<ReversalFilters>(initial.filters)
  const [offset, setOffset] = useState(initial.offset)
  const [verification, setVerification] = useState<'idle' | 'checking' | 'match' | 'mismatch' | 'error'>('idle')
  const [verifiedFile, setVerifiedFile] = useState('')

  const apiQuery = useMemo(() => queryString(filters, offset), [filters, offset])
  const result = useApi<ReversalSearchResult>(`/api/reversals?${apiQuery}`)
  const data = result.data
  const downloadQuery = useMemo(() => queryString(filters), [filters])
  const filteredDownload = `/api/reversals.csv${downloadQuery ? `?${downloadQuery}` : ''}`

  const updateLocation = (nextFilters: ReversalFilters, nextOffset: number, replace = false) => {
    const params = queryString(nextFilters, nextOffset)
    const nextUrl = `${window.location.pathname}${params ? `?${params}` : ''}`
    window.history[replace ? 'replaceState' : 'pushState']({}, '', nextUrl)
  }

  useEffect(() => {
    const onPopState = () => {
      const next = readLocationState()
      setDraft(next.filters)
      setFilters(next.filters)
      setOffset(next.offset)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = normalizedFilters(draft)
    setDraft(next)
    setFilters(next)
    setOffset(0)
    updateLocation(next, 0)
  }

  const reset = () => {
    setDraft(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setOffset(0)
    updateLocation(EMPTY_FILTERS, 0)
  }

  const changePage = (nextOffset: number) => {
    const safeOffset = Math.max(0, nextOffset)
    setOffset(safeOffset)
    updateLocation(filters, safeOffset)
    window.requestAnimationFrame(() => document.getElementById('reversal-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const verifyFile = async (file: File | undefined) => {
    if (!file || !data?.dataset.sha256) return
    setVerifiedFile(file.name)
    setVerification('checking')
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      setVerification(hash.toLowerCase() === data.dataset.sha256.toLowerCase() ? 'match' : 'mismatch')
    } catch {
      setVerification('error')
    }
  }

  const number = (value: number) => new Intl.NumberFormat(locale).format(value)
  const shownStart = data?.items.length ? data.offset + 1 : 0
  const shownEnd = data ? data.offset + data.items.length : 0
  const confirmed = data?.dataset.statusCounts.CONFIRMED ?? 0
  const notReplayable = data?.dataset.statusCounts.NOT_REPLAYABLE ?? 0
  const version = data?.dataset.version == null ? '—' : String(data.dataset.version)

  return <main className="reversal-page">
    <div className="reversal-shell">
      {data && <PageHeader eyebrow={t('reversal.eyebrow', { version })} title={t('reversal.title')} subtitle={t('reversal.subtitle')} />}

      {result.loading && !data ? <LoadingState /> : result.error && !data ? <><PageHeader eyebrow={t('reversal.eyebrow', { version: '—' })} title={t('reversal.title')} subtitle={t('reversal.subtitle')} /><ErrorState error={result.error} retry={result.refetch} /></> : data && <>
        {result.error && <div className="reversal-inline-error" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>{t('error.title')}</strong><p>{result.error.message}</p></div><button type="button" onClick={result.refetch}>{t('common.retry')}</button></div>}
        <section className="incident-summary" aria-label={t('reversal.summary.transactions')}>
          <div className="incident-summary-heading"><GitCompareArrows aria-hidden="true" /><div><strong>{t('reversal.summary.transactions')}</strong><span>{t('reversal.downloads.body', { version })}</span></div></div>
          <div className="incident-summary-metrics">
            <div><span>{t('reversal.summary.transactions')}</span><strong>{number(data.dataset.transactionCount)}</strong></div>
            <div><span>{t('reversal.summary.confirmed')}</span><strong>{number(confirmed)}</strong>{data.dataset.grossTransactionOutputRvn?.confirmed && <small>{exactRvn(data.dataset.grossTransactionOutputRvn.confirmed, locale)}</small>}</div>
            <div><span>{t('reversal.summary.notReplayable')}</span><strong>{number(notReplayable)}</strong>{data.dataset.grossTransactionOutputRvn?.notReplayable && <small>{exactRvn(data.dataset.grossTransactionOutputRvn.notReplayable, locale)}</small>}</div>
            <div><span>{t('reversal.summary.grossOutput')}</span><strong>{exactRvn(data.dataset.grossTransactionOutputRvn?.all, locale)}</strong><small>{t('reversal.summary.grossDetail')}</small></div>
          </div>
        </section>

        <section className="reversal-downloads">
          <div className="reversal-section-heading"><div><Download aria-hidden="true" /><span><h2>{t('reversal.downloads.title')}</h2><p>{t('reversal.downloads.body', { version })}</p></span></div></div>
          <div className="reversal-download-list">
            <a href="/data/rvn-reversed-transactions.csv" download><Download aria-hidden="true" /><span><strong>{t('reversal.downloads.original')}</strong><small>CSV</small></span></a>
            <a href="/data/rvn-reversed-transactions-inputs.csv" download><Download aria-hidden="true" /><span><strong>{t('reversal.downloads.inputs')}</strong><small>CSV</small></span></a>
            <a href="/data/rvn-reversed-transactions-outputs.csv" download><Download aria-hidden="true" /><span><strong>{t('reversal.downloads.outputs')}</strong><small>CSV</small></span></a>
            <a href="/data/rvn-reversed-transactions-spends.csv" download><GitCompareArrows aria-hidden="true" /><span><strong>{t('reversal.downloads.spends')}</strong><small>CSV</small></span></a>
            <a href="/data/rvn-reversed-transactions.meta.json" download><FileJson2 aria-hidden="true" /><span><strong>{t('reversal.downloads.metadata')}</strong><small>JSON</small></span></a>
            <a href="/data/rvn-reversed-transactions.csv.sha256" download><FileCheck2 aria-hidden="true" /><span><strong>{t('reversal.downloads.checksum')}</strong><small>SHA-256</small></span></a>
          </div>
        </section>

        <section className="reversal-integrity">
          <div className="reversal-integrity-copy">
            <ShieldCheck aria-hidden="true" />
            <div><h2>{t('reversal.integrity.title')}</h2><p>{t('reversal.integrity.body')}</p><span>{t('reversal.integrity.sha256')}</span><div className="reversal-checksum"><code>{data.dataset.sha256}</code><CopyButton value={data.dataset.sha256} /></div></div>
          </div>
          <div className="reversal-file-check">
            <div><strong>{t('reversal.integrity.localTitle')}</strong><p>{t('reversal.integrity.localBody')}</p></div>
            <label className="reversal-file-button" htmlFor="reversal-file"><FileCheck2 aria-hidden="true" />{t('reversal.integrity.select')}</label>
            <input id="reversal-file" className="reversal-file-input" type="file" accept=".csv,text/csv" onChange={(event) => void verifyFile(event.target.files?.[0])} />
            <div className={`reversal-verification reversal-verification--${verification}`} role="status" aria-live="polite">
              {verification === 'checking' && <><span className="reversal-spinner" />{t('reversal.integrity.checking')}</>}
              {verification === 'match' && <><CheckCircle2 aria-hidden="true" />{t('reversal.integrity.match')}</>}
              {verification === 'mismatch' && <><XCircle aria-hidden="true" />{t('reversal.integrity.mismatch')}</>}
              {verification === 'error' && <><AlertTriangle aria-hidden="true" />{t('reversal.integrity.error')}</>}
              {verification !== 'idle' && verifiedFile && <small>{verifiedFile}</small>}
            </div>
          </div>
        </section>

        <section className="reversal-search">
          <div className="reversal-section-heading"><div><Filter aria-hidden="true" /><span><h2>{t('reversal.filters.title')}</h2><p>{t('reversal.filters.body')}</p></span></div><a className="reversal-filtered-download" href={filteredDownload} download><Download aria-hidden="true" />{t('reversal.downloads.filtered')}</a></div>
          <form className="reversal-filter-form" onSubmit={submit}>
            <label className="reversal-filter reversal-filter--txid"><span>{t('reversal.filters.txid')}</span><input value={draft.q} onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))} placeholder={t('reversal.filters.txidPlaceholder')} pattern="[0-9a-fA-F]{64}" /></label>
            <label className="reversal-filter"><span>{t('reversal.filters.from')}</span><input value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} placeholder={t('reversal.filters.fromPlaceholder')} /><small>{t('reversal.filters.fromHelp')}</small></label>
            <label className="reversal-filter"><span>{t('reversal.filters.to')}</span><input value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} placeholder={t('reversal.filters.toPlaceholder')} /><small>{t('reversal.filters.toHelp')}</small></label>
            <label className="reversal-filter"><span>{t('reversal.filters.onward')}</span><input value={draft.onward} onChange={(event) => setDraft((current) => ({ ...current, onward: event.target.value }))} placeholder={t('reversal.filters.onwardPlaceholder')} /><small>{t('reversal.filters.onwardHelp')}</small></label>
            <label className="reversal-filter"><span>{t('reversal.filters.status')}</span><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="">{t('reversal.filters.allStatuses')}</option>{data.availableFilters.statuses.map((status) => <option value={status} key={status}>{status === 'CONFIRMED' ? t('reversal.status.confirmed') : status === 'NOT_REPLAYABLE' ? t('reversal.status.notReplayable') : status}</option>)}</select></label>
            <label className="reversal-filter"><span>{t('reversal.filters.reason')}</span><select value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))}><option value="">{t('reversal.filters.allReasons')}</option>{data.availableFilters.reasons.map((reason) => <option value={reason} key={reason}>{translatedReason(reason, t)}</option>)}</select></label>
            <div className="reversal-filter-actions"><button className="reversal-submit" type="submit"><Search aria-hidden="true" />{t('reversal.filters.submit')}</button><button className="reversal-reset" type="button" onClick={reset}>{t('reversal.filters.reset')}</button></div>
          </form>
        </section>

        <section id="reversal-results" className="reversal-results" aria-busy={result.loading}>
          <div className="reversal-results-heading"><div><h2>{t('reversal.results.title')}</h2><p>{t('reversal.results.count', { count: number(data.total) })}</p></div><a className="reversal-filtered-download" href={filteredDownload} download><Download aria-hidden="true" />{t('reversal.downloads.filtered')}</a></div>
          <div className="reversal-coverage-note"><ShieldCheck aria-hidden="true" /><div><strong>{t('reversal.coverage.pair')}</strong><p>{t('reversal.coverage.gross')}</p></div></div>
          {result.loading && <div className="reversal-loading-bar" role="status"><span />{t('common.loading')}</div>}
          {!data.items.length ? <div className="reversal-empty"><Search aria-hidden="true" /><p>{t('reversal.results.empty')}</p></div> : <div className="reversal-result-list">{data.items.map((row) => <ReversalResultRow row={row} source={filters.from} destination={filters.to} onward={filters.onward} locale={locale} t={t} key={row.txid} />)}</div>}
          <div className="reversal-pagination">
            <button type="button" disabled={data.offset === 0 || result.loading} onClick={() => changePage(data.offset - PAGE_SIZE)}><ArrowLeft aria-hidden="true" />{t('reversal.results.previous')}</button>
            <span>{t('reversal.results.range', { start: number(shownStart), end: number(shownEnd), total: number(data.total) })}</span>
            <button type="button" disabled={!data.hasMore || result.loading} onClick={() => changePage(data.offset + PAGE_SIZE)}>{t('reversal.results.next')}<ArrowRight aria-hidden="true" /></button>
          </div>
        </section>

        <section className="reversal-methodology">
          <div><GitCompareArrows aria-hidden="true" /><span><h2>{t('reversal.methodology.title')}</h2><p>{t('reversal.methodology.body')}</p></span></div>
          <ul>
            <li>{t('reversal.coverage.canonical')}</li>
            <li>{t('reversal.coverage.fork')}</li>
            <li>{t('reversal.coverage.pair')}</li>
            <li>{t('reversal.coverage.onward')}</li>
            <li>{t('reversal.coverage.gross')}</li>
          </ul>
          <p className="reversal-methodology-disclaimer"><AlertTriangle aria-hidden="true" />{t('reversal.methodology.disclaimer')}</p>
        </section>
      </>}
    </div>
  </main>
}
