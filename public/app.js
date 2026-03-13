let currentSymbol = '';
let currentChartData = [];
let currentQuote = null;
let priceChart = null;
let volumeChart = null;
let resizeObserverRef = null;
let analyzeController = null;
let periodController = null;
let dropdownIndex = -1;

// MA선 시리즈 참조 (토글용)
let maSeries = {};
let maVisible = { 5: true, 20: true, 60: true, 120: true };

const symbolInput = document.getElementById('symbolInput');

// ==================== 다크모드 ====================
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme === 'dark' ? 'dark' : '');
  if (newTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('theme', newTheme);
  document.getElementById('darkModeBtn').textContent = newTheme === 'dark' ? '☀️' : '🌙';

  // 차트 재렌더링 (배경색 반영)
  if (currentChartData.length > 0) renderChart(currentChartData);
}

// 초기 테마 적용
(function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('darkModeBtn').textContent = '☀️';
  }
})();

// ==================== 워치리스트 ====================
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('watchlist') || '[]'); }
  catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem('watchlist', JSON.stringify(list));
}

function isInWatchlist(symbol) {
  return getWatchlist().some(w => w.symbol === symbol);
}

function toggleWatchlistItem(symbol, name) {
  let list = getWatchlist();
  if (list.some(w => w.symbol === symbol)) {
    list = list.filter(w => w.symbol !== symbol);
  } else {
    list.unshift({ symbol, name });
    if (list.length > 20) list = list.slice(0, 20);
  }
  saveWatchlist(list);
  renderWatchlist();
  updateFavButton();
}

function toggleWatchlist() {
  const panel = document.getElementById('watchlistPanel');
  const btn = document.getElementById('watchlistToggle');
  panel.classList.toggle('hidden');
  btn.classList.toggle('active', !panel.classList.contains('hidden'));
  if (!panel.classList.contains('hidden')) renderWatchlist();
}

function renderWatchlist() {
  const container = document.getElementById('watchlistItems');
  const list = getWatchlist();
  if (list.length === 0) {
    container.innerHTML = '<p class="watchlist-empty">즐겨찾기한 종목이 없습니다</p>';
    return;
  }
  container.innerHTML = list.map(w => `
    <div class="watchlist-chip" onclick="setSymbol('${escapeHtml(w.symbol)}')">
      <span>${escapeHtml(w.name || w.symbol)}</span>
      <span class="remove" onclick="event.stopPropagation(); toggleWatchlistItem('${escapeHtml(w.symbol)}', '${escapeHtml(w.name || w.symbol)}')">&times;</span>
    </div>
  `).join('');
}

function updateFavButton() {
  const btn = document.querySelector('.stock-fav-btn');
  if (!btn || !currentSymbol) return;
  const isFav = isInWatchlist(currentSymbol);
  btn.textContent = isFav ? '★' : '☆';
  btn.classList.toggle('active', isFav);
}

// ==================== 키보드 단축키 ====================
document.addEventListener('keydown', (e) => {
  // 입력 필드에 포커스 중이면 전역 단축키 무시
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === '/' || e.key === 'ㅊ') {
    e.preventDefault();
    symbolInput.focus();
  } else if (e.key === 'd' || e.key === 'D' || e.key === 'ㅇ') {
    toggleDarkMode();
  } else if (e.key === 'w' || e.key === 'W' || e.key === 'ㅈ') {
    toggleWatchlist();
  }
});

// 엔터 키 + 키보드 네비게이션
symbolInput.addEventListener('keydown', (e) => {
  const dropdown = document.getElementById('searchDropdown');
  const items = dropdown ? dropdown.querySelectorAll('.dropdown-item') : [];

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    dropdownIndex = Math.min(dropdownIndex + 1, items.length - 1);
    updateDropdownHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    dropdownIndex = Math.max(dropdownIndex - 1, -1);
    updateDropdownHighlight(items);
  } else if (e.key === 'Enter') {
    if (dropdownIndex >= 0 && items[dropdownIndex]) {
      symbolInput.value = items[dropdownIndex].dataset.symbol;
    }
    hideDropdown();
    analyzeStock();
  } else if (e.key === 'Escape') {
    hideDropdown();
    symbolInput.blur();
  }
});

function updateDropdownHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('highlight', i === dropdownIndex);
  });
}

// 자동완성 검색
let searchTimeout = null;
symbolInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  dropdownIndex = -1;
  const q = symbolInput.value.trim();
  if (q.length < 1) { hideDropdown(); return; }

  const localResults = searchLocalStocks(q);
  if (localResults.length > 0) showDropdown(localResults);

  searchTimeout = setTimeout(() => searchSymbols(q, localResults), 200);
});

symbolInput.addEventListener('focus', () => {
  if (symbolInput.value.trim()) return;
  const history = getSearchHistory();
  if (history.length > 0) {
    showDropdown(history.map(h => ({
      symbol: h.symbol,
      name: h.name,
      exchange: h.exchange || '최근 검색'
    })));
  }
});

async function searchSymbols(query, localResults = []) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
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

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem('stockSearchHistory') || '[]'); }
  catch { return []; }
}

function addSearchHistory(symbol, name, exchange) {
  const history = getSearchHistory().filter(h => h.symbol !== symbol);
  history.unshift({ symbol, name, exchange });
  localStorage.setItem('stockSearchHistory', JSON.stringify(history.slice(0, 8)));
}

let KR_STOCKS = [];
fetch('/api/kr-stocks').then(r => r.json()).then(data => { KR_STOCKS = data.stocks || []; }).catch(() => {});

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
  dropdownIndex = -1;
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
  dropdownIndex = -1;
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) hideDropdown();
});

// ==================== MA선 토글 ====================
document.querySelectorAll('.legend-item').forEach(item => {
  item.addEventListener('click', () => {
    const ma = parseInt(item.dataset.ma);
    maVisible[ma] = !maVisible[ma];
    item.classList.toggle('disabled', !maVisible[ma]);

    if (maSeries[ma]) {
      maSeries[ma].applyOptions({
        visible: maVisible[ma],
      });
    }
  });
});

// 기간 버튼 이벤트
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentSymbol) {
      if (periodController) periodController.abort();
      periodController = new AbortController();
      const pSignal = periodController.signal;

      showChartLoading(true);
      document.getElementById('analysisSection').classList.add('hidden');
      document.getElementById('indicatorsGrid').innerHTML = '';
      fetchStockData(currentSymbol, btn.dataset.period)
        .then(() => {
          if (pSignal.aborted) return;
          showChartLoading(false);
          setText('loadingText', 'AI가 종목을 분석하고 있습니다...');
          show('loading');
          return fetchAnalysisStream(pSignal);
        })
        .then(() => {
          if (!pSignal.aborted) hide('loading');
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          hide('loading');
          showChartLoading(false);
          showError(err.message);
        });
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

  if (analyzeController) analyzeController.abort();
  analyzeController = new AbortController();
  const signal = analyzeController.signal;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;

  show('loading');
  hide('error');
  hide('result');
  document.getElementById('analysisSection').classList.add('hidden');
  document.getElementById('analysisContent').innerHTML = '';
  document.getElementById('indicatorsGrid').innerHTML = '';
  setText('loadingText', '주가 데이터를 불러오는 중...');

  try {
    const period = document.querySelector('.period-btn.active')?.dataset.period || '1y';
    await fetchStockData(input, period);

    if (signal.aborted) return;

    if (currentQuote) {
      addSearchHistory(currentSymbol, currentQuote.name, currentQuote.exchange);
    }

    setText('loadingText', 'AI가 종목을 분석하고 있습니다...');
    await fetchAnalysisStream(signal);

    show('result');
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError(err.message);
  } finally {
    hide('loading');
    btn.disabled = false;
  }
}

