import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, Box, Braces, Coins, Database, FileKey2,
  Fingerprint, HardDrive, Pickaxe, SearchX, ShieldCheck,
} from 'lucide-react'
import {
  BlockTable, CopyButton, DemoBanner, DetailGrid, EmptyState, ErrorState, Footer, formatAge,
  formatAmount, formatBytes, formatDate, formatHashrate, HashValue, Header, LoadingState, PageHeader,
  PageSearch, RavenGlyph, SearchBox, StatCard, StatusStrip, TransactionRows,
} from './components'
import { useApi } from './lib/api'
import { useI18n } from './lib/i18n'
import { Link, usePath } from './lib/router'
import type { AddressData, Asset, Block, Status, Transaction } from './types'

function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`section-card ${className}`}><div className="section-card__heading"><h2>{title}</h2>{action}</div>{children}</section>
}

function HomePage({ status }: { status: Status | null }) {
  const { t, locale } = useI18n()
  const blocks = useApi<Block[]>('/api/blocks?limit=7', 30_000)
  const assets = useApi<Asset[]>('/api/assets?limit=5')
  return <>
    <section className="hero"><div className="hero__glow hero__glow--one" /><div className="hero__glow hero__glow--two" /><div className="hero__raven" aria-hidden="true"><RavenGlyph /></div>
      <div className="shell hero__content"><span className="eyebrow"><i />{t('hero.eyebrow')}</span><h1>{t('hero.title1')} <em>{t('hero.title2')}</em></h1><p>{t('hero.body')}</p><SearchBox hero />
        {status && <StatusStrip status={status} />}
      </div>
    </section>
    <main className="shell home-main">
      <div className="stats-grid">
        <StatCard icon={<Box />} label={t('stats.height')} value={status ? `#${new Intl.NumberFormat(locale).format(status.blocks)}` : '—'} note={status?.indexer && status.indexer.progress < 1 ? `${t('indexer.label')} ${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(status.indexer.progress)}` : status ? formatAge(Math.floor(Date.now() / 1000 - status.minutesSinceLastBlock * 60), locale) : undefined} />
        <StatCard icon={<Pickaxe />} label={t('stats.hashrate')} value={status ? formatHashrate(status.networkHashrate, locale) : '—'} note={status ? `${t('stats.difficulty')} ${formatAmount(status.difficulty, locale, 2)}` : undefined} />
        <StatCard icon={<Activity />} label={t('stats.mempool')} value={status ? new Intl.NumberFormat(locale).format(status.mempoolTransactions) : '—'} note={status ? formatBytes(status.mempoolBytes, locale) : undefined} />
        <StatCard icon={<HardDrive />} label={t('stats.storage')} value={status ? formatBytes(status.sizeOnDisk, locale) : '—'} note={status ? `${t('stats.sync')} ${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(status.verificationProgress)}` : undefined} />
      </div>
      <div className="home-grid">
        <Section title={t('blocks.latest')} action={<Link className="text-link" href="/blocks">{t('common.viewAll')} <ArrowRight size={15} /></Link>}>
          {blocks.loading && !blocks.data ? <LoadingState /> : blocks.error ? <ErrorState error={blocks.error} retry={blocks.refetch} /> : <BlockTable blocks={blocks.data ?? []} />}
        </Section>
        <Section title={t('assets.title')} action={<Link className="text-link" href="/assets">{t('common.viewAll')} <ArrowRight size={15} /></Link>}>
          {assets.loading && !assets.data ? <LoadingState /> : assets.error ? <ErrorState error={assets.error} /> : <div className="asset-mini-list">{assets.data?.map((asset) => <Link href={`/asset/${encodeURIComponent(asset.name)}`} key={asset.name}><span className="asset-avatar">{asset.name.slice(0, 2)}</span><span><strong>{asset.name}</strong><small>{formatAmount(asset.amount, locale, asset.units)} · {asset.units}d</small></span><ArrowRight size={16} /></Link>)}</div>}
        </Section>
      </div>
    </main>
  </>
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
  return <main className="shell page"><PageHeader eyebrow={`${t('tx.title')} · ${t('status.mainnet')}`} title={t('tx.title')} subtitle={<span className="heading-hash">{data.txid}</span>} />
    <Section title={t('common.details')}><DetailGrid items={details} /></Section>
    <div className="io-grid top-gap"><Section title={`${t('tx.inputs')} · ${data.vin?.length ?? 0}`}>
      <div className="io-list">{data.vin?.map((input, index) => <div className="io-item" key={`${input.txid}-${index}`}><span className="io-index">{index}</span><div>{input.coinbase ? <><strong>{t('tx.coinbase')}</strong><code>{input.coinbase}</code></> : <><HashValue value={input.address ?? input.txid ?? t('common.unknown')} type={input.address ? 'address' : input.txid ? 'tx' : undefined} /><small>{input.value == null ? `${t('field.output')} #${input.vout ?? 0}` : `${formatAmount(input.value, locale)} RVN`}</small></>}</div></div>)}</div>
    </Section><Section title={`${t('tx.outputs')} · ${data.vout?.length ?? 0}`}>
      <div className="io-list">{data.vout?.map((output) => <div className="io-item" key={output.n}><span className="io-index">{output.n}</span><div>{output.addresses.length ? output.addresses.map((address) => <HashValue key={address} value={address} type="address" />) : <span>{t('tx.noAddress')}</span>}<small>{output.asset ? `${formatAmount(output.asset.amount, locale)} ${output.asset.name}` : `${formatAmount(output.value, locale)} RVN`}</small></div></div>)}</div>
    </Section></div>
  </main>
}

