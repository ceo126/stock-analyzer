require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 8120;

app.use(cors({ origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`] }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
  ].join('; '));
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting (IP당 분당 30회, 고정 윈도우)
const rateMap = new Map();
const rateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now - entry.start > 60000) rateMap.delete(ip);
  }
}, 30000);
app.use('/api', (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > 60000) {
    rateMap.set(ip, { start: now, count: 1 });
  } else {
    entry.count++;
    if (entry.count > 30) return res.status(429).json({ success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }
  next();
});

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY가 .env에 설정되어 있지 않습니다.');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  // 서버 소켓 에러가 아닌 경우에만 종료
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') process.exit(1);
});
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err?.message || err));

// ========================
//   캐시 (5분 TTL)
// ========================
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 200) evictCache();
}
function evictCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
  // 아직도 200 초과면 가장 오래된 것 제거
  while (cache.size > 200) {
    cache.delete(cache.keys().next().value);
  }
}
// 주기적 TTL 만료 캐시 정리 (60초마다)
const cacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}, 60000);

// ========================
//   한국 종목 매핑
// ========================
const KR_STOCK_NAMES = {
  '005930': '삼성전자', '005935': '삼성전자우', '000660': 'SK하이닉스',
  '005380': '현대차', '005490': 'POSCO홀딩스', '035420': 'NAVER',
  '035720': '카카오', '051910': 'LG화학', '006400': '삼성SDI',
  '003670': '포스코퓨처엠', '105560': 'KB금융', '055550': '신한지주',
  '086790': '하나금융지주', '066570': 'LG전자', '003550': 'LG',
  '034730': 'SK', '000270': '기아', '012330': '현대모비스',
  '028260': '삼성물산', '207940': '삼성바이오로직스', '068270': '셀트리온',
  '009150': '삼성전기', '018260': '삼성SDS', '010130': '고려아연',
  '032830': '삼성생명', '096770': 'SK이노베이션', '030200': 'KT',
  '017670': 'SK텔레콤', '316140': '우리금융지주', '323410': '카카오뱅크',
  '259960': '크래프톤', '003490': '대한항공', '033780': 'KT&G',
  '011200': 'HMM', '015760': '한국전력', '034020': '두산에너빌리티',
  '010950': 'S-Oil', '373220': 'LG에너지솔루션', '352820': '하이브',
  '247540': '에코프로비엠', '086520': '에코프로', '263750': '펄어비스',
  '042700': '한미반도체', '196170': '알테오젠', '377300': '카카오페이',
  '036570': '엔씨소프트', '251270': '넷마블', '047050': '포스코인터내셔널',
  '000810': '삼성화재', '024110': '기업은행',
  // KOSDAQ 확장
  '293490': '카카오게임즈', '035900': 'JYP Ent.', '041510': 'SM',
  '112040': '위메이드', '003380': '하림지주', '058470': '리노공업',
  '357780': '솔브레인', '240810': '원익IPS', '091990': '셀트리온헬스케어',
  '145020': '휴젤', '328130': '루닛', '326030': 'SK바이오팜',
  '039030': '이오테크닉스', '067160': '아프리카TV', '095340': 'ISC',
  '383220': 'F&F', '060310': '3S', '041190': '우리기술투자',
  '257720': '실리콘투', '131970': '테스나',
};

const KOSDAQ_CODES = new Set([
  '042700', '196170', '086520', '247540', '263750',
  '293490', '035900', '041510',
  '112040', '058470', '357780', '240810', '091990', '145020',
  '328130', '326030', '039030', '067160', '095340', '383220',
  '060310', '041190', '257720', '131970',
]);

function toYahooSymbol(symbol) {
  if (/^\d{6}\.(KS|KQ)$/.test(symbol)) return symbol;
  if (/^\d{6}$/.test(symbol)) return symbol + (KOSDAQ_CODES.has(symbol) ? '.KQ' : '.KS');
  return symbol;
}

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 기간별 인터벌 자동 결정 (주봉 전환)
function getInterval(range) {
  if (['2y', '5y', '10y'].includes(range)) return '1wk';
  return '1d';
}

// ========================
//   Yahoo Finance API
// ========================
async function fetchYahooChart(symbol, range) {
  const interval = getInterval(range);
  const cacheKey = `chart:${symbol}:${range}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Yahoo API HTTP ${res.status}`);

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error('해당 종목을 찾을 수 없습니다.');

  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};

  // previousClose = 전일 종가 (일일 변동 계산용)
  // chartPreviousClose = 차트 시작 전 종가 (기간 수익률용)
  const prevClose = meta.previousClose || meta.chartPreviousClose || 0;
  const curPrice = meta.regularMarketPrice || 0;

  // 시가: 마지막 거래일의 open 값 (meta에 없을 수 있으므로 chartData에서 추출)
  const lastOpen = q.open?.[timestamps.length - 1] || null;

  const quote = {
    name: KR_STOCK_NAMES[symbol.replace(/\.(KS|KQ)$/, '')] || meta.shortName || meta.longName || symbol,
    price: curPrice,
    open: meta.regularMarketOpen || lastOpen,
    change: curPrice - prevClose,
    changePercent: prevClose ? ((curPrice - prevClose) / prevClose * 100) : 0,
    volume: meta.regularMarketVolume || 0,
    marketCap: null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow || null,
    previousClose: prevClose || null,
    dayHigh: meta.regularMarketDayHigh || null,
    dayLow: meta.regularMarketDayLow || null,
    currency: meta.currency || '',
    exchange: meta.exchangeName || meta.exchange || '',
  };

  const chartData = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = q.close?.[i];
    if (close == null || close === 0) continue;
    const d = new Date(timestamps[i] * 1000);
    chartData.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T00:00:00.000Z`,
      open: q.open?.[i] || close, high: q.high?.[i] || close,
      low: q.low?.[i] || close, close, volume: q.volume?.[i] || 0,
    });
  }

  const out = { quote, chartData };
  setCache(cacheKey, out);
  return out;
}

