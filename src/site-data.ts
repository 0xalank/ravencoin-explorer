export interface MarketVenue {
  name: string
  pair: string
  href: string
  logo: string
  mark: string
  color: string
  region?: string
}

export const marketVenues: MarketVenue[] = [
  { name: 'Binance', pair: 'RVN / USDT', href: 'https://www.binance.com/en/trade/RVN_USDT', logo: 'https://coin-images.coingecko.com/markets/images/52/small/binance.jpg', mark: 'BN', color: '#f3ba2f', region: 'Global' },
  { name: 'Upbit', pair: 'RVN / KRW', href: 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-RVN', logo: 'https://coin-images.coingecko.com/markets/images/117/small/upbit.png', mark: 'UP', color: '#2875e2', region: 'Korea' },
  { name: 'Bithumb', pair: 'RVN / KRW', href: 'https://www.bithumb.com/trade/order/RVN_KRW', logo: 'https://coin-images.coingecko.com/markets/images/6/small/bithumb_BI.png', mark: 'BT', color: '#f37021', region: 'Korea' },
  { name: 'OKX', pair: 'RVN / USDT', href: 'https://www.okx.com/trade-spot/rvn-usdt', logo: 'https://coin-images.coingecko.com/markets/images/96/small/WeChat_Image_20220117220452.png', mark: 'OK', color: '#ffffff', region: 'Global' },
  { name: 'Bybit', pair: 'RVN / USDT', href: 'https://www.bybit.com/trade/spot/RVN/USDT', logo: 'https://coin-images.coingecko.com/markets/images/698/small/bybit_spot.png', mark: 'BY', color: '#f7a600', region: 'Global' },
  { name: 'Bitget', pair: 'RVN / USDT', href: 'https://www.bitget.com/en/spot/RVNUSDT_SPBL', logo: 'https://coin-images.coingecko.com/markets/images/540/small/2023-07-25_21.47.43.jpg', mark: 'BG', color: '#00f0ff', region: 'Global' },
  { name: 'Gate', pair: 'RVN / USDT', href: 'https://gate.io/trade/RVN_USDT', logo: 'https://coin-images.coingecko.com/markets/images/60/small/Frame_1.png', mark: 'GT', color: '#17e6a1', region: 'Global' },
  { name: 'MEXC', pair: 'RVN / USDT', href: 'https://www.mexc.com/exchange/RVN_USDT', logo: 'https://coin-images.coingecko.com/markets/images/409/small/164286be-32a5-4b58-978c-d072eea00eb9.jpeg', mark: 'MX', color: '#2f7df6', region: 'Global' },
  { name: 'KuCoin', pair: 'RVN / USDT', href: 'https://www.kucoin.com/trade/RVN-USDT', logo: 'https://coin-images.coingecko.com/markets/images/61/small/kucoin.png', mark: 'KC', color: '#24ae8f', region: 'Global' },
  { name: 'HTX', pair: 'RVN / USDT', href: 'https://www.htx.com/trade/rvn_usdt', logo: 'https://coin-images.coingecko.com/markets/images/25/small/htx.png', mark: 'HX', color: '#2f79ff', region: 'Global' },
  { name: 'WhiteBIT', pair: 'RVN / USDT', href: 'https://whitebit.com/trade/RVN_USDT', logo: 'https://coin-images.coingecko.com/markets/images/418/small/800_800.jpg', mark: 'WB', color: '#e8ff47', region: 'Europe' },
  { name: 'BitMart', pair: 'RVN / USDT', href: 'https://www.bitmart.com/trade/en-US?symbol=RVN_USDT', logo: 'https://coin-images.coingecko.com/markets/images/239/small/Bitmart.png', mark: 'BM', color: '#14b6f6', region: 'Global' },
  { name: 'CoinW', pair: 'RVN / USDT', href: 'https://www.coinw.com/front/market', logo: 'https://coin-images.coingecko.com/markets/images/1172/small/coinw_new_logo.png', mark: 'CW', color: '#3578ff', region: 'Global' },
  { name: 'XT.COM', pair: 'RVN / USDT', href: 'https://www.xt.com/trade/rvn_usdt', logo: 'https://coin-images.coingecko.com/markets/images/404/small/xt_logo_%E7%BB%BF.png', mark: 'XT', color: '#36ddad', region: 'Global' },
  { name: 'Crypto.com', pair: 'RVN / USD', href: 'https://crypto.com/exchange/trade/spot/RVN_USD', logo: 'https://coin-images.coingecko.com/markets/images/589/small/h2oMjPp6_400x400.jpg', mark: 'CD', color: '#103f68', region: 'Global' },
  { name: 'CoinEx', pair: 'RVN / USDT', href: 'https://www.coinex.com/trading?currency=USDT&dest=RVN', logo: 'https://coin-images.coingecko.com/markets/images/135/small/coinex.jpg', mark: 'CX', color: '#00c2b7', region: 'Global' },
]

export type CommunityIcon = 'telegram' | 'discord' | 'reddit' | 'x' | 'github' | 'globe'

export interface CommunityLink {
  name: string
  description: string
  href: string
  icon: CommunityIcon
  language?: string
}

export const communityLinks: CommunityLink[] = [
  { name: 'RavencoinDev', description: 'Developer and protocol discussion on Telegram.', href: 'https://t.me/RavencoinDev', icon: 'telegram', language: 'English' },
  { name: 'Ravencoin Korea', description: 'Active Korean Ravencoin community on Telegram.', href: 'https://t.me/ravencoinkorea', icon: 'telegram', language: '한국어' },
  { name: 'Ravencoin Discord', description: 'Community support, mining, assets, and development.', href: 'https://discord.com/invite/jn6uhur', icon: 'discord' },
  { name: 'r/Ravencoin', description: 'Long-form community discussion and project updates.', href: 'https://www.reddit.com/r/Ravencoin/', icon: 'reddit' },
  { name: '@Ravencoin', description: 'Network announcements and ecosystem updates.', href: 'https://x.com/Ravencoin', icon: 'x' },
  { name: 'Ravencoin Core', description: 'Source code, releases, issues, and contributions.', href: 'https://github.com/RavenProject/Ravencoin', icon: 'github' },
  { name: 'Ravencoin.org', description: 'Official community-maintained project resources.', href: 'https://ravencoin.org/', icon: 'globe' },
]