function AddressPage({ address }: { address: string }) {
  const { t, locale } = useI18n()
  const { data, loading, error, refetch } = useApi<AddressData>(`/api/address/${encodeURIComponent(address)}`)
  if (loading && !data) return <main className="shell page"><LoadingState /></main>
  if (error || !data) return <main className="shell page"><ErrorState error={error ?? new Error(t('error.notFound'))} retry={refetch} /></main>
  return <main className="shell page"><PageHeader eyebrow={`${t('address.title')} · ${t('status.mainnet')}`} title={t('address.title')} subtitle={<span className="heading-hash">{data.address}</span>}><CopyButton value={data.address} /></PageHeader>
    <div className="stats-grid stats-grid--three"><StatCard icon={<Coins />} label={t('address.balance')} value={`${formatAmount(data.balance, locale)} RVN`} /><StatCard icon={<ArrowRight />} label={t('address.received')} value={`${formatAmount(data.received, locale)} RVN`} /><StatCard icon={<ArrowLeft />} label={t('address.sent')} value={`${formatAmount(data.sent, locale)} RVN`} /></div>
    <div className="address-grid top-gap"><Section title={t('address.assets')}><div className="balance-list">{data.balances.map((balance) => <Link href={`/asset/${encodeURIComponent(balance.assetName)}`} key={balance.assetName}><span className="asset-avatar">{balance.assetName.slice(0, 2)}</span><span><strong>{balance.assetName}</strong><small>{t('address.received')} {formatAmount(balance.received, locale)}</small></span><b>{formatAmount(balance.balance, locale)}</b></Link>)}</div></Section>
      <Section title={t('address.utxos')}><div className="utxo-list">{data.utxos.slice(0, 8).map((utxo) => <div key={`${utxo.txid}-${utxo.outputIndex}`}><span><Link className="mono-link truncate" href={`/tx/${utxo.txid}`}>{utxo.txid}</Link><small>#{utxo.outputIndex} · {t('field.height')} {utxo.height}</small></span><strong>{formatAmount(utxo.amount, locale)} {utxo.assetName}</strong></div>)}</div></Section>
    </div>
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
  const principles = [
    [<ShieldCheck />, 'about.independent', 'about.independentBody'], [<FileKey2 />, 'about.private', 'about.privateBody'], [<Braces />, 'about.open', 'about.openBody'],
  ] as const
  return <main className="shell page about-page"><PageHeader eyebrow="Ravencoin Community Explorer" title={t('about.title')} subtitle={t('about.body')} />
    <div className="principles">{principles.map(([icon, title, body]) => <article key={title}><span>{icon}</span><h2>{t(title)}</h2><p>{t(body)}</p></article>)}</div>
    <div className="built-by"><div><span className="eyebrow">Dominant Strategies</span><h2>Strategy, product, and technology.</h2><p>The Ravencoin Community Explorer is developed and operated by Dominant Strategies.</p></div><a className="button" href="https://dominantstrategies.io" target="_blank" rel="noreferrer">dominantstrategies.io <ArrowRight size={16} /></a></div>
  </main>
}

function NotFoundPage() {
  const { t } = useI18n()
  return <main className="shell page"><div className="not-found"><span>404</span><Fingerprint /><h1>{t('error.notFound')}</h1><Link className="button" href="/">{t('error.home')} <ArrowRight size={16} /></Link></div></main>
}

function Route({ path, status }: { path: string; status: Status | null }) {
  if (path === '/') return <HomePage status={status} />
  if (path === '/blocks') return <BlocksPage />
  if (path === '/assets') return <AssetsPage />
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
  const isHome = path === '/'
  const memoStatus = useMemo(() => status.data, [status.data])
  return <div className="app"><Header meta={status.meta} />{status.meta?.source === 'demo' && <DemoBanner />}{!isHome && <PageSearch />}<Route path={path} status={memoStatus} /><Footer /></div>
}
