let currentSymbol = '';
let currentChartData = [];
let currentQuote = null;
let priceChart = null;
let volumeChart = null;
let macdChart = null;
let compareChart = null;
let resizeObserverRef = null;
let analyzeController = null;
let periodController = null;
let dropdownIndex = -1;
let compareSymbols = [];
let watchlistRefreshInterval = null;

// MA선 시리즈 참조
let maSeries = {};
let maVisible = { 5: true, 20: true, 60: true, 120: true };

// 오버레이 시리즈
let bbSeries = { upper: null, lower: null };
let srLines = [];
let overlayVisible = { bb: false, sr: false };
let currentIndicators = null;
let compareTimeRangeUnsubscribe = null;

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','em','a','code','pre','blockquote','table','thead','tbody','tr','th','td','div','span'],
  ALLOWED_ATTR: ['href','class'],
  FORBID_ATTR: ['style','onerror','onload'],
};

const symbolInput = document.getElementById('symbolInput');

// ==================== 토스트 ====================
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ==================== 다크모드 ====================
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
  document.getElementById('darkModeBtn').textContent = isDark ? '🌙' : '☀️';
  if (currentChartData.length > 0) renderChart(currentChartData);
}

(function initTheme() {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('darkModeBtn').textContent = '☀️';
  }
})();

// ==================== PWA ====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ==================== 스크롤 맨 위로 ====================
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scrollTopBtn');
  btn.classList.toggle('hidden', window.scrollY < 400);
}, { passive: true });

// ==================== 섹션 탭 ====================
document.querySelectorAll('.section-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

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
  const was = list.some(w => w.symbol === symbol);
  if (was) {
    list = list.filter(w => w.symbol !== symbol);
    showToast(`${name || symbol} 워치리스트에서 제거`);
  } else {
    list.unshift({ symbol, name });
    if (list.length > 20) list = list.slice(0, 20);
    showToast(`${name || symbol} 워치리스트에 추가`);
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
  // 다른 패널 닫기
  document.getElementById('historyPanel').classList.add('hidden');
  document.getElementById('historyToggle').classList.remove('active');
  if (!panel.classList.contains('hidden')) {
    renderWatchlist();
    fetchWatchlistPrices();
    // 30초마다 자동 갱신
    clearInterval(watchlistRefreshInterval);
    watchlistRefreshInterval = setInterval(fetchWatchlistPrices, 30000);
  } else {
    clearInterval(watchlistRefreshInterval);
  }
}

function renderWatchlist() {
  const container = document.getElementById('watchlistItems');
  const list = getWatchlist();
  if (list.length === 0) {
    container.innerHTML = '<p class="watchlist-empty">즐겨찾기한 종목이 없습니다</p>';
    return;
  }
  container.innerHTML = list.map(w => `
    <div class="watchlist-chip" data-wl-symbol="${escapeHtml(w.symbol)}" onclick="setSymbol('${escapeHtml(w.symbol)}')">
      <span>${escapeHtml(w.name || w.symbol)}</span>
      <span class="wl-price" id="wlPrice_${escapeHtml(w.symbol)}"></span>
      <span class="remove" onclick="event.stopPropagation(); toggleWatchlistItem('${escapeHtml(w.symbol)}', '${escapeHtml(w.name || w.symbol)}')">&times;</span>
    </div>
  `).join('');
}

async function fetchWatchlistPrices() {
  const list = getWatchlist();
  if (list.length === 0) return;
  try {
    const res = await fetch('/api/watchlist-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: list.map(w => w.symbol) }),
    });
    const data = await res.json();
    for (const [sym, info] of Object.entries(data.prices || {})) {
      const el = document.getElementById(`wlPrice_${sym}`);
      if (!el) continue;
      const pct = info.changePercent ?? 0;
      const sign = pct >= 0 ? '+' : '';
      const cls = pct >= 0 ? 'up' : 'down';
      el.className = `wl-price ${cls}`;
      el.textContent = `${sign}${pct.toFixed(1)}%`;
    }
  } catch {}
}

function updateFavButton() {
  const btn = document.querySelector('.stock-fav-btn');
  if (!btn || !currentSymbol) return;
  const isFav = isInWatchlist(currentSymbol);
  btn.textContent = isFav ? '★' : '☆';
  btn.classList.toggle('active', isFav);
}

// ==================== 분석 이력 ====================
function getAnalysisHistory() {
  try { return JSON.parse(localStorage.getItem('analysisHistory') || '[]'); } catch { return []; }
}

function saveAnalysisToHistory(symbol, name, score, summary) {
  const history = getAnalysisHistory().filter(h => h.symbol !== symbol);
  history.unshift({
    symbol, name, score,
    summary: (summary || '').substring(0, 200),
    date: new Date().toISOString(),
  });
  localStorage.setItem('analysisHistory', JSON.stringify(history.slice(0, 30)));
}

function toggleHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  const btn = document.getElementById('historyToggle');
  panel.classList.toggle('hidden');
  btn.classList.toggle('active', !panel.classList.contains('hidden'));
  // 다른 패널 닫기
  document.getElementById('watchlistPanel').classList.add('hidden');
  document.getElementById('watchlistToggle').classList.remove('active');
  clearInterval(watchlistRefreshInterval);
  if (!panel.classList.contains('hidden')) renderHistory();
}

