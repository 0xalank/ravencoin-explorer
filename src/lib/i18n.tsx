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
  'brand.subtitle': 'Community explorer', 'status.live': 'Node online', 'status.indexed': 'Index online', 'status.demo': 'Demo data', 'status.mainnet': 'Mainnet',
  'search.placeholder': 'Search a block, transaction, address, or asset', 'search.button': 'Search', 'search.hint': 'Block height · hash · transaction · address · asset', 'search.error': 'Enter a valid explorer search.',
  'hero.eyebrow': 'Open network · Community operated', 'hero.title': 'Ravencoin Blockchain Explorer', 'hero.body': 'Search blocks, transactions, addresses, balances, and native Ravencoin assets.',
  'merge.nav': 'Quai merge mining', 'merge.visit': 'Visit the Quai SOAP dashboard', 'merge.title': 'Ravencoin + Quai merge mining', 'merge.body': 'Extend participating KAWPOW mining to Quai through SOAP.', 'merge.cta': 'Explore SOAP',
  'demo.title': 'Preview mode', 'demo.body': 'A local Ravencoin node is not connected, so you are viewing representative demo data.',
  'common.viewAll': 'View all', 'common.details': 'Details', 'common.copy': 'Copy', 'common.copied': 'Copied', 'common.retry': 'Try again', 'common.loading': 'Reading the chain…', 'common.yes': 'Yes', 'common.no': 'No', 'common.unknown': 'Unknown', 'common.latest': 'Latest',
  'stats.height': 'Block height', 'stats.hashrate': 'Network hashrate', 'stats.mempool': 'Mempool', 'stats.peers': 'Connected peers', 'stats.difficulty': 'Difficulty', 'stats.storage': 'Chain size', 'stats.sync': 'Sync progress', 'stats.lastBlock': 'Last block',
  'blocks.latest': 'Latest blocks', 'blocks.title': 'Blocks', 'blocks.subtitle': 'The newest confirmed blocks on the Ravencoin network.', 'blocks.previous': 'Newer blocks', 'blocks.next': 'Older blocks', 'blocks.empty': 'No blocks found.',
  'tx.latest': 'Recent transactions', 'tx.title': 'Transaction', 'tx.inputs': 'Inputs', 'tx.outputs': 'Outputs', 'tx.coinbase': 'Newly mined coins', 'tx.noAddress': 'Unparsed script', 'tx.total': 'Total output', 'tx.fee': 'Fee',
  'block.title': 'Block', 'block.transactions': 'Transactions in this block', 'block.previous': 'Previous block', 'block.next': 'Next block',
  'address.title': 'Address', 'address.balance': 'Current balance', 'address.received': 'Total received', 'address.sent': 'Total sent', 'address.assets': 'Asset balances', 'address.utxos': 'Unspent outputs', 'address.transactions': 'Recent transactions',
  'assets.title': 'Ravencoin assets', 'assets.subtitle': 'Browse tokens issued and transferred directly on Ravencoin.', 'assets.search': 'Filter by asset name', 'assets.supply': 'Supply', 'assets.units': 'Decimals', 'assets.reissuable': 'Reissuable', 'assets.metadata': 'Metadata', 'assets.noResults': 'No matching assets.', 'asset.title': 'Asset', 'asset.created': 'Issued at block',
  'assets.transfers': 'Recent asset activity', 'transfer.issue': 'Issued', 'transfer.reissue': 'Reissued', 'transfer.transfer': 'Transferred', 'transfer.from': 'From', 'transfer.to': 'To', 'indexer.label': 'Explorer index', 'indexer.transactions': 'transactions indexed',
  'field.height': 'Height', 'field.hash': 'Hash', 'field.age': 'Age', 'field.time': 'Timestamp', 'field.transactions': 'Transactions', 'field.size': 'Size', 'field.confirmations': 'Confirmations', 'field.version': 'Version', 'field.merkle': 'Merkle root', 'field.nonce': 'Nonce', 'field.bits': 'Bits', 'field.txid': 'Transaction ID', 'field.block': 'Block', 'field.locktime': 'Lock time', 'field.value': 'Value', 'field.type': 'Type', 'field.output': 'Output',
  'about.title': 'Community infrastructure for Ravencoin.', 'about.body': 'Blocks, transactions, addresses, and assets indexed from Ravencoin Core.',
  'error.title': 'We could not read that data', 'error.notFound': 'That page does not exist.', 'error.home': 'Return to overview',
  'footer.built': 'Designed and developed by', 'footer.disclaimer': 'Community-run explorer. Not affiliated with the Ravencoin team or Ravencoin Foundation.', 'footer.readOnly': 'Read-only · Open network data',
}