async function fetchStockData(symbol, period = '1y') {
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

// ==================== SSE 스트리밍 분석 ====================
async function fetchAnalysisStream(signal) {
  const body = JSON.stringify({
    symbol: currentSymbol,
    quote: currentQuote,
    chartData: currentChartData
  });

  const res = await fetch('/api/analyze?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '분석에 실패했습니다');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let indicatorsReceived = false;

  // 분석 섹션 보이기
  const section = document.getElementById('analysisSection');
  const content = document.getElementById('analysisContent');
  section.classList.remove('hidden');
  section.classList.add('fade-in');

  const now = new Date();
  const timeStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div><span class="streaming-cursor"></span>`;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      try {
        const msg = JSON.parse(jsonStr);

        if (msg.type === 'indicators' && !indicatorsReceived) {
          indicatorsReceived = true;
          renderIndicators(msg.indicators);
        } else if (msg.type === 'chunk') {
          fullText += msg.text;
          const parsed = marked.parse(fullText, { breaks: true });
          const sanitized = DOMPurify.sanitize(parsed, {
            ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','em','a','code','pre','blockquote','table','thead','tbody','tr','th','td','div','span'],
            ALLOWED_ATTR: ['href','class'],
            FORBID_ATTR: ['style','onerror','onload'],
          });
          content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div>` + sanitized + '<span class="streaming-cursor"></span>';
        } else if (msg.type === 'done') {
          // 최종 렌더링 (커서 제거)
          const parsed = marked.parse(fullText, { breaks: true });
          const sanitized = DOMPurify.sanitize(parsed, {
            ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','em','a','code','pre','blockquote','table','thead','tbody','tr','th','td','div','span'],
            ALLOWED_ATTR: ['href','class'],
            FORBID_ATTR: ['style','onerror','onload'],
          });
          content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div>` + sanitized;

          // 자동 스크롤
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch {}
    }
  }
}

// 일반 분석 (폴백)
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

async function reAnalyze() {
  const btn = document.getElementById('reAnalyzeBtn');
  btn.disabled = true;
  btn.textContent = '분석 중...';
  try {
    await fetchAnalysisStream();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '재분석';
  }
}

// ==================== PDF 내보내기 ====================
function exportAnalysis() {
  window.print();
}

// ==================== 네이버 스타일 렌더링 ====================

function renderSummary(quote, symbol) {
  const isUp = quote.change >= 0;
  const cls = isUp ? 'up' : 'down';
  const sign = isUp ? '+' : '';
  const arrow = isUp ? '▲' : '▼';

  const range52 = (quote.fiftyTwoWeekHigh || 0) - (quote.fiftyTwoWeekLow || 0);
  const pos52 = range52 > 0 ? ((quote.price - quote.fiftyTwoWeekLow) / range52) * 100 : 50;

  const isFav = isInWatchlist(symbol);

  // 종목 헤더
  document.getElementById('stockSummary').innerHTML = `
    <div class="stock-title-row">
      <div class="stock-title">${escapeHtml(quote.name)}</div>
      <button class="stock-fav-btn ${isFav ? 'active' : ''}" onclick="toggleWatchlistItem('${escapeHtml(symbol)}', '${escapeHtml(quote.name)}')">${isFav ? '★' : '☆'}</button>
    </div>
    <div class="stock-code">${escapeHtml(quote.exchange)} ${escapeHtml(symbol)}</div>
    <div class="stock-price-main ${cls}">${formatNumber(quote.price)}</div>
    <div class="stock-change-info ${cls}">
      ${sign}${formatNumber(Math.abs(quote.change))} ${arrow} ${Math.abs(quote.changePercent || 0).toFixed(2)}%
    </div>
  `;

  // 52주 범위
  document.getElementById('rangeSection').innerHTML = `
    <div class="range-row">
      <div class="range-label-left">52주 최저<span>${formatNumber(quote.fiftyTwoWeekLow)}</span></div>
      <div class="range-track">
        <div class="range-pointer" style="left: ${Math.min(100, Math.max(0, pos52))}%"></div>
      </div>
      <div class="range-label-right">52주 최고<span>${formatNumber(quote.fiftyTwoWeekHigh)}</span></div>
    </div>
  `;

  // 시세 정보 테이블
  document.getElementById('infoTable').innerHTML = `
    <div class="info-grid">
      <div class="info-cell">
        <span class="info-label">전일</span>
        <span class="info-value">${formatNumber(quote.previousClose)}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">고가</span>
        <span class="info-value up">${formatNumber(quote.dayHigh)}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">시가</span>
        <span class="info-value">${formatNumber(quote.price)}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">저가</span>
        <span class="info-value down">${formatNumber(quote.dayLow)}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">거래량</span>
        <span class="info-value">${quote.volume ? quote.volume.toLocaleString() + '주' : 'N/A'}</span>
      </div>
      ${quote.marketCap ? `<div class="info-cell">
        <span class="info-label">시가총액</span>
        <span class="info-value">${formatMarketCap(quote.marketCap, quote.currency)}</span>
      </div>` : `<div class="info-cell">
        <span class="info-label">통화</span>
        <span class="info-value">${quote.currency || '-'}</span>
      </div>`}
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
  maSeries = {};
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    bg: isDark ? '#16213e' : '#ffffff',
    text: isDark ? '#777' : '#999',
    grid: isDark ? '#222244' : '#f0f0f0',
    border: isDark ? '#2a2a4a' : '#e0e0e0',
  };
}

function renderChart(chartData) {
  cleanupCharts();

  const colors = getChartColors();
  const priceContainer = document.getElementById('priceChart');
  const volumeContainer = document.getElementById('volumeChart');

  priceChart = LightweightCharts.createChart(priceContainer, {
    width: priceContainer.clientWidth,
    height: 360,
    layout: {
      background: { color: 'transparent' },
      textColor: colors.text,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: {
      borderColor: colors.border,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    },
    timeScale: {
      borderColor: colors.border,
      timeVisible: false,
      rightOffset: 2,
      barSpacing: 6,
    },
  });

  // 캔들스틱 (한국 주식 색상: 빨간=상승, 파란=하락)
  const candleSeries = priceChart.addCandlestickSeries({
    upColor: '#e22926',
    downColor: '#2679ed',
    borderDownColor: '#2679ed',
    borderUpColor: '#e22926',
    wickDownColor: '#2679ed',
    wickUpColor: '#e22926',
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
    { period: 5, color: '#f59e0b' },
    { period: 20, color: '#3b82f6' },
    { period: 60, color: '#8b5cf6' },
    { period: 120, color: '#ef4444' },
  ];

  maConfigs.forEach(({ period, color }) => {
    if (chartData.length >= period) {
      const series = priceChart.addLineSeries({
        color,
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: maVisible[period],
      });
      series.setData(calcMAArray(chartData, period));
      maSeries[period] = series;
    }
  });

  priceChart.timeScale().fitContent();

  // 거래량 차트
  volumeChart = LightweightCharts.createChart(volumeContainer, {
    width: volumeContainer.clientWidth,
    height: 80,
    layout: {
      background: { color: 'transparent' },
      textColor: colors.text,
      fontSize: 10,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: colors.grid },
    },
    rightPriceScale: { borderColor: colors.border },
    timeScale: { visible: false },
  });

  const volumeSeries = volumeChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
  });

  volumeSeries.setData(chartData.map(d => ({
    time: toChartTime(d.date),
    value: d.volume,
    color: d.close >= d.open ? 'rgba(226,41,38,0.3)' : 'rgba(38,121,237,0.3)',
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
      desc: indicators.RSI > 70 ? '과매수' : indicators.RSI < 30 ? '과매도' : '중립'
    },
    {
      label: 'MACD',
      value: indicators.MACD,
      cls: indicators.MACD_Histogram > 0 ? 'bullish' : 'bearish',
      desc: `신호: ${indicators.MACD_Signal}`
    },
    {
      label: '스토캐스틱',
      value: `${indicators.Stochastic_K}`,
      cls: indicators.Stochastic_K > 80 ? 'bearish' : indicators.Stochastic_K < 20 ? 'bullish' : 'neutral',
      desc: indicators.Stochastic_K > 80 ? '과매수' : indicators.Stochastic_K < 20 ? '과매도' : '중립'
    },
    {
      label: '이평선 배열',
      value: getMAAlignment(indicators),
      cls: getMAAlignmentClass(indicators),
      desc: getMAAlignmentDesc(indicators)
    },
    {
      label: 'MA5',
      value: formatNumber(indicators.MA5),
      cls: indicators.현재가 > indicators.MA5 ? 'bullish' : 'bearish',
      desc: indicators.현재가 > indicators.MA5 ? '상승' : '하락'
    },
    {
      label: 'MA20',
      value: formatNumber(indicators.MA20),
      cls: indicators.현재가 > indicators.MA20 ? 'bullish' : 'bearish',
      desc: indicators.현재가 > indicators.MA20 ? '상승' : '하락'
    },
    {
      label: '볼린저',
      value: `${indicators.BB_Width}%`,
      cls: indicators.현재가 > indicators.BB_Upper ? 'bearish' :
           indicators.현재가 < indicators.BB_Lower ? 'bullish' : 'neutral',
      desc: indicators.현재가 > indicators.BB_Upper ? '과열' :
            indicators.현재가 < indicators.BB_Lower ? '반등 기대' : '밴드 내'
    },
    {
      label: '거래량',
      value: `${indicators.거래량비율}x`,
      cls: indicators.거래량비율 > 2 ? 'bullish' : indicators.거래량비율 < 0.5 ? 'bearish' : 'neutral',
      desc: indicators.거래량비율 > 2 ? '급증' : indicators.거래량비율 < 0.5 ? '부진' : '보통'
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
  if (ind.MA5 > ind.MA20 && ind.MA20 > ind.MA60) return '강세';
  if (ind.MA5 < ind.MA20 && ind.MA20 < ind.MA60) return '약세';
  return '전환 가능';
}

function renderAnalysis(markdown) {
  const parsed = marked.parse(markdown, { breaks: true });
  const sanitized = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','em','a','code','pre','blockquote','table','thead','tbody','tr','th','td','div','span'],
    ALLOWED_ATTR: ['href','class'],
    FORBID_ATTR: ['style','onerror','onload'],
  });

  const now = new Date();
  const timeStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const section = document.getElementById('analysisSection');
  document.getElementById('analysisContent').innerHTML =
    `<div class="analysis-time">분석 시점: ${timeStr}</div>` + sanitized;
  section.classList.remove('hidden');
  section.classList.add('fade-in');

  // 자동 스크롤
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- 유틸리티 ---

function toChartTime(dateStr) {
  const d = new Date(dateStr);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
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

function formatNumber(num) {
  if (num == null || isNaN(num)) return '-';
  return Number(num).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatMarketCap(cap, currency) {
  if (!cap) return '-';
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

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function setText(id, text) { document.getElementById(id).textContent = text; }

function showChartLoading(on) {
  const container = document.querySelector('.chart-section');
  if (!container) return;
  if (on) container.classList.add('chart-loading');
  else container.classList.remove('chart-loading');
}

function showError(msg) {
  const el = document.getElementById('error');
  // 구체적 에러 메시지
  const messages = {
    'AI_TIMEOUT': 'AI 분석 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
    'API_QUOTA': 'API 할당량을 초과했습니다. 잠시 후 다시 시도해주세요.',
    'Failed to fetch': '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.',
  };
  el.textContent = messages[msg] || msg;
  el.classList.remove('hidden');
}