function renderHistory() {
  const container = document.getElementById('historyItems');
  const history = getAnalysisHistory();
  if (history.length === 0) {
    container.innerHTML = '<p class="watchlist-empty">분석 이력이 없습니다</p>';
    return;
  }
  container.innerHTML = history.map(h => {
    const d = new Date(h.date);
    const dateStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const scoreColor = h.score >= 60 ? 'var(--up)' : h.score <= 40 ? 'var(--down)' : 'var(--text-muted)';
    return `<div class="history-item" onclick="setSymbol('${escapeHtml(h.symbol)}')">
      <div class="history-item-info">
        <span class="history-item-name">${escapeHtml(h.name || h.symbol)}</span>
        <span class="history-item-date">${dateStr}</span>
      </div>
      <span class="history-item-score" style="color:${scoreColor}">${h.score != null ? h.score + '점' : '-'}</span>
    </div>`;
  }).join('');
}

function clearHistory() {
  localStorage.removeItem('analysisHistory');
  renderHistory();
  showToast('분석 이력이 삭제되었습니다');
}

// ==================== 비교 모드 ====================
function toggleCompareMode() {
  const on = document.getElementById('compareMode').checked;
  const inputs = document.getElementById('compareInputs');
  inputs.classList.toggle('hidden', !on);
  if (!on) {
    compareSymbols = [];
    renderCompareChips();
    const el = document.getElementById('compareChart');
    if (el) el.classList.add('hidden');
  }
}

function addCompareSymbol(symbolOverride) {
  const input = document.getElementById('compareSymbol');
  const sym = (symbolOverride || input.value).trim();
  if (!sym || compareSymbols.length >= 2) return;
  // 한글 종목명이면 코드로 변환
  const match = KR_STOCKS.find(s => s.name === sym);
  const resolvedSym = match ? match.symbol : sym;
  if (!compareSymbols.includes(resolvedSym)) compareSymbols.push(resolvedSym);
  input.value = '';
  hideCompareDropdown();
  renderCompareChips();
}

// 비교 종목 자동완성
let compareSearchTimeout = null;
const compareInput = document.getElementById('compareSymbol');
if (compareInput) {
  compareInput.addEventListener('input', () => {
    clearTimeout(compareSearchTimeout);
    const q = compareInput.value.trim();
    if (q.length < 1) { hideCompareDropdown(); return; }
    const local = searchLocalStocks(q);
    if (local.length > 0) showCompareDropdown(local);
    compareSearchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const localSyms = new Set(local.map(r => r.symbol));
        const merged = [...local, ...(data.results || []).filter(r => !localSyms.has(r.symbol))].slice(0, 6);
        if (merged.length > 0) showCompareDropdown(merged); else hideCompareDropdown();
      } catch {}
    }, 200);
  });
}

function showCompareDropdown(results) {
  let dd = document.getElementById('compareDropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'compareDropdown';
    dd.className = 'search-dropdown';
    compareInput.parentElement.appendChild(dd);
  }
  dd.innerHTML = results.map(r => {
    const displaySym = r.symbol.replace(/\.(KS|KQ)$/, '');
    return `<div class="dropdown-item" data-symbol="${escapeHtml(r.symbol)}">
      <span class="dropdown-symbol">${escapeHtml(displaySym)}</span>
      <span class="dropdown-name">${escapeHtml(r.name)}</span>
    </div>`;
  }).join('');
  dd.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => { addCompareSymbol(item.dataset.symbol); });
  });
  dd.classList.add('show');
}

function hideCompareDropdown() {
  const dd = document.getElementById('compareDropdown');
  if (dd) dd.classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.compare-inputs')) hideCompareDropdown();
});

function removeCompareSymbol(sym) {
  compareSymbols = compareSymbols.filter(s => s !== sym);
  renderCompareChips();
}

function renderCompareChips() {
  const container = document.getElementById('compareChips');
  container.innerHTML = compareSymbols.map(s =>
    `<span class="compare-chip">${escapeHtml(s)} <span class="remove" onclick="removeCompareSymbol('${escapeHtml(s)}')">&times;</span></span>`
  ).join('');
}

async function fetchCompareData() {
  if (compareSymbols.length === 0 || !currentSymbol) return;
  const all = [currentSymbol, ...compareSymbols];
  const period = document.querySelector('.period-btn.active')?.dataset.period || '1y';
  try {
    const res = await fetch(`/api/compare?symbols=${all.map(s => encodeURIComponent(s)).join(',')}&period=${period}`);
    const data = await res.json();
    if (data.success) renderCompareChart(data.results);
  } catch {}
}

function renderCompareChart(results) {
  const container = document.getElementById('compareChart');
  container.classList.remove('hidden');
  if (compareTimeRangeUnsubscribe) { compareTimeRangeUnsubscribe(); compareTimeRangeUnsubscribe = null; }
  if (compareChart) { compareChart.remove(); compareChart = null; }

  const colors = getChartColors();
  const lineColors = ['#4f6ef7', '#e22926', '#26a69a'];

  compareChart = LightweightCharts.createChart(container, {
    width: container.clientWidth, height: 180,
    layout: { background: { color: 'transparent' }, textColor: colors.text, fontSize: 10 },
    grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
    rightPriceScale: { borderColor: colors.border },
    timeScale: { visible: false },
  });

  results.forEach((r, i) => {
    const series = compareChart.addLineSeries({
      color: lineColors[i % lineColors.length], lineWidth: 2,
      crosshairMarkerVisible: true, lastValueVisible: true, priceLineVisible: false,
      title: r.name || r.symbol,
    });
    series.setData(r.normalized.map(d => ({ time: toChartTime(d.date), value: d.return })));
  });

  compareChart.timeScale().fitContent();

  if (priceChart) {
    const handler = range => {
      if (!range || !compareChart) return;
      compareChart.timeScale().setVisibleLogicalRange(range);
    };
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    compareTimeRangeUnsubscribe = () => priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }
}