// Yahoo 뉴스 검색
async function fetchYahooNews(query, count = 5) {
  const cacheKey = `news:${query}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}&listsCount=0`;
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA }, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const news = (data.news || []).map(n => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      date: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toLocaleDateString('ko-KR') : '',
    }));
    setCache(cacheKey, news);
    return news;
  } catch { return []; }
}

// 환율 조회 (USD/KRW)
async function fetchExchangeRate() {
  const cached = getCached('fx:USDKRW');
  if (cached) return cached;
  try {
    const { quote } = await fetchYahooChart('KRW=X', '5d');
    const rate = quote.price || 1350;
    setCache('fx:USDKRW', rate);
    return rate;
  } catch { return 1350; }
}

// ========================
//   API 엔드포인트
// ========================
app.get('/api/kr-stocks', (req, res) => {
  const list = Object.entries(KR_STOCK_NAMES).map(([code, name]) => {
    const suffix = KOSDAQ_CODES.has(code) ? '.KQ' : '.KS';
    return { symbol: code + suffix, name, exchange: suffix === '.KQ' ? 'KOSDAQ' : 'KOSPI' };
  });
  res.json({ stocks: list });
});

app.get('/api/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim().slice(0, 50);
    if (!query) return res.json({ results: [] });
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
    const fetchRes = await fetch(url, { headers: { 'User-Agent': YAHOO_UA }, signal: AbortSignal.timeout(5000) });
    const data = await fetchRes.json();
    res.json({ results: (data.quotes || []).map(q => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, exchange: q.exchDisp || q.exchange, type: q.quoteType })) });
  } catch { res.json({ results: [] }); }
});

// 뉴스 API
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const news = await fetchYahooNews(symbol);
    res.json({ news });
  } catch {
    res.json({ news: [] });
  }
});

// 환율 API
app.get('/api/exchange-rate', async (req, res) => {
  try {
    const rate = await fetchExchangeRate();
    res.json({ rate });
  } catch {
    res.json({ rate: 1350 });
  }
});

// 워치리스트 시세
app.post('/api/watchlist-prices', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > 20) return res.json({ prices: {} });
    const prices = {};
    await Promise.allSettled(symbols.map(async (sym) => {
      try {
        const { quote } = await fetchYahooChart(toYahooSymbol(sym), '5d');
        prices[sym] = { price: quote.price, change: quote.change, changePercent: quote.changePercent, currency: quote.currency };
      } catch {}
    }));
    res.json({ prices });
  } catch { res.json({ prices: {} }); }
});