const ko: Record<string, string> = {
  'nav.home': '개요', 'nav.blocks': '블록', 'nav.assets': '자산', 'nav.about': '소개', 'brand.subtitle': '커뮤니티 탐색기', 'status.live': '노드 온라인', 'status.indexed': '인덱스 온라인', 'status.demo': '데모 데이터', 'status.mainnet': '메인넷',
  'search.placeholder': '블록, 트랜잭션, 주소 또는 자산 검색', 'search.button': '검색', 'search.hint': '블록 높이 · 해시 · 트랜잭션 · 주소 · 자산', 'search.error': '올바른 검색어를 입력하세요.',
  'hero.eyebrow': '오픈 네트워크 · 커뮤니티 운영', 'hero.title': 'Ravencoin 블록체인 탐색기', 'hero.body': '블록, 트랜잭션, 주소, 잔액 및 Ravencoin 네이티브 자산을 검색하세요.',
  'merge.nav': 'Quai 병합 채굴', 'merge.visit': 'Quai SOAP 대시보드 방문', 'merge.title': 'Ravencoin + Quai 병합 채굴', 'merge.body': 'SOAP을 통해 참여 KAWPOW 채굴을 Quai로 확장합니다.', 'merge.cta': 'SOAP 살펴보기',
  'demo.title': '미리보기 모드', 'demo.body': '로컬 Ravencoin 노드가 연결되지 않아 예시 데모 데이터를 표시합니다.', 'common.viewAll': '모두 보기', 'common.details': '상세 정보', 'common.copy': '복사', 'common.copied': '복사됨', 'common.retry': '다시 시도', 'common.loading': '체인 읽는 중…', 'common.yes': '예', 'common.no': '아니요', 'common.unknown': '알 수 없음', 'common.latest': '최신',
  'stats.height': '블록 높이', 'stats.hashrate': '네트워크 해시레이트', 'stats.mempool': '메모리풀', 'stats.peers': '연결된 피어', 'stats.difficulty': '난이도', 'stats.storage': '체인 크기', 'stats.sync': '동기화 진행률', 'stats.lastBlock': '마지막 블록',
  'blocks.latest': '최신 블록', 'blocks.title': '블록', 'blocks.subtitle': 'Ravencoin 네트워크에서 최근 확정된 블록입니다.', 'blocks.previous': '새 블록', 'blocks.next': '이전 블록', 'blocks.empty': '블록이 없습니다.',
  'tx.latest': '최근 트랜잭션', 'tx.title': '트랜잭션', 'tx.inputs': '입력', 'tx.outputs': '출력', 'tx.coinbase': '새로 채굴된 코인', 'tx.noAddress': '해석되지 않은 스크립트', 'tx.total': '총 출력', 'tx.fee': '수수료',
  'block.title': '블록', 'block.transactions': '이 블록의 트랜잭션', 'block.previous': '이전 블록', 'block.next': '다음 블록',
  'address.title': '주소', 'address.balance': '현재 잔액', 'address.received': '총 수신', 'address.sent': '총 전송', 'address.assets': '자산 잔액', 'address.utxos': '미사용 출력', 'address.transactions': '최근 트랜잭션',
  'assets.title': 'Ravencoin 자산', 'assets.subtitle': 'Ravencoin에서 직접 발행되고 전송되는 토큰을 찾아보세요.', 'assets.search': '자산 이름 필터', 'assets.supply': '공급량', 'assets.units': '소수 자릿수', 'assets.reissuable': '재발행 가능', 'assets.metadata': '메타데이터', 'assets.noResults': '일치하는 자산이 없습니다.', 'asset.title': '자산', 'asset.created': '발행 블록',
  'assets.transfers': '최근 자산 활동', 'transfer.issue': '발행', 'transfer.reissue': '재발행', 'transfer.transfer': '전송', 'transfer.from': '보낸 주소', 'transfer.to': '받는 주소', 'indexer.label': '탐색기 인덱스', 'indexer.transactions': '트랜잭션 인덱싱됨',
  'field.height': '높이', 'field.hash': '해시', 'field.age': '경과 시간', 'field.time': '타임스탬프', 'field.transactions': '트랜잭션', 'field.size': '크기', 'field.confirmations': '확인 수', 'field.version': '버전', 'field.merkle': '머클 루트', 'field.nonce': '논스', 'field.bits': '비트', 'field.txid': '트랜잭션 ID', 'field.block': '블록', 'field.locktime': '잠금 시간', 'field.value': '값', 'field.type': '유형', 'field.output': '출력',
  'about.title': 'Ravencoin 커뮤니티 인프라.', 'about.body': 'Ravencoin Core에서 인덱싱한 블록, 트랜잭션, 주소 및 자산 데이터입니다.',
  'error.title': '데이터를 읽을 수 없습니다', 'error.notFound': '페이지를 찾을 수 없습니다.', 'error.home': '개요로 돌아가기', 'footer.built': '디자인 및 개발', 'footer.disclaimer': '커뮤니티 운영 탐색기이며 Ravencoin 팀 또는 재단과 제휴하지 않습니다.', 'footer.readOnly': '읽기 전용 · 공개 네트워크 데이터',
}

