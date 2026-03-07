let currentSymbol = '';
let currentChartData = [];
let currentQuote = null;
let priceChart = null;
let volumeChart = null;
let resizeObserverRef = null;
let analyzeController = null; // AbortController for canceling requests

// 엔터 키 처리
const symbolInput = document.getElementById('symbolInput');
symbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    hideDropdown();
    analyzeStock();
  }
});

// 자동완성 검색
let searchTimeout = null;
symbolInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = symbolInput.value.trim();
  if (q.length < 1) { hideDropdown(); return; }

  // 로컬 한국 종목 즉시 검색
  const localResults = searchLocalStocks(q);
  if (localResults.length > 0) showDropdown(localResults);

  // 1글자 이상이면 Yahoo API 검색 (로컬 결과와 병합)
  searchTimeout = setTimeout(() => searchSymbols(q, localResults), 200);
});

async function searchSymbols(query, localResults = []) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    // 로컬 + Yahoo 결과 병합 (중복 제거)
    const localSymbols = new Set(localResults.map(r => r.symbol));
    const yahooResults = (data.results || []).filter(r => !localSymbols.has(r.symbol));
    const merged = [...localResults, ...yahooResults].slice(0, 10);
    if (merged.length > 0) showDropdown(merged);
    else hideDropdown();
  } catch {
    if (localResults.length > 0) showDropdown(localResults);
    else hideDropdown();
  }
}

// 한국 주요 종목 로컬 데이터
const KR_STOCKS = [
  { symbol: '005930.KS', name: '삼성전자', exchange: 'KOSPI' },
  { symbol: '005935.KS', name: '삼성전자우', exchange: 'KOSPI' },
  { symbol: '000660.KS', name: 'SK하이닉스', exchange: 'KOSPI' },
  { symbol: '005380.KS', name: '현대차', exchange: 'KOSPI' },
  { symbol: '005490.KS', name: 'POSCO홀딩스', exchange: 'KOSPI' },
  { symbol: '035420.KS', name: 'NAVER', exchange: 'KOSPI' },
  { symbol: '035720.KS', name: '카카오', exchange: 'KOSPI' },
  { symbol: '051910.KS', name: 'LG화학', exchange: 'KOSPI' },
  { symbol: '006400.KS', name: '삼성SDI', exchange: 'KOSPI' },
  { symbol: '003670.KS', name: '포스코퓨처엠', exchange: 'KOSPI' },
  { symbol: '105560.KS', name: 'KB금융', exchange: 'KOSPI' },
  { symbol: '055550.KS', name: '신한지주', exchange: 'KOSPI' },
  { symbol: '086790.KS', name: '하나금융지주', exchange: 'KOSPI' },
  { symbol: '066570.KS', name: 'LG전자', exchange: 'KOSPI' },
  { symbol: '003550.KS', name: 'LG', exchange: 'KOSPI' },
  { symbol: '034730.KS', name: 'SK', exchange: 'KOSPI' },
  { symbol: '000270.KS', name: '기아', exchange: 'KOSPI' },
  { symbol: '012330.KS', name: '현대모비스', exchange: 'KOSPI' },
  { symbol: '028260.KS', name: '삼성물산', exchange: 'KOSPI' },
  { symbol: '207940.KS', name: '삼성바이오로직스', exchange: 'KOSPI' },
  { symbol: '068270.KS', name: '셀트리온', exchange: 'KOSPI' },
  { symbol: '009150.KS', name: '삼성전기', exchange: 'KOSPI' },
  { symbol: '018260.KS', name: '삼성에스디에스', exchange: 'KOSPI' },
  { symbol: '010130.KS', name: '고려아연', exchange: 'KOSPI' },
  { symbol: '032830.KS', name: '삼성생명', exchange: 'KOSPI' },
  { symbol: '096770.KS', name: 'SK이노베이션', exchange: 'KOSPI' },
  { symbol: '030200.KS', name: 'KT', exchange: 'KOSPI' },
  { symbol: '017670.KS', name: 'SK텔레콤', exchange: 'KOSPI' },
  { symbol: '316140.KS', name: '우리금융지주', exchange: 'KOSPI' },
  { symbol: '323410.KS', name: '카카오뱅크', exchange: 'KOSPI' },
  { symbol: '259960.KS', name: '크래프톤', exchange: 'KOSPI' },
  { symbol: '003490.KS', name: '대한항공', exchange: 'KOSPI' },
  { symbol: '033780.KS', name: 'KT&G', exchange: 'KOSPI' },
  { symbol: '011200.KS', name: 'HMM', exchange: 'KOSPI' },
  { symbol: '015760.KS', name: '한국전력', exchange: 'KOSPI' },
  { symbol: '034020.KS', name: '두산에너빌리티', exchange: 'KOSPI' },
  { symbol: '010950.KS', name: 'S-Oil', exchange: 'KOSPI' },
  { symbol: '373220.KS', name: 'LG에너지솔루션', exchange: 'KOSPI' },
  { symbol: '352820.KS', name: '하이브', exchange: 'KOSPI' },
  { symbol: '247540.KS', name: '에코프로비엠', exchange: 'KOSPI' },
  { symbol: '086520.KQ', name: '에코프로', exchange: 'KOSDAQ' },
  { symbol: '263750.KS', name: '펄어비스', exchange: 'KOSPI' },
  { symbol: '042700.KQ', name: '한미반도체', exchange: 'KOSDAQ' },
  { symbol: '196170.KQ', name: '알테오젠', exchange: 'KOSDAQ' },
  { symbol: '377300.KS', name: '카카오페이', exchange: 'KOSPI' },
  { symbol: '036570.KS', name: '엔씨소프트', exchange: 'KOSPI' },
  { symbol: '251270.KS', name: '넷마블', exchange: 'KOSPI' },
  { symbol: '047050.KS', name: '포스코인터내셔널', exchange: 'KOSPI' },
  { symbol: '000810.KS', name: '삼성화재', exchange: 'KOSPI' },
  { symbol: '024110.KS', name: '기업은행', exchange: 'KOSPI' },
];

