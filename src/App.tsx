import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Box, Clock3, Code2, Coins, Database,
  ExternalLink, Fingerprint, Gauge, Globe2, Landmark,
  MessageCircle, Pickaxe, Radio, SearchX, Send, TrendingUp, Users, WalletCards,
} from 'lucide-react'
import {
  BlockTable, CopyButton, DemoBanner, DetailGrid, EmptyState, ErrorState, Footer, formatAge,
  formatAmount, formatBytes, formatDate, formatHashrate, HashValue, Header, LoadingState, PageHeader,
  QuaiMark, RavenCoinMark, RavenGlyph, SearchBox, StatCard, StatusStrip, TransactionRows,
} from './components'
import { useApi } from './lib/api'
import { useI18n } from './lib/i18n'
import { Link, usePath } from './lib/router'
import { communityLinks, marketVenues, type CommunityIcon } from './site-data'
import type { AddressData, AddressRankings, Asset, Block, NetworkStats, StatsHistoryPoint, Status, Transaction } from './types'

function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`section-card ${className}`}><div className="section-card__heading"><h2>{title}</h2>{action}</div>{children}</section>
}

function formatDuration(seconds: number | null | undefined, locale: string) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  if (seconds >= 86_400) return `${number.format(Math.floor(seconds / 86_400))}d ${number.format(Math.floor(seconds % 86_400 / 3_600))}h`
  if (seconds >= 3_600) return `${number.format(Math.floor(seconds / 3_600))}h ${number.format(Math.floor(seconds % 3_600 / 60))}m`
  if (seconds >= 60) return `${number.format(Math.floor(seconds / 60))}m`
  return `${number.format(seconds)}s`
}