const zh: Record<string, string> = {
  'nav.home': '概览', 'nav.blocks': '区块', 'nav.assets': '资产', 'nav.about': '关于', 'brand.subtitle': '社区浏览器', 'status.live': '节点在线', 'status.indexed': '索引在线', 'status.demo': '演示数据', 'status.mainnet': '主网',
  'search.placeholder': '搜索区块、交易、地址或资产', 'search.button': '搜索', 'search.hint': '区块高度 · 哈希 · 交易 · 地址 · 资产', 'search.error': '请输入有效的搜索内容。', 'hero.eyebrow': '开放网络 · 社区运营', 'hero.title': 'Ravencoin 区块链浏览器', 'hero.body': '搜索区块、交易、地址、余额和 Ravencoin 原生资产。',
  'merge.nav': 'Quai 合并挖矿', 'merge.visit': '访问 Quai SOAP 仪表板', 'merge.title': 'Ravencoin + Quai 合并挖矿', 'merge.body': '通过 SOAP 将参与的 KAWPOW 挖矿扩展到 Quai。', 'merge.cta': '探索 SOAP',
  'demo.title': '预览模式', 'demo.body': '尚未连接本地 Ravencoin 节点，当前显示示例演示数据。', 'common.viewAll': '查看全部', 'common.details': '详情', 'common.copy': '复制', 'common.copied': '已复制', 'common.retry': '重试', 'common.loading': '正在读取链上数据…', 'common.yes': '是', 'common.no': '否', 'common.unknown': '未知', 'common.latest': '最新',
  'stats.height': '区块高度', 'stats.hashrate': '网络算力', 'stats.mempool': '内存池', 'stats.peers': '已连接节点', 'stats.difficulty': '难度', 'stats.storage': '链大小', 'stats.sync': '同步进度', 'stats.lastBlock': '最新区块', 'blocks.latest': '最新区块', 'blocks.title': '区块', 'blocks.subtitle': 'Ravencoin 网络最新确认的区块。', 'blocks.previous': '更新区块', 'blocks.next': '更早区块', 'blocks.empty': '未找到区块。',
  'tx.latest': '最近交易', 'tx.title': '交易', 'tx.inputs': '输入', 'tx.outputs': '输出', 'tx.coinbase': '新挖出的币', 'tx.noAddress': '未解析脚本', 'tx.total': '总输出', 'tx.fee': '手续费', 'block.title': '区块', 'block.transactions': '此区块中的交易', 'block.previous': '上一区块', 'block.next': '下一区块',
  'address.title': '地址', 'address.balance': '当前余额', 'address.received': '总接收', 'address.sent': '总发送', 'address.assets': '资产余额', 'address.utxos': '未花费输出', 'address.transactions': '最近交易', 'assets.title': 'Ravencoin 资产', 'assets.subtitle': '浏览直接在 Ravencoin 上发行和转移的代币。', 'assets.search': '按资产名称筛选', 'assets.supply': '供应量', 'assets.units': '小数位', 'assets.reissuable': '可再发行', 'assets.metadata': '元数据', 'assets.noResults': '没有匹配的资产。', 'asset.title': '资产', 'asset.created': '发行区块',
  'assets.transfers': '最近资产活动', 'transfer.issue': '发行', 'transfer.reissue': '再发行', 'transfer.transfer': '转移', 'transfer.from': '发送方', 'transfer.to': '接收方', 'indexer.label': '浏览器索引', 'indexer.transactions': '笔交易已索引',
  'field.height': '高度', 'field.hash': '哈希', 'field.age': '时间', 'field.time': '时间戳', 'field.transactions': '交易', 'field.size': '大小', 'field.confirmations': '确认数', 'field.version': '版本', 'field.merkle': '默克尔根', 'field.nonce': '随机数', 'field.bits': 'Bits', 'field.txid': '交易 ID', 'field.block': '区块', 'field.locktime': '锁定时间', 'field.value': '数值', 'field.type': '类型', 'field.output': '输出',
  'about.title': 'Ravencoin 社区基础设施。', 'about.body': '由 Ravencoin Core 索引的区块、交易、地址和资产数据。',
  'error.title': '无法读取数据', 'error.notFound': '此页面不存在。', 'error.home': '返回概览', 'footer.built': '设计与开发', 'footer.disclaimer': '社区运营的浏览器，与 Ravencoin 团队或基金会无隶属关系。', 'footer.readOnly': '只读 · 开放网络数据',
}

