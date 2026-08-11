import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'ko' | 'zh-CN' | 'ja' | 'es'

export const languages: { code: Locale; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ko', label: '한국어', short: 'KO' },
  { code: 'zh-CN', label: '简体中文', short: '中文' },
  { code: 'ja', label: '日本語', short: '日本' },
  { code: 'es', label: 'Español', short: 'ES' },
]

const en: Record<string, string> = {
  'nav.home': 'Overview', 'nav.blocks': 'Blocks', 'nav.assets': 'Assets', 'nav.about': 'About',
  'brand.subtitle': 'Community explorer', 'status.live': 'Node online', 'status.demo': 'Demo data', 'status.mainnet': 'Mainnet',
  'search.placeholder': 'Search a block, transaction, address, or asset', 'search.button': 'Search', 'search.hint': 'Block height · hash · transaction · address · asset', 'search.error': 'Enter a valid explorer search.',
  'hero.eyebrow': 'Open network · Community operated', 'hero.title1': 'See Ravencoin.', 'hero.title2': 'Clearly.', 'hero.body': 'A focused, fast view of blocks, transactions, addresses, balances, and community assets.',
  'demo.title': 'Preview mode', 'demo.body': 'A local Ravencoin node is not connected, so you are viewing representative demo data.',
  'common.viewAll': 'View all', 'common.details': 'Details', 'common.copy': 'Copy', 'common.copied': 'Copied', 'common.retry': 'Try again', 'common.loading': 'Reading the chain…', 'common.yes': 'Yes', 'common.no': 'No', 'common.unknown': 'Unknown', 'common.latest': 'Latest',
  'stats.height': 'Block height', 'stats.hashrate': 'Network hashrate', 'stats.mempool': 'Mempool', 'stats.peers': 'Connected peers', 'stats.difficulty': 'Difficulty', 'stats.storage': 'Chain size', 'stats.sync': 'Sync progress', 'stats.lastBlock': 'Last block',
  'blocks.latest': 'Latest blocks', 'blocks.title': 'Blocks', 'blocks.subtitle': 'The newest confirmed blocks on the Ravencoin network.', 'blocks.previous': 'Newer blocks', 'blocks.next': 'Older blocks', 'blocks.empty': 'No blocks found.',
  'tx.latest': 'Recent transactions', 'tx.title': 'Transaction', 'tx.inputs': 'Inputs', 'tx.outputs': 'Outputs', 'tx.coinbase': 'Newly mined coins', 'tx.noAddress': 'Unparsed script', 'tx.total': 'Total output', 'tx.fee': 'Fee',
  'block.title': 'Block', 'block.transactions': 'Transactions in this block', 'block.previous': 'Previous block', 'block.next': 'Next block',
  'address.title': 'Address', 'address.balance': 'Current balance', 'address.received': 'Total received', 'address.sent': 'Total sent', 'address.assets': 'Asset balances', 'address.utxos': 'Unspent outputs', 'address.transactions': 'Recent transactions',
  'assets.title': 'Ravencoin assets', 'assets.subtitle': 'Browse tokens issued and transferred directly on Ravencoin.', 'assets.search': 'Filter by asset name', 'assets.supply': 'Supply', 'assets.units': 'Decimals', 'assets.reissuable': 'Reissuable', 'assets.metadata': 'Metadata', 'assets.noResults': 'No matching assets.', 'asset.title': 'Asset', 'asset.created': 'Issued at block',
  'field.height': 'Height', 'field.hash': 'Hash', 'field.age': 'Age', 'field.time': 'Timestamp', 'field.transactions': 'Transactions', 'field.size': 'Size', 'field.confirmations': 'Confirmations', 'field.version': 'Version', 'field.merkle': 'Merkle root', 'field.nonce': 'Nonce', 'field.bits': 'Bits', 'field.txid': 'Transaction ID', 'field.block': 'Block', 'field.locktime': 'Lock time', 'field.value': 'Value', 'field.type': 'Type', 'field.output': 'Output',
  'about.title': 'Built for the Ravencoin community.', 'about.body': 'Raven Scout is a lightweight, read-only window into the public Ravencoin blockchain. It is designed for everyday lookups, community support, and transparent access to basic network data.', 'about.independent': 'Independent by design', 'about.independentBody': 'This explorer is community-run and is not affiliated with, maintained by, or endorsed by the Ravencoin project or Ravencoin Foundation.', 'about.private': 'Private by default', 'about.privateBody': 'Searches are read-only. Node credentials remain on the server and no wallet connection is requested.', 'about.open': 'Simple and open', 'about.openBody': 'A small API surface and graceful demo mode make the explorer easy to run, inspect, and support.',
  'error.title': 'We could not read that data', 'error.notFound': 'That page does not exist.', 'error.home': 'Return to overview',
  'footer.built': 'Designed and developed by', 'footer.disclaimer': 'Community-run explorer. Not affiliated with the Ravencoin team or Ravencoin Foundation.', 'footer.readOnly': 'Read-only · Open network data',
}