function searchLocalStocks(query) {
  const q = query.toLowerCase();
  return KR_STOCKS.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.symbol.toLowerCase().startsWith(q)
  ).slice(0, 8);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showDropdown(results) {
  let dropdown = document.getElementById('searchDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    dropdown.className = 'search-dropdown';
    symbolInput.parentElement.appendChild(dropdown);
  }
  dropdown.innerHTML = results.map(r => {
    const displaySymbol = r.symbol.replace(/\.(KS|KQ)$/, '');
    return `
    <div class="dropdown-item" data-symbol="${escapeHtml(r.symbol)}">
      <span class="dropdown-symbol">${escapeHtml(displaySymbol)}</span>
      <span class="dropdown-name">${escapeHtml(r.name)}</span>
      <span class="dropdown-exchange">${escapeHtml(r.exchange || '')}</span>
    </div>`;
  }).join('');
  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      symbolInput.value = item.dataset.symbol;
      hideDropdown();
      analyzeStock();
    });
  });
  dropdown.classList.add('show');
}

function hideDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) hideDropdown();
});

// 기간 버튼 이벤트
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentSymbol) {
      showChartLoading(true);
      fetchStockData(currentSymbol, btn.dataset.period)
        .catch(err => showError(err.message))
        .finally(() => showChartLoading(false));
    }
  });
});

function setSymbol(sym) {
  document.getElementById('symbolInput').value = sym;
  analyzeStock();
}

async function analyzeStock() {
  const input = document.getElementById('symbolInput').value.trim();
  if (!input) return;

  // 이전 분석 요청 취소
  if (analyzeController) analyzeController.abort();
  analyzeController = new AbortController();
  const signal = analyzeController.signal;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;

  show('loading');
  hide('error');
  hide('result');
  setText('loadingText', '주가 데이터를 불러오는 중...');

  try {
    const period = document.querySelector('.period-btn.active')?.dataset.period || '6mo';
    await fetchStockData(input, period);

    if (signal.aborted) return;

    setText('loadingText', 'AI가 종목을 분석하고 있습니다...');
    await fetchAnalysis(signal);

    show('result');
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError(err.message);
  } finally {
    hide('loading');
    btn.disabled = false;
  }
}

