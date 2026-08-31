/**
 * Tier 1 Always-Run Critical Smoke Suite (fast critical-path gate)
 * 驗證基本的 HTTP 載入、離線 file:// 載入、DOM 節點拓撲、Tooltip 彈出與圖鑑開啟
 */
import { startTestServer, createTestBrowser } from '../helpers/test_server.mjs';
import { assert, assertEqual, assertNoUnexpectedBrowserDiagnostics, captureFailureArtifacts } from '../helpers/test_utils.mjs';
import { orderedStylesheets } from '../../scripts/stylesheet_contract.mjs';

async function runLocaleChecks(page, localeChecks) {
  let assertions = 0;
  for (const { key, placeholder, title, unlockLabels } of localeChecks) {
    await page.click('#locale-toggle-btn');
    await page.waitForSelector('#locale-widget.is-expanded');
    await page.click(`#locale-widget [data-locale="${key}"]`);
    await page.waitForFunction(
      ({ expectedLocale, expectedPlaceholder }) => document.documentElement.lang === expectedLocale
        && document.querySelector('#search-input')?.placeholder.includes(expectedPlaceholder),
      { expectedLocale: key, expectedPlaceholder: placeholder },
    );
    const localeUi = await page.evaluate((locale) => ({
      title: document.title,
      filter: document.querySelector('#filter-heading')?.textContent.trim(),
      language: document.documentElement.lang,
      option: document.querySelector(`#locale-widget [data-locale="${locale}"]`)?.getAttribute('aria-pressed'),
    }), key);
    assertEqual(localeUi.title, title, `${key} switch must update the localized SEO title`);
    assert(localeUi.filter, `${key} switch must update visible filter text`);
    assertEqual(localeUi.language, key, `${key} switch must update the document language`);
    assertEqual(localeUi.option, 'true', `${key} locale option must be active`);
    const renderedUnlockLabels = await page.evaluate((ids) => Object.fromEntries(
      Object.keys(ids).map((id) => [
        id,
        document.querySelector(`button.tree-node-semantic[data-node-id="${id}"]`)?.dataset.unlockLabel || '',
      ]),
    ), unlockLabels);
    for (const [id, expectedLabel] of Object.entries(unlockLabels)) {
      assertEqual(renderedUnlockLabels[id], expectedLabel, `${key} unlock label for node ${id}`);
    }
    assertions += 4 + Object.keys(unlockLabels).length;
  }
  return assertions;
}