const ko: Record<string, string> = {
  'nav.home': '개요', 'nav.blocks': '블록', 'nav.assets': '자산', 'nav.about': '소개', 'brand.subtitle': '커뮤니티 탐색기', 'status.live': '노드 온라인', 'status.demo': '데모 데이터', 'status.mainnet': '메인넷',
  'search.placeholder': '블록, 트랜잭션, 주소 또는 자산 검색', 'search.button': '검색', 'search.hint': '블록 높이 · 해시 · 트랜잭션 · 주소 · 자산', 'search.error': '올바른 검색어를 입력하세요.',
  'hero.eyebrow': '오픈 네트워크 · 커뮤니티 운영', 'hero.title1': 'Ravencoin을', 'hero.title2': '명확하게.', 'hero.body': '블록, 트랜잭션, 주소, 잔액 및 커뮤니티 자산을 빠르고 간결하게 확인하세요.',
  'demo.title': '미리보기 모드', 'demo.body': '로컬 Ravencoin 노드가 연결되지 않아 예시 데모 데이터를 표시합니다.', 'common.viewAll': '모두 보기', 'common.details': '상세 정보', 'common.copy': '복사', 'common.copied': '복사됨', 'common.retry': '다시 시도', 'common.loading': '체인 읽는 중…', 'common.yes': '예', 'common.no': '아니요', 'common.unknown': '알 수 없음', 'common.latest': '최신',
  'stats.height': '블록 높이', 'stats.hashrate': '네트워크 해시레이트', 'stats.mempool': '메모리풀', 'stats.peers': '연결된 피어', 'stats.difficulty': '난이도', 'stats.storage': '체인 크기', 'stats.sync': '동기화 진행률', 'stats.lastBlock': '마지막 블록',
  'blocks.latest': '최신 블록', 'blocks.title': '블록', 'blocks.subtitle': 'Ravencoin 네트워크에서 최근 확정된 블록입니다.', 'blocks.previous': '새 블록', 'blocks.next': '이전 블록', 'blocks.empty': '블록이 없습니다.',
  'tx.latest': '최근 트랜잭션', 'tx.title': '트랜잭션', 'tx.inputs': '입력', 'tx.outputs': '출력', 'tx.coinbase': '새로 채굴된 코인', 'tx.noAddress': '해석되지 않은 스크립트', 'tx.total': '총 출력', 'tx.fee': '수수료',
  'block.title': '블록', 'block.transactions': '이 블록의 트랜잭션', 'block.previous': '이전 블록', 'block.next': '다음 블록',
  'address.title': '주소', 'address.balance': '현재 잔액', 'address.received': '총 수신', 'address.sent': '총 전송', 'address.assets': '자산 잔액', 'address.utxos': '미사용 출력', 'address.transactions': '최근 트랜잭션',
  'assets.title': 'Ravencoin 자산', 'assets.subtitle': 'Ravencoin에서 직접 발행되고 전송되는 토큰을 찾아보세요.', 'assets.search': '자산 이름 필터', 'assets.supply': '공급량', 'assets.units': '소수 자릿수', 'assets.reissuable': '재발행 가능', 'assets.metadata': '메타데이터', 'assets.noResults': '일치하는 자산이 없습니다.', 'asset.title': '자산', 'asset.created': '발행 블록',
  'field.height': '높이', 'field.hash': '해시', 'field.age': '경과 시간', 'field.time': '타임스탬프', 'field.transactions': '트랜잭션', 'field.size': '크기', 'field.confirmations': '확인 수', 'field.version': '버전', 'field.merkle': '머클 루트', 'field.nonce': '논스', 'field.bits': '비트', 'field.txid': '트랜잭션 ID', 'field.block': '블록', 'field.locktime': '잠금 시간', 'field.value': '값', 'field.type': '유형', 'field.output': '출력',
  'about.title': 'Ravencoin 커뮤니티를 위해 만들었습니다.', 'about.body': 'Raven Scout는 공개 Ravencoin 블록체인을 보여주는 가벼운 읽기 전용 탐색기입니다. 일상적인 조회, 커뮤니티 지원 및 기본 네트워크 데이터의 투명한 접근을 위해 설계되었습니다.', 'about.independent': '독립적인 운영', 'about.independentBody': '이 탐색기는 커뮤니티에서 운영하며 Ravencoin 프로젝트 또는 재단과 제휴, 유지 관리, 보증 관계가 없습니다.', 'about.private': '개인정보 우선', 'about.privateBody': '검색은 읽기 전용입니다. 노드 자격 증명은 서버에 보관되며 지갑 연결을 요청하지 않습니다.', 'about.open': '단순하고 개방적', 'about.openBody': '작은 API와 데모 모드로 쉽게 운영하고 점검하며 지원할 수 있습니다.',
  'error.title': '데이터를 읽을 수 없습니다', 'error.notFound': '페이지를 찾을 수 없습니다.', 'error.home': '개요로 돌아가기', 'footer.built': '디자인 및 개발', 'footer.disclaimer': '커뮤니티 운영 탐색기이며 Ravencoin 팀 또는 재단과 제휴하지 않습니다.', 'footer.readOnly': '읽기 전용 · 공개 네트워크 데이터',
}

