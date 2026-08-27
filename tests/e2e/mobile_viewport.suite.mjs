/**
 * Tier 3/4 Mobile Viewport, Touch & Morphing Widgets Suite
 * 涵蓋 390x844 手機視口、搜尋圓形按鈕、有效畫布比例 >= 75%、
 * Tooltip 幾何浮動與智慧避讓 (is-placed-below 及關閉動畫防跳)、
 * Filter Widget 與 Disclaimer Widget 彈性變形展開與收縮
 */
import { startTestServer, createTestBrowser } from '../helpers/test_server.mjs';
import { assert, assertEqual, assertNoUnexpectedBrowserDiagnostics, captureFailureArtifacts } from '../helpers/test_utils.mjs';

export async function runMobileViewportSuite(options = {}) {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('📱 [E2E] Running Mobile Viewport & Morphing Suite...');
  console.log('========================================');

  let serverInstance = null;
  let browserInstance = null;
  let passedAssertions = 0;

  try {
    serverInstance = await startTestServer(options.port || 0);
    const baseUrl = serverInstance.baseUrl;

    browserInstance = await createTestBrowser({
      browserType: options.browser || 'chromium',
      headless: options.headless !== false,
      viewport: { width: 390, height: 844 } // iPhone 12/13/14 viewport
    });
    const page = browserInstance.page;

    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('g.node[data-node-id]', { timeout: 5000 });
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(300);

    // Check the runtime marker.
    const runtimeAssertion = await page.evaluate(() => ({ runtime: window.__RD2_RUNTIME__ }));
    assertEqual(runtimeAssertion.runtime, 'ready', 'App runtime should be ready');
    passedAssertions += 1;

    // ==========================================
    // Tier 3: 手機視口排版與元素適配 (390x844)
    // ==========================================
    console.log('--- Tier 3: Mobile Viewport Layout & Search Button (390x844) ---');
    const searchFieldInfo = await page.$eval('#search-widget', el => {
      const s = window.getComputedStyle(el);
      return { width: Number.parseFloat(s.width), radius: s.borderRadius, ariaExpanded: el.getAttribute('aria-expanded') };
    });
    assert(Math.abs(searchFieldInfo.width - 38) <= 4, `Search button should be ~38px circle on mobile, got ${searchFieldInfo.width}px`);
    assertEqual(searchFieldInfo.ariaExpanded, 'false', 'Collapsed mobile search must expose a collapsed state');
    passedAssertions += 2;

    const filterTopBeforeQuery = await page.$eval('#filter-widget', (el) => el.getBoundingClientRect().top);
    await page.click('#search-widget .search-field');
    await page.waitForSelector('#search-widget.is-expanded');
    await page.waitForTimeout(350);
    const expandedSearch = await page.evaluate(() => {
      const widget = document.getElementById('search-widget');
      const field = widget?.querySelector('.search-field');
      const results = document.getElementById('search-results');
      return {
        widgetWidth: widget?.getBoundingClientRect().width || 0,
        fieldWidth: field?.getBoundingClientRect().width || 0,
        resultsHidden: results?.getAttribute('aria-hidden') === 'true',
        ariaExpanded: widget?.getAttribute('aria-expanded'),
        filterTop: document.getElementById('filter-widget')?.getBoundingClientRect().top || 0,
        inputFocused: document.activeElement?.id === 'search-input'
      };
    });
    assert(Math.abs(expandedSearch.widgetWidth - 38) <= 4, 'Opening mobile search must keep its trigger width compact');
    assert(Math.abs(expandedSearch.fieldWidth - (390 - 24)) <= 4, 'Opening mobile search must fill the available mobile width');
    assert(expandedSearch.resultsHidden, 'Search results must remain collapsed before a query matches');
    assertEqual(expandedSearch.ariaExpanded, 'true', 'Expanded mobile search must expose an expanded state');
    assert(expandedSearch.inputFocused, 'Opening mobile search must focus the original input');
    assertEqual(expandedSearch.filterTop, filterTopBeforeQuery, 'Opening mobile search must not push the filter widget downward');
    passedAssertions += 6;

    await page.fill('#search-input', '尖刺');
    await page.waitForSelector('#search-widget.has-search-results');
    await page.waitForTimeout(350);
    const mobileSearchResults = await page.evaluate(() => {
      const widget = document.getElementById('search-widget');
      const results = document.getElementById('search-results');
      const resultRect = results?.getBoundingClientRect();
      return {
        resultsExpanded: results?.getAttribute('aria-hidden') === 'false' && (resultRect?.height || 0) > 0,
        widgetHeight: widget?.getBoundingClientRect().height || 0,
        filterTop: document.getElementById('filter-widget')?.getBoundingClientRect().top || 0,
        resultCount: document.querySelectorAll('.search-result').length
      };
    });
    assert(mobileSearchResults.resultCount > 0, 'Mobile search should render matching nodes');
    assert(mobileSearchResults.resultsExpanded, 'Mobile search results must use the vertical expansion only after matches exist');
    assert(Math.abs(mobileSearchResults.widgetHeight - 38) <= 4, 'Mobile result expansion must keep the trigger height compact');
    assertEqual(mobileSearchResults.filterTop, filterTopBeforeQuery, 'Mobile result expansion must not push the filter widget downward');
    passedAssertions += 4;

    const searchClearContract = await page.evaluate(() => {
      let nativeClearSuppressed = false;
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules ? [...sheet.cssRules] : [];
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (!rule.selectorText?.includes('#search-input::-webkit-search-cancel-button')) continue;
          nativeClearSuppressed = rule.style?.getPropertyValue('appearance') === 'none'
            || rule.style?.getPropertyValue('-webkit-appearance') === 'none';
        }
      }
      return {
        customClearCount: document.querySelectorAll('#search-clear').length,
        nativeClearSuppressed
      };
    });
    assertEqual(searchClearContract.customClearCount, 1, 'Search must render exactly one custom clear control');
    assert(searchClearContract.nativeClearSuppressed, 'Search must suppress the browser-native duplicate clear control');
    passedAssertions += 2;

    await page.click('#search-clear');
    await page.evaluate(() => document.body.click());
    await page.waitForFunction(() => !document.getElementById('search-widget')?.classList.contains('is-expanded'));
    const mobileSearchClosed = await page.$eval('#search-widget', (el) => !el.classList.contains('is-expanded'));
    assert(mobileSearchClosed, 'Mobile search should close from an outside click after clearing');
    passedAssertions++;

    // 頂部 Filter Widget 按鈕並列可見
    const filterWidgetInfo = await page.$eval('.filter-widget', el => {
      const s = window.getComputedStyle(el);
      return { display: s.display, height: Number.parseFloat(s.height) };
    });
    assert(filterWidgetInfo.display.includes('flex') || filterWidgetInfo.display === 'inline-flex', 'Filter widget button must be visible on mobile topbar');
    passedAssertions++;

    // Active-filter count must grow the collapsed control instead of being
    // clipped by its overflow boundary (regression at a 368px viewport).
    await page.setViewportSize({ width: 368, height: 720 });
    await page.click('#filter-toggle-btn');
    await page.waitForFunction(() => (
      document.getElementById('filter-widget')?.classList.contains('is-expanded')
      && document.getElementById('filter-card')?.getAttribute('aria-hidden') === 'false'
    ));
    await page.click('.filter-chip.branch-chip[data-branch="1"]');
    await page.click('#filter-close-btn');
    await page.waitForFunction(() => !document.getElementById('filter-widget')?.classList.contains('is-expanded'));
    const activeFilterGeometry = await page.evaluate(() => {
      const widget = document.getElementById('filter-widget');
      const toggle = document.getElementById('filter-toggle-btn');
      const badge = document.getElementById('filter-active-count-badge');
      const toRect = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      return {
        widget: toRect(widget),
        toggle: toRect(toggle),
        badge: toRect(badge),
        badgeHidden: badge.hidden,
        hasActiveClass: widget.classList.contains('has-active-filters')
      };
    });
    assert(!activeFilterGeometry.badgeHidden, 'Active-filter count badge must be visible after selecting a filter');
    assert(activeFilterGeometry.hasActiveClass, 'Collapsed filter widget must expose its active-filter sizing state');
    assert(
      activeFilterGeometry.toggle.right <= activeFilterGeometry.widget.right + 0.5 &&
      activeFilterGeometry.badge.left >= activeFilterGeometry.widget.left - 0.5 &&
      activeFilterGeometry.badge.right <= activeFilterGeometry.widget.right + 0.5,
      `Active-filter badge and button must stay inside the collapsed widget: ${JSON.stringify(activeFilterGeometry)}`
    );
    passedAssertions += 3;

    // The compactest supported phone widths must keep adjacent topbar
    // controls independently clickable; document-width checks alone do not
    // catch flex children overlapping inside a shrinking status cluster.
    const compactTopbarResults = [];
    for (const width of [280, 240]) {
      await page.setViewportSize({ width, height: 568 });
      await page.waitForTimeout(160);
      compactTopbarResults.push({ width, ...(await page.evaluate(() => {
        const selectors = ['#search-widget', '#filter-widget', '#simulation-toggle-btn', '#data-version-badge', '#changelog-open-btn'];
        const rects = Object.fromEntries(selectors.map((selector) => {
          const element = document.querySelector(selector);
          const rect = element?.getBoundingClientRect();
          return [selector, rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, display: window.getComputedStyle(element).display } : null];
        }));
        const overlap = (a, b) => Boolean(
          a && b &&
          Math.max(a.left, b.left) < Math.min(a.right, b.right) - 0.5 &&
          Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom) - 0.5
        );
        const controls = selectors.filter((selector) => rects[selector]?.display !== 'none');
        const overlaps = [];
        for (let index = 0; index < controls.length; index += 1) {
          for (let next = index + 1; next < controls.length; next += 1) {
            if (overlap(rects[controls[index]], rects[controls[next]])) overlaps.push(`${controls[index]}↔${controls[next]}`);
          }
        }
        return { overlaps, documentWidth: document.documentElement.scrollWidth, rects };
      })) });
    }
    const compactTopbarFailure = compactTopbarResults.find(({ width, documentWidth, overlaps }) => documentWidth > width || overlaps.length > 0);
    assert(!compactTopbarFailure, `Compact topbar controls must not overlap or overflow: ${JSON.stringify(compactTopbarFailure)}`);
    passedAssertions++;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#filter-toggle-btn');
    await page.waitForFunction(() => document.getElementById('filter-widget')?.classList.contains('is-expanded'));
    await page.click('#filter-clear-btn');
    await page.click('#filter-close-btn');
    await page.waitForFunction(() => !document.getElementById('filter-widget')?.classList.contains('is-expanded'));
    await page.waitForFunction(() => {
      const widget = document.getElementById('filter-widget');
      const topbar = document.querySelector('.topbar');
      return Boolean(
        widget &&
        topbar &&
        widget.getBoundingClientRect().height <= 40.5 &&
        topbar.getBoundingClientRect().height <= 90
      );
    });

    // 工具列移除與有效畫布面積 >= 75%
    const toolbar = await page.$('.map-toolbar');
    assertEqual(toolbar, null, '.map-toolbar must be completely removed');
    passedAssertions++;

    const topbarHeight = await page.$eval('.topbar', el => el.getBoundingClientRect().height);
    const effectiveCanvasArea = ((844 - topbarHeight) / 844) * 100;
    assert(effectiveCanvasArea >= 75, `Mobile effective canvas area must be >= 75%, got ${effectiveCanvasArea.toFixed(1)}%`);
    passedAssertions++;

    // 手機端 Tooltip 幾何浮動置中 (Node 1001)
    console.log('--- Tier 3: Mobile Tooltip Geometric Alignment ---');
    const node1001 = await page.$('g.node[data-node-id="1001"]');
    if (node1001) {
      await page.evaluate(() => {
        const el = document.querySelector('g.node[data-node-id="1001"]');
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    }

    const mobileTooltip = await page.$eval('#tooltip', el => {
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const style = window.getComputedStyle(el);
      const topbarStyle = window.getComputedStyle(document.querySelector('.topbar'));
      const statGrid = el.querySelector('.dice-stat-grid');
      const readFontSize = (selector) => {
        const element = el.querySelector(selector);
        return element ? Number.parseFloat(window.getComputedStyle(element).fontSize) : 0;
      };
      return {
        position: window.getComputedStyle(el).position,
        width: rect.width,
        deltaX: Math.abs(centerX - window.innerWidth / 2),
        zIndex: Number.parseInt(style.zIndex, 10),
        topbarZIndex: Number.parseInt(topbarStyle.zIndex, 10),
        titleFontSize: readFontSize('.tooltip-title'),
        detailFontSize: readFontSize('.detail-copy'),
        statValueFontSize: readFontSize('.dice-stat-val'),
        statGridColumns: (statGrid ? window.getComputedStyle(statGrid).gridTemplateColumns : '').trim().split(/\s+/).filter(Boolean).length
      };
    });
    assertEqual(mobileTooltip.position, 'fixed', 'Mobile tooltip should use fixed positioning');
    assert(mobileTooltip.width <= 338, `Mobile tooltip should be slightly reduced to <= 338px, got ${mobileTooltip.width}px`);
    assert(mobileTooltip.deltaX <= 20, `Mobile tooltip should be horizontally centered within 20px, got deltaX ${mobileTooltip.deltaX}px`);
    assert(mobileTooltip.zIndex > mobileTooltip.topbarZIndex, 'Mobile tooltip must layer above the topbar filter widget');
    assert(mobileTooltip.titleFontSize <= 17.5, `Mobile tooltip title should be reduced, got ${mobileTooltip.titleFontSize}px`);
    assert(mobileTooltip.detailFontSize <= 14.5, `Mobile tooltip copy should be reduced, got ${mobileTooltip.detailFontSize}px`);
    assert(mobileTooltip.statValueFontSize <= 18.5, `Mobile tooltip stat values should be reduced, got ${mobileTooltip.statValueFontSize}px`);
    assertEqual(mobileTooltip.statGridColumns, 2, 'Mobile tooltip must retain its two-column stat layout');
    passedAssertions += 8;

    // ==========================================
    // Tier 3/4: Tooltip 智慧避讓 (Smart Avoidance) 與關閉動畫維護
    // ==========================================
    console.log('--- Tier 3/4: Tooltip Smart Avoidance Math & Exit Transition ---');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    // 展開 Filter Widget 並多選自然 + 工學
    await page.click('#filter-toggle-btn');
    await page.waitForTimeout(300);
    await page.click('.filter-chip.branch-chip[data-branch="1"]');
    await page.waitForTimeout(300);
    await page.click('.filter-chip.branch-chip[data-branch="2"]');
    await page.waitForTimeout(300);

    // 開啟 5102 前置高亮
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('5102', false);
      window.__TEST_HOOKS__.showTooltip('5102', true);
    });
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const state = window.__TEST_HOOKS__.getState();
      if (!state.showPrereqMode) {
        document.getElementById('toggle-prereq-btn')?.click();
      }
    });
    await page.waitForTimeout(400);

    // 驗證前置高亮優先級 (自然派系 1001 為 1.0, 5106 為 1.0, 秩序 4001 為 0.12)
    const priorityCheck = await page.evaluate(() => {
      const n1001 = document.querySelector('g.node[data-node-id="1001"]');
      const n5106 = document.querySelector('g.node[data-node-id="5106"]');
      const n4001 = document.querySelector('g.node[data-node-id="4001"]');
      return {
        filteredNature: n1001 ? Number.parseFloat(window.getComputedStyle(n1001).opacity) : 0,
        prereqChaos: n5106 ? Number.parseFloat(window.getComputedStyle(n5106).opacity) : 0,
        unfilteredOrder: n4001 ? Number.parseFloat(window.getComputedStyle(n4001).opacity) : 1,
      };
    });
    assert(priorityCheck.filteredNature >= 0.9, 'Active filtered branch should stay lit (opacity >= 0.9)');
    assert(priorityCheck.prereqChaos >= 0.9, 'Prerequisite node should stay lit (opacity >= 0.9)');
    assert(priorityCheck.unfilteredOrder <= 0.25, 'Unselected node should be dimmed (opacity <= 0.25)');
    passedAssertions += 3;

    // 智慧避讓：Tooltip 自動放置於節點下方 (is-placed-below)
    const smartAvoidance = await page.evaluate(() => {
      const tooltip = document.getElementById('tooltip');
      const state = window.__TEST_HOOKS__.getState();
      const pt = state.nodePositions.get('5102');
      const screenY = state.panY + pt.y * state.scale;
      const tooltipRect = tooltip.getBoundingClientRect();
      const isPlacedBelow = tooltip.classList.contains('is-placed-below');
      return { isPlacedBelow, isClearOfAbovePath: tooltipRect.top >= screenY };
    });
    assert(smartAvoidance.isPlacedBelow, 'Tooltip must have .is-placed-below when prereq nodes are above');
    assert(smartAvoidance.isClearOfAbovePath, 'Tooltip must be positioned below node screen Y');
    passedAssertions += 2;

    // 關閉動畫防跳：關閉途中依然維持 is-placed-below
    const closingCheck = await page.evaluate(async () => {
      window.__TEST_HOOKS__.closeTooltip();
      await new Promise(r => setTimeout(r, 60)); // 在 140ms 退場動畫中途檢查
      const tooltip = document.getElementById('tooltip');
      return {
        isClosing: tooltip.classList.contains('is-closing'),
        isPlacedBelow: tooltip.classList.contains('is-placed-below')
      };
    });
    assert(closingCheck.isPlacedBelow, 'Tooltip must maintain is-placed-below during closing animation');
    passedAssertions++;

    // 清除 Filter
    await page.click('#filter-clear-btn');
    await page.waitForTimeout(200);
    await page.click('#filter-close-btn');
    await page.waitForTimeout(200);

    // ==========================================
    // Tier 3/4: 免責聲明微件 (Disclaimer Widget) 變形與響應式
    // ==========================================
    console.log('--- Tier 3/4: Disclaimer Widget Morphing & Responsive UI ---');
    const initialDisclaimerBtn = await page.evaluate(() => {
      const w = document.querySelector('#disclaimer-widget');
      const s = window.getComputedStyle(w);
      return { width: Number.parseFloat(s.width), height: Number.parseFloat(s.height) };
    });
    assert(Math.abs(initialDisclaimerBtn.width - 36) <= 4, 'Disclaimer should be ~36px circle initially');
    passedAssertions++;

    // 點擊展開卡片
    await page.click('#disclaimer-toggle-btn');
    await page.waitForTimeout(400);

    const expandedDesktop = await page.evaluate(() => {
      const w = document.querySelector('#disclaimer-widget');
      const emailLink = document.querySelector('.disclaimer-email-link');
      const takedown = document.querySelector('.disclaimer-takedown-notice')?.textContent.trim() || '';
      return {
        isExpanded: w.classList.contains('is-expanded'),
        width: Number.parseFloat(window.getComputedStyle(w).width),
        height: Number.parseFloat(window.getComputedStyle(w).height),
        emailHref: emailLink?.getAttribute('href'),
        hasRightsHolder: takedown.includes('111 Percent Inc.')
      };
    });
    assert(expandedDesktop.isExpanded, 'Disclaimer widget must be expanded');
    assert(expandedDesktop.width >= 320, 'Desktop disclaimer width should be >= 320px');
    assertEqual(expandedDesktop.emailHref, 'mailto:itsestrella71@gmail.com', 'Disclaimer email must match mailto:itsestrella71@gmail.com');
    assert(expandedDesktop.hasRightsHolder, 'Disclaimer must identify 111 Percent Inc. in the takedown notice');
    passedAssertions += 4;

    // 點擊關閉按鈕收回
    await page.click('#disclaimer-close-btn');
    await page.waitForTimeout(300);
    const isDisclaimerClosed = await page.$eval('#disclaimer-widget', el => !el.classList.contains('is-expanded'));
    assert(isDisclaimerClosed, 'Disclaimer widget should close on button click');
    passedAssertions++;

    // 手機端免責聲明展開測試
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.click('#disclaimer-toggle-btn');
    await page.waitForTimeout(400);

    const expandedMobile = await page.evaluate(() => {
      const w = document.querySelector('#disclaimer-widget');
      return {
        isExpanded: w.classList.contains('is-expanded'),
        width: Number.parseFloat(window.getComputedStyle(w).width)
      };
    });
    assert(expandedMobile.isExpanded, 'Mobile disclaimer should expand');
    assert(expandedMobile.width >= 340, 'Mobile disclaimer width should be >= 340px');
    passedAssertions += 2;

    await page.click('#disclaimer-close-btn');
    await page.waitForTimeout(200);

    assertNoUnexpectedBrowserDiagnostics(browserInstance, 'mobile suite');
    const durationMs = Date.now() - startTime;
    console.log(`\n🎉 Mobile Viewport Suite Passed! (${passedAssertions} assertions in ${(durationMs / 1000).toFixed(2)}s)`);

    return {
      suite: 'mobile_viewport',
      name: 'Mobile Viewport & Morphing Suite',
      passed: true,
      durationMs,
      assertions: passedAssertions,
      errors: [],
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`\n❌ Mobile Viewport Suite Failed in ${(durationMs / 1000).toFixed(2)}s:`, err);
    const failure = await captureFailureArtifacts({
      suiteName: 'mobile-viewport',
      error: err,
      browser: options.browser || process.env.TEST_BROWSER || 'chromium',
      browserInstance,
      baseUrl: serverInstance?.baseUrl
    });
    return {
      suite: 'mobile_viewport',
      name: 'Mobile Viewport & Morphing Suite',
      passed: false,
      durationMs,
      assertions: passedAssertions,
      errors: [failure.message],
      diagnostics: failure
    };
  } finally {
    if (browserInstance) await browserInstance.close();
    if (serverInstance) await serverInstance.close();
  }
}

const directEntry = process.argv[1];
if (directEntry?.endsWith('mobile_viewport.suite.mjs')) {
  const result = await runMobileViewportSuite();
  process.exitCode = result.passed ? 0 : 1;
}