const ja: Record<string, string> = {
  'nav.home': '概要', 'nav.blocks': 'ブロック', 'nav.assets': 'アセット', 'nav.about': '概要', 'brand.subtitle': 'コミュニティ探索', 'status.live': 'ノード接続中', 'status.demo': 'デモデータ', 'status.mainnet': 'メインネット', 'search.placeholder': 'ブロック、取引、アドレス、アセットを検索', 'search.button': '検索', 'search.hint': 'ブロック高 · ハッシュ · 取引 · アドレス · アセット', 'hero.eyebrow': 'オープンネットワーク · コミュニティ運営', 'hero.title1': 'Ravencoinを', 'hero.title2': 'もっと明確に。', 'hero.body': 'ブロック、取引、アドレス、残高、コミュニティアセットをすばやく確認できます。', 'demo.title': 'プレビューモード', 'demo.body': 'ローカルノード未接続のため、サンプルデータを表示しています。', 'common.viewAll': 'すべて表示', 'common.details': '詳細', 'common.copy': 'コピー', 'common.copied': 'コピー済み', 'common.retry': '再試行', 'common.loading': 'チェーンを読み込み中…', 'common.yes': 'はい', 'common.no': 'いいえ', 'common.unknown': '不明', 'common.latest': '最新', 'stats.height': 'ブロック高', 'stats.hashrate': 'ハッシュレート', 'stats.mempool': 'メモリプール', 'stats.peers': '接続ピア', 'blocks.latest': '最新ブロック', 'blocks.title': 'ブロック', 'blocks.subtitle': 'Ravencoinネットワークで最近承認されたブロック。', 'tx.title': '取引', 'tx.inputs': '入力', 'tx.outputs': '出力', 'tx.coinbase': '新規採掘コイン', 'tx.total': '合計出力', 'tx.fee': '手数料', 'block.title': 'ブロック', 'block.transactions': 'このブロックの取引', 'address.title': 'アドレス', 'address.balance': '現在残高', 'address.received': '総受取', 'address.sent': '総送金', 'address.assets': 'アセット残高', 'address.utxos': '未使用出力', 'address.transactions': '最近の取引', 'assets.title': 'Ravencoinアセット', 'assets.subtitle': 'Ravencoin上で発行・転送されるトークンを検索。', 'assets.search': 'アセット名で絞り込み', 'assets.supply': '供給量', 'assets.units': '小数桁', 'assets.reissuable': '再発行可能', 'assets.metadata': 'メタデータ', 'assets.noResults': '一致するアセットがありません。', 'asset.title': 'アセット', 'field.height': '高さ', 'field.hash': 'ハッシュ', 'field.age': '経過時間', 'field.time': 'タイムスタンプ', 'field.transactions': '取引', 'field.size': 'サイズ', 'field.confirmations': '承認数', 'field.version': 'バージョン', 'field.merkle': 'マークルルート', 'field.nonce': 'ノンス', 'field.txid': '取引ID', 'field.block': 'ブロック', 'field.value': '値', 'field.type': '種類', 'about.title': 'Ravencoinコミュニティのために。', 'about.body': '公開Ravencoinブロックチェーンを表示する軽量な読み取り専用探索ツールです。', 'about.independent': '独立運営', 'about.independentBody': 'コミュニティ運営であり、Ravencoinチームまたは財団とは提携していません。', 'about.private': 'プライバシー優先', 'about.privateBody': '検索は読み取り専用で、ウォレット接続は求めません。', 'about.open': 'シンプルでオープン', 'about.openBody': '小さなAPIとデモモードで簡単に運用できます。', 'error.title': 'データを読み込めません', 'error.notFound': 'ページが見つかりません。', 'error.home': '概要へ戻る', 'footer.built': '設計・開発', 'footer.disclaimer': 'コミュニティ運営。Ravencoinチーム・財団とは無関係です。', 'footer.readOnly': '読み取り専用 · 公開ネットワークデータ',
}

