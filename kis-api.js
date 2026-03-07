require('dotenv').config();

const KIS_BASE = process.env.KIS_MOCK === 'true'
  ? 'https://openapivps.koreainvestment.com:29443'
  : 'https://openapi.koreainvestment.com:9443';

const APP_KEY = process.env.KIS_APP_KEY;
const APP_SECRET = process.env.KIS_APP_SECRET;

let accessToken = null;
let tokenExpiry = 0;

// --- 토큰 관리 ---
async function getToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('KIS 토큰 발급 실패: ' + (data.msg1 || JSON.stringify(data)));
  }

  accessToken = data.access_token;
  tokenExpiry = Date.now() + ((data.expires_in || 86400) - 300) * 1000;
  console.log('KIS 접근토큰 발급 완료');
  return accessToken;
}

// --- 공통 GET 요청 ---
async function kisGet(path, trId, params) {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();

  const res = await fetch(`${KIS_BASE}${path}?${qs}`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`,
      'appkey': APP_KEY,
      'appsecret': APP_SECRET,
      'tr_id': trId,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`KIS API HTTP ${res.status}`);

  const data = await res.json();
  if (data.rt_cd !== '0') {
    throw new Error(data.msg1 || `KIS API 오류 (rt_cd: ${data.rt_cd})`);
  }
  return data;
}

// --- 날짜 유틸 ---
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function subDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
}

function periodToDays(period) {
  return { '5d': 10, '1mo': 35, '3mo': 95, '6mo': 185, '1y': 370, '2y': 740 }[period] || 185;
}

function dateStrToISO(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00.000Z`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========================
//   국내주식
// ========================

async function getDomesticQuote(stockCode) {
  const data = await kisGet(
    '/uapi/domestic-stock/v1/quotations/inquire-price',
    'FHKST01010100',
    { fid_cond_mrkt_div_code: 'J', fid_input_iscd: stockCode }
  );

  const o = data.output;
  const sign = parseInt(o.prdy_vrss_sign) || 3;
  const mult = sign >= 4 ? -1 : 1;

  return {
    name: o.hts_kor_isnm || stockCode,
    price: parseFloat(o.stck_prpr) || 0,
    change: Math.abs(parseFloat(o.prdy_vrss) || 0) * mult,
    changePercent: Math.abs(parseFloat(o.prdy_ctrt) || 0) * mult,
    volume: parseInt(o.acml_vol) || 0,
    marketCap: (parseFloat(o.hts_avls) || 0) * 100000000,
    fiftyTwoWeekHigh: parseFloat(o.w52_hgpr) || null,
    fiftyTwoWeekLow: parseFloat(o.w52_lwpr) || null,
    previousClose: parseFloat(o.stck_sdpr) || null,
    dayHigh: parseFloat(o.stck_hgpr) || null,
    dayLow: parseFloat(o.stck_lwpr) || null,
    currency: 'KRW',
    exchange: 'KRX',
  };
}

async function getDomesticChart(stockCode, period) {
  const days = periodToDays(period);
  const endDate = fmtDate(new Date());
  const startDate = fmtDate(subDays(new Date(), days));

  const allRecords = [];
  let currentEnd = endDate;

  for (let i = 0; i < 8; i++) {
    const data = await kisGet(
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      'FHKST03010100',
      {
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
        fid_input_date_1: startDate,
        fid_input_date_2: currentEnd,
        fid_period_div_code: 'D',
        fid_org_adj_prc: '0',
      }
    );

    const records = data.output2 || [];
    if (records.length === 0) break;

    allRecords.push(...records);

    const oldest = records[records.length - 1].stck_bsop_date;
    if (oldest <= startDate || records.length < 100) break;

    currentEnd = fmtDate(subDays(
      new Date(oldest.slice(0, 4) + '-' + oldest.slice(4, 6) + '-' + oldest.slice(6, 8)),
      1
    ));

    await sleep(100); // Rate limit 보호
  }

  return allRecords
    .filter(d => d.stck_clpr && d.stck_clpr !== '0')
    .map(d => ({
      date: dateStrToISO(d.stck_bsop_date),
      open: parseFloat(d.stck_oprc),
      high: parseFloat(d.stck_hgpr),
      low: parseFloat(d.stck_lwpr),
      close: parseFloat(d.stck_clpr),
      volume: parseInt(d.acml_vol) || 0,
    }))
    .reverse();
}

// ========================
//   해외주식
// ========================

const EXCHANGE_NAMES = {
  NAS: 'NASDAQ', NYS: 'NYSE', AMS: 'AMEX',
  HKS: 'HKEX', TSE: 'TSE', SHS: 'SSE', SZS: 'SZSE',
  HSX: 'HOSE', HNX: 'HNX', BAY: 'SET',
};

async function getOverseasQuote(symbol, excd) {
  const exchanges = excd ? [excd] : ['NAS', 'NYS', 'AMS'];

  for (const ex of exchanges) {
    try {
      const data = await kisGet(
        '/uapi/overseas-price/v1/quotations/price',
        'HHDFS00000300',
        { AUTH: '', EXCD: ex, SYMB: symbol }
      );

      const o = data.output;
      if (!o || !o.last || o.last === '0' || o.last === '') continue;

      const sign = parseInt(o.sign) || 3;
      const mult = sign >= 4 ? -1 : 1;

      return {
        name: o.name || symbol,
        price: parseFloat(o.last) || 0,
        change: Math.abs(parseFloat(o.diff) || 0) * mult,
        changePercent: Math.abs(parseFloat(o.rate) || 0) * mult,
        volume: parseInt(o.tvol) || 0,
        marketCap: (parseFloat(o.tomv) || 0) * 1000000,
        fiftyTwoWeekHigh: parseFloat(o.h52p) || null,
        fiftyTwoWeekLow: parseFloat(o.l52p) || null,
        previousClose: parseFloat(o.base) || null,
        dayHigh: parseFloat(o.high) || null,
        dayLow: parseFloat(o.low) || null,
        currency: ['HKS'].includes(ex) ? 'HKD' : ['TSE'].includes(ex) ? 'JPY' : ['SHS', 'SZS'].includes(ex) ? 'CNY' : 'USD',
        exchange: EXCHANGE_NAMES[ex] || ex,
        _excd: ex,
      };
    } catch (e) {
      if (exchanges.indexOf(ex) === exchanges.length - 1) throw e;
    }
  }

  throw new Error('해당 종목을 찾을 수 없습니다.');
}

async function getOverseasChart(symbol, excd, period) {
  const days = periodToDays(period);
  const startDate = fmtDate(subDays(new Date(), days));
  const endDate = fmtDate(new Date());

  const allRecords = [];
  let bymd = endDate;

  for (let i = 0; i < 8; i++) {
    const data = await kisGet(
      '/uapi/overseas-price/v1/quotations/dailyprice',
      'HHDFS76240000',
      {
        AUTH: '',
        EXCD: excd,
        SYMB: symbol,
        GUBN: '0',
        BYMD: bymd,
        MODP: '0',
      }
    );

    const records = data.output2 || [];
    if (records.length === 0) break;

    allRecords.push(...records);

    const oldest = records[records.length - 1];
    const oldestDate = oldest.xymd;
    if (!oldestDate || oldestDate <= startDate || records.length < 100) break;

    bymd = fmtDate(subDays(
      new Date(oldestDate.slice(0, 4) + '-' + oldestDate.slice(4, 6) + '-' + oldestDate.slice(6, 8)),
      1
    ));

    await sleep(100);
  }

  return allRecords
    .filter(d => d.clos && d.clos !== '0')
    .map(d => ({
      date: dateStrToISO(d.xymd),
      open: parseFloat(d.open),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      close: parseFloat(d.clos),
      volume: parseInt(d.tvol) || 0,
    }))
    .reverse();
}

// --- 사용 가능 여부 ---
function isConfigured() {
  return !!(APP_KEY && APP_SECRET);
}

module.exports = {
  isConfigured,
  getDomesticQuote,
  getDomesticChart,
  getOverseasQuote,
  getOverseasChart,
};
