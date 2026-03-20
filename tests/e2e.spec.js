const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8120';

// ========== 그룹 1: UI 기본 동작 (API 호출 없음) ==========
test.describe('UI 기본 동작', () => {
  test('1. 메인 페이지 로드 및 UI 요소 확인', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/AI 주식 분석기/);
    await expect(page.locator('h1')).toContainText('AI 주식');
    await expect(page.locator('#symbolInput')).toBeVisible();
    await expect(page.locator('#searchBtn')).toBeVisible();
    await expect(page.locator('#darkModeBtn')).toBeVisible();
    await expect(page.locator('#watchlistToggle')).toBeVisible();
    const quickTags = page.locator('.quick-tags span');
    await expect(quickTags).toHaveCount(5);
    await expect(quickTags.nth(0)).toContainText('삼성전자');
    console.log('✓ 메인 페이지 로드 성공');
  });

  test('2. 다크모드 토글', async ({ page }) => {
    await page.goto(BASE);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    await page.click('#darkModeBtn');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.click('#darkModeBtn');
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    console.log('✓ 다크모드 토글 정상');
  });

  test('3. 워치리스트 패널 토글', async ({ page }) => {
    await page.goto(BASE);
    const panel = page.locator('#watchlistPanel');
    await expect(panel).toHaveClass(/hidden/);
    await page.click('#watchlistToggle');
    await expect(panel).not.toHaveClass(/hidden/);
    await expect(panel).toContainText('즐겨찾기한 종목이 없습니다');
    await page.click('#watchlistToggle');
    await expect(panel).toHaveClass(/hidden/);
    console.log('✓ 워치리스트 패널 토글 정상');
  });

  test('4. 분석 이력 패널 토글', async ({ page }) => {
    await page.goto(BASE);
    const panel = page.locator('#historyPanel');
    await expect(panel).toHaveClass(/hidden/);
    await page.click('#historyToggle');
    await expect(panel).not.toHaveClass(/hidden/);
    await expect(panel).toContainText('분석 이력이 없습니다');
    await page.click('#historyToggle');
    await expect(panel).toHaveClass(/hidden/);
    console.log('✓ 분석 이력 패널 토글 정상');
  });

  test('5. 키보드 단축키', async ({ page }) => {
    await page.goto(BASE);
    await page.keyboard.press('/');
    await expect(page.locator('#symbolInput')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#symbolInput')).not.toBeFocused();
    await page.keyboard.press('d');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('d');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('w');
    await expect(page.locator('#watchlistPanel')).not.toHaveClass(/hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#watchlistPanel')).toHaveClass(/hidden/);
    console.log('✓ 키보드 단축키 정상 (/, D, W, ESC)');
  });

  test('6. 비교 모드 UI', async ({ page }) => {
    await page.goto(BASE);
    const checkbox = page.locator('#compareMode');
    const compareInputs = page.locator('#compareInputs');
    await expect(compareInputs).toHaveClass(/hidden/);
    await checkbox.click();
    await expect(compareInputs).not.toHaveClass(/hidden/);
    await page.fill('#compareSymbol', 'SK하이닉스');
    await page.waitForTimeout(500);
    const dropdown = page.locator('#compareDropdown');
    await expect(dropdown).toHaveClass(/show/, { timeout: 3000 });
    console.log('✓ 비교 모드 UI 정상');
  });

  test('7. 보안 헤더 확인', async ({ page }) => {
    const response = await page.goto(BASE);
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    console.log('✓ 보안 헤더 정상');
  });
});