const zh: Record<string, string> = {
  'nav.home': '概览', 'nav.blocks': '区块', 'nav.assets': '资产', 'nav.about': '关于', 'brand.subtitle': '社区浏览器', 'status.live': '节点在线', 'status.demo': '演示数据', 'status.mainnet': '主网',
  'search.placeholder': '搜索区块、交易、地址或资产', 'search.button': '搜索', 'search.hint': '区块高度 · 哈希 · 交易 · 地址 · 资产', 'search.error': '请输入有效的搜索内容。', 'hero.eyebrow': '开放网络 · 社区运营', 'hero.title1': '清晰查看', 'hero.title2': 'Ravencoin。', 'hero.body': '快速、专注地查看区块、交易、地址、余额和社区资产。',
  'demo.title': '预览模式', 'demo.body': '尚未连接本地 Ravencoin 节点，当前显示示例演示数据。', 'common.viewAll': '查看全部', 'common.details': '详情', 'common.copy': '复制', 'common.copied': '已复制', 'common.retry': '重试', 'common.loading': '正在读取链上数据…', 'common.yes': '是', 'common.no': '否', 'common.unknown': '未知', 'common.latest': '最新',
  'stats.height': '区块高度', 'stats.hashrate': '网络算力', 'stats.mempool': '内存池', 'stats.peers': '已连接节点', 'stats.difficulty': '难度', 'stats.storage': '链大小', 'stats.sync': '同步进度', 'stats.lastBlock': '最新区块', 'blocks.latest': '最新区块', 'blocks.title': '区块', 'blocks.subtitle': 'Ravencoin 网络最新确认的区块。', 'blocks.previous': '更新区块', 'blocks.next': '更早区块', 'blocks.empty': '未找到区块。',
  'tx.latest': '最近交易', 'tx.title': '交易', 'tx.inputs': '输入', 'tx.outputs': '输出', 'tx.coinbase': '新挖出的币', 'tx.noAddress': '未解析脚本', 'tx.total': '总输出', 'tx.fee': '手续费', 'block.title': '区块', 'block.transactions': '此区块中的交易', 'block.previous': '上一区块', 'block.next': '下一区块',
  'address.title': '地址', 'address.balance': '当前余额', 'address.received': '总接收', 'address.sent': '总发送', 'address.assets': '资产余额', 'address.utxos': '未花费输出', 'address.transactions': '最近交易', 'assets.title': 'Ravencoin 资产', 'assets.subtitle': '浏览直接在 Ravencoin 上发行和转移的代币。', 'assets.search': '按资产名称筛选', 'assets.supply': '供应量', 'assets.units': '小数位', 'assets.reissuable': '可再发行', 'assets.metadata': '元数据', 'assets.noResults': '没有匹配的资产。', 'asset.title': '资产', 'asset.created': '发行区块',
  'field.height': '高度', 'field.hash': '哈希', 'field.age': '时间', 'field.time': '时间戳', 'field.transactions': '交易', 'field.size': '大小', 'field.confirmations': '确认数', 'field.version': '版本', 'field.merkle': '默克尔根', 'field.nonce': '随机数', 'field.bits': 'Bits', 'field.txid': '交易 ID', 'field.block': '区块', 'field.locktime': '锁定时间', 'field.value': '数值', 'field.type': '类型', 'field.output': '输出',
  'about.title': '为 Ravencoin 社区而建。', 'about.body': 'Raven Scout 是查看公开 Ravencoin 区块链的轻量只读窗口，专为日常查询、社区支持和透明访问基础网络数据而设计。', 'about.independent': '独立运营', 'about.independentBody': '本浏览器由社区运营，与 Ravencoin 项目或基金会无隶属、维护或背书关系。', 'about.private': '隐私优先', 'about.privateBody': '所有搜索均为只读。节点凭据保留在服务器端，不会请求连接钱包。', 'about.open': '简单开放', 'about.openBody': '精简 API 和优雅的演示模式，让部署、检查和支持更轻松。',
  'error.title': '无法读取数据', 'error.notFound': '此页面不存在。', 'error.home': '返回概览', 'footer.built': '设计与开发', 'footer.disclaimer': '社区运营的浏览器，与 Ravencoin 团队或基金会无隶属关系。', 'footer.readOnly': '只读 · 开放网络数据',
}