// 종목 비교 API
app.get('/api/compare', async (req, res) => {
  try {
    const symbols = (req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
    const validPeriods = ['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y'];
    const period = validPeriods.includes(req.query.period) ? req.query.period : '1y';
    if (symbols.length < 2) return res.status(400).json({ success: false, error: '2개 이상 종목이 필요합니다' });

    const results = await Promise.all(symbols.map(async sym => {
      const yahooSym = toYahooSymbol(sym);
      const { quote, chartData } = await fetchYahooChart(yahooSym, period);
      const displaySym = sym.replace(/\.(KS|KQ)$/, '');
      // 수익률 정규화 (첫날=0%)
      const base = chartData[0]?.close || 1;
      const normalized = chartData.map(d => ({
        date: d.date,
        return: ((d.close - base) / base) * 100,
      }));
      return { symbol: displaySym, name: quote.name, normalized, quote };
    }));

    res.json({ success: true, results });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 주식 데이터 조회
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    let symbol = req.params.symbol.trim();
    const validPeriods = ['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y'];
    const period = validPeriods.includes(req.query.period) ? req.query.period : '1y';
    const yahooSymbol = toYahooSymbol(symbol);
    const displaySymbol = symbol.replace(/\.(KS|KQ)$/, '');

    // 차트 데이터는 선택 기간으로, 시세(quote)는 항상 5d로 정확한 전일대비 계산
    const [chartResult, quoteResult] = await Promise.all([
      fetchYahooChart(yahooSymbol, period),
      period !== '5d' ? fetchYahooChart(yahooSymbol, '5d') : null,
    ]);

    const { chartData } = chartResult;
    const quote = quoteResult ? quoteResult.quote : chartResult.quote;
    if (chartData.length === 0) throw new Error('차트 데이터가 없습니다.');

    // 해외 종목이면 환율 정보 추가
    let exchangeRate = null;
    if (quote.currency && quote.currency !== 'KRW') {
      exchangeRate = await fetchExchangeRate();
    }

    res.json({ success: true, symbol: displaySymbol, quote, chartData, exchangeRate });
  } catch (err) {
    console.error('Stock fetch error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ========================
//   AI 분석 API
// ========================
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, quote, chartData } = req.body;
    if (!symbol || !quote || !Array.isArray(chartData) || chartData.length === 0 || chartData.length > 1000) {
      return res.status(400).json({ success: false, error: '유효하지 않은 요청 데이터입니다.' });
    }

    const closes = chartData.map(d => d.close);
    const volumes = chartData.map(d => d.volume);
    const latestClose = closes[closes.length - 1];
    const ma5 = calcMA(closes, 5), ma20 = calcMA(closes, 20), ma60 = calcMA(closes, 60), ma120 = calcMA(closes, 120);
    const rsi = calcRSI(closes, 14);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes, 20);
    const stoch = calcStochastic(chartData, 14);
    const avgVol20 = calcMA(volumes, 20);
    const volRatio = avgVol20 > 0 ? volumes[volumes.length - 1] / avgVol20 : 1;
    const srLevels = calcSupportResistance(chartData);

    // 종합 투자 스코어 (0~100)
    const score = calcSignalScore({ rsi, macd, ma5, ma20, ma60, bb, latestClose, volRatio, stoch });

    const indicators = {
      MA5: r2(ma5), MA20: r2(ma20), MA60: r2(ma60), MA120: r2(ma120),
      RSI: r2(rsi),
      MACD: r2(macd.macd), MACD_Signal: r2(macd.signal), MACD_Histogram: r2(macd.macd - macd.signal),
      BB_Upper: r2(bb.upper), BB_Middle: r2(bb.middle), BB_Lower: r2(bb.lower),
      BB_Width: bb.middle !== 0 ? r2(((bb.upper - bb.lower) / bb.middle) * 100) : 0,
      Stochastic_K: r2(stoch.k), Stochastic_D: r2(stoch.d),
      현재가: r2(latestClose), 거래량비율: r2(volRatio),
      지지선: srLevels.support.map(r2), 저항선: srLevels.resistance.map(r2),
      종합스코어: score,
    };

    // 뉴스 가져오기
    const news = await fetchYahooNews(quote.name || symbol);
    const newsText = news.length > 0
      ? '\n## 최근 뉴스\n' + news.map(n => `- [${n.date}] ${n.title} (${n.publisher})`).join('\n')
      : '';

    const priceSummary = chartData.slice(-30).map(d => ({
      date: new Date(d.date).toLocaleDateString('ko-KR'),
      close: Math.round(d.close), volume: d.volume
    }));

    const prompt = `당신은 20년 경력의 주식 애널리스트입니다. 아래 종목 데이터를 기반으로 분석 리포트를 작성해주세요.

## 종목: ${quote.name} (${symbol})
- 현재가: ${quote.price} ${quote.currency || ''}
- 전일대비: ${quote.change > 0 ? '+' : ''}${r2(quote.change)} (${quote.changePercent > 0 ? '+' : ''}${r2(quote.changePercent)}%)
- 52주 고/저: ${quote.fiftyTwoWeekHigh} / ${quote.fiftyTwoWeekLow}
- 거래소: ${quote.exchange}
- 종합 투자 스코어: ${score}/100

## 기술적 지표
${JSON.stringify(indicators, null, 2)}

## 최근 30일 가격
${JSON.stringify(priceSummary, null, 2)}
${newsText}

아래 형식으로 분석해주세요:

# 1. 거시경제 관점
- 해당 산업/섹터 현황
- 글로벌 경제(금리/환율/원자재)와의 연관성
- **유리한 요인** (불릿)
- **불리한 요인** (불릿)

# 2. 차트/기술적 분석
- 추세 판단 (상승/하락/횡보)
- 지지선/저항선 (구체적 가격)
- 이동평균선 배열 분석
- RSI/MACD/볼린저밴드/스토캐스틱 종합 해석
- 거래량 분석
- **매수 시나리오** (진입가, 목표가, 손절가)
- **매도 시나리오** (진입가, 목표가)

# 3. 종합 의견
| 구분 | 전략 |
|------|------|
| 단기 (1~2주) | ... |
| 중기 (1~3개월) | ... |
| 핵심 관전 포인트 | ... |
| 리스크 요인 | ... |

> 본 분석은 투자 권유가 아닌 참고 자료입니다.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    if (req.query.stream === '1') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      let clientDisconnected = false;
      req.on('close', () => { clientDisconnected = true; });
      res.write(`data: ${JSON.stringify({ type: 'indicators', indicators })}\n\n`);
      try {
        const streamResult = await model.generateContentStream(prompt);
        for await (const chunk of streamResult.stream) {
          if (clientDisconnected) break;
          const text = chunk.text();
          if (text) res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
        }
        if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (streamErr) {
        console.error('SSE stream error:', streamErr.message);
        if (!clientDisconnected) {
          const errMsg = streamErr.message.includes('quota') || streamErr.message.includes('429')
            ? 'Gemini API 할당량을 초과했습니다.' : 'AI 분석 중 오류가 발생했습니다.';
          res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
        }
      }
      res.end();
      return;
    }

    let timeoutId;
    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('AI_TIMEOUT')), 120000); })
      ]);
      clearTimeout(timeoutId);
      res.json({ success: true, analysis: result.response.text(), indicators });
    } catch (innerErr) {
      clearTimeout(timeoutId);
      throw innerErr;
    }
  } catch (err) {
    console.error('Analysis error:', err.message);
    const code = err.message;
    if (code === 'AI_TIMEOUT') res.status(504).json({ success: false, error: 'AI 분석 시간이 초과되었습니다 (2분).', code: 'AI_TIMEOUT' });
    else if (code.includes('quota') || code.includes('429')) res.status(429).json({ success: false, error: 'Gemini API 할당량 초과.', code: 'API_QUOTA' });
    else res.status(500).json({ success: false, error: 'AI 분석 오류: ' + err.message, code: 'AI_ERROR' });
  }
});

// ========================
//   기술적 지표 계산
// ========================
function r2(n) { return Math.round((n || 0) * 100) / 100; }

function calcMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  let sum = 0;
  for (let i = data.length - period; i < data.length; i++) sum += data[i];
  return sum / period;
}

function calcRSI(data, period = 14) {
  if (data.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) { const c = data[i] - data[i-1]; if (c > 0) avgGain += c; else avgLoss -= c; }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < data.length; i++) {
    const c = data[i] - data[i-1];
    avgGain = (avgGain * (period-1) + Math.max(c,0)) / period;
    avgLoss = (avgLoss * (period-1) + Math.max(-c,0)) / period;
  }
  return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(data) {
  if (data.length < 26) return { macd: 0, signal: 0 };
  const k12 = 2/13, k26 = 2/27, k9 = 2/10;
  let ema12 = data.slice(0,12).reduce((a,b) => a+b, 0) / 12;
  let ema26 = data.slice(0,26).reduce((a,b) => a+b, 0) / 26;
  for (let i = 12; i < 26; i++) ema12 = data[i]*k12 + ema12*(1-k12);
  let macdLine = ema12 - ema26, signal = macdLine, initCnt = 0, initSum = 0;
  for (let i = 26; i < data.length; i++) {
    ema12 = data[i]*k12 + ema12*(1-k12);
    ema26 = data[i]*k26 + ema26*(1-k26);
    macdLine = ema12 - ema26;
    if (initCnt < 9) { initSum += macdLine; initCnt++; if (initCnt === 9) signal = initSum / 9; }
    else signal = macdLine*k9 + signal*(1-k9);
  }
  return { macd: macdLine, signal };
}

function calcBollingerBands(data, period = 20) {
  if (data.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = data.slice(-period);
  const mean = slice.reduce((a,b) => a+b, 0) / period;
  const std = Math.sqrt(slice.reduce((s,v) => s + (v-mean)**2, 0) / period);
  return { upper: mean + 2*std, middle: mean, lower: mean - 2*std };
}

function calcStochastic(chartData, period = 14) {
  if (chartData.length < period) return { k: 50, d: 50 };
  const recent = chartData.slice(-period);
  const hh = Math.max(...recent.map(d => d.high));
  const ll = Math.min(...recent.map(d => d.low));
  const c = recent[recent.length-1].close;
  const k = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  const kValues = [];
  for (let i = Math.max(0, chartData.length - 3); i < chartData.length; i++) {
    const sl = chartData.slice(Math.max(0, i - period + 1), i + 1);
    const h = Math.max(...sl.map(d => d.high)), l = Math.min(...sl.map(d => d.low));
    kValues.push(h === l ? 50 : ((sl[sl.length-1].close - l) / (h - l)) * 100);
  }
  return { k, d: kValues.reduce((a,b) => a+b, 0) / kValues.length };
}

function calcSupportResistance(chartData) {
  if (chartData.length < 20) return { support: [], resistance: [] };
  const currentPrice = chartData[chartData.length-1].close;
  const recent = chartData.slice(-20);
  const high = Math.max(...recent.map(d => d.high));
  const low = Math.min(...recent.map(d => d.low));
  const close = recent[recent.length-1].close;
  const pivot = (high + low + close) / 3;
  const s1 = 2*pivot - high, s2 = pivot - (high - low);
  const r1 = 2*pivot - low, r2val = pivot + (high - low);
  return {
    support: [s1, s2].filter(v => v < currentPrice && v > 0).sort((a,b) => b-a).slice(0,2),
    resistance: [r1, r2val].filter(v => v > currentPrice).sort((a,b) => a-b).slice(0,2),
  };
}

// 종합 투자 스코어 (0~100)
function calcSignalScore({ rsi, macd, ma5, ma20, ma60, bb, latestClose, volRatio, stoch }) {
  let score = 50;
  // RSI (0-100 → -20 ~ +20)
  if (rsi < 30) score += 15; else if (rsi < 40) score += 8;
  else if (rsi > 70) score -= 15; else if (rsi > 60) score -= 5;
  // MACD
  if (macd.macd > macd.signal) score += 10; else score -= 10;
  // MA 배열
  if (ma5 > ma20 && ma20 > ma60) score += 15;
  else if (ma5 < ma20 && ma20 < ma60) score -= 15;
  // 볼린저 위치
  if (latestClose < bb.lower) score += 10;
  else if (latestClose > bb.upper) score -= 10;
  // 거래량
  if (volRatio > 1.5) score += 5;
  // 스토캐스틱
  if (stoch.k < 20) score += 5; else if (stoch.k > 80) score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// 글로벌 에러 핸들러 (URIError 등)
app.use((err, req, res, _next) => {
  if (err instanceof URIError) {
    return res.status(400).json({ success: false, error: '잘못된 URL 인코딩입니다.' });
  }
  console.error('Unhandled route error:', err.message);
  res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
});

const server = app.listen(PORT, () => {
  console.log(`주식 분석기 서버 실행 중: http://localhost:${PORT}`);
  console.log('데이터 소스: Yahoo Finance');
});
function gracefulShutdown() {
  clearInterval(rateCleanupTimer);
  clearInterval(cacheCleanupTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000); // 5초 후 강제 종료
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