const es: Record<string, string> = {
  'nav.home': 'Resumen', 'nav.blocks': 'Bloques', 'nav.assets': 'Activos', 'nav.about': 'Acerca de', 'brand.subtitle': 'Explorador comunitario', 'status.live': 'Nodo conectado', 'status.demo': 'Datos de muestra', 'status.mainnet': 'Red principal', 'search.placeholder': 'Busca un bloque, transacción, dirección o activo', 'search.button': 'Buscar', 'search.hint': 'Altura · hash · transacción · dirección · activo', 'hero.eyebrow': 'Red abierta · Operado por la comunidad', 'hero.title1': 'Ravencoin.', 'hero.title2': 'Con claridad.', 'hero.body': 'Una vista rápida de bloques, transacciones, direcciones, saldos y activos.', 'demo.title': 'Modo de vista previa', 'demo.body': 'No hay un nodo local conectado; se muestran datos de demostración.', 'common.viewAll': 'Ver todo', 'common.details': 'Detalles', 'common.copy': 'Copiar', 'common.copied': 'Copiado', 'common.retry': 'Reintentar', 'common.loading': 'Leyendo la cadena…', 'common.yes': 'Sí', 'common.no': 'No', 'common.unknown': 'Desconocido', 'common.latest': 'Reciente', 'stats.height': 'Altura del bloque', 'stats.hashrate': 'Tasa de hash', 'stats.mempool': 'Mempool', 'stats.peers': 'Pares conectados', 'blocks.latest': 'Bloques recientes', 'blocks.title': 'Bloques', 'blocks.subtitle': 'Los bloques confirmados más recientes de Ravencoin.', 'tx.title': 'Transacción', 'tx.inputs': 'Entradas', 'tx.outputs': 'Salidas', 'tx.coinbase': 'Monedas recién minadas', 'tx.total': 'Salida total', 'tx.fee': 'Comisión', 'block.title': 'Bloque', 'block.transactions': 'Transacciones del bloque', 'address.title': 'Dirección', 'address.balance': 'Saldo actual', 'address.received': 'Total recibido', 'address.sent': 'Total enviado', 'address.assets': 'Saldos de activos', 'address.utxos': 'Salidas no gastadas', 'address.transactions': 'Transacciones recientes', 'assets.title': 'Activos de Ravencoin', 'assets.subtitle': 'Explora tokens emitidos y transferidos directamente en Ravencoin.', 'assets.search': 'Filtrar por nombre', 'assets.supply': 'Suministro', 'assets.units': 'Decimales', 'assets.reissuable': 'Reemitible', 'assets.metadata': 'Metadatos', 'assets.noResults': 'No hay activos coincidentes.', 'asset.title': 'Activo', 'field.height': 'Altura', 'field.hash': 'Hash', 'field.age': 'Antigüedad', 'field.time': 'Fecha', 'field.transactions': 'Transacciones', 'field.size': 'Tamaño', 'field.confirmations': 'Confirmaciones', 'field.version': 'Versión', 'field.merkle': 'Raíz Merkle', 'field.nonce': 'Nonce', 'field.txid': 'ID de transacción', 'field.block': 'Bloque', 'field.value': 'Valor', 'field.type': 'Tipo', 'about.title': 'Creado para la comunidad Ravencoin.', 'about.body': 'Raven Scout es una vista ligera y de solo lectura de la cadena pública de Ravencoin.', 'about.independent': 'Independiente', 'about.independentBody': 'Este explorador es comunitario y no está afiliado con el proyecto ni la fundación Ravencoin.', 'about.private': 'Privacidad primero', 'about.privateBody': 'Las búsquedas son de solo lectura y no se conecta ninguna cartera.', 'about.open': 'Simple y abierto', 'about.openBody': 'Una API pequeña y el modo demo facilitan su operación.', 'error.title': 'No se pudieron leer los datos', 'error.notFound': 'Esta página no existe.', 'error.home': 'Volver al resumen', 'footer.built': 'Diseño y desarrollo por', 'footer.disclaimer': 'Explorador comunitario no afiliado con el equipo ni la Fundación Ravencoin.', 'footer.readOnly': 'Solo lectura · Datos de red abiertos',
}

Object.assign(en, {
  'nav.stats': 'Statistics', 'nav.addresses': 'Addresses', 'nav.markets': 'Markets', 'nav.community': 'Community',
  'indexer.syncing': 'Historical index in progress', 'indexer.indexedTip': 'Indexed tip', 'indexer.networkTip': 'Network tip',
  'indexer.notice': 'Blocks are available now. The indexed tip advances continuously until the complete chain, address history, and asset-transfer history are caught up.',
  'stats.title': 'Network statistics', 'stats.subtitle': 'Technical mining, chain, transaction, and address telemetry from the Ravencoin node and community index.',
  'stats.mining': 'Mining & consensus', 'stats.activity': 'Indexed chain activity', 'stats.chain': 'Chain counters', 'stats.infrastructure': 'Node & index infrastructure',
  'stats.blockTime': 'Average block time', 'stats.reward': 'Average coinbase output', 'stats.current': 'Current node reading', 'stats.average': 'Rolling average',
  'stats.rollingWindow': 'Indexed 24-hour window', 'stats.windowTransactions': 'Transactions in window', 'stats.activeAddresses': 'Active addresses',
  'stats.tps': 'Average transactions / second', 'stats.txPerBlock': 'Transactions / block', 'stats.blocksWindow': 'block window',
  'stats.headers': 'Downloaded headers', 'stats.totalTransactions': 'Indexed transactions', 'stats.trackedAddresses': 'Tracked RVN addresses',
  'stats.assetsIndexed': 'Asset directory', 'stats.database': 'PostgreSQL size', 'stats.avgBlockSize': 'Average block size',
  'stats.protocol': 'Protocol version', 'stats.node': 'Node build', 'stats.windowNote': 'Activity statistics follow the latest indexed window:',
  'stats.summary24': 'Indexed 24-hour summary', 'stats.blocksMined': 'Blocks mined', 'stats.mined': 'RVN mined', 'stats.fees': 'Transaction fees',
  'stats.outputVolume': 'Total output volume', 'stats.indexed24h': 'Latest indexed 24 hours', 'stats.circulating': 'Indexed circulating supply',
  'addresses.title': 'Addresses & rich list', 'addresses.subtitle': 'Ranked RVN balances, distribution, and activity from the PostgreSQL chain index.',
  'addresses.positive': 'Positive-balance addresses', 'addresses.balance': 'Indexed RVN balance', 'addresses.indexed': 'At the indexed chain tip',
  'addresses.topBalance': 'Largest balance on this page', 'addresses.distribution': 'Balance thresholds', 'addresses.addresses': 'addresses',
  'addresses.richList': 'RVN rich list', 'addresses.rank': 'Rank', 'addresses.share': 'Share', 'addresses.blocksMined': 'Blocks mined',
  'addresses.lastActivity': 'Last activity', 'addresses.newer': 'Previous page', 'addresses.older': 'Next page',
  'addresses.note': 'Balances and rankings reflect the current indexed tip and update continuously while historical indexing is in progress.',
  'about.developed': 'Developed & operated by', 'about.dominant': 'Explorer engineering and community infrastructure.',
  'about.mergeMining': 'Merge-mining ecosystem', 'about.quai': 'Ravencoin + Quai mining telemetry on SOAP.',
  'about.disclosure': 'Independent community explorer. Not affiliated with the Ravencoin team or Ravencoin Foundation.',
  'markets.title': 'Ravencoin markets', 'markets.subtitle': 'Direct links to major exchanges with active RVN spot markets.',
  'markets.heading': 'Trade RVN across global and Korean markets', 'markets.body': 'Listings are informational links only. Availability, custody, and regional requirements vary by venue.',
  'markets.disclaimer': 'Market links are provided for discovery and are not endorsements or financial advice. Verify the pair, network, deposit status, and jurisdiction before trading.',
  'community.title': 'Ravencoin community', 'community.subtitle': 'Developer, regional, social, and open-source channels maintained by the wider Ravencoin community.',
  'community.heading': 'A global, community-run network', 'community.body': 'Get support, follow development, meet miners and asset builders, or contribute directly to Ravencoin Core.', 'community.global': 'Global',
})