export async function runSmokeSuite(options = {}) {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('🚀 [E2E] Running Tier 1 Critical Smoke Suite...');
  console.log('========================================');

  let serverInstance = null;
  let browserInstance = null;
  let clientLocaleBrowser = null;
  let passedAssertions = 0;

  try {
    // 1. 啟動測試伺服器
    serverInstance = await startTestServer(options.port || 0);
    const baseUrl = serverInstance.baseUrl;
    console.log(`✓ Test HTTP Server active on ${baseUrl}`);
    passedAssertions++;

    // 2. 啟動瀏覽器
    browserInstance = await createTestBrowser({
      browserType: options.browser || 'chromium',
      headless: options.headless !== false,
      viewport: { width: 1280, height: 800 }
    });
    const page = browserInstance.page;
    passedAssertions++;

    await browserInstance.context.addInitScript(() => {
      window.__RD2_LOADER_TRACE__ = [];
      let lastSnapshot = "";
      const recordLoaderState = () => {
        const label = document.getElementById("loader-status-label");
        const fill = document.getElementById("loader-progress-fill");
        const screen = document.getElementById("loading-screen");
        if (!label || !fill || !screen) return;
        const snapshot = {
          text: label.textContent.trim(),
          width: fill.style.width,
          hidden: screen.hidden
        };
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSnapshot) return;
        lastSnapshot = serialized;
        window.__RD2_LOADER_TRACE__.push(snapshot);
      };
      new MutationObserver(recordLoaderState).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "hidden"]
      });
      recordLoaderState();
    });

    // Failure injection: the Canvas render manifest is a required runtime
    // asset. An invalid manifest must fail closed before an incomplete map is
    // exposed, with a retry path for the subsequent valid response.
    let failManifestRequest = true;
    await page.route('**/map-render-manifest.json', async (route) => {
      if (failManifestRequest) {
        failManifestRequest = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ schema_version: 999, nodes: [], edges: [] }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`${baseUrl}/index.html?manifest-failure-injection=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#loader-retry-btn:not([hidden])', { timeout: 3000 });
    const manifestFailureState = await page.$eval('#loading-screen', (el) => ({
      hidden: el.hidden,
      isError: el.classList.contains('is-error'),
      hasIncompleteScene: Boolean(document.querySelector('#scene canvas, #scene .tree-semantic-layer')),
    }));
    assert(!manifestFailureState.hidden, 'Invalid Canvas manifest must keep the loader visible');
    assert(manifestFailureState.isError, 'Invalid Canvas manifest must expose a bootstrap error state');
    assert(!manifestFailureState.hasIncompleteScene, 'Invalid Canvas manifest must not reach the map scene');
    passedAssertions += 3;
    await page.unroute('**/map-render-manifest.json');

    // Failure injection: malformed required event data must also fail closed
    // instead of rendering an empty compendium and hiding the loader.
    let failBossDataRequest = true;
    await page.route('**/boss_event_data.json', async (route) => {
      if (failBossDataRequest) {
        failBossDataRequest = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ events: {} }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`${baseUrl}/index.html?malformed-data-injection=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#loader-retry-btn:not([hidden])', { timeout: 3000 });
    const malformedDataState = await page.$eval('#loading-screen', (el) => ({
      hidden: el.hidden,
      isError: el.classList.contains('is-error'),
      hasIncompleteScene: Boolean(document.querySelector('#scene canvas, #scene .tree-semantic-layer')),
    }));
    assert(!malformedDataState.hidden, 'Malformed event data must keep the loader visible');
    assert(malformedDataState.isError, 'Malformed event data must expose a bootstrap error state');
    assert(!malformedDataState.hasIncompleteScene, 'Malformed event data must not complete the bootstrap');
    passedAssertions += 3;
    await page.unroute('**/boss_event_data.json');

    // Security regression: icon filenames come from canonical JSON but still
    // cross an innerHTML boundary. Unsafe values must fall back to a reviewed
    // public asset instead of creating attacker-controlled attributes.
    let injectIconDataRequest = true;
    await page.route('**/boss_event_data.json', async (route) => {
      if (injectIconDataRequest) {
        injectIconDataRequest = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            events: [],
            monsters: [{
              id: 'injected-monster',
              category: 'MONSTER',
              subType: 'NORMAL',
              name_zh: '測試怪物',
              name_en: 'Injected Monster',
              icon: 'x.png" onerror="window.__RD2_ICON_INJECTION__=true',
              speed: 1,
              hp_percent: 100,
              sp_per: 100,
            }],
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`${baseUrl}/index.html?icon-injection=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });
    await page.click('#tree-center-compendium-btn', { force: true });
    await page.waitForSelector('#compendium-overlay:not([hidden])', { timeout: 3000 });
    await page.click('#compendium-category-toggle-btn');
    await page.waitForFunction(
      () => document.getElementById('compendium-category-toggle-btn')?.getAttribute('aria-expanded') === 'true',
      null,
      { timeout: 3000 }
    );
    await page.locator('.category-option-item[data-value="monster"]').dispatchEvent('click');
    await page.waitForFunction(
      () => document.getElementById('compendium-category-current-label')?.textContent.trim() === '怪物'
        && Boolean(document.querySelector('.compendium-card.is-normal-monster .monster-static-poster')),
      null,
      { timeout: 10000 }
    );
    const iconSafetyState = await page.$eval('.compendium-card.is-normal-monster .monster-static-poster', (img) => ({
      src: img.getAttribute('src'),
      onerror: img.getAttribute('onerror') || '',
      injected: Boolean(window.__RD2_ICON_INJECTION__),
    }));
    assertEqual(iconSafetyState.src, 'icons/monster_static_boss_4.png', 'Unsafe monster icon must use the reviewed static fallback asset');
    assert(!iconSafetyState.onerror.includes('__RD2_ICON_INJECTION__'), 'Unsafe monster icon must not create an attacker-controlled onerror attribute');
    assert(!iconSafetyState.injected, 'Unsafe monster icon must not execute injected script state');
    passedAssertions += 3;
    await page.unroute('**/boss_event_data.json');

    // Failure injection: a required canonical data request must leave an
    // actionable error state instead of dismissing the loader into an empty
    // shell. The one-shot route then permits the retry to prove recovery.
    let failTreeRequest = true;
    await page.route('**/data/dice_tree.json', async (route) => {
      if (failTreeRequest) {
        failTreeRequest = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'injected failure' }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`${baseUrl}/index.html?failure-injection=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#loader-retry-btn:not([hidden])', { timeout: 3000 });
    const failureState = await page.$eval('#loading-screen', (el) => ({
      hidden: el.hidden,
      isError: el.classList.contains('is-error'),
      status: document.querySelector('#loader-status-label')?.textContent.trim(),
      retryDisabled: document.querySelector('#loader-retry-btn')?.disabled,
      activeId: document.activeElement?.id || '',
    }));
    assert(!failureState.hidden, 'Required data failure must keep the loader visible');
    assert(failureState.isError, 'Required data failure must expose an error state');
    assertEqual(failureState.status, 'Data loading failed. Reload to try again.', 'Failure state must explain the recovery action');
    assert(!failureState.retryDisabled && failureState.activeId === 'loader-retry-btn', 'Retry button must be actionable and receive focus after failure');
    passedAssertions += 4;
    await page.click('#loader-retry-btn');
    await page.waitForSelector('button.tree-node-semantic[data-node-id]', { timeout: 5000 });
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });
    assertEqual(await page.$$eval('button.tree-node-semantic[data-node-id]', (els) => els.length), 239, 'Retry must restore the canonical tree');
    passedAssertions++;
    await page.unroute('**/data/dice_tree.json');

    // 3. HTTP 正常載入與核心 DOM 元素檢查
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    console.log('✓ Page loaded via HTTP successfully');
    passedAssertions++;

    const liveStylesheetContract = await page.evaluate(() => {
      const links = [...document.querySelectorAll('link[rel~="stylesheet"]')]
        .filter(link => new URL(link.href, location.href).origin === location.origin);
      return {
        linked: links.map(link => new URL(link.href, location.href).pathname.split('/').pop()),
        loaded: links.map(link => ({
          href: new URL(link.href, location.href).pathname.split('/').pop(),
          hasSheet: Boolean(link.sheet),
          ruleCount: link.sheet?.cssRules?.length ?? 0,
        })),
      };
    });
    assertEqual(
      JSON.stringify(liveStylesheetContract.linked),
      JSON.stringify(orderedStylesheets),
      'Local stylesheets must reach the browser in canonical cascade order',
    );
    assert(
      liveStylesheetContract.loaded.every(entry => entry.hasSheet && entry.ruleCount > 0),
      `Every ordered stylesheet must load into CSSOM: ${JSON.stringify(liveStylesheetContract.loaded)}`,
    );
    passedAssertions += 2;

    for (const selector of ['#filter-toggle-btn', '#disclaimer-toggle-btn', '#changelog-open-btn', '#locale-toggle-btn']) {
      await page.focus(selector);
      const focusStyle = await page.$eval(selector, (element) => {
        const style = getComputedStyle(element);
        return {
          focusVisible: element.matches(':focus-visible'),
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth)
        };
      });
      assert(
        focusStyle.focusVisible && focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth >= 2,
        `${selector} must expose a visible keyboard focus indicator`
      );
      passedAssertions++;
    }

    // Optional changelog data must degrade to a renderable entry when a
    // generated row contains malformed optional fields. A bad notes payload
    // must not tear down the whole application bootstrap.
    const malformedChangelogPage = await browserInstance.context.newPage();
    try {
      await malformedChangelogPage.route('**/data/changelog.json', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            canonical_version: '1.0.3',
            entries: [{ version: 'malformed', categories: {}, notes: 'not-an-array', official_notices: [null] }]
          })
        });
      });
      await malformedChangelogPage.goto(`${baseUrl}/index.html?malformed-changelog-injection=1`, { waitUntil: 'networkidle' });
      await malformedChangelogPage.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });
      const malformedChangelogState = await malformedChangelogPage.$eval('#loading-screen', (el) => ({
        loaderHidden: el.hidden,
        appInitialized: Boolean(window.RD2App?._initialized),
        treeNodeCount: document.querySelectorAll('button.tree-node-semantic[data-node-id]').length
      }));
      assert(malformedChangelogState.loaderHidden, 'Malformed optional changelog must not keep the loader visible');
      assert(malformedChangelogState.appInitialized, 'Malformed optional changelog must not abort application bootstrap');
      assertEqual(malformedChangelogState.treeNodeCount, 239, 'Malformed optional changelog must still render the canonical tree');
      passedAssertions += 3;
    } finally {
      await malformedChangelogPage.close();
    }

    // Canonical game-data version and generated changelog must be visible and
    // must not fall back to the website package version.
    await page.waitForSelector('#data-version-badge');
    const dataVersion = await page.$eval('#data-version-badge', (el) => ({ text: el.textContent.trim(), version: el.dataset.version }));
    assertEqual(dataVersion.version, '1.0.3', 'Game-data badge must use canonical metadata version 1.0.3');
    assertEqual(dataVersion.text, 'v1.0.3', 'Game-data badge must be human-readable');
    await page.click('#changelog-open-btn');
    await page.waitForSelector('#changelog-widget.is-expanded');
    const changelogVersion = await page.$eval('#changelog-widget', (el) => el.textContent.includes('v1.0.3'));
    assert(changelogVersion, 'Changelog must include the canonical 1.0.3 entry');
    await page.locator('#changelog-widget .changelog-close-btn').click();
    await page.waitForSelector('#changelog-widget:not(.is-expanded)');
    const changelogReturnFocus = await page.evaluate(() => document.activeElement?.id || '');
    assertEqual(changelogReturnFocus, 'changelog-open-btn', 'Closing changelog should restore focus to its opener');
    passedAssertions += 6;

    // Re-initializing a mounted changelog must not accumulate opener listeners.
    // This protects hot reload/re-bootstrap paths from opening the same modal
    // multiple times for a single click.
    const changelogLifecycleOpenCount = await page.evaluate(() => {
      const view = window.RD2App.views.changelogView;
      const originalOpen = view.open;
      let count = 0;
      view.open = () => { count += 1; };
      view.init();
      const openButton = document.getElementById('changelog-open-btn');
      openButton.click();
      view.open = originalOpen;
      return count;
    });
    assertEqual(changelogLifecycleOpenCount, 0, 'Re-initialization must not register duplicate click listeners');
    passedAssertions += 1;

    // Check the runtime marker.
    const runtimeAssertion = await page.evaluate(() => ({
      runtime: window.__RD2_RUNTIME__,
    }));
    assertEqual(runtimeAssertion.runtime, 'ready', 'App runtime should be ready');
    passedAssertions += 1;

    await page.waitForSelector('button.tree-node-semantic[data-node-id]', { timeout: 4000 });
    const httpNodeCount = await page.$$eval('button.tree-node-semantic[data-node-id]', els => els.length);
    assertEqual(httpNodeCount, 239, 'Must render exactly 239 tree nodes in DOM');
    passedAssertions++;

    // 檢查 loading indicator 與 loading-screen
    const loadingScreen = await page.$('#loading-screen');
    if (loadingScreen) {
      await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 4000 });
    }
    const loaderStages = await page.evaluate(() => [...new Set(
      (window.__RD2_LOADER_TRACE__ || []).map((entry) => entry.text).filter(Boolean)
    )]);
    const requiredLoaderStages = [
      '正在載入骰子樹資料…',
      '讀取節點資料…',
      '解析 239 個節點…',
      '繪製骰子樹圖層…',
      '載入完成'
    ];
    assert(
      requiredLoaderStages.every((stage) => loaderStages.includes(stage)),
      `Loader must expose its staged status sequence: ${JSON.stringify(loaderStages)}`
    );
    assert(
      loaderStages.indexOf('載入完成') > loaderStages.indexOf('繪製骰子樹圖層…'),
      `Loader completion must follow its visible preparation stages: ${JSON.stringify(loaderStages)}`
    );
    passedAssertions += 2;
    const loadingEl = await page.$('#loading');
    if (loadingEl) {
      const loadingHidden = await page.$eval('#loading', el => el.hidden);
      assert(loadingHidden, 'Loading element must be hidden when ready');
    }
    passedAssertions++;

    // 檢查核心視口與小地圖 Canvas 存在
    const hasMinimapCanvas = await page.$eval('#minimap-canvas', el => !!el);
    const hasViewport = await page.$eval('#viewport', el => !!el);
    const hasTooltip = await page.$eval('#tooltip', el => !!el);
    assert(hasMinimapCanvas, 'Minimap canvas element must exist');
    assert(hasViewport, 'Viewport container must exist');
    assert(hasTooltip, 'Tooltip container must exist');
    passedAssertions += 3;

    // 5. 快速節點點擊與 Tooltip 驗證 (Node 1001: 自然派系 火骰子)
    const node1001 = await page.$('button.tree-node-semantic[data-node-id="1001"]');
    assert(node1001, 'Node 1001 must exist');
    await page.evaluate(() => {
      const el = document.querySelector('button.tree-node-semantic[data-node-id="1001"]');
      if (el) el.click();
    });
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 2000 });

    const tooltipTitle = await page.$eval('#tooltip-title', el => el.textContent.trim());
    assertEqual(tooltipTitle, '火骰子', 'Node 1001 tooltip title should be 火骰子');
    const branchBadge = await page.$eval('#tooltip-branch-badge', el => el.textContent.trim());
    assertEqual(branchBadge, '自然', 'Node 1001 branch should be 自然');
    const attackStat = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.dice-stat-item'));
      const atk = items.find(el => el.querySelector('.dice-stat-label')?.textContent.trim() === '攻擊力');
      return atk?.querySelector('.dice-stat-val')?.textContent.trim();
    });
    assertEqual(attackStat, '150', 'Node 1001 base attack must be 150');
    const selectionContract = await page.evaluate(() => {
      const title = document.getElementById('tooltip-title');
      const viewport = document.getElementById('viewport');
      const resolvedUserSelect = (element) => {
        const style = getComputedStyle(element);
        return style.userSelect || style.getPropertyValue('-webkit-user-select');
      };
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(title);
      selection.removeAllRanges();
      selection.addRange(range);
      const selectedText = selection.toString().trim();
      selection.removeAllRanges();
      return {
        bodyUserSelect: resolvedUserSelect(document.body),
        tooltipUserSelect: resolvedUserSelect(title),
        viewportUserSelect: resolvedUserSelect(viewport),
        selectedText,
      };
    });
    assert(selectionContract.bodyUserSelect !== 'none', 'Reference page text must remain selectable');
    assert(selectionContract.tooltipUserSelect !== 'none', 'Tooltip text must remain selectable');
    assertEqual(selectionContract.viewportUserSelect, 'none', 'Interactive map dragging surface must suppress selection');
    assertEqual(selectionContract.selectedText, '火骰子', 'Tooltip title should be programmatically selectable');
    passedAssertions += 8;
    console.log(`✓ Node 1001 click & tooltip validated: "${tooltipTitle}" (${branchBadge}, 攻擊力 ${attackStat})`);

    // 6. 快速圖鑑核心展開與關閉驗證
    // 關閉 Tooltip 並按 '0' 重設相機視口至中央，確保 #tree-center-compendium-btn 處於可互動視口中
    await page.keyboard.press('Escape');
    await page.keyboard.press('0');
    await page.waitForTimeout(450);

    const coreBtn = await page.$('#tree-center-compendium-btn');
    assert(coreBtn, 'Tree center compendium button must exist');
    await coreBtn.click({ force: true });
    await page.waitForSelector('#compendium-overlay:not([hidden])', { timeout: 3000 });

    const compendiumOpen = await page.$eval('#compendium-overlay', el => !el.hidden);
    assert(compendiumOpen, 'Compendium overlay must open on core button click');
    const compendiumGeometry = await page.$eval('#compendium-overlay', el => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });
    assert(compendiumGeometry.left <= 0.5 && compendiumGeometry.top <= 0.5, 'Compendium overlay must start at the viewport origin');
    assert(
      compendiumGeometry.width >= compendiumGeometry.viewportWidth - 1
      && compendiumGeometry.height >= compendiumGeometry.viewportHeight - 1,
      `Compendium overlay must cover the viewport: ${JSON.stringify(compendiumGeometry)}`
    );
    const cardCount = await page.$$eval('.compendium-card', els => els.length);
    assertEqual(cardCount, 41, 'Compendium must display 41 dice cards by default');
    const compendiumSelection = await page.evaluate(() => {
      const title = document.querySelector('.compendium-card .tooltip-title');
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(title);
      selection.removeAllRanges();
      selection.addRange(range);
      const selectedText = selection.toString().trim();
      selection.removeAllRanges();
      return {
        userSelect: getComputedStyle(title).userSelect,
        selectedText,
      };
    });
    assert(compendiumSelection.userSelect !== 'none', 'Compendium reference text must remain selectable');
    assert(compendiumSelection.selectedText.length > 0, 'Compendium card title should be programmatically selectable');
    passedAssertions += 4;
    console.log(`✓ Compendium core open verified: ${cardCount} cards displayed`);

    // 關閉圖鑑 (等待 shockwave contraction 動畫完成)
    const backBtn = await page.$('#compendium-back-btn');
    assert(backBtn, 'Compendium back button must exist');
    await backBtn.click();
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });
    const compendiumClosed = await page.$eval('#compendium-overlay', el => el.hidden);
    assert(compendiumClosed, 'Compendium overlay must close on back button click');
    passedAssertions++;

    // 6.5 詳細能力 (Detailed Stats) 入口與模態面板驗證
    const statBtn = await page.$('#detailed-stats-btn');
    assert(statBtn, 'Detailed stats button must exist in the toolbar');
    await statBtn.click();
    await page.waitForSelector('#detailed-stats-modal:not([hidden])', { timeout: 3000 });
    // Let the card entrance animation settle before measuring cross-browser geometry.
    await page.waitForFunction(() => {
      const card = document.getElementById('detailed-stats-card');
      return card && window.getComputedStyle(card).transform === 'none';
    }, null, { timeout: 3000 });
    const statModalOpen = await page.$eval('#detailed-stats-modal', el => !el.hidden);
    assert(statModalOpen, 'Detailed stats modal must open on button click');
    const statModalGeometry = await page.$eval('#detailed-stats-modal', el => {
      const rect = el.getBoundingClientRect();
      const card = document.getElementById('detailed-stats-card')?.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        background: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        cardCenterX: card ? (card.left + card.right) / 2 : null,
        cardCenterY: card ? (card.top + card.bottom) / 2 : null,
        viewportCenterX: window.innerWidth / 2,
        viewportCenterY: window.innerHeight / 2
      };
    });
    assert(statModalGeometry.left <= 0.5 && statModalGeometry.top <= 0.5, 'Detailed stats backdrop must start at the viewport origin');
    assert(
      statModalGeometry.width >= statModalGeometry.viewportWidth - 1
      && statModalGeometry.height >= statModalGeometry.viewportHeight - 1,
      `Detailed stats backdrop must cover the viewport: ${JSON.stringify(statModalGeometry)}`
    );
    assertEqual(statModalGeometry.background, 'rgba(0, 0, 0, 0.72)', 'Detailed stats backdrop must use the compendium black translucent surface');
    assertEqual(statModalGeometry.backdropFilter, 'none', 'Detailed stats backdrop must not blur the map');
    assert(
      Math.abs(statModalGeometry.cardCenterX - statModalGeometry.viewportCenterX) <= 1
      && Math.abs(statModalGeometry.cardCenterY - statModalGeometry.viewportCenterY) <= 1,
      `Detailed stats card must remain centered: ${JSON.stringify(statModalGeometry)}`
    );
    const statItemCount = await page.$$eval('.detailed-stats-item', els => els.length);
    assert(statItemCount > 0, 'Detailed stats modal must display calculated passive items');
    
    // Close detailed stats modal via close button
    const statCloseBtn = await page.$('#detailed-stats-close-btn');
    assert(statCloseBtn, 'Detailed stats close button must exist');
    await statCloseBtn.click();
    await page.waitForSelector('#detailed-stats-modal', { state: 'hidden', timeout: 3000 });
    const statModalClosed = await page.$eval('#detailed-stats-modal', el => el.hidden);
    assert(statModalClosed, 'Detailed stats modal must close on close button click');
    passedAssertions += 5;
    console.log(`✓ Detailed stats modal verified: ${statItemCount} items displayed in normal mode`);

    // A failure after viewport setup must dispose the partial composition
    // root before a caller retries init; otherwise viewport subscriptions
    // accumulate across attempts and every render dispatches duplicate state.
    const lifecycleProbePage = await browserInstance.context.newPage();
    try {
      await lifecycleProbePage.goto(`${baseUrl}/index.html?bootstrap-retry-probe=1`, { waitUntil: 'networkidle' });
      await lifecycleProbePage.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });
      const lifecycleProbe = await lifecycleProbePage.evaluate(async () => {
        // Isolate the disposable Application instance from the page bootstrap.
        window.RD2App.views.simulationView?.destroy();
        const AppCtor = window.RD2App.constructor;
        const app = new AppCtor();
        const originalSubscribe = app.store.subscribe;
        let shouldFail = true;
        app.store.subscribe = function (listener) {
          if (shouldFail) {
            shouldFail = false;
            throw new Error('controlled bootstrap failure');
          }
          return originalSubscribe.call(this, listener);
        };
        const first = await app.init();
        const afterFailure = app.viewportController._listeners.size;
        const rootApp = window.RD2App;
        rootApp.viewportController._state.scale = 2;
        rootApp.viewportController._state.x = 111;
        rootApp.viewportController._state.y = 222;
        const second = await app.init();
        const afterRetry = app.viewportController._listeners.size;
        const viewportTimerOwnership = await (async () => {
          const { ViewportController } = await import('./src/infra/viewport_controller.js');
          const controller = new ViewportController({ mapWidth: 4000, mapHeight: 3400 });
          const listeners = new Map();
          const container = {
            clientWidth: 1000,
            clientHeight: 800,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
            addEventListener: (type, listener) => {
              const entries = listeners.get(type) || [];
              entries.push(listener);
              listeners.set(type, entries);
            },
            removeEventListener: (type, listener) => {
              listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
            },
            dispatch: (type, event) => {
              for (const listener of listeners.get(type) || []) listener(event);
            }
          };
          const scene = { style: {} };
          const wheel = () => container.dispatch('wheel', {
            deltaY: -100,
            clientX: 640,
            clientY: 400,
            preventDefault() {}
          });
          controller.init(container, scene, { initialScale: 1, initialX: 0, initialY: 0 });
          document.body.classList.remove('is-zooming', 'is-navigating');
          const firstGestureState = controller._gestureState;
          wheel();
          const firstZoomTimer = firstGestureState?.zoomingTimer;
          controller.destroy();
          const staleTimerCleared = firstGestureState?.zoomingTimer === null;
          controller.init(container, scene, { initialScale: 1, initialX: 0, initialY: 0 });
          const secondGestureState = controller._gestureState;
          wheel();
          const activeAfterReinit = document.body.classList.contains('is-zooming');
          const newTimerOwned = Boolean(secondGestureState?.zoomingTimer)
            && secondGestureState !== firstGestureState
            && secondGestureState.zoomingTimer !== firstZoomTimer;
          await new Promise((resolve) => setTimeout(resolve, 12));
          const activeDuringNewTimer = document.body.classList.contains('is-zooming');
          controller.destroy();
          return Boolean(firstZoomTimer)
            && staleTimerCleared
            && activeAfterReinit
            && newTimerOwned
            && activeDuringNewTimer;
        })();
        await new Promise((resolve) => setTimeout(resolve, 950));
        const rootViewportPreservedAfterBootstrap = rootApp.viewportController._state.scale === 2
          && rootApp.viewportController._state.x === 111
          && rootApp.viewportController._state.y === 222;
        const idempotent = await app.init();
        app.views.compendiumView.open();
        const compendiumOpenBeforeDestroy = !document.querySelector('#compendium-overlay')?.hidden;
        app.destroy();
        const compendiumHiddenAfterDestroy = Boolean(document.querySelector('#compendium-overlay')?.hidden);
        const centerHookClearedAfterDestroy = window.__RD2_CENTER_FOR_TOOLTIP__ === undefined;
        const compendiumHookClearedAfterDestroy = window.__COMPENDIUM_HOOKS__ === undefined;
        const testHookClearedAfterDestroy = window.__TEST_HOOKS__ === undefined;
        const restarted = await app.init();
        app.simulationPlanUseCase.enter();
        const simulationShareTrigger = document.querySelector('#simulation-share-trigger-btn');
        const simulationShareWidget = document.querySelector('#simulation-share-widget');
        simulationShareTrigger?.click();
        const simulationShareOpenBeforeDestroy = simulationShareWidget?.classList.contains('is-expanded') === true;
        const { dismissLoader } = await import('./src/main.js');
        const loaderGeneration = app._lifecycleGeneration;
        app.viewportController._state.scale = 2;
        app.viewportController._state.x = 123;
        app.viewportController._state.y = 456;
        dismissLoader(() => loaderGeneration === app._lifecycleGeneration, app.viewportController, app);
        await new Promise((resolve) => setTimeout(resolve, 100));
        app.destroy();
        const simulationTopCapsuleHiddenAfterDestroy = Boolean(document.querySelector('#simulation-top-capsule-group')?.hidden);
        const simulationBodyClassAfterDestroy = document.body.classList.contains('simulation-mode');
        const loaderViewportBeforeCallback = { ...app.viewportController._state };
        await new Promise((resolve) => setTimeout(resolve, 600));
        const loaderViewportAfterCallback = { ...app.viewportController._state };
        const loaderViewportPreserved = loaderViewportAfterCallback.scale === loaderViewportBeforeCallback.scale
          && loaderViewportAfterCallback.x === loaderViewportBeforeCallback.x
          && loaderViewportAfterCallback.y === loaderViewportBeforeCallback.y;
        const delayedApp = new AppCtor();
        const originalDelayedLoadDiceTree = delayedApp.dataRepo.loadDiceTree.bind(delayedApp.dataRepo);
        let releaseDelayedLoad;
        delayedApp.dataRepo.loadDiceTree = () => new Promise((resolve) => {
          releaseDelayedLoad = resolve;
        });
        const delayedInit = delayedApp.init();
        await new Promise((resolve) => setTimeout(resolve, 50));
        delayedApp.destroy();
        if (!releaseDelayedLoad) throw new Error('Delayed bootstrap probe did not reach the controlled load');
        releaseDelayedLoad(await originalDelayedLoadDiceTree());
        const delayedInitResult = await delayedInit;
        const delayedBootstrapCancelled = delayedInitResult === false
          && !delayedApp._initialized
          && Object.values(delayedApp.views).every((view) => !view);
        return {
          first,
          afterFailure,
          second,
          afterRetry,
          viewportTimerOwnership,
          rootViewportPreservedAfterBootstrap,
          idempotent,
          compendiumOpenBeforeDestroy,
          compendiumHiddenAfterDestroy,
          centerHookClearedAfterDestroy,
          compendiumHookClearedAfterDestroy,
          testHookClearedAfterDestroy,
          restarted,
          simulationShareOpenBeforeDestroy,
          simulationShareWidgetClosedAfterDestroy: !document.querySelector('#simulation-share-widget')?.classList.contains('is-expanded'),
          simulationTopCapsuleHiddenAfterDestroy,
          simulationBodyClassAfterDestroy,
          loaderViewportPreserved,
          delayedBootstrapCancelled
        };
      });
      assertEqual(lifecycleProbe.first, false, 'Controlled bootstrap failure must return false');
      assertEqual(lifecycleProbe.afterFailure, 0, 'Failed bootstrap must release viewport subscriptions');
      assertEqual(lifecycleProbe.second, true, 'Bootstrap retry must succeed after cleanup');
      assertEqual(lifecycleProbe.afterRetry, 1, 'Successful retry must keep one viewport subscription');
      assertEqual(lifecycleProbe.viewportTimerOwnership, true, 'Viewport destroy/re-init must cancel stale zoom timers before new interaction state');
      assertEqual(lifecycleProbe.rootViewportPreservedAfterBootstrap, true, 'Bootstrap loader must reset its owning viewport, not the global app viewport');
      assertEqual(lifecycleProbe.idempotent, true, 'Repeated successful init must return true without rebuilding');
      assertEqual(lifecycleProbe.compendiumOpenBeforeDestroy, true, 'Teardown probe must open the compendium before destroy');
      assertEqual(lifecycleProbe.compendiumHiddenAfterDestroy, true, 'Application destroy must hide the compendium overlay');
      assertEqual(lifecycleProbe.centerHookClearedAfterDestroy, true, 'Application destroy must clear the tooltip center hook');
      assertEqual(lifecycleProbe.compendiumHookClearedAfterDestroy, true, 'Application destroy must clear the compendium hook');
      assertEqual(lifecycleProbe.testHookClearedAfterDestroy, true, 'Application destroy must clear the test hook');
      assertEqual(lifecycleProbe.restarted, true, 'Application must reinitialize after a full teardown');
      assertEqual(lifecycleProbe.simulationShareOpenBeforeDestroy, true, 'Teardown probe must open the simulation share panel');
      assertEqual(lifecycleProbe.simulationShareWidgetClosedAfterDestroy, true, 'Application destroy must close the simulation share panel');
      assertEqual(lifecycleProbe.simulationTopCapsuleHiddenAfterDestroy, true, 'Application destroy must hide the simulation top capsule');
      assertEqual(lifecycleProbe.simulationBodyClassAfterDestroy, false, 'Application destroy must clear the simulation body state');
      assertEqual(lifecycleProbe.loaderViewportPreserved, true, 'Loader timers must not reset a destroyed viewport');
      assertEqual(lifecycleProbe.delayedBootstrapCancelled, true, 'Destroy must cancel an in-flight bootstrap before views are rebuilt');
      passedAssertions += 19;
    } finally {
      await lifecycleProbePage.close();
    }

    // A destroyed application must not leave loader body-class callbacks that
    // can mutate the next bootstrap's entering state. Intercept the timers so
    // this ownership contract remains deterministic across browser speeds.
    const loaderRacePage = await browserInstance.context.newPage();
    try {
      await loaderRacePage.addInitScript(() => {
        window.__BLOCK_DISMISS_LOADER__ = true;
      });
      await loaderRacePage.goto(`${baseUrl}/index.html?loader-race-probe=1`, { waitUntil: 'networkidle' });
      await loaderRacePage.waitForSelector('button.tree-node-semantic[data-node-id]', { timeout: 5000 });
      const loaderRace = await loaderRacePage.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        window.__BLOCK_DISMISS_LOADER__ = false;
        const { dismissLoader } = await import('./src/main.js');
        const nativeSetTimeout = window.setTimeout;
        const scheduled = [];
        const firstOwner = {};
        const newOwner = {};
        const viewport = { resetToCenter() {} };
        window.setTimeout = (callback, delay) => {
          scheduled.push({ callback, delay });
          return scheduled.length;
        };
        try {
          document.body.classList.remove('app-entering', 'is-minimap-active');
          dismissLoader(() => true, viewport, firstOwner);
          const firstCallbacks = scheduled.splice(0);
          dismissLoader(() => true, viewport, newOwner);
          const newCallbacks = scheduled.splice(0);
          firstCallbacks.forEach(({ callback }) => callback());
          const staleCallbacksIgnored = document.body.classList.contains('app-entering');
          newCallbacks.forEach(({ callback }) => callback());
          return {
            staleCallbacksIgnored,
            firstTimerCount: firstCallbacks.length,
            newTimerCount: newCallbacks.length
          };
        } finally {
          window.setTimeout = nativeSetTimeout;
          delete window.__RD2_LOADER_OWNER__;
          document.body.classList.remove('app-entering', 'is-minimap-active');
        }
      });
      assertEqual(loaderRace.firstTimerCount, 2, 'Loader dismissal must schedule its two owned callbacks');
      assertEqual(loaderRace.newTimerCount, 2, 'A new loader owner must schedule its two callbacks');
      assertEqual(loaderRace.staleCallbacksIgnored, true, 'Stale loader callbacks must not clear the new entering state');
      passedAssertions += 3;
    } finally {
      await loaderRacePage.close();
    }

    // Locale selector is a sibling widget to the changelog and must keep the
    // same compact surface geometry while updating every visible document key.
    const widgetGeometry = await page.evaluate(() => {
      const changelog = document.getElementById('changelog-widget')?.getBoundingClientRect();
      const locale = document.getElementById('locale-widget')?.getBoundingClientRect();
      return {
        changelogRight: changelog?.right ?? 0,
        localeLeft: locale?.left ?? 0,
        localeWidth: locale?.width ?? 0,
        localeHeight: locale?.height ?? 0
      };
    });
    assert(widgetGeometry.localeLeft >= widgetGeometry.changelogRight - 1, 'Locale widget must be placed to the right of the changelog widget');
    assert(widgetGeometry.localeWidth > 0 && widgetGeometry.localeHeight > 0, 'Locale widget must have a visible compact surface');
    const localeChecks = [
      {
        key: 'zh-tw',
        placeholder: '搜尋骰子',
        title: 'Random Dice 2 Lab｜骰子樹、圖鑑與配點工具',
        unlockLabels: {
          '4008': '七日任務 700',
          '5002': '合作擊殺數 900',
          '5006': '討伐獎勵 2100',
          '5008': '競技場通行證 300',
          '1106': '自然等級 10',
          '1107': '自然等級 30',
          '1108': '自然等級 50',
          '2106': '工學等級 10',
          '2107': '工學等級 30',
          '2108': '工學等級 50',
          '3106': '魔法等級 10',
          '3107': '魔法等級 30',
          '3108': '魔法等級 50',
        },
      },
      {
        key: 'en',
        placeholder: 'Search dice',
        title: 'Random Dice 2 Lab | Dice tree, compendium, and build planner',
        unlockLabels: {
          '4008': 'Seven-day mission 700',
          '5002': 'Co-op kills 900',
          '5006': 'Bounty reward 2100',
          '5008': 'Arena pass 300',
          '1106': 'Nature level 10',
          '1107': 'Nature level 30',
          '1108': 'Nature level 50',
          '2106': 'Engineering level 10',
          '2107': 'Engineering level 30',
          '2108': 'Engineering level 50',
          '3106': 'Magic level 10',
          '3107': 'Magic level 30',
          '3108': 'Magic level 50',
        },
      },
      {
        key: 'ja',
        placeholder: 'ダイス',
        title: 'Random Dice 2 Lab｜ダイスツリー・図鑑・ビルドプランナー',
        unlockLabels: {
          '4008': '7日ミッション 700',
          '5002': '協力撃破数 900',
          '5006': '討伐報酬 2100',
          '5008': 'アリーナパス 300',
          '1106': '自然レベル 10',
          '1107': '自然レベル 30',
          '1108': '自然レベル 50',
          '2106': '工学レベル 10',
          '2107': '工学レベル 30',
          '2108': '工学レベル 50',
          '3106': '魔法レベル 10',
          '3107': '魔法レベル 30',
          '3108': '魔法レベル 50',
        },
      },
      {
        key: 'ko',
        placeholder: '주사위',
        title: 'Random Dice 2 Lab | 주사위 트리·도감·빌드 플래너',
        unlockLabels: {
          '4008': '7일 임무 700',
          '5002': '협동 처치 수 900',
          '5006': '토벌 보상 2100',
          '5008': '아레나 패스 300',
          '1106': '자연 레벨 10',
          '1107': '자연 레벨 30',
          '1108': '자연 레벨 50',
          '2106': '공학 레벨 10',
          '2107': '공학 레벨 30',
          '2108': '공학 레벨 50',
          '3106': '마법 레벨 10',
          '3107': '마법 레벨 30',
          '3108': '마법 레벨 50',
        },
      },
    ];
    passedAssertions += await runLocaleChecks(page, localeChecks);

    // A fresh client without a stored choice should follow its browser
    // language.  The main test context is explicitly Traditional Chinese so
    // the rest of this suite keeps stable content expectations.
    clientLocaleBrowser = await createTestBrowser({
      browserType: options.browser || 'chromium',
      headless: options.headless !== false,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US'
    });
    const clientLocalePage = clientLocaleBrowser.page;
    await clientLocalePage.goto(`${baseUrl}/index.html?client-locale-detection=1`, { waitUntil: 'networkidle' });
    await clientLocalePage.waitForFunction(() => document.documentElement.lang === 'en');
    const clientLocaleUi = await clientLocalePage.evaluate(() => ({
      language: document.documentElement.lang,
      placeholder: document.querySelector('#search-input')?.getAttribute('placeholder') || '',
      option: document.querySelector('#locale-widget [data-locale="en"]')?.getAttribute('aria-pressed') || ''
    }));
    assertEqual(clientLocaleUi.language, 'en', 'A fresh client must follow its browser locale');
    assert(clientLocaleUi.placeholder.includes('Search dice'), 'Client locale detection must localize the search placeholder');
    assertEqual(clientLocaleUi.option, 'true', 'Detected client locale must be marked active');
    passedAssertions += 3;
    assertNoUnexpectedBrowserDiagnostics(clientLocaleBrowser, 'client locale detection', {
      allowedConsoleErrors: [/Failed to load resource: the server responded with a status of 503/i]
    });
    await clientLocaleBrowser.close();
    clientLocaleBrowser = null;

    assertNoUnexpectedBrowserDiagnostics(browserInstance, 'smoke suite', {
      allowedConsoleErrors: [/Failed to load resource: the server responded with a status of 503/i]
    });
    const durationMs = Date.now() - startTime;
    console.log(`\n🎉 Smoke Suite Passed! (${passedAssertions} assertions in ${(durationMs / 1000).toFixed(2)}s)`);

    return {
      suite: 'smoke',
      name: 'Tier 1 Smoke Suite',
      passed: true,
      durationMs,
      assertions: passedAssertions,
      errors: [],
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`\n❌ Smoke Suite Failed in ${(durationMs / 1000).toFixed(2)}s:`, err);
    const failure = await captureFailureArtifacts({
      suiteName: 'smoke',
      error: err,
      browser: options.browser || process.env.TEST_BROWSER || 'chromium',
      browserInstance,
      baseUrl: serverInstance?.baseUrl
    });
    return {
      suite: 'smoke',
      name: 'Tier 1 Smoke Suite',
      passed: false,
      durationMs,
      assertions: passedAssertions,
      errors: [failure.message],
      diagnostics: failure
    };
  } finally {
    if (clientLocaleBrowser) await clientLocaleBrowser.close();
    if (browserInstance) await browserInstance.close();
    if (serverInstance) await serverInstance.close();
  }
}

const directEntry = process.argv[1];
if (directEntry?.endsWith('smoke.suite.mjs')) {
  const result = await runSmokeSuite();
  process.exitCode = result.passed ? 0 : 1;
}