async function fetchStockData(symbol, period = '6mo') {
  const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}?period=${period}`);
  const data = await res.json();

  if (!data.success) throw new Error(data.error || '데이터를 가져올 수 없습니다');

  currentSymbol = data.symbol;
  currentQuote = data.quote;
  currentChartData = data.chartData;

  renderSummary(data.quote, data.symbol);
  renderChart(data.chartData);
  show('result');
}

async function fetchAnalysis(signal) {
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: currentSymbol,
      quote: currentQuote,
      chartData: currentChartData
    })
  };
  if (signal) fetchOptions.signal = signal;

  const res = await fetch('/api/analyze', fetchOptions);
  const data = await res.json();

  if (!data.success) throw new Error(data.error || '분석에 실패했습니다');

  renderIndicators(data.indicators);
  renderAnalysis(data.analysis);
}

// 재분석
async function reAnalyze() {
  const btn = document.getElementById('reAnalyzeBtn');
  btn.disabled = true;
  btn.textContent = '분석 중...';
  try {
    await fetchAnalysis();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '재분석';
  }
}

function renderSummary(quote, symbol) {
  const changeClass = quote.change >= 0 ? 'up' : 'down';
  const changeSign = quote.change >= 0 ? '+' : '';

  // 52주 대비 위치 (%)
  const range52 = quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow;
  const position52 = range52 > 0 ? ((quote.price - quote.fiftyTwoWeekLow) / range52) * 100 : 50;

  document.getElementById('stockSummary').innerHTML = `
    <div class="stock-name-block">
      <div class="stock-name">${escapeHtml(quote.name)}</div>
      <div class="stock-symbol">${escapeHtml(symbol)} · ${escapeHtml(quote.exchange)}</div>
    </div>
    <div class="stock-price-block">
      <div class="stock-price">${formatNumber(quote.price)} ${quote.currency || ''}</div>
      <div class="stock-change ${changeClass}">
        ${changeSign}${formatNumber(quote.change)} (${changeSign}${quote.changePercent?.toFixed(2)}%)
      </div>
    </div>
    <div class="stock-meta">
      ${quote.marketCap ? `<div class="meta-item">
        <span class="meta-label">시가총액</span>
        <span class="meta-value">${formatMarketCap(quote.marketCap, quote.currency)}</span>
      </div>` : ''}
      <div class="meta-item">
        <span class="meta-label">전일종가</span>
        <span class="meta-value">${formatNumber(quote.previousClose)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">거래량</span>
        <span class="meta-value">${formatVolume(quote.volume)}</span>
      </div>
      <div class="meta-item meta-item-wide">
        <span class="meta-label">52주 범위</span>
        <div class="range-52w">
          <span class="range-low">${formatNumber(quote.fiftyTwoWeekLow)}</span>
          <div class="range-bar">
            <div class="range-fill" style="width: ${Math.min(100, Math.max(0, position52))}%"></div>
            <div class="range-marker" style="left: ${Math.min(100, Math.max(0, position52))}%"></div>
          </div>
          <span class="range-high">${formatNumber(quote.fiftyTwoWeekHigh)}</span>
        </div>
      </div>
    </div>
  `;
}

function cleanupCharts() {
  if (resizeObserverRef) {
    resizeObserverRef.disconnect();
    resizeObserverRef = null;
  }
  if (priceChart) {
    priceChart.remove();
    priceChart = null;
  }
  if (volumeChart) {
    volumeChart.remove();
    volumeChart = null;
  }
}

function renderChart(chartData) {
  cleanupCharts();

  const priceContainer = document.getElementById('priceChart');
  const volumeContainer = document.getElementById('volumeChart');

  // 가격 차트
  priceChart = LightweightCharts.createChart(priceContainer, {
    width: priceContainer.clientWidth,
    height: 400,
    layout: {
      background: { color: 'transparent' },
      textColor: '#6b7280',
    },
    grid: {
      vertLines: { color: '#1e2545' },
      horzLines: { color: '#1e2545' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a3045' },
    timeScale: {
      borderColor: '#2a3045',
      timeVisible: true,
    },
  });

  // 볼린저밴드 (배경 영역)
  const bbData = calcBBArray(chartData, 20);
  if (bbData.length > 0) {
    const bbUpperSeries = priceChart.addLineSeries({
      color: 'rgba(123,97,255,0.3)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Upper',
      crosshairMarkerVisible: false,
    });
    const bbLowerSeries = priceChart.addLineSeries({
      color: 'rgba(123,97,255,0.3)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Lower',
      crosshairMarkerVisible: false,
    });
    bbUpperSeries.setData(bbData.map(d => ({ time: d.time, value: d.upper })));
    bbLowerSeries.setData(bbData.map(d => ({ time: d.time, value: d.lower })));
  }

  // 캔들스틱
  const candleSeries = priceChart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    wickUpColor: '#22c55e',
  });

  candleSeries.setData(chartData.map(d => ({
    time: toChartTime(d.date),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  })));

  // 이동평균선
  const maConfigs = [
    { period: 5, color: '#eab308', title: 'MA5' },
    { period: 20, color: '#3b82f6', title: 'MA20' },
    { period: 60, color: '#a855f7', title: 'MA60' },
    { period: 120, color: '#ef4444', title: 'MA120' },
  ];

  maConfigs.forEach(({ period, color, title }) => {
    if (chartData.length >= period) {
      const series = priceChart.addLineSeries({ color, lineWidth: 1, title });
      series.setData(calcMAArray(chartData, period));
    }
  });

  priceChart.timeScale().fitContent();

  // 거래량 차트
  volumeChart = LightweightCharts.createChart(volumeContainer, {
    width: volumeContainer.clientWidth,
    height: 100,
    layout: {
      background: { color: 'transparent' },
      textColor: '#6b7280',
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: '#1e2545' },
    },
    rightPriceScale: { borderColor: '#2a3045' },
    timeScale: { visible: false },
  });

  const volumeSeries = volumeChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
  });

  volumeSeries.setData(chartData.map(d => ({
    time: toChartTime(d.date),
    value: d.volume,
    color: d.close >= d.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
  })));

  volumeChart.timeScale().fitContent();

  // 차트 동기화
  priceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (range) volumeChart.timeScale().setVisibleLogicalRange(range);
  });

  // 리사이즈
  resizeObserverRef = new ResizeObserver(() => {
    if (priceChart) priceChart.applyOptions({ width: priceContainer.clientWidth });
    if (volumeChart) volumeChart.applyOptions({ width: volumeContainer.clientWidth });
  });
  resizeObserverRef.observe(priceContainer);
}

function renderIndicators(indicators) {
  const grid = document.getElementById('indicatorsGrid');

  const items = [
    {
      label: 'RSI (14)',
      value: indicators.RSI,
      cls: indicators.RSI > 70 ? 'bearish' : indicators.RSI < 30 ? 'bullish' : 'neutral',
      desc: indicators.RSI > 70 ? '과매수 구간' : indicators.RSI < 30 ? '과매도 구간' : '중립 구간'
    },
    {
      label: 'MACD',
      value: indicators.MACD,
      cls: indicators.MACD_Histogram > 0 ? 'bullish' : 'bearish',
      desc: `시그널: ${indicators.MACD_Signal} / 히스토그램: ${indicators.MACD_Histogram > 0 ? '+' : ''}${indicators.MACD_Histogram}`
    },
    {
      label: '스토캐스틱',
      value: `${indicators.Stochastic_K} / ${indicators.Stochastic_D}`,
      cls: indicators.Stochastic_K > 80 ? 'bearish' : indicators.Stochastic_K < 20 ? 'bullish' : 'neutral',
      desc: indicators.Stochastic_K > 80 ? '과매수 구간' : indicators.Stochastic_K < 20 ? '과매도 구간' : '중립 구간'
    },
    {
      label: '5일 이평선',
      value: formatNumber(indicators.MA5),
      cls: indicators.현재가 > indicators.MA5 ? 'bullish' : 'bearish',
      desc: indicators.현재가 > indicators.MA5 ? '단기 상승 추세' : '단기 하락 추세'
    },
    {
      label: '20일 이평선',
      value: formatNumber(indicators.MA20),
      cls: indicators.현재가 > indicators.MA20 ? 'bullish' : 'bearish',
      desc: indicators.현재가 > indicators.MA20 ? '중기 상승 추세' : '중기 하락 추세'
    },
    {
      label: '볼린저밴드',
      value: `폭 ${indicators.BB_Width}%`,
      cls: indicators.현재가 > indicators.BB_Upper ? 'bearish' :
           indicators.현재가 < indicators.BB_Lower ? 'bullish' : 'neutral',
      desc: indicators.현재가 > indicators.BB_Upper ? '상단 돌파 (과열)' :
            indicators.현재가 < indicators.BB_Lower ? '하단 이탈 (반등 기대)' :
            `${formatNumber(indicators.BB_Lower)} ~ ${formatNumber(indicators.BB_Upper)}`
    },
    {
      label: '거래량',
      value: `${indicators.거래량비율}x`,
      cls: indicators.거래량비율 > 2 ? 'bullish' : indicators.거래량비율 < 0.5 ? 'bearish' : 'neutral',
      desc: indicators.거래량비율 > 2 ? '평균 대비 급증' :
            indicators.거래량비율 < 0.5 ? '평균 대비 부진' : '20일 평균 대비'
    },
    {
      label: '이평선 배열',
      value: getMAAlignment(indicators),
      cls: getMAAlignmentClass(indicators),
      desc: getMAAlignmentDesc(indicators)
    }
  ];

  grid.innerHTML = items.map(item => `
    <div class="indicator-card">
      <div class="indicator-label">${item.label}</div>
      <div class="indicator-value ${item.cls}">${item.value}</div>
      <div class="indicator-desc">${item.desc}</div>
    </div>
  `).join('');
}

function getMAAlignment(ind) {
  if (ind.MA5 > ind.MA20 && ind.MA20 > ind.MA60) return '정배열';
  if (ind.MA5 < ind.MA20 && ind.MA20 < ind.MA60) return '역배열';
  return '혼조';
}

function getMAAlignmentClass(ind) {
  if (ind.MA5 > ind.MA20 && ind.MA20 > ind.MA60) return 'bullish';
  if (ind.MA5 < ind.MA20 && ind.MA20 < ind.MA60) return 'bearish';
  return 'neutral';
}

function getMAAlignmentDesc(ind) {
  if (ind.MA5 > ind.MA20 && ind.MA20 > ind.MA60) return '강한 상승 추세';
  if (ind.MA5 < ind.MA20 && ind.MA20 < ind.MA60) return '강한 하락 추세';
  return '추세 전환 가능성';
}

function renderAnalysis(markdown) {
  const parsed = marked.parse(markdown, { breaks: true });
  // 스크립트 태그 제거 (AI 응답 XSS 방지)
  const sanitized = parsed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '');

  const now = new Date();
  const timeStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  document.getElementById('analysisContent').innerHTML =
    `<div class="analysis-time">분석 시점: ${timeStr}</div>` + sanitized;
  document.getElementById('analysisSection').classList.remove('hidden');
}

// --- 유틸리티 ---

function toChartTime(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function calcMAArray(data, period) {
  const result = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) {
      result.push({ time: toChartTime(data[i].date), value: sum / period });
    }
  }
  return result;
}

function calcBBArray(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(d => d.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period);
    result.push({
      time: toChartTime(data[i].date),
      upper: mean + 2 * std,
      lower: mean - 2 * std
    });
  }
  return result;
}

function formatNumber(num) {
  if (num == null || isNaN(num)) return 'N/A';
  return Number(num).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatMarketCap(cap, currency) {
  if (!cap) return 'N/A';
  if (currency === 'KRW') {
    if (cap >= 1e12) return (cap / 1e12).toFixed(1) + '조';
    if (cap >= 1e8) return (cap / 1e8).toFixed(0) + '억';
    return cap.toLocaleString() + '원';
  }
  if (cap >= 1e12) return (cap / 1e12).toFixed(2) + 'T';
  if (cap >= 1e9) return (cap / 1e9).toFixed(1) + 'B';
  if (cap >= 1e6) return (cap / 1e6).toFixed(1) + 'M';
  return cap.toLocaleString();
}

function formatVolume(vol) {
  if (!vol) return 'N/A';
  if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(0) + 'K';
  return vol.toLocaleString();
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function setText(id, text) { document.getElementById(id).textContent = text; }

function showChartLoading(on) {
  const container = document.querySelector('.chart-container');
  if (!container) return;
  if (on) container.classList.add('chart-loading');
  else container.classList.remove('chart-loading');
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