Object.assign(ko, {
  'nav.stats': '통계', 'nav.addresses': '주소', 'nav.markets': '마켓', 'nav.community': '커뮤니티',
  'indexer.syncing': '과거 데이터 인덱싱 중', 'indexer.indexedTip': '인덱싱 높이', 'indexer.networkTip': '네트워크 높이',
  'indexer.notice': '블록은 지금 조회할 수 있습니다. 전체 체인, 주소 기록 및 자산 전송 기록이 완료될 때까지 인덱싱 높이가 계속 증가합니다.',
  'stats.title': '네트워크 통계', 'stats.subtitle': 'Ravencoin 노드와 커뮤니티 인덱스의 채굴, 체인, 트랜잭션 및 주소 기술 지표입니다.',
  'stats.mining': '채굴 및 합의', 'stats.activity': '인덱싱된 체인 활동', 'stats.chain': '체인 카운터', 'stats.infrastructure': '노드 및 인덱스 인프라',
  'stats.blockTime': '평균 블록 시간', 'stats.reward': '평균 코인베이스 출력', 'stats.current': '현재 노드 값', 'stats.average': '이동 평균',
  'stats.rollingWindow': '인덱싱된 최근 24시간', 'stats.windowTransactions': '구간 트랜잭션', 'stats.activeAddresses': '활성 주소',
  'stats.tps': '초당 평균 트랜잭션', 'stats.txPerBlock': '블록당 트랜잭션', 'stats.blocksWindow': '블록 구간',
  'stats.headers': '다운로드된 헤더', 'stats.totalTransactions': '인덱싱된 트랜잭션', 'stats.trackedAddresses': '추적 중인 RVN 주소',
  'stats.assetsIndexed': '자산 디렉터리', 'stats.database': 'PostgreSQL 크기', 'stats.avgBlockSize': '평균 블록 크기',
  'stats.protocol': '프로토콜 버전', 'stats.node': '노드 빌드', 'stats.windowNote': '활동 통계의 최신 인덱싱 구간:',
  'stats.summary24': '인덱싱된 24시간 요약', 'stats.blocksMined': '채굴 블록', 'stats.mined': '채굴된 RVN', 'stats.fees': '트랜잭션 수수료',
  'stats.outputVolume': '총 출력량', 'stats.indexed24h': '최근 인덱싱 24시간', 'stats.circulating': '인덱싱된 유통량',
  'addresses.title': '주소 및 리치 리스트', 'addresses.subtitle': 'PostgreSQL 체인 인덱스의 RVN 잔액 순위, 분포 및 활동입니다.',
  'addresses.positive': '잔액이 있는 주소', 'addresses.balance': '인덱싱된 RVN 잔액', 'addresses.indexed': '현재 인덱싱 높이 기준',
  'addresses.topBalance': '이 페이지 최대 잔액', 'addresses.distribution': '잔액 기준 분포', 'addresses.addresses': '주소',
  'addresses.richList': 'RVN 리치 리스트', 'addresses.rank': '순위', 'addresses.share': '비중', 'addresses.blocksMined': '채굴 블록',
  'addresses.lastActivity': '최근 활동', 'addresses.newer': '이전 페이지', 'addresses.older': '다음 페이지',
  'addresses.note': '잔액과 순위는 현재 인덱싱 높이를 기준으로 하며 과거 데이터 인덱싱 중 계속 갱신됩니다.',
  'about.developed': '개발 및 운영', 'about.dominant': '탐색기 엔지니어링 및 커뮤니티 인프라.',
  'about.mergeMining': '병합 채굴 생태계', 'about.quai': 'SOAP의 Ravencoin + Quai 채굴 지표.',
  'about.disclosure': '독립 커뮤니티 탐색기이며 Ravencoin 팀 또는 재단과 제휴하지 않습니다.',
  'markets.title': 'Ravencoin 마켓', 'markets.subtitle': 'RVN 현물 거래를 지원하는 주요 거래소 바로가기입니다.',
  'markets.heading': '글로벌 및 한국 마켓에서 RVN 거래', 'markets.body': '정보 제공용 링크입니다. 이용 가능 여부, 수탁 및 지역 규정은 거래소마다 다릅니다.',
  'markets.disclaimer': '마켓 링크는 탐색용이며 보증이나 투자 조언이 아닙니다. 거래 전 페어, 네트워크, 입출금 상태 및 관할 규정을 확인하세요.',
  'community.title': 'Ravencoin 커뮤니티', 'community.subtitle': 'Ravencoin 커뮤니티가 운영하는 개발자, 지역, 소셜 및 오픈소스 채널입니다.',
  'community.heading': '글로벌 커뮤니티 운영 네트워크', 'community.body': '지원, 개발 소식, 채굴 및 자산 제작자 교류, Ravencoin Core 기여 채널을 확인하세요.', 'community.global': '글로벌',
})