// ==================== 키보드 단축키 ====================
document.addEventListener('keydown', (e) => {
  // ESC: 팝업/패널 닫기
  if (e.key === 'Escape') {
    const popup = document.getElementById('indicatorPopup');
    if (!popup.classList.contains('hidden')) { closeIndicatorPopup(); return; }
    const wl = document.getElementById('watchlistPanel');
    if (!wl.classList.contains('hidden')) { toggleWatchlist(); return; }
    const hp = document.getElementById('historyPanel');
    if (!hp.classList.contains('hidden')) { toggleHistoryPanel(); return; }
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '/' || e.key === 'ㅊ') { e.preventDefault(); symbolInput.focus(); }
  else if (e.key === 'd' || e.key === 'D' || e.key === 'ㅇ') { toggleDarkMode(); }
  else if (e.key === 'w' || e.key === 'W' || e.key === 'ㅈ') { toggleWatchlist(); }
});

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
  items.forEach((item, i) => item.classList.toggle('highlight', i === dropdownIndex));
}

// ==================== 자동완성 ====================
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
    showDropdown(history.map(h => ({ symbol: h.symbol, name: h.name, exchange: h.exchange || '최근 검색' })));
  }
});

async function searchSymbols(query, localResults = []) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const localSymbols = new Set(localResults.map(r => r.symbol));
    const yahooResults = (data.results || []).filter(r => !localSymbols.has(r.symbol));
    const merged = [...localResults, ...yahooResults].slice(0, 10);
    if (merged.length > 0) showDropdown(merged); else hideDropdown();
  } catch {
    if (localResults.length > 0) showDropdown(localResults); else hideDropdown();
  }
}

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem('stockSearchHistory') || '[]'); } catch { return []; }
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
  return KR_STOCKS.filter(s => s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().startsWith(q)).slice(0, 8);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    return `<div class="dropdown-item" data-symbol="${escapeHtml(r.symbol)}">
      <span class="dropdown-symbol">${escapeHtml(displaySymbol)}</span>
      <span class="dropdown-name">${escapeHtml(r.name)}</span>
      <span class="dropdown-exchange">${escapeHtml(r.exchange || '')}</span>
    </div>`;
  }).join('');
  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => { symbolInput.value = item.dataset.symbol; hideDropdown(); analyzeStock(); });
  });
  dropdown.classList.add('show');
}

function hideDropdown() {
  dropdownIndex = -1;
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) hideDropdown(); });

// ==================== MA선 / 오버레이 토글 ====================
document.querySelectorAll('.legend-item[data-ma]').forEach(item => {
  item.addEventListener('click', () => {
    const ma = parseInt(item.dataset.ma);
    maVisible[ma] = !maVisible[ma];
    item.classList.toggle('disabled', !maVisible[ma]);
    if (maSeries[ma]) maSeries[ma].applyOptions({ visible: maVisible[ma] });
  });
});

document.querySelectorAll('.legend-item[data-overlay]').forEach(item => {
  item.addEventListener('click', () => {
    const type = item.dataset.overlay;
    overlayVisible[type] = !overlayVisible[type];
    item.classList.toggle('disabled', !overlayVisible[type]);
    if (type === 'bb') {
      if (bbSeries.upper) bbSeries.upper.applyOptions({ visible: overlayVisible.bb });
      if (bbSeries.lower) bbSeries.lower.applyOptions({ visible: overlayVisible.bb });
    } else if (type === 'sr') {
      srLines.forEach(line => line.applyOptions({ visible: overlayVisible.sr }));
    }
  });
});

document.querySelectorAll('.legend-item[data-overlay]').forEach(item => item.classList.add('disabled'));

