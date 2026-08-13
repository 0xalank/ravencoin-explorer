import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Clipboard, Database, ExternalLink, Globe2, Menu, Moon, Search, Sun, X } from 'lucide-react'
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

export function RavenCoinMark({ className = '' }: { className?: string }) {
  return <span className={`raven-coin-mark ${className}`} aria-label="RVN"><RavenGlyph /></span>
}

export function RavenMark({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  return <div className={`brand ${compact ? 'brand--compact' : ''}`}>
    <span className="brand__mark" aria-hidden="true">
      <img src="/ravencoin-community-explorer-logo.svg" alt="" />
    </span>
    <span className="brand__text"><strong>Ravencoin</strong>{!compact && <small>{t('brand.subtitle')}</small>}</span>
  </div>
}

export function QuaiMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 600 600" role="img" aria-label="Quai Network">
    <circle cx="299.939" cy="301.158" r="175.549" fill="white" />
    <path d="M360.397 299.918C360.379 283.877 353.999 268.498 342.656 257.156C331.314 245.813 315.935 239.433 299.894 239.415C294.321 239.417 288.776 240.191 283.415 241.714C270.569 245.385 259.294 253.193 251.339 263.927C243.575 274.32 239.379 286.945 239.378 299.918C239.396 315.963 245.777 331.345 257.122 342.69C268.467 354.035 283.85 360.417 299.894 360.434C305.028 360.418 310.138 359.749 315.103 358.443L337.717 391.975L370.233 370.338L347.7 336.925C355.939 326.35 360.407 313.324 360.397 299.918Z" fill="#E22901" />
    <path d="M300 100C246.957 100 196.086 121.071 158.579 158.579C121.071 196.086 100 246.957 100 300C100 353.043 121.071 403.914 158.579 441.421C177.15 459.993 199.198 474.725 223.463 484.776C247.728 494.827 273.736 500 300 500C353.043 500 403.914 478.929 441.421 441.421C478.929 403.914 500 353.043 500 300C500 246.957 478.929 196.086 441.421 158.579C403.914 121.071 353.043 100 300 100ZM392.387 403.227L360.093 425.013L337.707 391.84C325.743 396.753 312.933 399.276 300 399.267C273.668 399.267 248.414 388.81 229.789 370.195C211.164 351.581 200.694 326.332 200.68 300C200.655 274.078 210.805 249.182 228.947 230.667C238.101 221.274 249.021 213.784 261.08 208.627C273.385 203.385 286.625 200.691 300 200.707C326.337 200.707 351.595 211.167 370.22 229.787C388.846 248.408 399.313 273.663 399.32 300C399.338 313.064 396.77 326.003 391.763 338.07C386.756 350.137 379.409 361.093 370.147 370.307L392.387 403.227Z" fill="#E22901" />
  </svg>
}

export function Header({ meta }: { meta: ApiMeta | null }) {
  const { t, locale, setLocale } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('rvn-explorer-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('rvn-explorer-theme', theme)
  }, [theme])
  const activeLanguage = languages.find((language) => language.code === locale) ?? languages[0]
  const path = window.location.pathname
  const nav = [
    ['/', 'nav.home'], ['/blocks', 'nav.blocks'], ['/addresses', 'nav.addresses'], ['/assets', 'nav.assets'], ['/stats', 'nav.stats'],
    ['/markets', 'nav.markets'], ['/fork-data', 'nav.data'], ['/community', 'nav.community'], ['/about', 'nav.about'],
  ]
  return <header className="site-header">
    <div className="shell header__inner">
      <Link href="/" className="header__brand" aria-label="Raven Scout home"><RavenMark /></Link>
      <div className="header__actions">
        <a className="quai-nav-link" href="https://soap.qu.ai" target="_blank" rel="noreferrer" title={t('merge.visit')}>
          <QuaiMark /><span>{t('merge.nav')}</span><ExternalLink size={12} />
        </a>
        <span className={`network-pill ${!meta ? 'network-pill--loading' : meta.source === 'demo' ? 'network-pill--demo' : meta.source === 'indexed' ? 'network-pill--indexed' : ''}`}>
          <i /> <span>{!meta ? t('common.loading') : meta.source === 'demo' ? t('status.demo') : meta.source === 'indexed' ? t('status.indexed') : t('status.live')}</span>
        </span>
        <button className="theme-button" onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
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
    <div className="header__nav-row">
      <div className="shell header__nav-inner">
        <nav className={`nav ${menuOpen ? 'nav--open' : ''}`} aria-label="Primary navigation">
          {nav.map(([href, key]) => <Link key={href} href={href} className={path === href || (href !== '/' && path.startsWith(`${href}/`)) ? 'active' : ''} onClick={() => setMenuOpen(false)}>{t(key)}</Link>)}
        </nav>
        {path !== '/' && <div className="header-search"><SearchBox /></div>}
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

export function SyncBanner({ status }: { status: Status | null }) {
  const { t, locale } = useI18n()
  if (!status?.indexer || status.indexer.progress >= 1) return null
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(status.indexer.progress)
  return <aside className="sync-banner" role="status"><div className="shell sync-banner__inner">
    <Database size={15} aria-hidden="true" />
    <p><strong>{t('sync.bannerTitle')}</strong><span>{t('sync.bannerBody')}</span></p>
    <Link href="/stats">{percent} · {t('sync.bannerDetails')} <ArrowRight size={13} /></Link>
  </div></aside>
}

export function Footer() {
  const { t } = useI18n()
  return <footer className="footer"><div className="shell footer__grid">
    <div><RavenMark /><p>{t('footer.disclaimer')}</p></div>
    <div className="footer__meta"><span>{t('footer.readOnly')}</span><span><Link href="/fork-data">{t('nav.data')}</Link></span><span><a href="https://soap.qu.ai" target="_blank" rel="noreferrer">SOAP · Quai merge mining</a></span><span>{t('footer.built')} <a href="https://dominantstrategies.io" target="_blank" rel="noreferrer">Dominant Strategies</a></span><span>© {new Date().getFullYear()} Ravencoin Community Explorer</span></div>
  </div></footer>
}

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
    <div className="transaction-row__main"><RavenCoinMark className="transaction-icon" /><div><Link className="mono-link truncate" href={`/tx/${tx.txid}`}>{tx.txid}</Link><small>{tx.time ? formatAge(tx.time, locale) : t('common.unknown')}</small></div></div>
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