Object.assign(zh, {
  'nav.stats': '统计', 'nav.addresses': '地址', 'nav.markets': '市场', 'nav.community': '社区',
  'indexer.syncing': '历史数据索引进行中', 'indexer.indexedTip': '已索引高度', 'indexer.networkTip': '网络高度',
  'indexer.notice': '区块现已可查询。索引高度将持续增长，直至完整链、地址历史和资产转账历史全部同步。',
  'stats.title': '网络统计', 'stats.subtitle': '来自 Ravencoin 节点和社区索引的挖矿、链、交易及地址技术指标。',
  'stats.mining': '挖矿与共识', 'stats.activity': '已索引链上活动', 'stats.chain': '链计数器', 'stats.infrastructure': '节点与索引基础设施',
  'stats.blockTime': '平均出块时间', 'stats.reward': '平均 Coinbase 输出', 'stats.current': '当前节点读数', 'stats.average': '滚动平均',
  'stats.rollingWindow': '已索引的 24 小时窗口', 'stats.windowTransactions': '窗口交易数', 'stats.activeAddresses': '活跃地址',
  'stats.tps': '平均每秒交易数', 'stats.txPerBlock': '每区块交易数', 'stats.blocksWindow': '区块窗口',
  'stats.headers': '已下载区块头', 'stats.totalTransactions': '已索引交易', 'stats.trackedAddresses': '已跟踪 RVN 地址',
  'stats.assetsIndexed': '资产目录', 'stats.database': 'PostgreSQL 大小', 'stats.avgBlockSize': '平均区块大小',
  'stats.protocol': '协议版本', 'stats.node': '节点版本', 'stats.windowNote': '活动统计对应最新索引窗口：',
  'stats.summary24': '已索引 24 小时摘要', 'stats.blocksMined': '已挖区块', 'stats.mined': '已挖 RVN', 'stats.fees': '交易手续费',
  'stats.outputVolume': '总输出量', 'stats.indexed24h': '最近已索引 24 小时', 'stats.circulating': '已索引流通量',
  'addresses.title': '地址与富豪榜', 'addresses.subtitle': '来自 PostgreSQL 链索引的 RVN 余额排名、分布和活动。',
  'addresses.positive': '正余额地址', 'addresses.balance': '已索引 RVN 余额', 'addresses.indexed': '基于当前索引高度',
  'addresses.topBalance': '本页最大余额', 'addresses.distribution': '余额阈值', 'addresses.addresses': '个地址',
  'addresses.richList': 'RVN 富豪榜', 'addresses.rank': '排名', 'addresses.share': '占比', 'addresses.blocksMined': '已挖区块',
  'addresses.lastActivity': '最近活动', 'addresses.newer': '上一页', 'addresses.older': '下一页',
  'addresses.note': '余额和排名反映当前索引高度，并会在历史索引期间持续更新。',
  'about.developed': '开发与运营', 'about.dominant': '浏览器工程与社区基础设施。',
  'about.mergeMining': '合并挖矿生态', 'about.quai': 'SOAP 上的 Ravencoin + Quai 挖矿指标。',
  'about.disclosure': '独立社区浏览器，与 Ravencoin 团队或基金会无隶属关系。',
  'markets.title': 'Ravencoin 市场', 'markets.subtitle': '支持 RVN 现货交易的主要交易所直达链接。',
  'markets.heading': '在全球及韩国市场交易 RVN', 'markets.body': '链接仅供信息参考。可用性、托管及地区要求因平台而异。',
  'markets.disclaimer': '市场链接仅用于发现，不构成认可或投资建议。交易前请核实交易对、网络、充提状态和所在地规定。',
  'community.title': 'Ravencoin 社区', 'community.subtitle': '由更广泛 Ravencoin 社区维护的开发者、地区、社交和开源频道。',
  'community.heading': '全球社区运营网络', 'community.body': '获取支持、关注开发、联系矿工与资产开发者，或直接参与 Ravencoin Core。', 'community.global': '全球',
})