// ==================== 기간 버튼 ====================
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentSymbol) {
      if (periodController) periodController.abort();
      periodController = new AbortController();
      const pSignal = periodController.signal;
      showChartLoading(true);
      fetchStockData(currentSymbol, btn.dataset.period, pSignal)
        .then(() => {
          if (pSignal.aborted) return;
          showChartLoading(false);
          if (document.getElementById('compareMode').checked && compareSymbols.length > 0) {
            fetchCompareData();
          }
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
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

// ==================== 프로그레스 바 ====================
function showProgress(step) {
  const bar = document.getElementById('progressBar');
  bar.classList.remove('hidden');
  const steps = ['data', 'indicator', 'news', 'ai'];
  const idx = steps.indexOf(step);
  document.getElementById('progressFill').style.width = ((idx + 1) / steps.length * 100) + '%';
  document.querySelectorAll('.progress-step').forEach(el => {
    const si = steps.indexOf(el.dataset.step);
    el.classList.toggle('active', el.dataset.step === step);
    el.classList.toggle('done', si < idx);
  });
}

function hideProgress() {
  document.getElementById('progressBar').classList.add('hidden');
}

// ==================== 마켓 상태 ====================
function getMarketStatus(exchange) {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const day = now.getUTCDay();
  // 주말
  if (day === 0 || day === 6) return 'closed';
  // 한국 (KSE, KOE, KOSDAQ): UTC+9, 09:00~15:30
  if (['KSE', 'KOE', 'KOSDAQ', 'KSC'].some(e => (exchange || '').toUpperCase().includes(e))) {
    const kstH = (utcH + 9) % 24;
    const kstMin = kstH * 60 + utcM;
    return (kstMin >= 540 && kstMin <= 930) ? 'open' : 'closed';
  }
  // 미국 (NYSE, NASDAQ, NMS): EDT(UTC-4) / EST(UTC-5), 09:30~16:00
  // DST: 3월 두번째 일요일 ~ 11월 첫번째 일요일
  const year = now.getUTCFullYear();
  const mar2ndSun = new Date(Date.UTC(year, 2, 8 + (7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7, 7));
  const nov1stSun = new Date(Date.UTC(year, 10, 1 + (7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7, 6));
  const isDST = now >= mar2ndSun && now < nov1stSun;
  const usOffset = isDST ? 4 : 5;
  const usH = (utcH - usOffset + 24) % 24;
  const usMin = usH * 60 + utcM;
  if (['NYSE', 'NASDAQ', 'NMS', 'NYQ', 'NGM', 'PCX'].some(e => (exchange || '').toUpperCase().includes(e))) {
    return (usMin >= 570 && usMin <= 960) ? 'open' : 'closed';
  }
  // 기타 시장: 알 수 없음 → closed 기본값
  return 'closed';
}

// ==================== 메인 분석 ====================
async function analyzeStock() {
  const input = document.getElementById('symbolInput').value.trim();
  if (!input) return;

  if (analyzeController) analyzeController.abort();
  analyzeController = new AbortController();
  const signal = analyzeController.signal;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;

  hide('error');
  hide('result');
  document.getElementById('analysisSection').classList.add('hidden');
  document.getElementById('analysisContent').innerHTML = '';
  document.getElementById('indicatorsGrid').innerHTML = '';
  document.getElementById('signalScoreSection').classList.add('hidden');
  showProgress('data');

  try {
    const period = document.querySelector('.period-btn.active')?.dataset.period || '1y';
    await fetchStockData(input, period, signal);
    if (signal.aborted) return;

    if (currentQuote) addSearchHistory(currentSymbol, currentQuote.name, currentQuote.exchange);

    if (document.getElementById('compareMode').checked && compareSymbols.length > 0) {
      fetchCompareData();
    }

    showProgress('news');
    fetchNews(currentSymbol);

    showProgress('ai');
    await fetchAnalysisStream(signal);
    show('result');
    hideProgress();
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError(err.message);
    hideProgress();
  } finally {
    btn.disabled = false;
  }
}

function retryAnalysis() {
  hide('error');
  analyzeStock();
}

async function fetchStockData(symbol, period = '1y', signal) {
  const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}?period=${period}`, signal ? { signal } : undefined);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '데이터를 가져올 수 없습니다');

  currentSymbol = data.symbol;
  currentQuote = data.quote;
  currentChartData = data.chartData;

  renderSummary(data.quote, data.symbol);
  renderPeriodReturn(data.chartData, period);
  renderChart(data.chartData);
  show('result');

  const rateBar = document.getElementById('exchangeRateBar');
  if (data.exchangeRate && data.quote.currency !== 'KRW') {
    rateBar.innerHTML = `USD/KRW <strong>${formatNumber(data.exchangeRate)}</strong>원 &middot; 원화 환산 <strong>${formatNumber(data.quote.price * data.exchangeRate)}</strong>원`;
    rateBar.classList.remove('hidden');
  } else {
    rateBar.classList.add('hidden');
  }
}

// ==================== 뉴스 ====================
async function fetchNews(symbol) {
  try {
    const res = await fetch(`/api/news/${encodeURIComponent(symbol)}`);
    const data = await res.json();
    const section = document.getElementById('newsSection');
    const list = document.getElementById('newsList');
    if (data.news && data.news.length > 0) {
      list.innerHTML = data.news.map(n => {
        const safeLink = n.link && /^https?:\/\//.test(n.link) ? n.link : '';
        return `<div class="news-item${safeLink ? ' news-clickable' : ''}" ${safeLink ? `data-href="${escapeHtml(safeLink)}"` : ''}>
          <div class="news-item-title">${escapeHtml(n.title)}</div>
          <div class="news-item-meta">
            <div class="news-item-publisher">${escapeHtml(n.publisher)}</div>
            <div>${escapeHtml(n.date)}</div>
          </div>
        </div>`;
      }).join('');
      // 이벤트 위임으로 XSS 방지
      list.querySelectorAll('.news-clickable').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => window.open(el.dataset.href, '_blank', 'noopener'));
      });
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  } catch {
    document.getElementById('newsSection').classList.add('hidden');
  }
}

// ==================== SSE 스트리밍 ====================
async function fetchAnalysisStream(signal) {
  const body = JSON.stringify({ symbol: currentSymbol, quote: currentQuote, chartData: currentChartData });

  const res = await fetch('/api/analyze?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body, signal,
  });

  if (!res.ok) {
    let errMsg = '분석에 실패했습니다';
    try {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const err = await res.json();
        errMsg = err.error || errMsg;
      } else {
        errMsg = await res.text() || errMsg;
      }
    } catch {}
    throw new Error(errMsg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let indicatorsReceived = false;

  const section = document.getElementById('analysisSection');
  const content = document.getElementById('analysisContent');
  section.classList.remove('hidden');
  section.classList.add('fade-in');

  const timeStr = getTimeStr();
  content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div><span class="streaming-cursor"></span>`;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // flush 잔여 바이트 + 남은 버퍼 처리
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      processSSELine(line);
    }
  }

  // 스트림 종료 후 버퍼에 남은 데이터 처리
  if (buffer.trim()) processSSELine(buffer);

  function processSSELine(line) {
    if (!line.startsWith('data: ')) return;
    try {
      const msg = JSON.parse(line.slice(6));

      if (msg.type === 'indicators' && !indicatorsReceived) {
        indicatorsReceived = true;
        currentIndicators = msg.indicators;
        renderIndicators(msg.indicators);
        renderSignalScore(msg.indicators.종합스코어);
        showProgress('ai');
        if (msg.indicators.지지선 || msg.indicators.저항선) {
          renderSRLines(msg.indicators);
        }
      } else if (msg.type === 'chunk') {
        fullText += msg.text;
        const sanitized = DOMPurify.sanitize(marked.parse(fullText, { breaks: true }), SANITIZE_CONFIG);
        content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div>` + sanitized + '<span class="streaming-cursor"></span>';
      } else if (msg.type === 'done') {
        const sanitized = DOMPurify.sanitize(marked.parse(fullText, { breaks: true }), SANITIZE_CONFIG);
        content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div>` + sanitized;
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (currentQuote && currentIndicators) {
          saveAnalysisToHistory(currentSymbol, currentQuote.name, currentIndicators.종합스코어, fullText);
        }
      } else if (msg.type === 'error') {
        content.innerHTML = `<div class="analysis-time">분석 시점: ${timeStr}</div><p style="color:#dc2626;font-weight:600;">${escapeHtml(msg.error)}</p>`;
      }
    } catch {}
  }
}

async function reAnalyze() {
  if (analyzeController) analyzeController.abort();
  analyzeController = new AbortController();
  const signal = analyzeController.signal;
  const btn = document.getElementById('reAnalyzeBtn');
  btn.disabled = true;
  btn.textContent = '분석 중...';
  try {
    await fetchAnalysisStream(signal);
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '재분석';
  }
}

function exportAnalysis() { window.print(); }

// ==================== 종합 스코어 게이지 ====================
function renderSignalScore(score) {
  const section = document.getElementById('signalScoreSection');
  const valueEl = document.getElementById('signalScoreValue');
  const descEl = document.getElementById('signalScoreDesc');
  const arc = document.getElementById('scoreArc');

  if (score == null) return;
  section.classList.remove('hidden');

  const arcLen = (score / 100) * 157;
  arc.setAttribute('stroke-dasharray', `${arcLen} 157`);

  let color;
  if (score >= 70) color = 'var(--up)';
  else if (score >= 40) color = 'var(--accent)';
  else color = 'var(--down)';
  arc.setAttribute('stroke', color);
  valueEl.style.color = color;
  valueEl.textContent = score;

  let desc;
  if (score >= 80) desc = '강력 매수 신호';
  else if (score >= 60) desc = '매수 우위';
  else if (score >= 40) desc = '중립';
  else if (score >= 20) desc = '매도 우위';
  else desc = '강력 매도 신호';
  descEl.textContent = desc;
}

// ==================== 스크린샷 ====================
async function screenshotChart() {
  const el = document.querySelector('.chart-section');
  if (!el || typeof html2canvas === 'undefined') return;
  try {
    const canvas = await html2canvas(el, { backgroundColor: null, useCORS: true });
    downloadCanvas(canvas, `chart_${currentSymbol}_${Date.now()}.png`);
    showToast('차트 캡처 완료');
  } catch {}
}

async function screenshotAnalysis() {
  const el = document.getElementById('analysisSection');
  if (!el || typeof html2canvas === 'undefined') return;
  try {
    const canvas = await html2canvas(el, { backgroundColor: null, useCORS: true });
    downloadCanvas(canvas, `analysis_${currentSymbol}_${Date.now()}.png`);
    showToast('리포트 캡처 완료');
  } catch {}
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ==================== 렌더링 ====================
function renderSummary(quote, symbol) {
  const isUp = quote.change >= 0;
  const cls = isUp ? 'up' : 'down';
  const sign = isUp ? '+' : '';
  const arrow = isUp ? '▲' : '▼';
  const range52 = (quote.fiftyTwoWeekHigh || 0) - (quote.fiftyTwoWeekLow || 0);
  const pos52 = range52 > 0 ? ((quote.price - quote.fiftyTwoWeekLow) / range52) * 100 : 50;
  const isFav = isInWatchlist(symbol);
  const marketSt = getMarketStatus(quote.exchange);
  const marketLabel = marketSt === 'open' ? '장중' : '장마감';

  document.getElementById('stockSummary').innerHTML = `
    <div class="stock-title-row">
      <div class="stock-title">${escapeHtml(quote.name)}</div>
      <button class="stock-fav-btn ${isFav ? 'active' : ''}" onclick="toggleWatchlistItem('${escapeHtml(symbol)}', '${escapeHtml(quote.name)}')">${isFav ? '★' : '☆'}</button>
    </div>
    <div class="stock-code">${escapeHtml(quote.exchange)} ${escapeHtml(symbol)} <span class="market-status ${marketSt}">${marketLabel}</span></div>
    <div class="stock-price-main ${cls}">${formatNumber(quote.price)}</div>
    <div class="stock-change-info ${cls}">
      ${sign}${formatNumber(Math.abs(quote.change))} ${arrow} ${Math.abs(quote.changePercent || 0).toFixed(2)}%
    </div>`;

  document.getElementById('rangeSection').innerHTML = `
    <div class="range-row">
      <div class="range-label-left">52주 최저<span>${formatNumber(quote.fiftyTwoWeekLow)}</span></div>
      <div class="range-track">
        <div class="range-pointer" style="left: ${Math.min(100, Math.max(0, pos52))}%"></div>
      </div>
      <div class="range-label-right">52주 최고<span>${formatNumber(quote.fiftyTwoWeekHigh)}</span></div>
    </div>`;

  document.getElementById('infoTable').innerHTML = `
    <div class="info-grid">
      <div class="info-cell"><span class="info-label">전일</span><span class="info-value">${formatNumber(quote.previousClose)}</span></div>
      <div class="info-cell"><span class="info-label">고가</span><span class="info-value up">${formatNumber(quote.dayHigh)}</span></div>
      <div class="info-cell"><span class="info-label">시가</span><span class="info-value">${formatNumber(quote.open || quote.price)}</span></div>
      <div class="info-cell"><span class="info-label">저가</span><span class="info-value down">${formatNumber(quote.dayLow)}</span></div>
      <div class="info-cell"><span class="info-label">거래량</span><span class="info-value">${quote.volume ? quote.volume.toLocaleString() + '주' : 'N/A'}</span></div>
      ${quote.marketCap ? `<div class="info-cell"><span class="info-label">시가총액</span><span class="info-value">${formatMarketCap(quote.marketCap, quote.currency)}</span></div>` : `<div class="info-cell"><span class="info-label">통화</span><span class="info-value">${quote.currency || '-'}</span></div>`}
    </div>`;
}

// ==================== 기간 수익률 ====================
function renderPeriodReturn(chartData, period) {
  const container = document.getElementById('periodReturn');
  if (!container || chartData.length < 2) { if (container) container.classList.add('hidden'); return; }
  const first = chartData[0].close;
  const last = chartData[chartData.length - 1].close;
  const ret = ((last - first) / first) * 100;
  const periodLabels = { '5d': '5일', '1mo': '1개월', '3mo': '3개월', '6mo': '6개월', '1y': '1년', '2y': '2년', '5y': '5년', '10y': '10년' };
  const label = periodLabels[period] || period;
  const sign = ret >= 0 ? '+' : '';
  const cls = ret >= 0 ? 'up' : 'down';
  container.innerHTML = `<span class="${cls}">${label} 수익률: ${sign}${ret.toFixed(2)}%</span>`;
  container.classList.remove('hidden');
}

function cleanupCharts() {
  if (resizeObserverRef) { resizeObserverRef.disconnect(); resizeObserverRef = null; }
  if (compareTimeRangeUnsubscribe) { compareTimeRangeUnsubscribe(); compareTimeRangeUnsubscribe = null; }
  if (priceChart) { priceChart.remove(); priceChart = null; }
  if (volumeChart) { volumeChart.remove(); volumeChart = null; }
  if (macdChart) { macdChart.remove(); macdChart = null; }
  if (compareChart) { compareChart.remove(); compareChart = null; }
  maSeries = {};
  bbSeries = { upper: null, lower: null };
  srLines = [];
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    text: isDark ? '#666' : '#999',
    grid: isDark ? '#1e1e30' : '#f0f0f0',
    border: isDark ? '#2a2a40' : '#e0e0e0',
  };
}

function renderChart(chartData) {
  cleanupCharts();
  const colors = getChartColors();
  const priceContainer = document.getElementById('priceChart');
  const volumeContainer = document.getElementById('volumeChart');
  const macdContainer = document.getElementById('macdChart');
  const isMobile = window.innerWidth <= 768;

  const commonLayout = { background: { color: 'transparent' }, textColor: colors.text };

  priceChart = LightweightCharts.createChart(priceContainer, {
    width: priceContainer.clientWidth, height: isMobile ? 260 : 340,
    layout: { ...commonLayout, fontSize: 11 },
    grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: colors.border, scaleMargins: { top: 0.05, bottom: 0.05 } },
    timeScale: { borderColor: colors.border, timeVisible: false, rightOffset: 2, barSpacing: isMobile ? 4 : 6 },
  });

  const candleSeries = priceChart.addCandlestickSeries({
    upColor: '#e22926', downColor: '#2679ed',
    borderDownColor: '#2679ed', borderUpColor: '#e22926',
    wickDownColor: '#2679ed', wickUpColor: '#e22926',
  });
  candleSeries.setData(chartData.map(d => ({
    time: toChartTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close,
  })));

  // 크로스헤어 툴팁 (Map으로 O(1) 조회)
  const tooltip = document.getElementById('crosshairTooltip');
  const volumeMap = new Map();
  chartData.forEach(d => {
    if (d.date) volumeMap.set(d.date.slice(0, 10), d.volume);
  });
  priceChart.subscribeCrosshairMove(param => {
    if (!param || !param.time || !param.seriesData) {
      tooltip.classList.add('hidden');
      return;
    }
    const candle = param.seriesData.get(candleSeries);
    if (!candle) { tooltip.classList.add('hidden'); return; }
    const { year, month, day } = param.time;
    const cls = candle.close >= candle.open ? 'tt-up' : 'tt-down';
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const vol = volumeMap.get(dateStr) ?? null;
    tooltip.classList.remove('hidden');
    tooltip.innerHTML = `
      <div class="tt-date">${year}.${String(month).padStart(2,'0')}.${String(day).padStart(2,'0')}</div>
      <div class="tt-ohlcv ${cls}">
        <span>시 ${formatNumber(candle.open)}</span>
        <span>고 ${formatNumber(candle.high)}</span>
        <span>저 ${formatNumber(candle.low)}</span>
        <span>종 ${formatNumber(candle.close)}</span>
        ${vol != null ? `<span>량 ${(vol/10000).toFixed(0)}만</span>` : ''}
      </div>`;
  });

  // 이동평균선
  const maConfigs = [
    { period: 5, color: '#f59e0b' }, { period: 20, color: '#3b82f6' },
    { period: 60, color: '#8b5cf6' }, { period: 120, color: '#ef4444' },
  ];
  maConfigs.forEach(({ period, color }) => {
    if (chartData.length >= period) {
      const series = priceChart.addLineSeries({
        color, lineWidth: 1, crosshairMarkerVisible: false,
        lastValueVisible: false, priceLineVisible: false, visible: maVisible[period],
      });
      series.setData(calcMAArray(chartData, period));
      maSeries[period] = series;
    }
  });

  // 볼린저밴드
  const bbData = calcBBArray(chartData, 20);
  if (bbData.length > 0) {
    bbSeries.upper = priceChart.addLineSeries({
      color: 'rgba(38,166,154,0.4)', lineWidth: 1, lineStyle: 2,
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      visible: overlayVisible.bb,
    });
    bbSeries.upper.setData(bbData.map(d => ({ time: d.time, value: d.upper })));

    bbSeries.lower = priceChart.addLineSeries({
      color: 'rgba(38,166,154,0.4)', lineWidth: 1, lineStyle: 2,
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      visible: overlayVisible.bb,
    });
    bbSeries.lower.setData(bbData.map(d => ({ time: d.time, value: d.lower })));
  }

  priceChart.timeScale().fitContent();

  // 거래량 차트
  volumeChart = LightweightCharts.createChart(volumeContainer, {
    width: volumeContainer.clientWidth, height: isMobile ? 60 : 70,
    layout: { ...commonLayout, fontSize: 10 },
    grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
    rightPriceScale: { borderColor: colors.border },
    timeScale: { visible: false },
  });

  const volumeSeries = volumeChart.addHistogramSeries({ priceFormat: { type: 'volume' } });
  volumeSeries.setData(chartData.map(d => ({
    time: toChartTime(d.date), value: d.volume,
    color: d.close >= d.open ? 'rgba(226,41,38,0.25)' : 'rgba(38,121,237,0.25)',
  })));
  volumeChart.timeScale().fitContent();

  // MACD
  const macdData = calcMACDArray(chartData);
  if (macdData.length > 0) {
    macdChart = LightweightCharts.createChart(macdContainer, {
      width: macdContainer.clientWidth, height: isMobile ? 80 : 90,
      layout: { ...commonLayout, fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { visible: false },
    });

    const histSeries = macdChart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    histSeries.setData(macdData.map(d => ({
      time: d.time, value: d.histogram,
      color: d.histogram >= 0 ? 'rgba(226,41,38,0.4)' : 'rgba(38,121,237,0.4)',
    })));

    const macdLine = macdChart.addLineSeries({
      color: '#2196F3', lineWidth: 1,
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
    });
    macdLine.setData(macdData.map(d => ({ time: d.time, value: d.macd })));

    const signalLine = macdChart.addLineSeries({
      color: '#FF9800', lineWidth: 1,
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
    });
    signalLine.setData(macdData.map(d => ({ time: d.time, value: d.signal })));

    macdChart.timeScale().fitContent();
  }

  // 차트 동기화
  priceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (!range) return;
    volumeChart.timeScale().setVisibleLogicalRange(range);
    if (macdChart) macdChart.timeScale().setVisibleLogicalRange(range);
  });

  // 리사이즈
  resizeObserverRef = new ResizeObserver(() => {
    if (priceChart) priceChart.applyOptions({ width: priceContainer.clientWidth });
    if (volumeChart) volumeChart.applyOptions({ width: volumeContainer.clientWidth });
    if (macdChart) macdChart.applyOptions({ width: macdContainer.clientWidth });
    if (compareChart) {
      const cc = document.getElementById('compareChart');
      if (cc) compareChart.applyOptions({ width: cc.clientWidth });
    }
  });
  resizeObserverRef.observe(priceContainer);

  if (currentIndicators) renderSRLines(currentIndicators);
}

