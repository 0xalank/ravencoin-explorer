import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Clipboard, Database, Globe2, Menu, Search, X } from 'lucide-react'
import { api } from './lib/api'
import { languages, useI18n } from './lib/i18n'
import { Link, navigate } from './lib/router'
import type { ApiMeta, Block, Status, Transaction } from './types'

export function RavenGlyph({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 256 256" role="img" aria-label="Ravencoin raven">
    <polygon points="62,243 101,68 124,200" fill="#394080" />
    <polygon points="62,243 124,200 163,201" fill="#394080" />
    <polygon points="101,68 123,34 142,40" fill="#343f83" />
    <polygon points="101,68 142,40 178,76" fill="#f79534" />
    <polygon points="101,68 124,200 163,201 178,76" fill="#f04f3b" />
    <polygon points="163,201 178,76 183,78" fill="#303d83" />
    <polygon points="123,34 143,16 165,18 142,40" fill="#f04f3b" />
    <polygon points="143,16 165,18 175,38 142,40" fill="#f79534" />
    <polygon points="165,18 175,38 203,36" fill="#f79534" />
    <polygon points="175,38 178,48 203,36" fill="#e9862d" />
  </svg>
}

export function RavenMark({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  return <div className={`brand ${compact ? 'brand--compact' : ''}`}>
    <span className="brand__mark" aria-hidden="true">
      <RavenGlyph />
    </span>
    <span className="brand__text"><strong>Ravencoin</strong>{!compact && <small>{t('brand.subtitle')}</small>}</span>
  </div>
}

export function Header({ meta }: { meta: ApiMeta | null }) {
  const { t, locale, setLocale } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const activeLanguage = languages.find((language) => language.code === locale) ?? languages[0]
  const path = window.location.pathname
  const nav = [
    ['/', 'nav.home'], ['/blocks', 'nav.blocks'], ['/assets', 'nav.assets'], ['/about', 'nav.about'],
  ]
  return <header className="site-header">
    <div className="shell header__inner">
      <Link href="/" className="header__brand" aria-label="Raven Scout home"><RavenMark /></Link>
      <nav className={`nav ${menuOpen ? 'nav--open' : ''}`} aria-label="Primary navigation">
        {nav.map(([href, key]) => <Link key={href} href={href} className={path === href ? 'active' : ''} onClick={() => setMenuOpen(false)}>{t(key)}</Link>)}
      </nav>
      <div className="header__actions">
        <span className={`network-pill ${!meta ? 'network-pill--loading' : meta.source === 'demo' ? 'network-pill--demo' : meta.source === 'indexed' ? 'network-pill--indexed' : ''}`}>
          <i /> <span>{!meta ? t('common.loading') : meta.source === 'demo' ? t('status.demo') : meta.source === 'indexed' ? t('status.indexed') : t('status.live')}</span>
        </span>
        <div className="language">
          <button className="language__button" onClick={() => setLanguageOpen((open) => !open)} aria-expanded={languageOpen} aria-label="Choose language">
            <Globe2 size={16} /><span>{activeLanguage.short}</span><ChevronDown size={14} />
          </button>
          {languageOpen && <div className="language__menu">
            {languages.map((language) => <button key={language.code} className={language.code === locale ? 'active' : ''} onClick={() => { setLocale(language.code); setLanguageOpen(false) }}>
              {language.label}{language.code === locale && <Check size={14} />}
            </button>)}
          </div>}
        </div>
        <button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation">{menuOpen ? <X /> : <Menu />}</button>
      </div>
    </div>
  </header>
}

export function SearchBox({ hero = false }: { hero?: boolean }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault(); inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!query.trim()) { setError(t('search.error')); return }
    setLoading(true); setError('')
    try {
      const result = await api<{ path: string }>(`/api/search?q=${encodeURIComponent(query.trim())}`)
      navigate(result.data.path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('search.error'))
    } finally { setLoading(false) }
  }
  return <div className={`search-wrap ${hero ? 'search-wrap--hero' : ''}`}>
    <form className="search-box" onSubmit={submit}>
      <Search className="search-box__icon" size={hero ? 23 : 19} />
      <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} />
      <kbd>/</kbd>
      <button disabled={loading} type="submit"><span>{t('search.button')}</span><ArrowRight size={18} /></button>
    </form>
    {hero && <p className="search-hint">{t('search.hint')}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}

export function DemoBanner() {
  const { t } = useI18n()
  return <div className="demo-banner"><div className="shell demo-banner__inner"><span className="demo-badge">DEMO</span><p><strong>{t('demo.title')}</strong> {t('demo.body')}</p></div></div>
}

export function Footer() {
  const { t } = useI18n()
  return <footer className="footer"><div className="shell footer__grid">
    <div><RavenMark /><p>{t('footer.disclaimer')}</p></div>
      <div className="footer__meta"><span>{t('footer.readOnly')}</span><span>{t('footer.built')} <a href="https://dominantstrategies.io" target="_blank" rel="noreferrer">Dominant Strategies</a></span><span>© {new Date().getFullYear()} Ravencoin Community Explorer</span></div>
  </div></footer>
}

