let currentSymbol = '';
let currentChartData = [];
let currentQuote = null;
let priceChart = null;
let volumeChart = null;
let resizeObserverRef = null;

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
  if (q.length < 2) { hideDropdown(); return; }
  searchTimeout = setTimeout(() => searchSymbols(q), 300);
});

async function searchSymbols(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.results.length > 0) showDropdown(data.results);
    else hideDropdown();
  } catch { hideDropdown(); }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showDropdown(results) {
  let dropdown = document.getElementById('searchDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    dropdown.className = 'search-dropdown';
    symbolInput.parentElement.appendChild(dropdown);
  }
  dropdown.innerHTML = results.map(r => `
    <div class="dropdown-item" data-symbol="${escapeHtml(r.symbol)}">
      <span class="dropdown-symbol">${escapeHtml(r.symbol)}</span>
      <span class="dropdown-name">${escapeHtml(r.name)}</span>
      <span class="dropdown-exchange">${escapeHtml(r.exchange || '')}</span>
    </div>
  `).join('');
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

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;

  show('loading');
  hide('error');
  hide('result');
  setText('loadingText', '주가 데이터를 불러오는 중...');

  try {
    const period = document.querySelector('.period-btn.active')?.dataset.period || '6mo';
    await fetchStockData(input, period);

    setText('loadingText', 'AI가 종목을 분석하고 있습니다...');
    await fetchAnalysis();

    show('result');
  } catch (err) {
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

async function fetchAnalysis() {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: currentSymbol,
      quote: currentQuote,
      chartData: currentChartData
    })
  });
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
      <div class="meta-item">
        <span class="meta-label">시가총액</span>
        <span class="meta-value">${formatMarketCap(quote.marketCap, quote.currency)}</span>
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
  const closes = chartData.map(d => d.close);
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
  document.getElementById('analysisContent').innerHTML = marked.parse(markdown);
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