function renderSRLines(indicators) {
  if (!priceChart || !currentChartData.length) return;
  srLines.forEach(line => { try { priceChart.removeSeries(line); } catch {} });
  srLines = [];

  const firstTime = toChartTime(currentChartData[0].date);
  const lastTime = toChartTime(currentChartData[currentChartData.length - 1].date);

  (indicators.지지선 || []).forEach(price => {
    const line = priceChart.addLineSeries({
      color: '#4CAF50', lineWidth: 1, lineStyle: 2,
      crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false,
      visible: overlayVisible.sr,
    });
    line.setData([{ time: firstTime, value: price }, { time: lastTime, value: price }]);
    srLines.push(line);
  });

  (indicators.저항선 || []).forEach(price => {
    const line = priceChart.addLineSeries({
      color: '#f44336', lineWidth: 1, lineStyle: 2,
      crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false,
      visible: overlayVisible.sr,
    });
    line.setData([{ time: firstTime, value: price }, { time: lastTime, value: price }]);
    srLines.push(line);
  });
}

// ==================== 지표 설명 팝업 ====================
const INDICATOR_EXPLANATIONS = {
  'RSI (14)': {
    title: 'RSI (상대강도지수)',
    body: '<strong>RSI</strong>는 14일간의 가격 변동 강도를 0~100으로 나타냅니다.<br><br><strong>70 이상</strong>: 과매수 구간<br><strong>30 이하</strong>: 과매도 구간<br><strong>50 부근</strong>: 중립'
  },
  'MACD': {
    title: 'MACD (이동평균수렴확산)',
    body: '<strong>MACD</strong>는 12일 EMA와 26일 EMA의 차이입니다.<br><br><strong>MACD > Signal</strong>: 상승 모멘텀<br><strong>MACD < Signal</strong>: 하락 모멘텀<br><strong>히스토그램</strong>: 두 선의 차이'
  },
  '스토캐스틱': {
    title: '스토캐스틱 오실레이터',
    body: '<strong>%K</strong>는 현재가가 최근 14일 범위에서 어느 위치인지를 나타냅니다.<br><br><strong>80 이상</strong>: 과매수<br><strong>20 이하</strong>: 과매도'
  },
  '이평선 배열': {
    title: '이동평균선 배열',
    body: '<strong>정배열</strong>: MA5 > MA20 > MA60 — 강세장<br><strong>역배열</strong>: MA5 < MA20 < MA60 — 약세장<br><strong>혼조</strong>: 추세 전환 가능성'
  },
  '볼린저': {
    title: '볼린저 밴드',
    body: '20일 이동평균 ± 2표준편차.<br><br><strong>상단 이탈</strong>: 과매수 가능성<br><strong>하단 이탈</strong>: 과매도 / 반등 기대<br><strong>폭 축소</strong>: 변동성 확대 예고'
  },
  '거래량': {
    title: '거래량 비율',
    body: '최근 거래량 / 20일 평균 거래량.<br><br><strong>2x 이상</strong>: 급증 (관심 폭발)<br><strong>0.5x 미만</strong>: 부진 (관심 저조)'
  },
};

