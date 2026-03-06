require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 8120;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Yahoo Finance v8 chart API로 quote + 차트 데이터 통합 조회
async function fetchYahooData(symbol, range = '6mo') {
  const intervalMap = { '5d': '15m', '1mo': '1h' };
  const interval = intervalMap[range] || '1d';

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const data = await res.json();
  const chart = data?.chart?.result?.[0];
  if (!chart) throw new Error('종목을 찾을 수 없습니다');

  const meta = chart.meta;
  const timestamps = chart.timestamp || [];
  const ohlcv = chart.indicators?.quote?.[0] || {};

  const chartData = timestamps.map((t, i) => ({
    date: new Date(t * 1000).toISOString(),
    open: ohlcv.open?.[i],
    high: ohlcv.high?.[i],
    low: ohlcv.low?.[i],
    close: ohlcv.close?.[i],
    volume: ohlcv.volume?.[i]
  })).filter(d => d.close != null);

  // 전일 대비 계산 - 일봉 기준으로 정확한 전일 종가 사용
  const currentPrice = meta.regularMarketPrice;
  let prevClose;
  if (interval === '1d' && chartData.length >= 2) {
    prevClose = chartData[chartData.length - 2].close;
  } else {
    // 분봉/시간봉일 때는 meta.chartPreviousClose 대신 일봉 별도 조회
    prevClose = meta.previousClose || meta.chartPreviousClose;
  }
  const change = prevClose ? currentPrice - prevClose : 0;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;

  return {
    symbol,
    quote: {
      name: meta.shortName || meta.longName || symbol,
      price: currentPrice,
      change,
      changePercent,
      volume: meta.regularMarketVolume,
      marketCap: meta.marketCap || null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      fiftyDayAverage: meta.fiftyDayAverage,
      twoHundredDayAverage: meta.twoHundredDayAverage,
      previousClose: prevClose,
      currency: meta.currency,
      exchange: meta.fullExchangeName || meta.exchangeName
    },
    chartData
  };
}

// 주식 데이터 조회 API
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    let symbol = req.params.symbol.toUpperCase();
    const period = req.query.period || '6mo';

    if (/^\d{6}$/.test(symbol)) {
      symbol = symbol + '.KS';
    }

    let result;
    try {
      result = await fetchYahooData(symbol, period);
    } catch (e) {
      if (symbol.endsWith('.KS')) {
        symbol = symbol.replace('.KS', '.KQ');
        result = await fetchYahooData(symbol, period);
      } else {
        throw e;
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Stock fetch error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 종목 검색 API
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json({ results: [] });

    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const data = await response.json();

    const results = (data.quotes || []).map(q => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchDisp || q.exchange,
      type: q.quoteType
    }));

    res.json({ results });
  } catch (err) {
    res.json({ results: [] });
  }
});