const ja: Record<string, string> = {
  'nav.home': '概要', 'nav.blocks': 'ブロック', 'nav.assets': 'アセット', 'nav.about': '概要', 'brand.subtitle': 'コミュニティ探索', 'status.live': 'ノード接続中', 'status.demo': 'デモデータ', 'status.mainnet': 'メインネット', 'search.placeholder': 'ブロック、取引、アドレス、アセットを検索', 'search.button': '検索', 'search.hint': 'ブロック高 · ハッシュ · 取引 · アドレス · アセット', 'hero.eyebrow': 'オープンネットワーク · コミュニティ運営', 'hero.title1': 'Ravencoinを', 'hero.title2': 'もっと明確に。', 'hero.body': 'ブロック、取引、アドレス、残高、コミュニティアセットをすばやく確認できます。', 'demo.title': 'プレビューモード', 'demo.body': 'ローカルノード未接続のため、サンプルデータを表示しています。', 'common.viewAll': 'すべて表示', 'common.details': '詳細', 'common.copy': 'コピー', 'common.copied': 'コピー済み', 'common.retry': '再試行', 'common.loading': 'チェーンを読み込み中…', 'common.yes': 'はい', 'common.no': 'いいえ', 'common.unknown': '不明', 'common.latest': '最新', 'stats.height': 'ブロック高', 'stats.hashrate': 'ハッシュレート', 'stats.mempool': 'メモリプール', 'stats.peers': '接続ピア', 'blocks.latest': '最新ブロック', 'blocks.title': 'ブロック', 'blocks.subtitle': 'Ravencoinネットワークで最近承認されたブロック。', 'tx.title': '取引', 'tx.inputs': '入力', 'tx.outputs': '出力', 'tx.coinbase': '新規採掘コイン', 'tx.total': '合計出力', 'tx.fee': '手数料', 'block.title': 'ブロック', 'block.transactions': 'このブロックの取引', 'address.title': 'アドレス', 'address.balance': '現在残高', 'address.received': '総受取', 'address.sent': '総送金', 'address.assets': 'アセット残高', 'address.utxos': '未使用出力', 'address.transactions': '最近の取引', 'assets.title': 'Ravencoinアセット', 'assets.subtitle': 'Ravencoin上で発行・転送されるトークンを検索。', 'assets.search': 'アセット名で絞り込み', 'assets.supply': '供給量', 'assets.units': '小数桁', 'assets.reissuable': '再発行可能', 'assets.metadata': 'メタデータ', 'assets.noResults': '一致するアセットがありません。', 'asset.title': 'アセット', 'field.height': '高さ', 'field.hash': 'ハッシュ', 'field.age': '経過時間', 'field.time': 'タイムスタンプ', 'field.transactions': '取引', 'field.size': 'サイズ', 'field.confirmations': '承認数', 'field.version': 'バージョン', 'field.merkle': 'マークルルート', 'field.nonce': 'ノンス', 'field.txid': '取引ID', 'field.block': 'ブロック', 'field.value': '値', 'field.type': '種類', 'about.title': 'Ravencoinコミュニティのために。', 'about.body': '公開Ravencoinブロックチェーンを表示する軽量な読み取り専用探索ツールです。', 'about.independent': '独立運営', 'about.independentBody': 'コミュニティ運営であり、Ravencoinチームまたは財団とは提携していません。', 'about.private': 'プライバシー優先', 'about.privateBody': '検索は読み取り専用で、ウォレット接続は求めません。', 'about.open': 'シンプルでオープン', 'about.openBody': '小さなAPIとデモモードで簡単に運用できます。', 'error.title': 'データを読み込めません', 'error.notFound': 'ページが見つかりません。', 'error.home': '概要へ戻る', 'footer.built': '設計・開発', 'footer.disclaimer': 'コミュニティ運営。Ravencoinチーム・財団とは無関係です。', 'footer.readOnly': '読み取り専用 · 公開ネットワークデータ',
}