function showIndicatorPopup(label) {
  const info = INDICATOR_EXPLANATIONS[label];
  if (!info) return;
  document.getElementById('popupTitle').textContent = info.title;
  document.getElementById('popupBody').innerHTML = info.body;
  document.getElementById('indicatorPopup').classList.remove('hidden');
}

function closeIndicatorPopup() {
  document.getElementById('indicatorPopup').classList.add('hidden');
}

document.getElementById('indicatorPopup').addEventListener('click', (e) => {
  if (e.target.id === 'indicatorPopup') closeIndicatorPopup();
});

function renderIndicators(indicators) {
  const grid = document.getElementById('indicatorsGrid');
  const items = [
    { label: 'RSI (14)', value: indicators.RSI,
      cls: indicators.RSI > 70 ? 'bearish' : indicators.RSI < 30 ? 'bullish' : 'neutral',
      desc: indicators.RSI > 70 ? '과매수' : indicators.RSI < 30 ? '과매도' : '중립' },
    { label: 'MACD', value: indicators.MACD,
      cls: indicators.MACD_Histogram > 0 ? 'bullish' : 'bearish',
      desc: `신호: ${indicators.MACD_Signal}` },
    { label: '스토캐스틱', value: `${indicators.Stochastic_K}`,
      cls: indicators.Stochastic_K > 80 ? 'bearish' : indicators.Stochastic_K < 20 ? 'bullish' : 'neutral',
      desc: indicators.Stochastic_K > 80 ? '과매수' : indicators.Stochastic_K < 20 ? '과매도' : '중립' },
    { label: '이평선 배열', value: getMAAlignment(indicators),
      cls: getMAAlignmentClass(indicators), desc: getMAAlignmentDesc(indicators) },
    { label: 'MA5', value: formatNumber(indicators.MA5),
      cls: indicators.현재가 > indicators.MA5 ? 'bullish' : 'bearish',
      desc: indicators.현재가 > indicators.MA5 ? '상승' : '하락' },
    { label: 'MA20', value: formatNumber(indicators.MA20),
      cls: indicators.현재가 > indicators.MA20 ? 'bullish' : 'bearish',
      desc: indicators.현재가 > indicators.MA20 ? '상승' : '하락' },
    { label: '볼린저', value: `${indicators.BB_Width}%`,
      cls: indicators.현재가 > indicators.BB_Upper ? 'bearish' : indicators.현재가 < indicators.BB_Lower ? 'bullish' : 'neutral',
      desc: indicators.현재가 > indicators.BB_Upper ? '과열' : indicators.현재가 < indicators.BB_Lower ? '반등 기대' : '밴드 내' },
    { label: '거래량', value: `${indicators.거래량비율}x`,
      cls: indicators.거래량비율 > 2 ? 'bullish' : indicators.거래량비율 < 0.5 ? 'bearish' : 'neutral',
      desc: indicators.거래량비율 > 2 ? '급증' : indicators.거래량비율 < 0.5 ? '부진' : '보통' },
  ];

  grid.innerHTML = items.map(item => {
    const hasPopup = INDICATOR_EXPLANATIONS[item.label] ? `onclick="showIndicatorPopup('${item.label}')"` : '';
    return `<div class="indicator-card" ${hasPopup}>
      <div class="indicator-label">${item.label}</div>
      <div class="indicator-value ${item.cls}">${item.value}</div>
      <div class="indicator-desc">${item.desc}</div>
    </div>`;
  }).join('');
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

// ==================== 유틸리티 ====================
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
    if (i >= period - 1) result.push({ time: toChartTime(data[i].date), value: sum / period });
  }
  return result;
}

