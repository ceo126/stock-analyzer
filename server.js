require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const kis = require('./kis-api');

const app = express();
const PORT = process.env.PORT || 8120;

app.use(cors({ origin: [`http://localhost:${process.env.PORT || 8120}`, 'http://127.0.0.1:' + (process.env.PORT || 8120)] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 간이 Rate Limiting (IP당 분당 30회)
const rateMap = new Map();
setInterval(() => rateMap.clear(), 60000);
app.use('/api', (req, res, next) => {
  const ip = req.ip;
  const count = (rateMap.get(ip) || 0) + 1;
  rateMap.set(ip, count);
  if (count > 30) return res.status(429).json({ success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  next();
});

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY가 .env에 설정되어 있지 않습니다.');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

if (!kis.isConfigured()) {
  console.warn('⚠ KIS_APP_KEY / KIS_APP_SECRET 미설정. KIS API를 사용하려면 .env에 설정해주세요.');
}

// 서버 안정성 - 예외 처리
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
});

// 한국 종목 이름 매핑
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
};

// 심볼 → 해외 거래소 매핑
const SUFFIX_TO_EXCD = { '.T': 'TSE', '.HK': 'HKS', '.SS': 'SHS', '.SZ': 'SZS' };

function isDomesticSymbol(symbol) {
  return /^\d{6}$/.test(symbol) || /^\d{6}\.(KS|KQ)$/.test(symbol);
}

function isValidSymbol(symbol) {
  return /^[A-Z0-9.\-]{1,15}$/.test(symbol);
}

// 한국 종목 목록 API
app.get('/api/kr-stocks', (req, res) => {
  const list = Object.entries(KR_STOCK_NAMES).map(([code, name]) => {
    const suffix = ['042700', '196170', '086520'].includes(code) ? '.KQ' : '.KS';
    return { symbol: code + suffix, name, exchange: suffix === '.KQ' ? 'KOSDAQ' : 'KOSPI' };
  });
  res.json({ stocks: list });
});

// 종목 검색 API (Yahoo 기반 - 검색 전용)
app.get('/api/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim().slice(0, 50);
    if (!query) return res.json({ results: [] });

    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
    const fetchRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await fetchRes.json();
    const results = (data.quotes || []).map(q => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchDisp || q.exchange,
      type: q.quoteType
    }));
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

// ========================
//   주식 데이터 조회 API (KIS)
// ========================
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    if (!kis.isConfigured()) {
      return res.status(500).json({ success: false, error: 'KIS API 키가 설정되지 않았습니다. .env 파일에 KIS_APP_KEY와 KIS_APP_SECRET을 설정해주세요.' });
    }

    let symbol = req.params.symbol.toUpperCase().trim();
    const validPeriods = ['5d', '1mo', '3mo', '6mo', '1y', '2y'];
    const period = validPeriods.includes(req.query.period) ? req.query.period : '6mo';

    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ success: false, error: '유효하지 않은 종목코드 형식입니다.' });
    }

    let quote, chartData;

    if (isDomesticSymbol(symbol)) {
      // 국내주식
      const stockCode = symbol.replace(/\.(KS|KQ)$/, '');
      quote = await kis.getDomesticQuote(stockCode);
      chartData = await kis.getDomesticChart(stockCode, period);
      symbol = stockCode;
    } else {
      // 해외주식 - 거래소 코드 추출
      let excd = null;
      for (const [suffix, exchange] of Object.entries(SUFFIX_TO_EXCD)) {
        if (symbol.endsWith(suffix)) {
          excd = exchange;
          symbol = symbol.replace(suffix, '');
          break;
        }
      }

      quote = await kis.getOverseasQuote(symbol, excd);
      chartData = await kis.getOverseasChart(symbol, quote._excd, period);
    }

    if (chartData.length === 0) {
      throw new Error('차트 데이터가 없습니다.');
    }

    res.json({ success: true, symbol, quote, chartData });
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
    const ma5 = calcMA(closes, 5);
    const ma20 = calcMA(closes, 20);
    const ma60 = calcMA(closes, 60);
    const ma120 = calcMA(closes, 120);
    const rsi = calcRSI(closes, 14);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes, 20);
    const stoch = calcStochastic(chartData, 14);
    const avgVol20 = calcMA(volumes, 20);
    const currentVol = volumes[volumes.length - 1];
    const volRatio = avgVol20 > 0 ? currentVol / avgVol20 : 1;
    const latestClose = closes[closes.length - 1];

    const indicators = {
      MA5: r2(ma5), MA20: r2(ma20), MA60: r2(ma60), MA120: r2(ma120),
      RSI: r2(rsi),
      MACD: r2(macd.macd), MACD_Signal: r2(macd.signal), MACD_Histogram: r2(macd.macd - macd.signal),
      BB_Upper: r2(bb.upper), BB_Middle: r2(bb.middle), BB_Lower: r2(bb.lower),
      BB_Width: bb.middle !== 0 ? r2(((bb.upper - bb.lower) / bb.middle) * 100) : 0,
      Stochastic_K: r2(stoch.k), Stochastic_D: r2(stoch.d),
      현재가: r2(latestClose), 거래량비율: r2(volRatio)
    };

    const priceSummary = chartData.slice(-30).map(d => ({
      date: new Date(d.date).toLocaleDateString('ko-KR'),
      close: Math.round(d.close),
      volume: d.volume
    }));

    const prompt = `당신은 20년 경력의 주식 애널리스트입니다. 아래 종목 데이터를 기반으로 분석 리포트를 작성해주세요.

## 종목: ${quote.name} (${symbol})
- 현재가: ${quote.price} ${quote.currency || ''}
- 전일대비: ${quote.change > 0 ? '+' : ''}${r2(quote.change)} (${quote.changePercent > 0 ? '+' : ''}${r2(quote.changePercent)}%)
- 52주 고/저: ${quote.fiftyTwoWeekHigh} / ${quote.fiftyTwoWeekLow}
- 거래소: ${quote.exchange}

## 기술적 지표
${JSON.stringify(indicators, null, 2)}

## 최근 30일 가격
${JSON.stringify(priceSummary, null, 2)}

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
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI 분석 시간이 초과되었습니다. 다시 시도해주세요.')), 120000))
    ]);
    const text = result.response.text();

    res.json({ success: true, analysis: text, indicators });
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ success: false, error: 'AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// --- 기술적 지표 계산 ---
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
  for (let i = 1; i <= period; i++) {
    const c = data[i] - data[i - 1];
    if (c > 0) avgGain += c; else avgLoss -= c;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < data.length; i++) {
    const c = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(c, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-c, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(data) {
  if (data.length < 26) return { macd: 0, signal: 0 };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let ema12 = data.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = data.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 12; i < 26; i++) ema12 = data[i] * k12 + ema12 * (1 - k12);
  let macdLine = ema12 - ema26, signal = macdLine;
  let initCnt = 0, initSum = 0;
  for (let i = 26; i < data.length; i++) {
    ema12 = data[i] * k12 + ema12 * (1 - k12);
    ema26 = data[i] * k26 + ema26 * (1 - k26);
    macdLine = ema12 - ema26;
    if (initCnt < 9) { initSum += macdLine; initCnt++; if (initCnt === 9) signal = initSum / 9; }
    else signal = macdLine * k9 + signal * (1 - k9);
  }
  return { macd: macdLine, signal };
}

function calcBollingerBands(data, period = 20) {
  if (data.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

function calcStochastic(chartData, period = 14) {
  if (chartData.length < period) return { k: 50, d: 50 };
  const recent = chartData.slice(-period);
  const hh = Math.max(...recent.map(d => d.high));
  const ll = Math.min(...recent.map(d => d.low));
  const c = recent[recent.length - 1].close;
  const k = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  const kValues = [];
  for (let i = Math.max(0, chartData.length - 3); i < chartData.length; i++) {
    const sl = chartData.slice(Math.max(0, i - period + 1), i + 1);
    const h = Math.max(...sl.map(d => d.high));
    const l = Math.min(...sl.map(d => d.low));
    kValues.push(h === l ? 50 : ((sl[sl.length - 1].close - l) / (h - l)) * 100);
  }
  return { k, d: kValues.reduce((a, b) => a + b, 0) / kValues.length };
}

const server = app.listen(PORT, () => {
  console.log(`주식 분석기 서버 실행 중: http://localhost:${PORT}`);
  console.log(`데이터 소스: ${kis.isConfigured() ? 'KIS (한국투자증권)' : '⚠ KIS 미설정'}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
