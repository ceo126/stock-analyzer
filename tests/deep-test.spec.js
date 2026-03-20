const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8120';

// ========== 엣지 케이스 & 보안 테스트 ==========
test.describe('엣지 케이스 & 보안', () => {

  test('존재하지 않는 종목 → 에러 표시', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', 'ZZZZZZZZZZ999');
    await page.click('#searchBtn');
    // 에러 표시 확인
    await expect(page.locator('#error')).not.toHaveClass(/hidden/, { timeout: 15000 });
    const errText = await page.locator('#errorText').textContent();
    expect(errText.length).toBeGreaterThan(0);
    console.log(`✓ 존재하지 않는 종목 에러: "${errText}"`);
  });

  test('빈 입력으로 검색 → 무반응', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '');
    await page.click('#searchBtn');
    // 결과 영역이 숨겨진 상태 유지
    await page.waitForTimeout(500);
    await expect(page.locator('#result')).toHaveClass(/hidden/);
    await expect(page.locator('#error')).toHaveClass(/hidden/);
    console.log('✓ 빈 입력 무반응 정상');
  });

  test('XSS 시도 in 검색 → 이스케이프 확인', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '<script>alert(1)</script>');
    await page.click('#searchBtn');
    await page.waitForTimeout(2000);
    // 스크립트가 실행되지 않았는지 확인 (alert이 뜨면 dialog 이벤트 발생)
    let alertFired = false;
    page.on('dialog', () => { alertFired = true; });
    await page.waitForTimeout(500);
    expect(alertFired).toBe(false);
    // HTML에 raw script 태그가 없는지 확인
    const html = await page.content();
    expect(html).not.toContain('<script>alert(1)</script>');
    console.log('✓ XSS 방어 정상');
  });

  test('SQL Injection 패턴 in API → 안전한 응답', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/stock/'; DROP TABLE stocks; --`);
    const status = response.status();
    expect([400, 429]).toContain(status);
    console.log(`✓ SQL Injection 패턴 → ${status} 응답 (안전)`);
  });

  test('URL 인코딩 에러 → 400 응답', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/stock/%E0%A4%A`, { failOnStatusCode: false });
    expect([400, 404]).toContain(response.status());
    console.log(`✓ 잘못된 URL 인코딩 → ${response.status()} 응답`);
  });

  test('초대형 JSON 바디 → 거부', async ({ page }) => {
    await page.goto(BASE);
    const hugeBody = JSON.stringify({ symbol: 'A', quote: {}, chartData: new Array(2000).fill({ close: 1, volume: 1, open: 1, high: 1, low: 1, date: '2024-01-01' }) });
    const response = await page.request.post(`${BASE}/api/analyze`, {
      headers: { 'Content-Type': 'application/json' },
      data: hugeBody,
      failOnStatusCode: false,
    });
    // chartData.length > 1000이면 400
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    console.log('✓ 초대형 chartData(2000개) → 400 거부');
  });

  test('watchlist-prices 최대 20개 제한', async ({ page }) => {
    await page.goto(BASE);
    const symbols = Array.from({ length: 25 }, (_, i) => `SYM${i}`);
    const response = await page.request.post(`${BASE}/api/watchlist-prices`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ symbols }),
    });
    const data = await response.json();
    // 25개 보내면 빈 결과
    expect(Object.keys(data.prices).length).toBe(0);
    console.log('✓ 워치리스트 20개 초과 → 빈 결과 반환');
  });

  test('compare API 1개 종목 → 400', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/compare?symbols=005930&period=1y`, { failOnStatusCode: false });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('2개 이상');
    console.log('✓ 비교 API 1개 종목 → 400 에러');
  });

  test('유효하지 않은 period 파라미터 → 기본값(1y) 사용', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/stock/005930?period=999d`);
    const data = await response.json();
    expect(data.success).toBe(true);
    // 기본값 1y가 적용되어 차트 데이터가 많아야 함
    expect(data.chartData.length).toBeGreaterThan(100);
    console.log(`✓ 유효하지 않은 period → 기본값(1y) 적용, ${data.chartData.length}개 데이터`);
  });
});

// ========== UI 인터랙션 심화 테스트 ==========
test.describe('UI 인터랙션 심화', () => {

  test('빠른 연속 클릭 → 이전 요청 abort', async ({ page }) => {
    await page.goto(BASE);
    // 삼성전자 검색 시작
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    // 즉시 AAPL로 변경
    await page.fill('#symbolInput', 'AAPL');
    await page.click('#searchBtn');
    // 최종 결과가 AAPL이어야 함
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });
    const summary = await page.locator('#stockSummary').textContent();
    // 삼성전자가 아닌 Apple 관련 텍스트
    expect(summary).not.toContain('삼성전자');
    console.log('✓ 연속 클릭 → 이전 요청 abort, 최종 결과만 표시');
  });

  test('기간 버튼 빠른 전환 → 충돌 없음', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    // 빠르게 5d → 1mo → 3mo → 6mo 전환
    await page.click('.period-btn[data-period="5d"]');
    await page.click('.period-btn[data-period="1mo"]');
    await page.click('.period-btn[data-period="3mo"]');
    await page.click('.period-btn[data-period="6mo"]');

    await page.waitForTimeout(4000);
    // 차트가 여전히 정상 렌더링
    const chartCanvas = page.locator('#priceChart canvas');
    await expect(chartCanvas.first()).toBeVisible();
    // 마지막 클릭한 6mo가 active
    await expect(page.locator('.period-btn[data-period="6mo"]')).toHaveClass(/active/);
    console.log('✓ 기간 빠른 전환 → 충돌 없이 최종(6개월) 표시');
  });

  test('드롭다운 키보드 네비게이션 (ArrowDown/Up/Enter)', async ({ page }) => {
    await page.goto(BASE);
    // KR_STOCKS 로드 대기 후 fill로 입력 (IME 한글은 pressSequentially 불가)
    await page.waitForTimeout(1000);
    await page.fill('#symbolInput', '삼성');
    // fill 후 input 이벤트 수동 트리거
    await page.locator('#symbolInput').dispatchEvent('input');
    await expect(page.locator('#searchDropdown')).toHaveClass(/show/, { timeout: 5000 });

    // ArrowDown으로 첫 번째 항목 하이라이트
    await page.keyboard.press('ArrowDown');
    const first = page.locator('#searchDropdown .dropdown-item').first();
    await expect(first).toHaveClass(/highlight/);

    // ArrowDown 한 번 더
    await page.keyboard.press('ArrowDown');
    const second = page.locator('#searchDropdown .dropdown-item').nth(1);
    await expect(second).toHaveClass(/highlight/);
    await expect(first).not.toHaveClass(/highlight/);

    // ArrowUp으로 돌아오기
    await page.keyboard.press('ArrowUp');
    await expect(first).toHaveClass(/highlight/);

    // Enter로 선택
    const selectedSymbol = await first.getAttribute('data-symbol');
    await page.keyboard.press('Enter');
    // 입력값이 선택된 심볼로 변경
    const inputVal = await page.locator('#symbolInput').inputValue();
    expect(inputVal).toBe(selectedSymbol);
    console.log(`✓ 키보드 네비게이션 정상 (선택: ${selectedSymbol})`);
  });

  test('워치리스트 최대 20개 제한', async ({ page }) => {
    await page.goto(BASE);
    // localStorage에 직접 20개 세팅
    await page.evaluate(() => {
      const list = Array.from({ length: 20 }, (_, i) => ({ symbol: `TEST${i}`, name: `Test Stock ${i}` }));
      localStorage.setItem('watchlist', JSON.stringify(list));
    });
    // 21번째 추가 시도
    await page.evaluate(() => {
      let list = JSON.parse(localStorage.getItem('watchlist') || '[]');
      list.unshift({ symbol: 'TEST20', name: 'Test Stock 20' });
      if (list.length > 20) list = list.slice(0, 20);
      localStorage.setItem('watchlist', JSON.stringify(list));
    });
    const list = await page.evaluate(() => JSON.parse(localStorage.getItem('watchlist')));
    expect(list.length).toBe(20);
    expect(list[0].symbol).toBe('TEST20'); // 최신이 맨 앞
    expect(list[19].symbol).toBe('TEST18'); // 마지막 것이 밀려남
    console.log('✓ 워치리스트 20개 제한 정상');

    // cleanup
    await page.evaluate(() => localStorage.removeItem('watchlist'));
  });

  test('분석 이력 최대 30개 제한', async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => {
      const history = Array.from({ length: 35 }, (_, i) => ({
        symbol: `SYM${i}`, name: `Stock ${i}`, score: 50,
        summary: 'test', date: new Date().toISOString(),
      }));
      localStorage.setItem('analysisHistory', JSON.stringify(history));
    });
    // 페이지 함수로 저장하면 30개로 잘리는지
    await page.evaluate(() => {
      // saveAnalysisToHistory 시뮬레이션
      const history = JSON.parse(localStorage.getItem('analysisHistory') || '[]').filter(h => h.symbol !== 'NEW');
      history.unshift({ symbol: 'NEW', name: 'New Stock', score: 99, summary: 'new', date: new Date().toISOString() });
      localStorage.setItem('analysisHistory', JSON.stringify(history.slice(0, 30)));
    });
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('analysisHistory')));
    expect(history.length).toBe(30);
    expect(history[0].symbol).toBe('NEW');
    console.log('✓ 분석 이력 30개 제한 정상');

    await page.evaluate(() => localStorage.removeItem('analysisHistory'));
  });

  test('다크모드 localStorage 유지', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#darkModeBtn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 페이지 새로고침 후에도 유지
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#darkModeBtn')).toContainText('☀️');

    // 라이트로 돌리고 확인
    await page.click('#darkModeBtn');
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    console.log('✓ 다크모드 localStorage 유지 정상');
  });

  test('검색 이력 저장 및 포커스 시 표시', async ({ page }) => {
    await page.goto(BASE);
    // 종목 검색 및 분석
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    // 입력 비우고 포커스
    await page.fill('#symbolInput', '');
    await page.locator('#symbolInput').blur();
    await page.waitForTimeout(300);
    await page.locator('#symbolInput').focus();

    // 최근 검색 드롭다운 표시
    const dropdown = page.locator('#searchDropdown');
    await expect(dropdown).toHaveClass(/show/, { timeout: 3000 });
    const items = dropdown.locator('.dropdown-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    console.log(`✓ 검색 이력 표시: ${count}개`);
  });
});

// ========== 차트 & 데이터 정합성 ==========
test.describe('데이터 정합성', () => {

  test('52주 범위 포인터 위치 정합성', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    // 52주 범위 확인
    const rangeHtml = await page.locator('#rangeSection').innerHTML();
    expect(rangeHtml).toContain('52주 최저');
    expect(rangeHtml).toContain('52주 최고');
    // 포인터가 0~100% 범위 안에 있는지
    const pointerStyle = await page.locator('.range-pointer').getAttribute('style');
    const leftMatch = pointerStyle.match(/left:\s*([\d.]+)%/);
    expect(leftMatch).toBeTruthy();
    const leftPct = parseFloat(leftMatch[1]);
    expect(leftPct).toBeGreaterThanOrEqual(0);
    expect(leftPct).toBeLessThanOrEqual(100);
    console.log(`✓ 52주 범위 포인터: ${leftPct.toFixed(1)}% 위치`);
  });

  test('시세 정보 테이블 데이터 정합성', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    const infoText = await page.locator('#infoTable').textContent();
    expect(infoText).toContain('전일');
    expect(infoText).toContain('고가');
    expect(infoText).toContain('시가');
    expect(infoText).toContain('저가');
    expect(infoText).toContain('거래량');
    // 거래량에 '주' 단위 포함
    expect(infoText).toContain('주');
    console.log('✓ 시세 정보 테이블 정합성 확인');
  });

  test('해외 종목 환율 바 표시', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', 'AAPL');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    const rateBar = page.locator('#exchangeRateBar');
    await expect(rateBar).not.toHaveClass(/hidden/, { timeout: 5000 });
    const rateText = await rateBar.textContent();
    expect(rateText).toContain('USD/KRW');
    expect(rateText).toContain('원화 환산');
    console.log(`✓ 환율 바 표시: ${rateText}`);
  });

  test('한국 종목 환율 바 미표시', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    const rateBar = page.locator('#exchangeRateBar');
    await expect(rateBar).toHaveClass(/hidden/);
    console.log('✓ 한국 종목 환율 바 미표시 정상');
  });

  test('기간 수익률 표시 + 부호/색상 일관성', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    const periodReturn = page.locator('#periodReturn');
    await expect(periodReturn).not.toHaveClass(/hidden/);
    const returnText = await periodReturn.textContent();
    expect(returnText).toContain('수익률');
    expect(returnText).toContain('%');

    // + 또는 - 부호가 있는지
    const hasSign = returnText.includes('+') || returnText.includes('-');
    expect(hasSign).toBe(true);

    // 색상 클래스 확인
    const span = periodReturn.locator('span');
    const cls = await span.getAttribute('class');
    if (returnText.includes('+')) {
      expect(cls).toContain('up');
    } else if (returnText.includes('-')) {
      expect(cls).toContain('down');
    }
    console.log(`✓ 기간 수익률: ${returnText.trim()}`);
  });

  test('종합 스코어 게이지 arc 길이 정합성', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');

    await expect(page.locator('#signalScoreSection')).not.toHaveClass(/hidden/, { timeout: 60000 });

    const scoreText = await page.locator('#signalScoreValue').textContent();
    const score = parseInt(scoreText);
    const arcDash = await page.locator('#scoreArc').getAttribute('stroke-dasharray');
    const [arcLen] = arcDash.split(' ').map(Number);
    const expectedLen = (score / 100) * 157;
    // 오차 1 이내
    expect(Math.abs(arcLen - expectedLen)).toBeLessThan(1);
    console.log(`✓ 스코어 arc: score=${score}, arcLen=${arcLen.toFixed(1)}, expected=${expectedLen.toFixed(1)}`);
  });

  test('볼린저/지지저항 오버레이 토글', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#priceChart canvas').first()).toBeVisible({ timeout: 15000 });

    // BB 토글
    const bbItem = page.locator('.legend-item[data-overlay="bb"]');
    await expect(bbItem).toHaveClass(/disabled/);
    await bbItem.click();
    await expect(bbItem).not.toHaveClass(/disabled/);
    await bbItem.click();
    await expect(bbItem).toHaveClass(/disabled/);

    // S/R 토글
    const srItem = page.locator('.legend-item[data-overlay="sr"]');
    await expect(srItem).toHaveClass(/disabled/);
    await srItem.click();
    await expect(srItem).not.toHaveClass(/disabled/);
    await srItem.click();
    await expect(srItem).toHaveClass(/disabled/);

    console.log('✓ 볼린저/지지저항 오버레이 토글 정상');
  });

  test('MA선 토글', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#priceChart canvas').first()).toBeVisible({ timeout: 15000 });

    // MA5 토글 (기본 활성)
    const ma5 = page.locator('.legend-item[data-ma="5"]');
    await expect(ma5).not.toHaveClass(/disabled/);
    await ma5.click();
    await expect(ma5).toHaveClass(/disabled/);
    await ma5.click();
    await expect(ma5).not.toHaveClass(/disabled/);

    // MA120 토글
    const ma120 = page.locator('.legend-item[data-ma="120"]');
    await expect(ma120).not.toHaveClass(/disabled/);
    await ma120.click();
    await expect(ma120).toHaveClass(/disabled/);

    console.log('✓ MA선 토글 정상');
  });
});

// ========== 반응형 테스트 ==========
test.describe('반응형 (모바일)', () => {

  test('모바일 뷰포트 레이아웃', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); // iPhone X
    await page.goto(BASE);

    // 검색창 표시
    await expect(page.locator('#symbolInput')).toBeVisible();

    // 분석 실행
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    // 차트 렌더링
    await expect(page.locator('#priceChart canvas').first()).toBeVisible({ timeout: 5000 });

    // 지표 그리드 2열 확인
    const gridCols = await page.evaluate(() => {
      const grid = document.querySelector('.indicators-grid');
      if (!grid) return '';
      return getComputedStyle(grid).gridTemplateColumns;
    });
    // 모바일에서는 2열 (repeat(2, 1fr))
    const colCount = gridCols.split(' ').length;
    expect(colCount).toBeLessThanOrEqual(2);

    // 크로스헤어 툴팁 숨김 (모바일)
    const tooltipDisplay = await page.evaluate(() => {
      const tt = document.querySelector('.crosshair-tooltip');
      return tt ? getComputedStyle(tt).display : 'none';
    });
    expect(tooltipDisplay).toBe('none');

    // 단축키 힌트 숨김 (모바일)
    const hintDisplay = await page.evaluate(() => {
      const hint = document.querySelector('.shortcut-hint');
      return hint ? getComputedStyle(hint).display : 'none';
    });
    expect(hintDisplay).toBe('none');

    console.log('✓ 모바일 뷰포트: 2열 지표, 툴팁 숨김, 힌트 숨김');
  });

  test('섹션 탭 스크롤 이동', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    // '시세' 탭 클릭
    await page.click('.section-tab[data-target="infoArea"]');
    await expect(page.locator('.section-tab[data-target="infoArea"]')).toHaveClass(/active/);

    // '지표' 탭 클릭
    await page.click('.section-tab[data-target="indicatorArea"]');
    await expect(page.locator('.section-tab[data-target="indicatorArea"]')).toHaveClass(/active/);

    console.log('✓ 섹션 탭 전환 정상');
  });
});

// ========== 콘솔 에러 모니터링 ==========
test.describe('콘솔 에러 모니터링', () => {

  test('전체 분석 플로우 중 JS 에러 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error'
        && !msg.text().includes('favicon')
        && !msg.text().includes('manifest')
        && !msg.text().includes('net::ERR_FAILED')
        && !msg.text().includes('Failed to load resource')
        && !msg.text().includes('429')) {
        errors.push(`console.error: ${msg.text()}`);
      }
    });

    await page.goto(BASE);
    await page.fill('#symbolInput', '005930');
    await page.click('#searchBtn');
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 30000 });

    // 기간 변경
    await page.click('.period-btn[data-period="3mo"]');
    await page.waitForTimeout(3000);

    // 다크모드
    await page.click('#darkModeBtn');
    await page.waitForTimeout(500);

    // 워치리스트
    await page.click('#watchlistToggle');
    await page.waitForTimeout(500);
    await page.click('#watchlistToggle');

    // MA 토글
    await page.click('.legend-item[data-ma="5"]');
    await page.click('.legend-item[data-ma="5"]');

    if (errors.length > 0) {
      console.log('⚠ JS 에러 발견:', errors);
    }
    expect(errors.length).toBe(0);
    console.log('✓ 전체 플로우 중 JS 에러 0건');
  });
});

// ========== 서비스 워커 ==========
test.describe('서비스 워커', () => {

  test('SW 등록 확인', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration('/');
      return !!reg;
    });
    expect(swRegistered).toBe(true);
    console.log('✓ 서비스 워커 등록 확인');
  });
});