function calcBBArray(data, period) {
  if (data.length < period) return [];
  const result = [];
  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i].close;
    sum += c; sumSq += c * c;
    if (i >= period) { const old = data[i - period].close; sum -= old; sumSq -= old * old; }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      const std = Math.sqrt(Math.abs(variance));
      result.push({ time: toChartTime(data[i].date), upper: mean + 2 * std, lower: mean - 2 * std });
    }
  }
  return result;
}

function calcMACDArray(data) {
  if (data.length < 26) return [];
  const closes = data.map(d => d.close);
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let ema12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 12; i < 26; i++) ema12 = closes[i] * k12 + ema12 * (1 - k12);

  const macdValues = [];
  let signal = ema12 - ema26;
  let initCnt = 0, initSum = 0;

  for (let i = 26; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12);
    ema26 = closes[i] * k26 + ema26 * (1 - k26);
    const macdVal = ema12 - ema26;
    if (initCnt < 9) { initSum += macdVal; initCnt++; if (initCnt === 9) signal = initSum / 9; }
    else signal = macdVal * k9 + signal * (1 - k9);

    macdValues.push({
      time: toChartTime(data[i].date),
      macd: macdVal,
      signal: signal,
      histogram: macdVal - signal,
    });
  }
  return macdValues;
}

function getTimeStr() {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
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

function showChartLoading(on) {
  const container = document.querySelector('.chart-section');
  if (!container) return;
  container.classList.toggle('chart-loading', on);
}

function showError(msg) {
  const el = document.getElementById('error');
  const textEl = document.getElementById('errorText');
  const messages = {
    'AI_TIMEOUT': 'AI 분석 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
    'API_QUOTA': 'API 할당량을 초과했습니다. 잠시 후 다시 시도해주세요.',
    'Failed to fetch': '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.',
  };
  textEl.textContent = messages[msg] || msg;
  el.classList.remove('hidden');
}