function IndexerProgress({ status }: { status: Status }) {
  const { t, locale } = useI18n()
  if (!status.indexer || status.indexer.progress >= 1) return null
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(status.indexer.progress)
  const number = (value: number, maximumFractionDigits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
  return <section className="indexer-panel">
    <div className="indexer-panel__status"><span><Database size={16} />{t('indexer.syncing')}</span><strong>{percent}</strong></div>
    <div className="indexer-panel__track"><i style={{ width: `${Math.max(.35, status.indexer.progress * 100)}%` }} /></div>
    <div className="indexer-panel__meta">
      <span>{t('indexer.indexedTip')} <b>#{number(status.indexer.indexedHeight)}</b></span>
      <span>{t('indexer.networkTip')} <b>#{number(status.chainTip ?? status.indexer.targetHeight)}</b></span>
      <span>{t('indexer.rate')} <b>{number(status.indexer.blocksPerSecond, 1)} {t('indexer.blocksPerSecond')}</b></span>
      <span>{t('indexer.eta')} <b>{formatDuration(status.indexer.estimatedSecondsRemaining, locale)}</b></span>
      <span>{t('indexer.remaining')} <b>{number(status.indexer.blocksRemaining)}</b></span>
      <span>{t('indexer.updated')} <b>{status.indexer.lastIndexedAt ? formatAge(status.indexer.lastIndexedAt, locale) : '—'}</b></span>
    </div>
    <p>{t('indexer.notice')}</p>
  </section>
}

function HomePage({ status }: { status: Status | null }) {
  const { t, locale } = useI18n()
  const blocks = useApi<Block[]>('/api/blocks?limit=7', 30_000)
  const transactions = useApi<Transaction[]>('/api/transactions?limit=7', 30_000)
  const assets = useApi<Asset[]>('/api/assets?limit=5')
  return <>
    <section className="hero"><div className="hero__glow hero__glow--one" /><div className="hero__glow hero__glow--two" /><div className="hero__raven" aria-hidden="true"><RavenGlyph /></div>
      <div className="shell hero__content"><span className="eyebrow"><i />{t('hero.eyebrow')}</span><h1>{t('hero.title')}</h1><p>{t('hero.body')}</p><SearchBox hero />
        {status && <StatusStrip status={status} />}
      </div>
    </section>
    <main className="shell home-main">
      <section className="network-overview">
        <div className="network-overview__heading"><span>{t('stats.networkOverview')}</span><b><i />{t('status.mainnet')}</b></div>
        <div className="network-overview__metrics">
          <StatCard icon={<Box />} label={t('stats.height')} value={status ? `#${new Intl.NumberFormat(locale).format(status.chainTip ?? status.blocks)}` : '—'} note={status?.indexer ? `${t('indexer.indexedTip')} #${new Intl.NumberFormat(locale).format(status.indexer.indexedHeight)} · ${t('stats.sync')} ${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(status.verificationProgress)}` : status ? formatAge(Math.floor(Date.now() / 1000 - status.minutesSinceLastBlock * 60), locale) : undefined} />
          <StatCard icon={<Pickaxe />} label={t('stats.hashrate')} value={status ? formatHashrate(status.networkHashrate, locale) : '—'} note={status ? `${t('stats.difficulty')} ${formatAmount(status.difficulty, locale, 2)}` : undefined} />
          <StatCard icon={<Activity />} label={t('stats.mempool')} value={status ? new Intl.NumberFormat(locale).format(status.mempoolTransactions) : '—'} note={status ? formatBytes(status.mempoolBytes, locale) : undefined} />
        </div>
      </section>
      {status && <IndexerProgress status={status} />}
      <aside className="merge-mining-card">
        <span className="merge-mining-card__logo"><QuaiMark /></span>
        <div><span className="merge-mining-card__eyebrow">SOAP · QUAI NETWORK</span><h2>{t('merge.title')}</h2><p>{t('merge.body')}</p></div>
        <a href="https://soap.qu.ai" target="_blank" rel="noreferrer">{t('merge.cta')} <ArrowRight size={16} /></a>
      </aside>
      <div className="home-grid">
        <Section title={t('blocks.latest')} action={<Link className="text-link" href="/blocks">{t('common.viewAll')} <ArrowRight size={15} /></Link>}>
          {blocks.loading && !blocks.data ? <LoadingState /> : blocks.error ? <ErrorState error={blocks.error} retry={blocks.refetch} /> : <BlockTable blocks={blocks.data ?? []} />}
        </Section>
        <Section title={t('tx.latest')}>
          {transactions.loading && !transactions.data ? <LoadingState /> : transactions.error ? <ErrorState error={transactions.error} retry={transactions.refetch} /> : <TransactionRows transactions={transactions.data ?? []} />}
        </Section>
      </div>
      <Section title={t('assets.title')} className="asset-overview" action={<Link className="text-link" href="/assets">{t('common.viewAll')} <ArrowRight size={15} /></Link>}>
        {assets.loading && !assets.data ? <LoadingState /> : assets.error ? <ErrorState error={assets.error} /> : <div className="asset-mini-list">{assets.data?.map((asset) => <Link href={`/asset/${encodeURIComponent(asset.name)}`} key={asset.name}><span className="asset-avatar">{asset.name.slice(0, 2)}</span><span><strong>{asset.name}</strong><small>{formatAmount(asset.amount, locale, asset.units)} · {asset.units}d</small></span><ArrowRight size={16} /></Link>)}</div>}
      </Section>
    </main>
  </>
}

function MetricTile({ icon, label, value, detail }: { icon: ReactNode; label: string; value: ReactNode; detail?: ReactNode }) {
  return <article className="metric-tile"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong>{detail && <p>{detail}</p>}</div></article>
}

function StatsChart({ data, valueKey, title, color, locale, formatValue }: { data: StatsHistoryPoint[]; valueKey: keyof Pick<StatsHistoryPoint, 'blocks' | 'transactions' | 'activeAddresses' | 'difficulty'>; title: string; color: string; locale: string; formatValue: (value: number) => string }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const width = 720; const height = 230; const top = 24; const bottom = 30; const left = 48; const right = 18
  const values = data.map((point) => point[valueKey])
  const maximum = Math.max(...values, 1)
  const rawMinimum = Math.min(...values, 0)
  const minimum = valueKey === 'difficulty' && rawMinimum > 0 ? rawMinimum * .97 : 0
  const range = Math.max(maximum - minimum, 1)
  const x = (index: number) => left + (data.length < 2 ? 0 : index / (data.length - 1)) * (width - left - right)
  const y = (value: number) => top + (1 - (value - minimum) / range) * (height - top - bottom)
  const points = data.map((point, index) => `${x(index)},${y(point[valueKey])}`).join(' ')
  const area = data.length ? `M ${x(0)} ${height - bottom} L ${points.replaceAll(' ', ' L ')} L ${x(data.length - 1)} ${height - bottom} Z` : ''
  const labels = data.length ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : []
  const time = (timestamp: number) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(timestamp * 1000)
  const fullTime = (timestamp: number) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp * 1000)
  const activeIndex = hovered ?? data.length - 1
  const activePoint = data[activeIndex]
  return <article className="chart-panel">
    <div className="chart-panel__heading"><div><h2>{title}</h2><span>{data.length ? time(data.at(-1)!.timestamp) : '—'}</span></div><strong>{data.length ? formatValue(data.at(-1)![valueKey]) : '—'}</strong></div>
    <div className="chart-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} preserveAspectRatio="none" tabIndex={0}
        onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setHovered(Math.max(0, Math.min(data.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (data.length - 1))))) }}
        onPointerLeave={() => setHovered(null)} onFocus={() => data.length && setHovered(data.length - 1)} onBlur={() => setHovered(null)}
        onKeyDown={(event) => { if (!data.length || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); setHovered((current) => Math.max(0, Math.min(data.length - 1, (current ?? data.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))) }}>
        <defs><linearGradient id={`fill-${valueKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".26" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {[0, .33, .66, 1].map((step) => <g key={step}><line x1={left} x2={width - right} y1={top + step * (height - top - bottom)} y2={top + step * (height - top - bottom)} className="chart-gridline" /><text x={left - 8} y={top + step * (height - top - bottom) + 3} textAnchor="end">{formatValue(maximum - step * range)}</text></g>)}
        {area && <path d={area} fill={`url(#fill-${valueKey})`} />}
        {points && <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
        {activePoint ? <><line className="chart-crosshair" x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={height - bottom} /><circle className="chart-active-point" cx={x(activeIndex)} cy={y(activePoint[valueKey])} r="4.5" fill={color} /></> : null}
        {labels.map((index) => <text key={index} x={x(index)} y={height - 7} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>{time(data[index].timestamp)}</text>)}
      </svg>
      {hovered != null && activePoint && <div className="chart-tooltip" style={{ left: `${Math.max(10, Math.min(90, x(activeIndex) / width * 100))}%` }}><span>{fullTime(activePoint.timestamp)}</span><strong>{formatValue(activePoint[valueKey])}</strong></div>}
    </div>
  </article>
}

function StatsPage({ status }: { status: Status | null }) {
  const { t, locale } = useI18n()
  const stats = useApi<NetworkStats>('/api/stats', 30_000)
  const number = (value: number, maximumFractionDigits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
  const data = stats.data
  return <main className="shell page technical-page"><PageHeader eyebrow="KAWPOW · MAINNET TELEMETRY" title={t('stats.title')} subtitle={t('stats.subtitle')} />
    {status && <IndexerProgress status={status} />}
    {stats.loading && !data ? <LoadingState /> : stats.error ? <ErrorState error={stats.error} retry={stats.refetch} /> : data && <>
      <section className="stats-dashboard">
        <div className="stats-dashboard__heading"><div><span>{t('stats.indexedSeries')}</span><h2>{t('stats.networkOverview')}</h2></div><span>KAWPOW · MAINNET</span></div>
        <div className="stats-topline">
          <div><Pickaxe /><span>{t('stats.hashrate')}</span><strong>{status ? formatHashrate(status.networkHashrate, locale) : '—'}</strong><small>KAWPOW</small></div>
          <div><Gauge /><span>{t('stats.difficulty')}</span><strong>{status ? number(status.difficulty, 2) : '—'}</strong><small>{t('stats.current')}</small></div>
          <div><Clock3 /><span>{t('stats.blockTime')}</span><strong>{number(data.averageBlockTimeSeconds, 1)}s</strong><small>{number(data.windowBlocks)} blocks</small></div>
          <div><Activity /><span>{t('stats.windowTransactions')}</span><strong>{number(data.windowTransactions)}</strong><small>{number(data.averageTransactionsPerBlock, 2)} / block</small></div>
          <div><Users /><span>{t('stats.activeAddresses')}</span><strong>{number(data.activeAddresses)}</strong><small>{t('stats.indexed24h')}</small></div>
          <div><Radio /><span>{t('stats.mempool')}</span><strong>{number(status?.mempoolTransactions ?? 0)}</strong><small>{status ? formatBytes(status.mempoolBytes, locale) : '—'}</small></div>
        </div>
        <div className="charts-grid">
          <StatsChart data={data.history} valueKey="transactions" title={t('stats.transactionsChart')} color="#f28c28" locale={locale} formatValue={(value) => number(value)} />
          <StatsChart data={data.history} valueKey="activeAddresses" title={t('stats.addressesChart')} color="#e14c3d" locale={locale} formatValue={(value) => number(value)} />
          <StatsChart data={data.history} valueKey="blocks" title={t('stats.blocksChart')} color="#4aa6d8" locale={locale} formatValue={(value) => number(value)} />
          <StatsChart data={data.history} valueKey="difficulty" title={t('stats.difficultyChart')} color="#757ccb" locale={locale} formatValue={(value) => number(value, 2)} />
        </div>
        <div className="stats-data-section"><h2>{t('stats.syncMetrics')}</h2><div className="stats-data-grid">
          <div><span>{t('indexer.networkTip')}</span><strong>#{number(status?.chainTip ?? status?.blocks ?? data.windowEndHeight)}</strong></div>
          <div><span>{t('indexer.indexedTip')}</span><strong>#{number(status?.indexer?.indexedHeight ?? data.windowEndHeight)}</strong></div>
          <div><span>{t('indexer.remaining')}</span><strong>{number(status?.indexer?.blocksRemaining ?? 0)}</strong></div>
          <div><span>{t('indexer.rate')}</span><strong>{number(status?.indexer?.blocksPerSecond ?? 0, 1)} {t('indexer.blocksPerSecond')}</strong></div>
          <div><span>{t('indexer.eta')}</span><strong>{formatDuration(status?.indexer?.estimatedSecondsRemaining, locale)}</strong></div>
          <div><span>{t('stats.totalTransactions')}</span><strong>{number(data.totalTransactions)}</strong></div>
          <div><span>{t('stats.trackedAddresses')}</span><strong><Link className="text-link" href="/addresses">{number(data.trackedAddresses)}</Link></strong></div>
          <div><span>{t('stats.assetsIndexed')}</span><strong>{number(data.totalAssets)}</strong></div>
        </div></div>
        <div className="stats-data-section"><h2>{t('stats.activityMetrics')}</h2><div className="stats-data-grid">
          <div><span>{t('stats.blocksWindow')}</span><strong>{number(data.windowBlocks)}</strong></div>
          <div><span>{t('stats.tps')}</span><strong>{number(data.transactionsPerSecond, 4)}</strong></div>
          <div><span>{t('stats.txPerBlock')}</span><strong>{number(data.averageTransactionsPerBlock, 2)}</strong></div>
          <div><span>{t('stats.avgBlockSize')}</span><strong>{formatBytes(data.averageBlockSize, locale)}</strong></div>
          <div><span>{t('stats.mined')}</span><strong>{number(data.minedRvn, 2)} RVN</strong></div>
          <div><span>{t('stats.fees')}</span><strong>{number(data.totalFees, 4)} RVN</strong></div>
          <div><span>{t('stats.outputVolume')}</span><strong>{number(data.outputVolume, 2)} RVN</strong></div>
          <div><span>{t('stats.circulating')}</span><strong>{number(data.circulatingSupply, 2)} RVN</strong></div>
        </div></div>
      </section>
      <div className="window-note"><Radio size={15} /><span>{t('stats.windowNote')} <b>#{number(data.windowStartHeight)}</b> — <b>#{number(data.windowEndHeight)}</b>{data.windowEnd ? ` · ${formatDate(data.windowEnd, locale)}` : ''}</span></div>
    </>}
  </main>
}

function AddressesPage() {
  const { t, locale } = useI18n()
  const [page, setPage] = useState(0)
  const limit = 50
  const result = useApi<AddressRankings>(`/api/addresses?limit=${limit}&offset=${page * limit}`)
  const data = result.data
  const number = (value: number, maximumFractionDigits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
  const shownStart = data?.items.length ? page * limit + 1 : 0
  const shownEnd = data ? page * limit + data.items.length : 0
  return <main className="shell page technical-page"><PageHeader eyebrow="RVN · ADDRESSES" title={t('addresses.title')} subtitle={t('addresses.subtitle')} />
    {result.loading && !data ? <LoadingState /> : result.error ? <ErrorState error={result.error} retry={result.refetch} /> : data && <>
      <div className="address-summary-grid">
        <MetricTile icon={<WalletCards />} label={t('addresses.positive')} value={number(data.total)} />
        <MetricTile icon={<Coins />} label={t('addresses.balance')} value={`${number(data.totalBalance, 2)} RVN`} />
        <MetricTile icon={<Landmark />} label={t('addresses.topBalance')} value={data.items[0] ? `${number(data.items[0].balance, 2)} RVN` : '—'} />
      </div>
      <Section title={t('addresses.distribution')} className="top-gap">
        <div className="threshold-grid">{data.thresholds.map((threshold) => <div key={threshold.balance}><span>≥ {number(threshold.balance)} RVN</span><strong>{number(threshold.addresses)}</strong><small>{t('addresses.addresses')}</small></div>)}</div>
      </Section>
      <Section title={t('addresses.richList')} className="top-gap">
        <div className="address-table-wrap"><table className="address-table"><thead><tr><th>{t('addresses.rank')}</th><th>{t('address.title')}</th><th>{t('address.balance')}</th><th>{t('addresses.share')}</th><th>{t('field.transactions')}</th><th>{t('addresses.blocksMined')}</th><th>{t('addresses.lastActivity')}</th></tr></thead><tbody>
          {data.items.map((item) => <tr key={item.address}><td><b>#{item.rank}</b></td><td><Link className="mono-link" href={`/address/${item.address}`}>{item.address}</Link></td><td><strong>{number(item.balance, 8)} RVN</strong></td><td>{number(item.share * 100, 4)}%</td><td>{number(item.transactionCount)}</td><td>{number(item.blocksMined)}</td><td>{item.lastActivityHeight == null ? '—' : <Link className="height-link" href={`/block/${item.lastActivityHeight}`}>#{number(item.lastActivityHeight)}</Link>}</td></tr>)}
        </tbody></table></div>
        <div className="pagination"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ArrowLeft size={16} />{t('addresses.newer')}</button><span>{number(shownStart)} — {number(shownEnd)} / {number(data.total)}</span><button disabled={shownEnd >= data.total} onClick={() => setPage((value) => value + 1)}>{t('addresses.older')}<ArrowRight size={16} /></button></div>
      </Section>
      <p className="index-data-note">{t('addresses.note')}</p>
    </>}
  </main>
}

function MarketsPage() {
  const { t } = useI18n()
  return <main className="shell page technical-page"><PageHeader eyebrow="RVN · GLOBAL SPOT MARKETS" title={t('markets.title')} subtitle={t('markets.subtitle')} />
    <div className="market-summary"><Landmark /><div><strong>{t('markets.heading')}</strong><p>{t('markets.body')}</p></div><a href="https://coinmarketcap.com/currencies/ravencoin/#Markets" target="_blank" rel="noreferrer">CoinMarketCap <ExternalLink size={14} /></a></div>
    <div className="market-directory">{marketVenues.map((venue) => <a className="market-card" href={venue.href} target="_blank" rel="noreferrer" key={venue.name}>
      <span className="market-card__logo" style={{ '--market-color': venue.color } as CSSProperties}><span>{venue.mark}</span><img src={venue.logo} alt={`${venue.name} logo`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /></span>
      <div><h2>{venue.name}</h2><p>{venue.pair}</p></div>
      <span className="market-card__region">{venue.region}</span><ExternalLink size={15} />
    </a>)}</div>
    <p className="market-disclaimer">{t('markets.disclaimer')}</p>
  </main>
}

function CommunityGlyph({ icon }: { icon: CommunityIcon }) {
  if (icon === 'telegram') return <Send />
  if (icon === 'discord') return <MessageCircle />
  if (icon === 'reddit') return <Radio />
  if (icon === 'github') return <Code2 />
  if (icon === 'globe') return <Globe2 />
  return <span className="x-glyph">X</span>
}

function CommunityPage() {
  const { t } = useI18n()
  return <main className="shell page technical-page"><PageHeader eyebrow="OPEN SOURCE · COMMUNITY OPERATED" title={t('community.title')} subtitle={t('community.subtitle')} />
    <div className="community-callout"><Users /><div><strong>{t('community.heading')}</strong><p>{t('community.body')}</p></div></div>
    <div className="community-grid">{communityLinks.map((item) => <a className="community-card" href={item.href} target="_blank" rel="noreferrer" key={item.name}>
      <span className={`community-card__icon community-card__icon--${item.icon}`}><CommunityGlyph icon={item.icon} /></span>
      <div><span>{item.language ?? t('community.global')}</span><h2>{item.name}</h2><p>{item.description}</p></div><ExternalLink size={16} />
    </a>)}</div>
  </main>
}

function BlocksPage() {
  const { t, locale } = useI18n()
  const [start, setStart] = useState<number | null>(null)
  const query = `/api/blocks?limit=20${start == null ? '' : `&start=${start}`}`
  const { data, loading, error, refetch } = useApi<Block[]>(query)
  const newest = data?.[0]?.height ?? 0
  const oldest = data?.at(-1)?.height ?? 0
  return <main className="shell page"><PageHeader eyebrow={t('status.mainnet')} title={t('blocks.title')} subtitle={t('blocks.subtitle')} />
    <Section title={t('blocks.latest')}>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} retry={refetch} /> : data?.length ? <BlockTable blocks={data} /> : <EmptyState>{t('blocks.empty')}</EmptyState>}
      {data?.length ? <div className="pagination"><button disabled={start == null} onClick={() => setStart(newest + 20)}><ArrowLeft size={16} />{t('blocks.previous')}</button><span>#{new Intl.NumberFormat(locale).format(newest)} — #{new Intl.NumberFormat(locale).format(oldest)}</span><button disabled={oldest <= 0} onClick={() => setStart(Math.max(0, oldest - 1))}>{t('blocks.next')}<ArrowRight size={16} /></button></div> : null}
    </Section>
  </main>
}

function BlockPage({ id }: { id: string }) {
  const { t, locale } = useI18n()
  const { data, loading, error, refetch } = useApi<Block>(`/api/block/${encodeURIComponent(id)}`)
  if (loading && !data) return <main className="shell page"><LoadingState /></main>
  if (error || !data) return <main className="shell page"><ErrorState error={error ?? new Error(t('error.notFound'))} retry={refetch} /></main>
  const details = [
    { label: t('field.height'), value: `#${new Intl.NumberFormat(locale).format(data.height)}` },
    { label: t('field.time'), value: formatDate(data.time, locale) },
    { label: t('field.transactions'), value: new Intl.NumberFormat(locale).format(data.txCount) },
    { label: t('field.size'), value: formatBytes(data.size, locale) },
    { label: t('field.confirmations'), value: new Intl.NumberFormat(locale).format(data.confirmations) },
    { label: t('stats.difficulty'), value: formatAmount(data.difficulty, locale, 3) },
    { label: t('field.version'), value: data.version },
    { label: t('field.nonce'), value: new Intl.NumberFormat(locale).format(data.nonce) },
    { label: t('field.hash'), value: <HashValue value={data.hash} copy />, wide: true },
    { label: t('field.merkle'), value: <HashValue value={data.merkleRoot} copy />, wide: true },
  ]
  return <main className="shell page"><PageHeader eyebrow={`${t('block.title')} · ${t('status.mainnet')}`} title={<>#{new Intl.NumberFormat(locale).format(data.height)}</>} subtitle={formatAge(data.time, locale)}>
    <div className="block-nav">{data.previousBlockHash && <Link href={`/block/${data.previousBlockHash}`} title={t('block.previous')}><ArrowLeft size={18} /></Link>}{data.nextBlockHash && <Link href={`/block/${data.nextBlockHash}`} title={t('block.next')}><ArrowRight size={18} /></Link>}</div>
  </PageHeader><Section title={t('common.details')}><DetailGrid items={details} /></Section>
    <Section title={t('block.transactions')} className="top-gap">{data.transactions.length ? <TransactionRows transactions={data.transactions} /> : <EmptyState>{t('blocks.empty')}</EmptyState>}</Section>
  </main>
}

function TransactionPage({ txid }: { txid: string }) {
  const { t, locale } = useI18n()
  const { data, loading, error, refetch } = useApi<Transaction>(`/api/tx/${encodeURIComponent(txid)}`)
  if (loading && !data) return <main className="shell page"><LoadingState /></main>
  if (error || !data) return <main className="shell page"><ErrorState error={error ?? new Error(t('error.notFound'))} retry={refetch} /></main>
  const details = [
    { label: t('field.txid'), value: <HashValue value={data.txid} copy />, wide: true },
    { label: t('field.block'), value: data.blockHash ? <HashValue value={data.blockHash} type="block" /> : '—', wide: true },
    { label: t('field.time'), value: formatDate(data.time, locale) },
    { label: t('field.confirmations'), value: data.confirmations ?? 0 },
    { label: t('field.size'), value: formatBytes(data.size, locale) },
    { label: t('field.version'), value: data.version ?? '—' },
    { label: t('tx.total'), value: `${formatAmount(data.totalOutput, locale)} RVN` },
    { label: t('tx.fee'), value: data.fee == null ? '—' : `${formatAmount(data.fee, locale)} RVN` },
  ]
  return <main className="shell page record-page"><PageHeader eyebrow={`${t('tx.title')} · ${t('status.mainnet')}`} title={t('tx.title')} subtitle={<span className="heading-hash">{data.txid}</span>} />
    <Section title={t('common.details')} className="detail-panel"><DetailGrid items={details} /></Section>
    <Section title={`${t('tx.inputs')} & ${t('tx.outputs')}`} className="top-gap transaction-flow-panel"><div className="io-unified">
      <div><h3>{t('tx.inputs')} <span>{data.vin?.length ?? 0}</span></h3><div className="io-list">{data.vin?.map((input, index) => <div className="io-item" key={`${input.txid}-${index}`}><span className="io-index">{index}</span><div>{input.coinbase ? <><strong>{t('tx.coinbase')}</strong><code>{input.coinbase}</code></> : <><HashValue value={input.address ?? input.txid ?? t('common.unknown')} type={input.address ? 'address' : input.txid ? 'tx' : undefined} /><small className="coin-value"><RavenCoinMark />{input.value == null ? `${t('field.output')} #${input.vout ?? 0}` : `${formatAmount(input.value, locale)} RVN`}</small></>}</div></div>)}</div></div>
      <div><h3>{t('tx.outputs')} <span>{data.vout?.length ?? 0}</span></h3><div className="io-list">{data.vout?.map((output) => <div className="io-item" key={output.n}><span className="io-index">{output.n}</span><div>{output.addresses.length ? output.addresses.map((address) => <HashValue key={address} value={address} type="address" />) : <span>{t('tx.noAddress')}</span>}<small className="coin-value">{!output.asset && <RavenCoinMark />}{output.asset ? `${formatAmount(output.asset.amount, locale)} ${output.asset.name}` : `${formatAmount(output.value, locale)} RVN`}</small></div></div>)}</div></div>
    </div></Section>
  </main>
}

function AddressPage({ address }: { address: string }) {
  const { t, locale } = useI18n()
  const { data, loading, error, refetch } = useApi<AddressData>(`/api/address/${encodeURIComponent(address)}`)
  if (loading && !data) return <main className="shell page"><LoadingState /></main>
  if (error || !data) return <main className="shell page"><ErrorState error={error ?? new Error(t('error.notFound'))} retry={refetch} /></main>
  return <main className="shell page record-page"><PageHeader eyebrow={`${t('address.title')} · ${t('status.mainnet')}`} title={t('address.title')} subtitle={<span className="heading-hash">{data.address}</span>}><CopyButton value={data.address} /></PageHeader>
    <Section title={t('address.overview')} className="account-overview"><div className="account-summary">
      <div className="account-summary__balance"><RavenCoinMark /><span><small>{t('address.balance')}</small><strong>{formatAmount(data.balance, locale)} <b>RVN</b></strong></span></div>
      <div><small>{t('address.received')}</small><strong>{formatAmount(data.received, locale)} RVN</strong></div>
      <div><small>{t('address.sent')}</small><strong>{formatAmount(data.sent, locale)} RVN</strong></div>
      <div><small>{t('field.transactions')}</small><strong>{new Intl.NumberFormat(locale).format(data.transactionCount)}</strong></div>
    </div></Section>
    <Section title={t('address.holdings')} className="top-gap holdings-panel"><div className="address-holdings-grid"><div><h3>{t('address.assets')} <span>{data.balances.length}</span></h3><div className="balance-list">{data.balances.map((balance) => <Link href={`/asset/${encodeURIComponent(balance.assetName)}`} key={balance.assetName}>{balance.assetName === 'RVN' ? <RavenCoinMark /> : <span className="asset-avatar">{balance.assetName.slice(0, 2)}</span>}<span><strong>{balance.assetName}</strong><small>{t('address.received')} {formatAmount(balance.received, locale)}</small></span><b>{formatAmount(balance.balance, locale)}</b></Link>)}</div></div>
      <div><h3>{t('address.utxos')} <span>{data.utxos.length}</span></h3><div className="utxo-list">{data.utxos.slice(0, 8).map((utxo) => <div key={`${utxo.txid}-${utxo.outputIndex}`}><span><Link className="mono-link truncate" href={`/tx/${utxo.txid}`}>{utxo.txid}</Link><small>#{utxo.outputIndex} · {t('field.height')} {utxo.height}</small></span><strong className="coin-value">{utxo.assetName === 'RVN' && <RavenCoinMark />}{formatAmount(utxo.amount, locale)} {utxo.assetName}</strong></div>)}</div></div></div></Section>
    <Section title={`${t('address.transactions')} · ${new Intl.NumberFormat(locale).format(data.transactionCount)}`} className="top-gap"><TransactionRows transactions={data.transactions} /></Section>
  </main>
}

function AssetsPage() {
  const { t, locale } = useI18n()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const { data, loading, error, refetch } = useApi<Asset[]>(`/api/assets?limit=50&q=${encodeURIComponent(query)}`)
  return <main className="shell page"><PageHeader eyebrow={t('status.mainnet')} title={t('assets.title')} subtitle={t('assets.subtitle')} />
    <form className="filter-box" onSubmit={(event) => { event.preventDefault(); setQuery(input.trim()) }}><SearchX size={19} /><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('assets.search')} /><button>{t('search.button')}</button></form>
    {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} retry={refetch} /> : data?.length ? <div className="asset-grid">{data.map((asset) => <Link className="asset-card" href={`/asset/${encodeURIComponent(asset.name)}`} key={asset.name}><div className="asset-card__top"><span className="asset-avatar asset-avatar--large">{asset.name.slice(0, 2)}</span>{asset.hasIpfs && <span className="metadata-pill"><Database size={13} /> IPFS</span>}</div><h2>{asset.name}</h2><div><span>{t('assets.supply')}<strong>{formatAmount(asset.amount, locale, asset.units)}</strong></span><span>{t('assets.units')}<strong>{asset.units}</strong></span></div><span className="asset-card__open"><ArrowRight size={16} /></span></Link>)}</div> : <EmptyState>{t('assets.noResults')}</EmptyState>}
  </main>
}

function AssetPage({ name }: { name: string }) {
  const { t, locale } = useI18n()
  const { data, loading, error, refetch } = useApi<Asset>(`/api/asset/${encodeURIComponent(name)}`)
  if (loading && !data) return <main className="shell page"><LoadingState /></main>
  if (error || !data) return <main className="shell page"><ErrorState error={error ?? new Error(t('error.notFound'))} retry={refetch} /></main>
  return <main className="shell page"><PageHeader eyebrow={`${t('asset.title')} · ${t('status.mainnet')}`} title={data.name} subtitle={t('assets.subtitle')} />
    <div className="asset-hero"><span className="asset-avatar asset-avatar--hero">{data.name.slice(0, 2)}</span><div><p>{t('assets.supply')}</p><strong>{formatAmount(data.amount, locale, data.units)}</strong></div></div>
    <Section title={t('common.details')} className="top-gap"><DetailGrid items={[
      { label: t('assets.units'), value: data.units }, { label: t('assets.reissuable'), value: data.reissuable ? t('common.yes') : t('common.no') },
      { label: t('assets.metadata'), value: data.hasIpfs ? (data.ipfsHash ?? 'IPFS') : t('common.no') }, { label: t('asset.created'), value: data.blockHeight ? <Link className="height-link" href={`/block/${data.blockHeight}`}>#{new Intl.NumberFormat(locale).format(data.blockHeight)}</Link> : '—' },
    ]} /></Section>
    {data.transfers?.length ? <Section title={`${t('assets.transfers')} · ${data.transfers.length}`} className="top-gap"><div className="asset-transfer-list">{data.transfers.map((transfer) => <article key={`${transfer.txid}-${transfer.outputIndex}`}>
      <div className="asset-transfer__amount"><span className={`transfer-type transfer-type--${transfer.type}`}>{t(`transfer.${transfer.type}`)}</span><strong>{formatAmount(transfer.amount, locale, data.units)} {data.name}</strong><small>{formatAge(transfer.time, locale)} · <Link className="height-link" href={`/block/${transfer.blockHeight}`}>#{new Intl.NumberFormat(locale).format(transfer.blockHeight)}</Link></small></div>
      <div className="asset-transfer__flow"><span><small>{t('transfer.from')}</small>{transfer.fromAddresses[0] ? <HashValue value={transfer.fromAddresses[0]} type="address" /> : <em>—</em>}</span><ArrowRight size={18} /><span><small>{t('transfer.to')}</small>{transfer.toAddresses[0] ? <HashValue value={transfer.toAddresses[0]} type="address" /> : <em>—</em>}</span></div>
      <Link className="asset-transfer__tx" href={`/tx/${transfer.txid}`}>{transfer.txid}</Link>
    </article>)}</div></Section> : null}
  </main>
}

function AboutPage() {
  const { t } = useI18n()
  return <main className="shell page about-page"><PageHeader eyebrow="Ravencoin Community Explorer" title={t('about.title')} subtitle={t('about.body')} />
    <div className="about-partners">
      <a className="about-partner about-partner--dominant" href="https://dominantstrategies.io" target="_blank" rel="noreferrer"><span>{t('about.developed')}</span><img src="/dominant-strategies-logo.svg" alt="Dominant Strategies" /><p>{t('about.dominant')}</p><ExternalLink /></a>
      <a className="about-partner about-partner--quai" href="https://soap.qu.ai" target="_blank" rel="noreferrer"><span>{t('about.mergeMining')}</span><QuaiMark /><div><strong>Quai Network</strong><p>{t('about.quai')}</p></div><ExternalLink /></a>
    </div>
    <div className="about-disclosure"><Radio /><p>{t('about.disclosure')}</p></div>
  </main>
}

function NotFoundPage() {
  const { t } = useI18n()
  return <main className="shell page"><div className="not-found"><span>404</span><Fingerprint /><h1>{t('error.notFound')}</h1><Link className="button" href="/">{t('error.home')} <ArrowRight size={16} /></Link></div></main>
}

function Route({ path, status }: { path: string; status: Status | null }) {
  if (path === '/') return <HomePage status={status} />
  if (path === '/blocks') return <BlocksPage />
  if (path === '/addresses' || path === '/rich-list') return <AddressesPage />
  if (path === '/assets') return <AssetsPage />
  if (path === '/stats') return <StatsPage status={status} />
  if (path === '/markets') return <MarketsPage />
  if (path === '/community') return <CommunityPage />
  if (path === '/about') return <AboutPage />
  if (path.startsWith('/block/')) return <BlockPage id={decodeURIComponent(path.slice(7))} />
  if (path.startsWith('/tx/')) return <TransactionPage txid={decodeURIComponent(path.slice(4))} />
  if (path.startsWith('/address/')) return <AddressPage address={decodeURIComponent(path.slice(9))} />
  if (path.startsWith('/asset/')) return <AssetPage name={decodeURIComponent(path.slice(7))} />
  return <NotFoundPage />
}

export default function App() {
  const path = usePath()
  const status = useApi<Status>('/api/status', 30_000)
  const memoStatus = useMemo(() => status.data, [status.data])
  return <div className="app"><Header meta={status.meta} />{status.meta?.source === 'demo' && <DemoBanner />}<Route path={path} status={memoStatus} /><Footer /></div>
}