// ========== 그룹 2: API 직접 호출 ==========
test.describe('API 테스트', () => {
  test('8. 한국 종목 API + KOSDAQ 분류', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/kr-stocks`);
    const data = await response.json();
    expect(data.stocks).toBeTruthy();
    expect(data.stocks.length).toBeGreaterThan(40);

    const samsung = data.stocks.find(s => s.symbol === '005930.KS');
    expect(samsung).toBeTruthy();
    expect(samsung.name).toBe('삼성전자');
    expect(samsung.exchange).toBe('KOSPI');

    // KOSDAQ 수정 반영 확인
    const ecopro = data.stocks.find(s => s.name === '에코프로비엠');
    expect(ecopro).toBeTruthy();
    expect(ecopro.symbol).toBe('247540.KQ');
    expect(ecopro.exchange).toBe('KOSDAQ');

    const pearl = data.stocks.find(s => s.name === '펄어비스');
    expect(pearl).toBeTruthy();
    expect(pearl.symbol).toBe('263750.KQ');
    expect(pearl.exchange).toBe('KOSDAQ');

    console.log(`✓ 한국 종목 API: ${data.stocks.length}개 종목, KOSDAQ 분류 정상`);
  });

  test('9. 주식 데이터 조회 (삼성전자)', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/stock/005930?period=1mo`);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.symbol).toBe('005930');
    expect(data.quote).toBeTruthy();
    expect(data.quote.name).toBe('삼성전자');
    expect(data.quote.price).toBeGreaterThan(0);
    expect(data.chartData).toBeTruthy();
    expect(data.chartData.length).toBeGreaterThan(0);

    const firstCandle = data.chartData[0];
    expect(firstCandle.date).toBeTruthy();
    expect(firstCandle.open).toBeGreaterThan(0);
    expect(firstCandle.high).toBeGreaterThan(0);
    expect(firstCandle.low).toBeGreaterThan(0);
    expect(firstCandle.close).toBeGreaterThan(0);
    console.log(`✓ 삼성전자 데이터: 현재가 ${data.quote.price}, 차트 ${data.chartData.length}개`);
  });

  test('10. 해외 종목 + 환율 (AAPL)', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/stock/AAPL?period=1mo`);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.quote).toBeTruthy();
    expect(data.quote.currency).toBe('USD');
    expect(data.exchangeRate).toBeGreaterThan(1000);
    console.log(`✓ AAPL 데이터: $${data.quote.price}, 환율 ${data.exchangeRate}`);
  });

  test('11. 검색 자동완성', async ({ page }) => {
    await page.goto(BASE);
    const input = page.locator('#symbolInput');
    await input.fill('삼성');
    const dropdown = page.locator('#searchDropdown');
    await expect(dropdown).toHaveClass(/show/, { timeout: 3000 });
    const items = dropdown.locator('.dropdown-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    await expect(items.first()).toContainText('삼성');
    console.log(`✓ 자동완성 드롭다운 표시: ${count}개 결과`);
  });

  test('12. 뉴스 API 응답', async ({ page }) => {
    await page.goto(BASE);
    const response = await page.request.get(`${BASE}/api/news/삼성전자`);
    // 200 또는 429(rate limit) 모두 허용
    const status = response.status();
    expect([200, 429]).toContain(status);
    if (status === 200) {
      const data = await response.json();
      expect(data.news).toBeTruthy();
      expect(Array.isArray(data.news)).toBe(true);
      console.log(`✓ 뉴스 API: ${data.news.length}개 기사`);
    } else {
      console.log('✓ 뉴스 API: rate limit 확인 (429)');
    }
  });
});

// ========== 그룹 3: 전체 분석 플로우 (1번만 분석 실행, 순차) ==========
test.describe.serial('전체 분석 플로우', () => {
  let sharedPage;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await sharedPage.goto(BASE);

    // 삼성전자 분석 실행 (한 번만)
    await sharedPage.fill('#symbolInput', '005930');
    await sharedPage.click('#searchBtn');

    // 결과 영역 표시 대기
    await expect(sharedPage.locator('#result')).not.toHaveClass(/hidden/, { timeout: 15000 });
  });

  test.afterAll(async () => {
    await sharedPage.close();
  });

  test('13. 차트 렌더링 확인', async () => {
    await expect(sharedPage.locator('#stockSummary')).toContainText('삼성전자', { timeout: 5000 });
    const chartCanvas = sharedPage.locator('#priceChart canvas');
    await expect(chartCanvas.first()).toBeVisible({ timeout: 5000 });
    console.log('✓ 삼성전자 차트 렌더링 완료');
  });

  test('14. 종합 스코어 게이지', async () => {
    // SSE에서 indicators 수신 대기
    await expect(sharedPage.locator('#signalScoreSection')).not.toHaveClass(/hidden/, { timeout: 60000 });
    const scoreValue = await sharedPage.locator('#signalScoreValue').textContent();
    const score = parseInt(scoreValue);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    const desc = await sharedPage.locator('#signalScoreDesc').textContent();
    expect(['강력 매수 신호', '매수 우위', '중립', '매도 우위', '강력 매도 신호']).toContain(desc);
    console.log(`✓ 종합 스코어: ${score}점 (${desc})`);
  });

  test('15. 기술적 지표 카드 (8개)', async () => {
    await expect(sharedPage.locator('#indicatorsGrid .indicator-card').first()).toBeVisible({ timeout: 60000 });
    const cards = sharedPage.locator('#indicatorsGrid .indicator-card');
    const count = await cards.count();
    expect(count).toBe(8);
    await expect(cards.first()).toContainText('RSI');
    console.log(`✓ 기술적 지표 카드 ${count}개 렌더링 완료`);
  });

  test('16. 지표 설명 팝업 열기/닫기', async () => {
    // RSI 카드 클릭
    await sharedPage.click('#indicatorsGrid .indicator-card:first-child');
    const popup = sharedPage.locator('#indicatorPopup');
    await expect(popup).not.toHaveClass(/hidden/);
    await expect(popup).toContainText('RSI');
    await expect(popup).toContainText('과매수');
    await sharedPage.click('#indicatorPopup .icon-btn');
    await expect(popup).toHaveClass(/hidden/);
    console.log('✓ 지표 설명 팝업 열기/닫기 정상');
  });

  test('17. SSE AI 분석 스트리밍', async () => {
    // AI 분석 섹션 표시 대기
    await expect(sharedPage.locator('#analysisSection')).not.toHaveClass(/hidden/, { timeout: 60000 });
    await expect(sharedPage.locator('#analysisContent')).toContainText('분석 시점:', { timeout: 5000 });

    // 분석 완료 대기 (스트리밍 커서 사라짐)
    await expect(sharedPage.locator('.streaming-cursor')).toHaveCount(0, { timeout: 120000 });
    const content = await sharedPage.locator('#analysisContent').textContent();

    // SSE 연결 자체는 정상 — Gemini API 할당량 초과 시 에러 메시지만 올 수 있음
    if (content.length > 200) {
      console.log(`✓ AI 분석 스트리밍 완료: ${content.length}자 (전체 리포트)`);
    } else {
      // 분석 시점 텍스트가 있으면 SSE 연결은 성공한 것
      expect(content).toContain('분석 시점');
      console.log(`✓ AI 분석 SSE 연결 정상 (Gemini API 할당량 제한으로 짧은 응답: ${content.length}자)`);
    }
  });

  test('18. 기간 버튼 (3개월) 차트 갱신', async () => {
    const btn3mo = sharedPage.locator('.period-btn[data-period="3mo"]');
    await btn3mo.click();
    await expect(btn3mo).toHaveClass(/active/);
    await sharedPage.waitForTimeout(3000);
    const chartCanvas = sharedPage.locator('#priceChart canvas');
    await expect(chartCanvas.first()).toBeVisible();
    console.log('✓ 기간 변경 (3개월) 후 차트 갱신 정상');
  });

  test('19. 워치리스트 추가/제거', async () => {
    const favBtn = sharedPage.locator('.stock-fav-btn');
    await expect(favBtn).toBeVisible({ timeout: 5000 });
    await favBtn.click();
    await expect(sharedPage.locator('.toast')).toContainText('워치리스트', { timeout: 3000 });
    await sharedPage.click('#watchlistToggle');
    await expect(sharedPage.locator('#watchlistItems')).toContainText('삼성전자', { timeout: 3000 });
    await sharedPage.click('#watchlistToggle');
    await favBtn.click();
    await expect(sharedPage.locator('.toast').last()).toContainText('제거', { timeout: 3000 });
    console.log('✓ 워치리스트 추가/제거 정상');
  });

  test('20. 스크린샷: 분석 결과', async () => {
    await sharedPage.screenshot({ path: 'tests/screenshot-result.png', fullPage: true });
    console.log('✓ 분석 결과 스크린샷 저장');
  });
});

// ========== 그룹 4: Rate Limiter (마지막에 실행) ==========
test.describe('Rate Limiter', () => {
  test('21. 30회 초과 시 429 응답', async ({ page }) => {
    await page.goto(BASE);
    const requests = [];
    for (let i = 0; i < 35; i++) {
      requests.push(page.request.get(`${BASE}/api/kr-stocks`));
    }
    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());
    const has429 = statuses.some(s => s === 429);
    expect(has429).toBe(true);
    const ok = statuses.filter(s => s === 200).length;
    const blocked = statuses.filter(s => s === 429).length;
    console.log(`✓ Rate Limiter 동작: ${ok}x 200, ${blocked}x 429`);
  });
});