const es: Record<string, string> = {
  'nav.home': 'Resumen', 'nav.blocks': 'Bloques', 'nav.assets': 'Activos', 'nav.about': 'Acerca de', 'brand.subtitle': 'Explorador comunitario', 'status.live': 'Nodo conectado', 'status.demo': 'Datos de muestra', 'status.mainnet': 'Red principal', 'search.placeholder': 'Busca un bloque, transacción, dirección o activo', 'search.button': 'Buscar', 'search.hint': 'Altura · hash · transacción · dirección · activo', 'hero.eyebrow': 'Red abierta · Operado por la comunidad', 'hero.title1': 'Ravencoin.', 'hero.title2': 'Con claridad.', 'hero.body': 'Una vista rápida de bloques, transacciones, direcciones, saldos y activos.', 'demo.title': 'Modo de vista previa', 'demo.body': 'No hay un nodo local conectado; se muestran datos de demostración.', 'common.viewAll': 'Ver todo', 'common.details': 'Detalles', 'common.copy': 'Copiar', 'common.copied': 'Copiado', 'common.retry': 'Reintentar', 'common.loading': 'Leyendo la cadena…', 'common.yes': 'Sí', 'common.no': 'No', 'common.unknown': 'Desconocido', 'common.latest': 'Reciente', 'stats.height': 'Altura del bloque', 'stats.hashrate': 'Tasa de hash', 'stats.mempool': 'Mempool', 'stats.peers': 'Pares conectados', 'blocks.latest': 'Bloques recientes', 'blocks.title': 'Bloques', 'blocks.subtitle': 'Los bloques confirmados más recientes de Ravencoin.', 'tx.title': 'Transacción', 'tx.inputs': 'Entradas', 'tx.outputs': 'Salidas', 'tx.coinbase': 'Monedas recién minadas', 'tx.total': 'Salida total', 'tx.fee': 'Comisión', 'block.title': 'Bloque', 'block.transactions': 'Transacciones del bloque', 'address.title': 'Dirección', 'address.balance': 'Saldo actual', 'address.received': 'Total recibido', 'address.sent': 'Total enviado', 'address.assets': 'Saldos de activos', 'address.utxos': 'Salidas no gastadas', 'address.transactions': 'Transacciones recientes', 'assets.title': 'Activos de Ravencoin', 'assets.subtitle': 'Explora tokens emitidos y transferidos directamente en Ravencoin.', 'assets.search': 'Filtrar por nombre', 'assets.supply': 'Suministro', 'assets.units': 'Decimales', 'assets.reissuable': 'Reemitible', 'assets.metadata': 'Metadatos', 'assets.noResults': 'No hay activos coincidentes.', 'asset.title': 'Activo', 'field.height': 'Altura', 'field.hash': 'Hash', 'field.age': 'Antigüedad', 'field.time': 'Fecha', 'field.transactions': 'Transacciones', 'field.size': 'Tamaño', 'field.confirmations': 'Confirmaciones', 'field.version': 'Versión', 'field.merkle': 'Raíz Merkle', 'field.nonce': 'Nonce', 'field.txid': 'ID de transacción', 'field.block': 'Bloque', 'field.value': 'Valor', 'field.type': 'Tipo', 'about.title': 'Creado para la comunidad Ravencoin.', 'about.body': 'Raven Scout es una vista ligera y de solo lectura de la cadena pública de Ravencoin.', 'about.independent': 'Independiente', 'about.independentBody': 'Este explorador es comunitario y no está afiliado con el proyecto ni la fundación Ravencoin.', 'about.private': 'Privacidad primero', 'about.privateBody': 'Las búsquedas son de solo lectura y no se conecta ninguna cartera.', 'about.open': 'Simple y abierto', 'about.openBody': 'Una API pequeña y el modo demo facilitan su operación.', 'error.title': 'No se pudieron leer los datos', 'error.notFound': 'Esta página no existe.', 'error.home': 'Volver al resumen', 'footer.built': 'Diseño y desarrollo por', 'footer.disclaimer': 'Explorador comunitario no afiliado con el equipo ni la Fundación Ravencoin.', 'footer.readOnly': 'Solo lectura · Datos de red abiertos',
}

const dictionaries: Record<Locale, Record<string, string>> = { en, ko, 'zh-CN': zh, ja, es }

interface I18nValue { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string, values?: Record<string, string | number>) => string }
const I18nContext = createContext<I18nValue | null>(null)

function initialLocale(): Locale {
  const saved = localStorage.getItem('raven-scout-locale') as Locale | null
  if (saved && dictionaries[saved]) return saved
  const browser = navigator.language
  if (browser.startsWith('ko')) return 'ko'
  if (browser.startsWith('zh')) return 'zh-CN'
  if (browser.startsWith('ja')) return 'ja'
  if (browser.startsWith('es')) return 'es'
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  useEffect(() => {
    localStorage.setItem('raven-scout-locale', locale)
    document.documentElement.lang = locale
  }, [locale])
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => {
      let result = dictionaries[locale][key] ?? en[key] ?? key
      for (const [name, value] of Object.entries(values ?? {})) result = result.replaceAll(`{${name}}`, String(value))
      return result
    },
  }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
