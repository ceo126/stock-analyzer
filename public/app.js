let currentSymbol = '';
let currentChartData = [];
let currentQuote = null;
let priceChart = null;
let volumeChart = null;
let candleSeries = null;
let ma5Series = null;
let ma20Series = null;
let ma60Series = null;
let volumeSeries = null;

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

function showDropdown(results) {
  let dropdown = document.getElementById('searchDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    dropdown.className = 'search-dropdown';
    symbolInput.parentElement.appendChild(dropdown);
  }
  dropdown.innerHTML = results.map(r => `
    <div class="dropdown-item" onclick="selectResult('${r.symbol}')">
      <span class="dropdown-symbol">${r.symbol}</span>
      <span class="dropdown-name">${r.name}</span>
      <span class="dropdown-exchange">${r.exchange || ''}</span>
    </div>
  `).join('');
  dropdown.classList.add('show');
}

function hideDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

function selectResult(sym) {
  symbolInput.value = sym;
  hideDropdown();
  analyzeStock();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) hideDropdown();
});

// 기간 버튼 이벤트
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentSymbol) fetchStockData(currentSymbol, btn.dataset.period);
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

function renderSummary(quote, symbol) {
  const changeClass = quote.change >= 0 ? 'up' : 'down';
  const changeSign = quote.change >= 0 ? '+' : '';

  document.getElementById('stockSummary').innerHTML = `
    <div class="stock-name-block">
      <div class="stock-name">${quote.name}</div>
      <div class="stock-symbol">${symbol} · ${quote.exchange}</div>
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
        <span class="meta-value">${formatMarketCap(quote.marketCap)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">52주 최고</span>
        <span class="meta-value">${formatNumber(quote.fiftyTwoWeekHigh)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">52주 최저</span>
        <span class="meta-value">${formatNumber(quote.fiftyTwoWeekLow)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">PER</span>
        <span class="meta-value">${quote.trailingPE?.toFixed(1) || 'N/A'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">거래량</span>
        <span class="meta-value">${formatVolume(quote.volume)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">배당률</span>
        <span class="meta-value">${quote.dividendYield ? (quote.dividendYield * 100).toFixed(2) + '%' : 'N/A'}</span>
      </div>
    </div>
  `;
}

function renderChart(chartData) {
  const priceContainer = document.getElementById('priceChart');
  const volumeContainer = document.getElementById('volumeChart');
  priceContainer.innerHTML = '';
  volumeContainer.innerHTML = '';

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

  // 캔들스틱
  candleSeries = priceChart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    wickUpColor: '#22c55e',
  });

  const candleData = chartData.map(d => ({
    time: toChartTime(d.date),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
  candleSeries.setData(candleData);

  // 이동평균선
  const closes = chartData.map(d => d.close);

  ma5Series = priceChart.addLineSeries({ color: '#eab308', lineWidth: 1, title: 'MA5' });
  ma20Series = priceChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, title: 'MA20' });
  ma60Series = priceChart.addLineSeries({ color: '#a855f7', lineWidth: 1, title: 'MA60' });

  ma5Series.setData(calcMAArray(chartData, 5));
  ma20Series.setData(calcMAArray(chartData, 20));
  ma60Series.setData(calcMAArray(chartData, 60));

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

  volumeSeries = volumeChart.addHistogramSeries({
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
  const resizeObserver = new ResizeObserver(() => {
    priceChart.applyOptions({ width: priceContainer.clientWidth });
    volumeChart.applyOptions({ width: volumeContainer.clientWidth });
  });
  resizeObserver.observe(priceContainer);
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
      cls: indicators.MACD > indicators.MACD_Signal ? 'bullish' : 'bearish',
      desc: indicators.MACD > indicators.MACD_Signal ? '매수 시그널' : '매도 시그널'
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
      label: '볼린저 상단',
      value: formatNumber(indicators.BB_Upper),
      cls: indicators.현재가 > indicators.BB_Upper ? 'bearish' : 'neutral',
      desc: indicators.현재가 > indicators.BB_Upper ? '상단 돌파 (과열)' : '상단 미만'
    },
    {
      label: '볼린저 하단',
      value: formatNumber(indicators.BB_Lower),
      cls: indicators.현재가 < indicators.BB_Lower ? 'bullish' : 'neutral',
      desc: indicators.현재가 < indicators.BB_Lower ? '하단 이탈 (반등 기대)' : '하단 이상'
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

function renderAnalysis(markdown) {
  document.getElementById('analysisContent').innerHTML = marked.parse(markdown);
  document.getElementById('analysisSection').classList.remove('hidden');
}

// 유틸리티
function toChartTime(dateStr) {
  const d = new Date(dateStr);
  return Math.floor(d.getTime() / 1000);
}

function calcMAArray(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push({
      time: toChartTime(data[i].date),
      value: sum / period
    });
  }
  return result;
}

function formatNumber(num) {
  if (num == null || isNaN(num)) return 'N/A';
  return Number(num).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatMarketCap(cap) {
  if (!cap) return 'N/A';
  if (cap >= 1e12) return (cap / 1e12).toFixed(1) + '조';
  if (cap >= 1e8) return (cap / 1e8).toFixed(0) + '억';
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

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