Object.assign(ja, {
  'hero.title': 'Ravencoin ブロックチェーンエクスプローラー',
  'hero.body': 'ブロック、取引、アドレス、残高、Ravencoin ネイティブアセットを検索できます。',
  'merge.nav': 'Quai マージマイニング',
  'merge.visit': 'Quai SOAP ダッシュボードへ',
  'merge.title': 'Ravencoin + Quai マージマイニング',
  'merge.body': 'SOAP を通じて KAWPOW マイニングを Quai へ拡張します。',
  'merge.cta': 'SOAPを見る',
  'tx.latest': '最近の取引',
  'nav.stats': '統計', 'nav.addresses': 'アドレス', 'nav.markets': '市場', 'nav.community': 'コミュニティ',
  'stats.title': 'ネットワーク統計', 'markets.title': 'Ravencoin 市場', 'community.title': 'Ravencoin コミュニティ',
})

Object.assign(es, {
  'hero.title': 'Explorador de la blockchain Ravencoin',
  'hero.body': 'Busca bloques, transacciones, direcciones, saldos y activos nativos de Ravencoin.',
  'merge.nav': 'Minería combinada Quai',
  'merge.visit': 'Visitar el panel SOAP de Quai',
  'merge.title': 'Minería combinada Ravencoin + Quai',
  'merge.body': 'Extiende la minería KAWPOW participante a Quai mediante SOAP.',
  'merge.cta': 'Explorar SOAP',
  'tx.latest': 'Transacciones recientes',
  'nav.stats': 'Estadísticas', 'nav.addresses': 'Direcciones', 'nav.markets': 'Mercados', 'nav.community': 'Comunidad',
  'stats.title': 'Estadísticas de red', 'markets.title': 'Mercados de Ravencoin', 'community.title': 'Comunidad Ravencoin',
})

Object.assign(en, {
  'theme.light': 'Use light mode', 'theme.dark': 'Use dark mode',
  'stats.transactionsChart': 'Transactions by hour', 'stats.addressesChart': 'Active addresses by hour',
  'stats.difficultyChart': 'Mining difficulty by hour', 'stats.indexedSeries': 'Latest indexed 24 hours',
  'stats.networkOverview': 'Network overview', 'stats.chainData': 'Chain & index data',
  'address.overview': 'Address overview', 'address.holdings': 'Holdings & unspent outputs',
})
Object.assign(ko, {
  'theme.light': '라이트 모드 사용', 'theme.dark': '다크 모드 사용',
  'stats.transactionsChart': '시간별 트랜잭션', 'stats.addressesChart': '시간별 활성 주소',
  'stats.difficultyChart': '시간별 채굴 난이도', 'stats.indexedSeries': '최근 인덱싱 24시간',
  'stats.networkOverview': '네트워크 개요', 'stats.chainData': '체인 및 인덱스 데이터',
  'address.overview': '주소 개요', 'address.holdings': '보유 자산 및 미사용 출력',
})
Object.assign(zh, {
  'theme.light': '使用浅色模式', 'theme.dark': '使用深色模式',
  'stats.transactionsChart': '每小时交易数', 'stats.addressesChart': '每小时活跃地址',
  'stats.difficultyChart': '每小时挖矿难度', 'stats.indexedSeries': '最近已索引 24 小时',
  'stats.networkOverview': '网络概览', 'stats.chainData': '链与索引数据',
  'address.overview': '地址概览', 'address.holdings': '资产与未花费输出',
})
Object.assign(ja, {
  'theme.light': 'ライトモードを使用', 'theme.dark': 'ダークモードを使用',
  'stats.transactionsChart': '時間別トランザクション', 'stats.addressesChart': '時間別アクティブアドレス',
  'stats.difficultyChart': '時間別マイニング難易度', 'stats.indexedSeries': '直近24時間のインデックス',
  'stats.networkOverview': 'ネットワーク概要', 'stats.chainData': 'チェーンとインデックス',
  'address.overview': 'アドレス概要', 'address.holdings': '保有資産と未使用出力',
})
Object.assign(es, {
  'theme.light': 'Usar modo claro', 'theme.dark': 'Usar modo oscuro',
  'stats.transactionsChart': 'Transacciones por hora', 'stats.addressesChart': 'Direcciones activas por hora',
  'stats.difficultyChart': 'Dificultad minera por hora', 'stats.indexedSeries': 'Últimas 24 horas indexadas',
  'stats.networkOverview': 'Resumen de red', 'stats.chainData': 'Datos de cadena e índice',
  'address.overview': 'Resumen de dirección', 'address.holdings': 'Saldos y salidas no gastadas',
})

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