// AI 분석 API
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, quote, chartData } = req.body;

    const priceList = chartData.slice(-60).map(d => ({
      date: new Date(d.date).toLocaleDateString('ko-KR'),
      close: Math.round(d.close),
      volume: d.volume
    }));

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

    // 거래량 분석
    const avgVol20 = calcMA(volumes, 20);
    const currentVol = volumes[volumes.length - 1];
    const volRatio = avgVol20 > 0 ? currentVol / avgVol20 : 1;

    const latestClose = closes[closes.length - 1];
    const indicators = {
      MA5: round2(ma5),
      MA20: round2(ma20),
      MA60: round2(ma60),
      MA120: round2(ma120),
      RSI: round2(rsi),
      MACD: round2(macd.macd),
      MACD_Signal: round2(macd.signal),
      MACD_Histogram: round2(macd.macd - macd.signal),
      BB_Upper: round2(bb.upper),
      BB_Middle: round2(bb.middle),
      BB_Lower: round2(bb.lower),
      BB_Width: round2(((bb.upper - bb.lower) / bb.middle) * 100),
      Stochastic_K: round2(stoch.k),
      Stochastic_D: round2(stoch.d),
      현재가: round2(latestClose),
      거래량비율: round2(volRatio)
    };

    const prompt = `당신은 20년 경력의 주식 애널리스트입니다. 아래 종목 데이터를 분석해주세요.

## 종목 정보
- 종목: ${quote.name} (${symbol})
- 현재가: ${quote.price} ${quote.currency || ''}
- 전일대비: ${quote.change > 0 ? '+' : ''}${round2(quote.change)} (${quote.changePercent > 0 ? '+' : ''}${round2(quote.changePercent)}%)
- 52주 최고/최저: ${quote.fiftyTwoWeekHigh} / ${quote.fiftyTwoWeekLow}
- 거래소: ${quote.exchange}

## 기술적 지표
${JSON.stringify(indicators, null, 2)}

## 최근 가격 데이터 (최근 30일)
${JSON.stringify(priceList.slice(-30), null, 2)}

아래 관점에서 분석해주세요. 마크다운 형식으로 작성하되, 실전 투자에 도움이 되는 구체적인 분석을 해주세요.

---

# 1. 거시경제 관점 분석

해당 종목이 속한 산업/섹터의 현재 상황, 글로벌 경제 흐름(금리, 환율, 원자재 등)과의 연관성, 정부 정책/규제 영향, 실적 전망 등을 분석해주세요.

핵심 포인트를 불릿으로 정리하고, 해당 종목에 유리한 요인과 불리한 요인을 구분해주세요.

# 2. 차트/기술적 분석

현재 추세(상승/하락/횡보), 지지선과 저항선, 이동평균선 배열(정배열/역배열), RSI/MACD/볼린저밴드/스토캐스틱 해석, 거래량 분석을 포함해주세요.

구체적인 가격대를 언급하면서 매수/매도 관점의 시나리오를 제시해주세요.

# 3. 종합 의견

위 분석을 종합하여 단기(1~2주), 중기(1~3개월) 관점의 투자 전략을 제시해주세요.
핵심 관전 포인트와 리스크 요인도 함께 정리해주세요.

---

주의: 투자 권유가 아닌 분석 참고 자료임을 마지막에 명시해주세요.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    res.json({ success: true, analysis: text, indicators });
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 기술적 지표 계산 함수들 ---

function round2(n) {
  return Math.round(n * 100) / 100;
}

function calcMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(data, period = 14) {
  if (data.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  // 초기 평균
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  // Wilder's smoothing
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(data) {
  if (data.length < 26) return { macd: 0, signal: 0 };
  // EMA 12, 26을 점진적으로 계산 (O(n))
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let ema12 = data.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = data.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  // 12~25 구간: ema12만 갱신
  for (let i = 12; i < 26; i++) {
    ema12 = data[i] * k12 + ema12 * (1 - k12);
  }
  let macdLine = ema12 - ema26;
  let signal = macdLine;
  // 26 이후: 양쪽 갱신 + signal EMA 9
  let signalInitCount = 0;
  let signalSum = 0;
  for (let i = 26; i < data.length; i++) {
    ema12 = data[i] * k12 + ema12 * (1 - k12);
    ema26 = data[i] * k26 + ema26 * (1 - k26);
    macdLine = ema12 - ema26;
    if (signalInitCount < 9) {
      signalSum += macdLine;
      signalInitCount++;
      if (signalInitCount === 9) signal = signalSum / 9;
    } else {
      signal = macdLine * k9 + signal * (1 - k9);
    }
  }
  return { macd: macdLine, signal };
}

function calcBollingerBands(data, period = 20) {
  if (data.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

function calcStochastic(chartData, period = 14) {
  if (chartData.length < period) return { k: 50, d: 50 };
  const recent = chartData.slice(-period);
  const highs = recent.map(d => d.high);
  const lows = recent.map(d => d.low);
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const currentClose = recent[recent.length - 1].close;
  const k = highestHigh === lowestLow ? 50 : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  // %D = 3일 SMA of %K (간소화: 최근 3개 계산)
  const kValues = [];
  for (let i = Math.max(0, chartData.length - 3); i < chartData.length; i++) {
    const slice = chartData.slice(Math.max(0, i - period + 1), i + 1);
    const h = Math.max(...slice.map(d => d.high));
    const l = Math.min(...slice.map(d => d.low));
    const c = slice[slice.length - 1].close;
    kValues.push(h === l ? 50 : ((c - l) / (h - l)) * 100);
  }
  const d = kValues.reduce((a, b) => a + b, 0) / kValues.length;
  return { k, d };
}

app.listen(PORT, () => {
  console.log(`주식 분석기 서버 실행 중: http://localhost:${PORT}`);
});