export function PageSearch() { return <div className="page-search shell"><SearchBox /></div> }

export function PageHeader({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return <div className="page-heading">
    {eyebrow && <span className="eyebrow">{eyebrow}</span>}
    <div className="page-heading__row"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children}</div>
  </div>
}

export function LoadingState() {
  const { t } = useI18n()
  return <div className="state-card"><span className="loader" /><p>{t('common.loading')}</p></div>
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  const { t } = useI18n()
  return <div className="state-card state-card--error"><span className="state-icon">!</span><h2>{t('error.title')}</h2><p>{error.message}</p>{retry && <button className="button button--secondary" onClick={retry}>{t('common.retry')}</button>}</div>
}

export function EmptyState({ children }: { children: ReactNode }) { return <div className="state-card"><p>{children}</p></div> }

export function CopyButton({ value }: { value: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  return <button className="copy-button" onClick={copy} title={t('common.copy')} aria-label={t('common.copy')}>{copied ? <Check size={15} /> : <Clipboard size={15} />}<span>{copied ? t('common.copied') : t('common.copy')}</span></button>
}

export function HashValue({ value, type, copy = false }: { value: string; type?: 'block' | 'tx' | 'address'; copy?: boolean }) {
  const content = type ? <Link className="mono-link" href={`/${type}/${encodeURIComponent(value)}`}>{value}</Link> : <span className="mono">{value}</span>
  return <span className="hash-value">{content}{copy && <CopyButton value={value} />}</span>
}

export function DetailGrid({ items }: { items: { label: string; value: ReactNode; wide?: boolean }[] }) {
  return <div className="detail-grid">{items.map((item, index) => <div className={`detail-item ${item.wide ? 'detail-item--wide' : ''}`} key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
}

export function formatAmount(value: number | null | undefined, locale: string, max = 8) {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(value)
}

export function formatAge(timestamp: number | null | undefined, locale: string) {
  if (!timestamp) return '—'
  const seconds = Math.round(timestamp - Date.now() / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

export function formatDate(timestamp: number | null | undefined, locale: string) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp * 1000)
}

export function formatBytes(value: number | null | undefined, locale: string) {
  if (value == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value; let unit = 0
  while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1 }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)} ${units[unit]}`
}

export function formatHashrate(value: number, locale: string) {
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s']
  let amount = value; let unit = 0
  while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1 }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)} ${units[unit]}`
}

export function BlockTable({ blocks }: { blocks: Block[] }) {
  const { t, locale } = useI18n()
  return <div className="table-wrap"><table><thead><tr><th>{t('field.height')}</th><th>{t('field.age')}</th><th>{t('field.transactions')}</th><th>{t('field.size')}</th><th>{t('field.hash')}</th></tr></thead>
    <tbody>{blocks.map((block) => <tr key={block.hash}><td><Link className="height-link" href={`/block/${block.height}`}>#{new Intl.NumberFormat(locale).format(block.height)}</Link></td><td>{formatAge(block.time, locale)}</td><td>{block.txCount}</td><td>{formatBytes(block.size, locale)}</td><td><Link className="mono-link truncate" href={`/block/${block.hash}`}>{block.hash}</Link></td></tr>)}</tbody></table></div>
}

export function TransactionRows({ transactions }: { transactions: Transaction[] }) {
  const { t, locale } = useI18n()
  return <div className="transaction-list">{transactions.map((tx) => <article className="transaction-row" key={tx.txid}>
    <div className="transaction-row__main"><span className="transaction-icon">TX</span><div><Link className="mono-link truncate" href={`/tx/${tx.txid}`}>{tx.txid}</Link><small>{tx.time ? formatAge(tx.time, locale) : t('common.unknown')}</small></div></div>
    <div className="transaction-row__stats"><span><small>{t('tx.total')}</small><strong>{formatAmount(tx.totalOutput, locale)} RVN</strong></span><span><small>{t('field.confirmations')}</small><strong>{tx.confirmations ?? '—'}</strong></span></div>
  </article>)}</div>
}

export function StatCard({ icon, label, value, note }: { icon: ReactNode; label: string; value: ReactNode; note?: ReactNode }) {
  return <article className="stat-card"><span className="stat-card__icon">{icon}</span><div><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</div></article>
}

export function StatusStrip({ status }: { status: Status }) {
  const { t, locale } = useI18n()
  if (status.indexer) return <div className="status-strip"><span><i className="pulse" />{t('status.mainnet')}</span><span><Database size={12} />{t('indexer.label')} <strong>{new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(status.indexer.progress)}</strong></span><span>#{new Intl.NumberFormat(locale).format(status.indexer.indexedHeight)} / #{new Intl.NumberFormat(locale).format(status.indexer.targetHeight)}</span><span>{new Intl.NumberFormat(locale).format(status.indexer.indexedTransactions)} {t('indexer.transactions')}</span></div>
  return <div className="status-strip"><span><i className="pulse" />{t('status.mainnet')}</span><span>{t('stats.sync')} <strong>{new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(status.verificationProgress)}</strong></span><span>{status.subversion}</span></div>
}
