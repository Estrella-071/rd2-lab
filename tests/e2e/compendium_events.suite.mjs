/**
 * Tier 1/2/3/4 Compendium & Wave Events Suite
 * 涵蓋 41 顆骰子卡片、派系切換、簡潔網格模式、自訂排序下拉選單、
 * SP 魔像 1/30 3-stat 同步與反向同步、怪物 SP 掉落分階、71 筆戰術事件與 1-to-3 心智圖分支
 */
import { startTestServer, createTestBrowser } from '../helpers/test_server.mjs';
import { assert, assertEqual, assertNoUnexpectedBrowserDiagnostics, captureFailureArtifacts } from '../helpers/test_utils.mjs';

export async function runCompendiumEventsSuite(options = {}) {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('📖 [E2E] Running Compendium & Events Suite...');
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
      viewport: { width: 1440, height: 900 }
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

    // ID-based event links must continue to resolve before any current
    // filtering is applied.  This is the same path historical event links use.
    await page.goto(`${baseUrl}/index.html?event=event_6&event_mode=versus`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });
    await page.waitForSelector('#compendium-dice-modal:not([hidden])', { timeout: 3000 });
    const sharedEvent = await page.$eval('#compendium-modal-card-slot .is-event-card', (card) => ({
      title: card.querySelector('.tooltip-title')?.textContent.trim(),
      body: card.textContent.includes('召喚1個3骰點骰子')
    }));
    assertEqual(sharedEvent.title, '召喚精英', 'ID-based event link should open the requested event card');
    assert(sharedEvent.body, 'ID-based event link should retain event details');
    passedAssertions += 2;

    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('g.node[data-node-id]', { timeout: 5000 });
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 5000 });

    // ==========================================
    // Tier 1: 圖鑑開啟、41 骰子卡片與派系篩選
    // ==========================================
    console.log('--- Tier 1: Dice Compendium & Branch Tabs ---');
    const coreBtn = await page.$('#tree-center-compendium-btn');
    assert(coreBtn, 'Tree center compendium button must exist');
    await coreBtn.focus();
    await coreBtn.click({ force: true });
    await page.waitForSelector('#compendium-overlay:not([hidden])', { timeout: 3000 });

    const totalDiceCards = await page.$$eval('.compendium-card', els => els.length);
    assertEqual(totalDiceCards, 41, 'Must show 41 dice cards in compendium');
    passedAssertions++;
    assertEqual(new URL(page.url()).pathname, '/zh-tw/compendium/dice', 'Opening the dice compendium must update its canonical collection URL');
    passedAssertions++;

    const fireCardFeatures = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-dice-node'))
        .find((element) => element.querySelector('.tooltip-title')?.textContent.trim() === '火骰子');
      const awakening = Array.from(card?.querySelectorAll('.detail-section') || [])
        .find((section) => section.querySelector('.section-label')?.textContent.trim() === '覺醒效果');
      return {
        hasCard: Boolean(card),
        awakeningText: awakening?.querySelector('.detail-copy')?.textContent.trim() || '',
        hasBurnTag: Boolean(awakening?.querySelector('[data-tag-key="BURN"]')),
        actionLabels: Array.from(card?.querySelectorAll('.dice-upgrade-btn') || []).map((button) => button.textContent.trim()),
        baseAttack: card?.querySelector('.dice-stat-item .stat-base-val')?.textContent.trim() || ''
      };
    });
    assert(fireCardFeatures.hasCard, 'Fire dice must render as a full compendium card');
    assert(fireCardFeatures.awakeningText.length > 0 && fireCardFeatures.hasBurnTag, 'Dice compendium cards must expose awakening effects');
    assertEqual(fireCardFeatures.actionLabels.join('|'), '強化|提升骰點', 'Dice compendium cards must expose localized upgrade actions');
    assertEqual(fireCardFeatures.baseAttack, '150', 'Compendium dice stats must retain the canonical base attack');
    passedAssertions += 4;

    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-dice-node'))
        .find((element) => element.querySelector('.tooltip-title')?.textContent.trim() === '火骰子');
      card?.querySelector('.btn-powerup')?.click();
      card?.querySelector('.btn-dot')?.click();
    });
    await page.waitForTimeout(100);
    const fireCardBonus = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-dice-node'))
        .find((element) => element.querySelector('.tooltip-title')?.textContent.trim() === '火骰子');
      const attack = card?.querySelector('.dice-stat-item .dice-stat-bonus-atk-combined');
      return {
        powerupLabel: card?.querySelector('.btn-powerup')?.textContent.trim() || '',
        dotLabel: card?.querySelector('.btn-dot')?.textContent.trim() || '',
        combinedVisible: Boolean(attack && !attack.hidden),
        combinedValue: attack?.textContent.trim() || '',
        powerupValue: attack?.dataset.powerupValue || '',
        dotValue: attack?.dataset.dotValue || ''
      };
    });
    assertEqual(fireCardBonus.powerupLabel, '2', 'Compendium power-up action must advance its preview level');
    assertEqual(fireCardBonus.dotLabel, '2', 'Compendium pip action must advance its preview level');
    assert(fireCardBonus.combinedVisible && fireCardBonus.combinedValue.includes('(+250)'), 'Compendium must combine same-sign attack bonuses');
    assertEqual(fireCardBonus.powerupValue, '+150', 'Combined attack bonus must retain the power-up component');
    assertEqual(fireCardBonus.dotValue, '+100', 'Combined attack bonus must retain the pip component');
    passedAssertions += 4;

    const fireCardBonusFonts = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-dice-node'))
        .find((element) => element.querySelector('.tooltip-title')?.textContent.trim() === '火骰子');
      const combined = card?.querySelector('.dice-stat-bonus-atk-combined');
      const single = card?.querySelector('.dice-stat-bonus-atk-powerup');
      return {
        combined: combined ? getComputedStyle(combined).fontSize : '',
        single: single ? getComputedStyle(single).fontSize : ''
      };
    });
    assertEqual(fireCardBonusFonts.combined, fireCardBonusFonts.single, 'Combined stat values must match individual bonus font sizing');
    passedAssertions++;

    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-dice-node'))
        .find((element) => element.querySelector('.tooltip-title')?.textContent.trim() === '火骰子');
      card?.querySelector('.dice-stat-bonus-atk-combined')?.click();
    });
    await page.waitForTimeout(100);
    const compendiumBonusPopover = await page.$eval('#stat-bonus-popover', (popover) => ({
      visible: !popover.hidden,
      details: popover.textContent.trim()
    }));
    assert(compendiumBonusPopover.visible, 'Compendium combined stat value must open the shared bonus detail popover');
    assert(compendiumBonusPopover.details.includes('+150') && compendiumBonusPopover.details.includes('+100'), 'Bonus detail popover must split both compendium bonus components');
    passedAssertions += 2;
    await page.evaluate(() => window.RD2App.views.tooltipView?.hideBonusPopover());

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const mobileCompendiumLayout = await page.evaluate(() => {
      const header = document.querySelector('.compendium-header');
      const controls = document.querySelector('.compendium-controls');
      const tabs = document.querySelector('.compendium-tabs:not([hidden])');
      const body = document.querySelector('.compendium-card.is-dice-node .tooltip-body');
      const controlOrder = [...document.querySelectorAll('.compendium-controls > .compendium-sort-widget, .compendium-controls > .compendium-search-wrap, .compendium-controls > .compendium-view-toggle')]
        .filter((element) => !element.hidden && getComputedStyle(element).display !== 'none')
        .sort((left, right) => Number.parseInt(getComputedStyle(left).order, 10) - Number.parseInt(getComputedStyle(right).order, 10))
        .map((element) => element.className.split(' ')[0]);
      const headerRect = header?.getBoundingClientRect();
      const controlsRect = controls?.getBoundingClientRect();
      const tabsRect = tabs?.getBoundingClientRect();
      return {
        headerHeight: headerRect?.height || 0,
        controlsInsideHeader: Boolean(headerRect && controlsRect && controlsRect.bottom <= headerRect.bottom + 0.5),
        tabsInsideHeader: Boolean(headerRect && tabsRect && tabsRect.bottom <= headerRect.bottom + 0.5),
        controlOrder,
        bodyScrollable: Boolean(body && body.scrollHeight > body.clientHeight + 1),
        bodyOverflowY: body ? getComputedStyle(body).overflowY : ''
      };
    });
    assert(mobileCompendiumLayout.headerHeight <= 132, `Mobile compendium header should remain compact, got ${mobileCompendiumLayout.headerHeight}px`);
    assert(mobileCompendiumLayout.controlsInsideHeader && mobileCompendiumLayout.tabsInsideHeader, 'Mobile compendium controls must remain inside the header surface');
    assertEqual(mobileCompendiumLayout.controlOrder.join('|'), 'compendium-sort-widget|compendium-search-wrap|compendium-view-toggle', 'Mobile dice controls must read sort, search, then view mode');
    assert(!mobileCompendiumLayout.bodyScrollable && mobileCompendiumLayout.bodyOverflowY === 'visible', 'Mobile dice cards must grow with content instead of scrolling internally');
    passedAssertions += 4;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(150);

    const compendiumDialogContract = await page.$eval('#compendium-overlay', (overlay) => ({
      role: overlay.getAttribute('role'),
      modal: overlay.getAttribute('aria-modal')
    }));
    assertEqual(compendiumDialogContract.role, 'dialog', 'Full-screen compendium should expose dialog semantics');
    assertEqual(compendiumDialogContract.modal, 'true', 'Full-screen compendium should expose modal semantics');
    await page.focus('#compendium-back-btn');
    await page.keyboard.press('Shift+Tab');
    const wrappedFocusInsideCompendium = await page.evaluate(() => (
      document.getElementById('compendium-overlay')?.contains(document.activeElement)
    ));
    assert(wrappedFocusInsideCompendium, 'Shift+Tab from the first control should wrap inside the compendium');
    passedAssertions += 3;

    await page.click('#compendium-category-toggle-btn');
    const expandedCategoryContract = await page.evaluate(() => ({
      expanded: document.getElementById('compendium-category-toggle-btn')?.getAttribute('aria-expanded'),
      hidden: document.getElementById('compendium-category-menu')?.getAttribute('aria-hidden'),
      inert: document.getElementById('compendium-category-menu')?.inert
    }));
    assertEqual(expandedCategoryContract.expanded, 'true', 'Category toggle should expose its expanded state');
    assertEqual(expandedCategoryContract.hidden, 'false', 'Expanded category options should be exposed to assistive technology');
    assertEqual(expandedCategoryContract.inert, false, 'Expanded category options should be keyboard reachable');
    await page.keyboard.press('Escape');
    const collapsedCategoryContract = await page.evaluate(() => ({
      overlayOpen: !document.getElementById('compendium-overlay')?.hidden,
      expanded: document.getElementById('compendium-category-toggle-btn')?.getAttribute('aria-expanded'),
      hidden: document.getElementById('compendium-category-menu')?.getAttribute('aria-hidden'),
      inert: document.getElementById('compendium-category-menu')?.inert,
      focusId: document.activeElement?.id
    }));
    assert(collapsedCategoryContract.overlayOpen, 'Escape from an expanded category menu should keep the compendium open');
    assertEqual(collapsedCategoryContract.expanded, 'false', 'Escape should collapse the category menu');
    assertEqual(collapsedCategoryContract.hidden, 'true', 'Collapsed category options should be hidden from assistive technology');
    assertEqual(collapsedCategoryContract.inert, true, 'Collapsed category options should leave the tab order');
    assertEqual(collapsedCategoryContract.focusId, 'compendium-category-toggle-btn', 'Collapsing a category menu should restore focus to its toggle');
    await page.keyboard.press('ArrowDown');
    const arrowOpenedCategoryContract = await page.evaluate(() => ({
      expanded: document.getElementById('compendium-category-toggle-btn')?.getAttribute('aria-expanded'),
      focusedRole: document.activeElement?.getAttribute('role'),
      focusedValue: document.activeElement?.dataset.value
    }));
    assertEqual(arrowOpenedCategoryContract.expanded, 'true', 'ArrowDown should expand the category listbox');
    assertEqual(arrowOpenedCategoryContract.focusedRole, 'option', 'ArrowDown should move focus to a category option');
    assertEqual(arrowOpenedCategoryContract.focusedValue, 'monster', 'ArrowDown should focus the first available category');
    await page.keyboard.press('Escape');
    const arrowClosedCategoryContract = await page.evaluate(() => ({
      overlayOpen: !document.getElementById('compendium-overlay')?.hidden
        && document.getElementById('compendium-overlay')?.getAttribute('aria-hidden') !== 'true',
      expanded: document.getElementById('compendium-category-toggle-btn')?.getAttribute('aria-expanded'),
      focusId: document.activeElement?.id
    }));
    assert(arrowClosedCategoryContract.overlayOpen, 'Escape from a focused category option should keep the compendium open');
    assertEqual(arrowClosedCategoryContract.expanded, 'false', 'Escape from an option should collapse only the category menu');
    assertEqual(arrowClosedCategoryContract.focusId, 'compendium-category-toggle-btn', 'Closing an option list should restore focus to its toggle');
    passedAssertions += 14;

    await page.click('#compendium-back-btn');
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });
    const compendiumReturnFocus = await page.evaluate(() => document.activeElement?.id || '');
    assertEqual(compendiumReturnFocus, 'tree-center-compendium-btn', 'Closing compendium should restore focus to its opener');
    passedAssertions++;

    await coreBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#compendium-overlay:not([hidden])', { timeout: 3000 });
    const keyboardCompendiumState = await page.evaluate(() => ({
      open: !document.getElementById('compendium-overlay')?.hidden,
      focusId: document.activeElement?.id || ''
    }));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });
    const keyboardCompendiumClosed = await page.evaluate(() => ({
      hidden: document.getElementById('compendium-overlay')?.hidden,
      focusId: document.activeElement?.id || ''
    }));
    assert(
      keyboardCompendiumState.open &&
        keyboardCompendiumState.focusId === 'compendium-back-btn' &&
        keyboardCompendiumClosed.hidden &&
        keyboardCompendiumClosed.focusId === 'tree-center-compendium-btn',
      'Tree center compendium Enter path must move focus into the view and Escape must close it back to the opener'
    );
    passedAssertions++;

    await coreBtn.focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('#compendium-overlay:not([hidden])', { timeout: 3000 });
    assert(await page.$eval('#compendium-overlay', (el) => !el.hidden), 'Tree center compendium button must activate with Space');
    passedAssertions++;
    await page.click('#compendium-back-btn');
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });

    await page.click('#tree-center-compendium-btn', { force: true });
    await page.waitForSelector('#compendium-overlay:not([hidden])', { timeout: 3000 });

    // 自然派系 Tab (Branch 1) -> 8 顆骰子
    await page.click('.compendium-tab[data-branch="1"]');
    await page.waitForTimeout(200);
    const natureDiceCount = await page.$$eval('.compendium-card', els => els.length);
    assertEqual(natureDiceCount, 8, 'Nature branch should have 8 dice');
    passedAssertions++;

    // 驗證尖刺骰子只呈現 raw client 有穩定本地化鍵的屬性，不以未標籤的
    // Range 欄位猜測或沿用舊的手動「尖刺範圍」資料。
    const thornLabels = await page.$$eval('.compendium-card:nth-of-type(2) .dice-stat-label', els => els.map(e => e.textContent.trim()));
    assert(!thornLabels.includes('zh-tw'), 'Thorn labels must not contain raw "zh-tw"');
    assert(thornLabels.includes('尖刺持續時間'), 'Thorn labels must contain the raw-backed duration label');
    assert(!thornLabels.includes('尖刺範圍'), 'Thorn labels must not guess an unlabeled raw Range field');
    passedAssertions += 3;

    const flowerText = await page.$$eval('.compendium-card', cards => {
      const flower = cards.find(card => card.textContent.includes('花骰子'));
      return flower?.textContent || '';
    });
    assert(flowerText.includes('綻放持續時間'), 'Flower card must expose the semantic Bloom duration label');
    assert(flowerText.includes('60s'), 'Flower card must show the raw-backed 60-second Bloom duration');
    passedAssertions += 2;

    // 渾沌派系 Tab (Branch 5) -> 9 顆骰子
    await page.click('.compendium-tab[data-branch="5"]');
    await page.waitForTimeout(200);
    const chaosDiceCount = await page.$$eval('.compendium-card', els => els.length);
    assertEqual(chaosDiceCount, 9, 'Chaos branch should have 9 dice');
    passedAssertions++;

    // 渾沌第一張卡片專屬效果 1/50 滑桿與滿級綠色增量隱藏
    const rankBadgeBtn = await page.$('.compendium-card:first-of-type .rune-rank-badge-btn');
    assert(rankBadgeBtn, 'Rune rank badge button must exist');
    await rankBadgeBtn.click();
    await page.waitForTimeout(150);

    const popoverVisible = await page.$eval('.compendium-card:first-of-type .rune-slider-popover', el => !el.hidden);
    assert(popoverVisible, 'Rune slider popover must be visible');
    passedAssertions++;

    await page.$eval('.compendium-card:first-of-type .rune-slider-popover .rank-slider-input', el => {
      el.value = '50';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(100);

    const maxDesc = await page.$eval('.compendium-card:first-of-type .compendium-rune-item:first-of-type .compendium-rune-desc', el => el.textContent.trim());
    assert(!maxDesc.includes('(+'), 'Max rank (50/50) description must hide green increment');
    passedAssertions++;

    // 光明派系 Tab (Branch 2) -> 齒輪骰子無誤植 (+%)
    await page.click('.compendium-tab[data-branch="2"]');
    await page.waitForTimeout(200);
    const gearText = await page.$$eval('.compendium-card', cards => {
      const gear = cards.find(c => c.textContent.includes('齒輪骰子'));
      return gear ? gear.textContent : '';
    });
    assert(!gearText.includes('(+%)'), 'Gear dice card should not contain invalid (+%) typo');
    passedAssertions++;

    const ironText = await page.$$eval('.compendium-card', cards => {
      const iron = cards.find(c => c.textContent.includes('鐵甲骰子'));
      return iron ? iron.textContent : '';
    });
    assert(ironText.includes('首領額外傷害'), 'Iron dice card should retain the raw skill stat');
    assert(ironText.includes('首領傷害倍率'), 'Iron dice card should expose DefenderTable BossAttackPer');
    assert(ironText.includes('200%'), 'Iron dice card should show the raw BossAttackPer value');
    passedAssertions += 3;

    // Compendium tag explanations must reuse the global popover and remain above cards.
    const compendiumTag = await page.$('.compendium-card .tooltip-tag-inline');
    assert(compendiumTag, 'Compendium must render at least one interactive tag');
    const compendiumTagKey = await compendiumTag.getAttribute('data-tag-key');
    const compendiumTagDefinition = await page.evaluate((key) => window.TREE_DATA?.tag_definitions?.[key], compendiumTagKey);
    assert(compendiumTagDefinition?.name_zh && compendiumTagDefinition?.desc_zh, 'Compendium tag must have a localized definition');
    await page.evaluate(() => {
      window.__RD2_TAG_TEST_DATA__ = window.TREE_DATA;
      delete window.TREE_DATA;
    });
    await compendiumTag.click();
    await page.waitForTimeout(150);
    const tagPopoverInfo = await page.evaluate(() => {
      const popover = document.getElementById('tag-popover');
      return {
        visible: Boolean(popover && !popover.hidden && popover.getBoundingClientRect().width > 0),
        zIndex: Number.parseInt(popover ? window.getComputedStyle(popover).zIndex : '0', 10),
        badge: document.getElementById('tag-popover-badge')?.textContent.trim(),
        description: document.getElementById('tag-popover-desc')?.textContent.trim(),
      };
    });
    assert(tagPopoverInfo.visible, 'Compendium tag click must open the shared popover');
    assert(tagPopoverInfo.zIndex >= 2000, `Compendium tag popover must remain above cards (z-index ${tagPopoverInfo.zIndex})`);
    assert(tagPopoverInfo.badge?.startsWith('#'), 'Compendium tag popover must show a localized hashtag badge');
    assertEqual(tagPopoverInfo.badge, `#${compendiumTagDefinition.name_zh}`, 'Compendium tag popover badge must use the localized tag name');
    assertEqual(tagPopoverInfo.description, compendiumTagDefinition.desc_zh, 'Compendium tag popover must show the tag mechanism description');
    await page.evaluate(() => {
      window.TREE_DATA = window.__RD2_TAG_TEST_DATA__;
      delete window.__RD2_TAG_TEST_DATA__;
    });
    passedAssertions += 5;

    // 點擊「在地圖中定位」按鈕 -> 收縮圖鑑並聚焦節點
    const locateBtn = await page.$('.compendium-card .card-locate-btn');
    assert(locateBtn, 'Compendium dice cards must expose a locate control');
    await locateBtn.click();
    await page.waitForTimeout(800);
    const afterLocate = await page.evaluate(() => ({
      isOverlayHidden: document.querySelector('#compendium-overlay').hidden,
      isTooltipVisible: !document.querySelector('#tooltip').hidden,
    }));
    assert(afterLocate.isOverlayHidden, 'Compendium overlay should close after locate click');
    assert(afterLocate.isTooltipVisible, 'Tooltip should be visible after locate click');
    passedAssertions += 3;

    // 重新打開圖鑑
    await page.evaluate(() => window.__COMPENDIUM_HOOKS__.open());
    await page.waitForTimeout(600);

    // ==========================================
    // Tier 1: 簡潔網格模式 (Compact Grid View) 與 Modal
    // ==========================================
    console.log('--- Tier 1: Compact Grid View & Modal ---');
    await page.click('.compendium-tab[data-branch="all"]');
    await page.waitForTimeout(200);

    await page.click('.view-toggle-btn[data-mode="grid"]');
    await page.waitForTimeout(300);

    const compactCount = await page.$$eval('.compendium-compact-item', els => els.length);
    assertEqual(compactCount, 41, 'Compact grid must display 41 dice items');
    passedAssertions++;

    // 點擊網格項目開啟 Modal
    await page.click('.compendium-compact-item:first-of-type');
    await page.waitForTimeout(200);
    const modalOpen = await page.$eval('#compendium-dice-modal', el => !el.hidden);
    assert(modalOpen, 'Modal should open when compact dice item is clicked');
    const modalInitialFocus = await page.evaluate(() => document.activeElement?.id || '');
    assertEqual(modalInitialFocus, 'compendium-modal-close', 'Compact modal should focus its close control');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const modalClosed = await page.$eval('#compendium-dice-modal', el => el.hidden);
    assert(modalClosed, 'Escape should close the compact modal');
    const modalReturnFocus = await page.evaluate(() => document.activeElement?.classList.contains('compendium-compact-item'));
    assert(modalReturnFocus, 'Closing compact modal should restore focus to its opener');
    await page.click('.compendium-compact-item:first-of-type');
    await page.waitForTimeout(150);
    await page.click('#compendium-modal-close');
    await page.waitForTimeout(200);
    const modalClickClosed = await page.$eval('#compendium-dice-modal', el => el.hidden);
    assert(modalClickClosed, 'Modal close button should close the compact modal');
    passedAssertions += 5;

    // 切換回卡片模式
    await page.click('.view-toggle-btn[data-mode="cards"]');
    await page.waitForTimeout(300);

    // 自訂排序選單測試 (攻擊力 高到低)
    console.log('--- Tier 1/2: Compendium Custom Sort Dropdown ---');
    await page.click('#compendium-sort-toggle-btn');
    await page.waitForTimeout(200);

    const sortSurfaceExpanded = await page.$eval('#compendium-sort-widget', el => el.classList.contains('is-expanded'));
    assert(sortSurfaceExpanded, 'Sort widget must expand on toggle');
    passedAssertions++;

    await page.click('.sort-option-item[data-value="damage-desc"]');
    await page.waitForTimeout(300);

    const topCardAtk = await page.evaluate(() => {
      const firstCardAtk = document.querySelector('.compendium-card .dice-stat-item .stat-base-val')?.textContent.trim();
      return Number.parseInt(firstCardAtk || '0', 10);
    });
    assert(topCardAtk >= 500, `Top card attack after damage-desc sort should be high (>=500), got: ${topCardAtk}`);
    passedAssertions++;

    // 切換回預設排序
    await page.click('#compendium-sort-toggle-btn');
    await page.waitForTimeout(200);
    await page.click('.sort-option-item[data-value="default"]');
    await page.waitForTimeout(200);

    // ==========================================
    // Tier 2: 怪物圖鑑、SP 掉落分階與 SP 魔像 1/30 3-Stat 同步/反向同步
    // ==========================================
    console.log('--- Tier 2: Monster Compendium & SP Golem 1/30 Sync ---');
    await page.click('#compendium-category-toggle-btn');
    await page.waitForTimeout(200);
    await page.click('.category-option-item[data-value="monster"]');
    await page.waitForTimeout(400);
    assertEqual(new URL(page.url()).pathname, '/zh-tw/compendium/monster', 'Opening the monster compendium must update its canonical collection URL');
    passedAssertions++;

    // A rapid close→open must not let the stale close timer hide the newly
    // reopened overlay.
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const view = window.RD2App.views.compendiumView;
      const opener = document.getElementById('tree-center-compendium-btn');
      view.close();
      view.open(opener);
    });
    await page.waitForTimeout(500);
    const rapidReopenState = await page.evaluate(() => ({
      overlayHidden: document.getElementById('compendium-overlay')?.hidden,
    }));
    assert(!rapidReopenState.overlayHidden, 'Rapid compendium close/reopen must keep the overlay visible');
    passedAssertions++;

    // 怪物難度 Tabs (一般 / 困難橘色)
    const monsterTabsInfo = await page.evaluate(() => {
      const container = document.getElementById('compendium-monster-tabs');
      const isVisible = container && !container.hidden;
      const normalTab = container?.querySelector('[data-monster-difficulty="normal"]');
      const hardTab = container?.querySelector('[data-monster-difficulty="hard"]');
      return {
        isVisible,
        normalActive: normalTab?.classList.contains('is-active'),
        hardActive: hardTab?.classList.contains('is-active'),
        hardColor: hardTab?.style.getPropertyValue('--tab-color')?.trim()
      };
    });
    assert(monsterTabsInfo.isVisible, 'Monster difficulty tabs should be visible');
    assert(monsterTabsInfo.normalActive, 'Normal difficulty tab should be active by default');
    assertEqual(monsterTabsInfo.hardColor, '#F59E0B', 'Hard difficulty tab color should be #F59E0B');
    passedAssertions += 3;

    // 點擊困難 Tab 彈出 Coming Soon Modal 並能關閉恢復
    await page.click('#compendium-monster-tabs [data-monster-difficulty="hard"]');
    await page.waitForTimeout(200);
    const modalTitle = await page.$eval('#coming-soon-modal .coming-soon-title', el => el.textContent.trim());
    const expectedComingSoonTitle = await page.evaluate(() => window.RD2App.localization.t('common.comingSoon'));
    assertEqual(modalTitle, expectedComingSoonTitle, 'Hard tab click should show the localized Coming Soon modal');
    const comingSoonInitialFocus = await page.evaluate(() => document.activeElement?.id || '');
    assertEqual(comingSoonInitialFocus, 'coming-soon-close-btn', 'Coming Soon modal should focus its close control');
    await page.keyboard.press('Tab');
    const comingSoonTabFocus = await page.evaluate(() => document.activeElement?.id || '');
    assertEqual(comingSoonTabFocus, 'coming-soon-close-btn', 'Coming Soon modal Tab navigation should remain inside the modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const normalRestored = await page.$eval('#compendium-monster-tabs [data-monster-difficulty="normal"]', el => el.classList.contains('is-active'));
    assert(normalRestored, 'Normal tab should be restored after closing Coming Soon modal');
    const comingSoonReturnFocus = await page.evaluate(() => document.activeElement?.dataset.monsterDifficulty || '');
    assertEqual(comingSoonReturnFocus, 'hard', 'Closing Coming Soon modal should restore focus to its opener');
    passedAssertions += 5;

    await page.click('.view-toggle-btn[data-mode="grid"]');
    await page.click('.compendium-compact-item:first-of-type');
    await page.waitForSelector('#compendium-dice-modal:not([hidden])', { timeout: 3000 });
    await page.waitForSelector('#compendium-modal-card-slot .monster-static-poster', { state: 'visible', timeout: 5000 });
    const modalPosterBeforeClose = await page.evaluate(() => ({
      modalOpen: !document.getElementById('compendium-dice-modal')?.hidden,
      posterVisible: Boolean(document.querySelector('#compendium-modal-card-slot .monster-static-poster')),
      hasCanvas: Boolean(document.querySelector('#compendium-modal-card-slot canvas')),
    }));
    assert(modalPosterBeforeClose.modalOpen, 'Monster detail modal should remain open while its poster is available');
    assert(modalPosterBeforeClose.posterVisible, 'Monster detail should expose its static poster');
    assert(!modalPosterBeforeClose.hasCanvas, 'Monster detail should not create an additional rendering canvas');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('compendium-dice-modal')?.hidden);
    const modalPosterAfterClose = await page.evaluate(() => ({
      modalHidden: document.getElementById('compendium-dice-modal')?.hidden
    }));
    assert(modalPosterAfterClose.modalHidden, 'Closing monster detail should hide the compact modal');
    await page.click('.view-toggle-btn[data-mode="cards"]');
    await page.waitForSelector('.compendium-card', { state: 'visible' });
    passedAssertions += 4;

    // 一般怪物 SP 掉落分階測試 (1/7 合作 SP 滑動至 7 -> 80 SP; 1/11 競技 SP 滑動至 11 -> 30 SP)
    const normalMonsterCard = await page.$('.compendium-card.is-normal-monster');
    assert(normalMonsterCard, 'Normal monster card must exist');

    // 調整合作 SP 至第 7 階
    await page.evaluate(() => {
      const card = document.querySelector('.compendium-card.is-normal-monster');
      const item = card.querySelectorAll('.dice-stat-item')[2];
      const slider = item.querySelector('.rank-slider-input');
      if (slider) {
        slider.value = '7';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(200);

    const coopSp7 = await page.evaluate(() => {
      const card = document.querySelector('.compendium-card.is-normal-monster');
      const item = card.querySelectorAll('.dice-stat-item')[2];
      return item?.querySelector('.stat-base-val')?.textContent.trim();
    });
    assertEqual(coopSp7, '80 SP', 'Normal monster coop SP at stage 7 should be 80 SP');
    passedAssertions++;

    // 調整競技 SP 至第 11 回合
    await page.evaluate(() => {
      const card = document.querySelector('.compendium-card.is-normal-monster');
      const item = card.querySelectorAll('.dice-stat-item')[3];
      const slider = item.querySelector('.rank-slider-input');
      if (slider) {
        slider.value = '11';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(200);

    const vsSp11 = await page.evaluate(() => {
      const card = document.querySelector('.compendium-card.is-normal-monster');
      const item = card.querySelectorAll('.dice-stat-item')[3];
      return item?.querySelector('.stat-base-val')?.textContent.trim();
    });
    assertEqual(vsSp11, '30 SP', 'Normal monster versus SP at round 11 should be 30 SP');
    passedAssertions++;

    // SP 魔像 1/30 3-stat 同步與反向同步
    console.log('--- Tier 2: SP Golem 1/30 3-Stat Synchronization ---');
    const spGolemInitial = await page.evaluate(() => {
      const bossSection = Array.from(document.querySelectorAll('.compendium-branch-section')).find(s => s.textContent.includes('首領怪物'));
      const firstBossCard = bossSection?.querySelector('.compendium-card');
      const title = firstBossCard?.querySelector('.tooltip-title')?.textContent.trim();
      const statItems = Array.from(firstBossCard?.querySelectorAll('.dice-stat-item') || []);
      const hpVal = statItems[1]?.querySelector('.stat-base-val')?.textContent.trim();
      const coopVal = statItems[2]?.querySelector('.stat-base-val')?.textContent.trim();
      const vsVal = statItems[3]?.querySelector('.stat-base-val')?.textContent.trim();
      return { title, hpVal, coopVal, vsVal };
    });
    assertEqual(spGolemInitial.title, 'SP魔像', 'First boss card should be SP魔像');
    assertEqual(spGolemInitial.hpVal, '50%', 'Initial HP should be 50%');
    assertEqual(spGolemInitial.coopVal, '500 SP', 'Initial coop SP should be 500 SP');
    assertEqual(spGolemInitial.vsVal, '500 SP', 'Initial vs SP should be 500 SP');
    passedAssertions += 4;

    // 正向同步：生命值調至 30 (Max) -> 全部 3 項同步至 Max
    await page.evaluate(() => {
      const card = document.querySelector('.compendium-branch-section:nth-of-type(2) .compendium-card:first-of-type');
      const item = card.querySelectorAll('.dice-stat-item')[1];
      const slider = item.querySelector('.rank-slider-input');
      if (slider) {
        slider.value = '30';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(200);

    const golemRank30 = await page.evaluate(() => {
      const card = document.querySelector('.compendium-branch-section:nth-of-type(2) .compendium-card:first-of-type');
      const statItems = Array.from(card.querySelectorAll('.dice-stat-item'));
      return {
        hpVal: statItems[1]?.querySelector('.stat-base-val')?.textContent.trim(),
        coopVal: statItems[2]?.querySelector('.stat-base-val')?.textContent.trim(),
        vsVal: statItems[3]?.querySelector('.stat-base-val')?.textContent.trim()
      };
    });
    assertEqual(golemRank30.hpVal, '1,500%', 'HP at rank 30 should be 1,500%');
    assertEqual(golemRank30.coopVal, '10,000 SP', 'Coop SP at rank 30 should be 10,000 SP (capped at 10k)');
    assertEqual(golemRank30.vsVal, '10,000 SP', 'Versus SP at rank 30 should be 10,000 SP (capped at 10k)');
    passedAssertions += 3;

    // 反向同步：調整合作 SP 至 10 階 -> 全部 3 項反向同步至 10/30
    await page.evaluate(() => {
      const card = document.querySelector('.compendium-branch-section:nth-of-type(2) .compendium-card:first-of-type');
      const item = card.querySelectorAll('.dice-stat-item')[2];
      const slider = item.querySelector('.rank-slider-input');
      if (slider) {
        slider.value = '10';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(200);

    const golemRank10 = await page.evaluate(() => {
      const card = document.querySelector('.compendium-branch-section:nth-of-type(2) .compendium-card:first-of-type');
      const statItems = Array.from(card.querySelectorAll('.dice-stat-item'));
      return {
        hpVal: statItems[1]?.querySelector('.stat-base-val')?.textContent.trim(),
        coopVal: statItems[2]?.querySelector('.stat-base-val')?.textContent.trim(),
        vsVal: statItems[3]?.querySelector('.stat-base-val')?.textContent.trim()
      };
    });
    assertEqual(golemRank10.hpVal, '500%', 'HP reverse synced at rank 10 should be 500%');
    assertEqual(golemRank10.coopVal, '5,000 SP', 'Coop SP reverse synced at rank 10 should be 5,000 SP');
    assertEqual(golemRank10.vsVal, '5,000 SP', 'Versus SP reverse synced at rank 10 should be 5,000 SP');
    passedAssertions += 3;

    // ==========================================
    // Tier 3/4: 戰術波次事件與 1-to-3 心智圖分支
    // ==========================================
    console.log('--- Tier 3/4: Wave Tactics Events & Mindmap Branching ---');
    await page.click('#compendium-category-toggle-btn');
    await page.waitForTimeout(200);
    await page.click('.category-option-item[data-value="event"]');
    await page.waitForTimeout(400);
    assertEqual(new URL(page.url()).pathname, '/zh-tw/compendium/event', 'Opening the event compendium must update its canonical collection URL');
    passedAssertions++;

    // 1. 合作模式篩選：1.0.3 公告移除三個戰術後為 44 筆
    await page.click('#compendium-event-tabs .compendium-tab[data-event-mode="coop"]');
    await page.waitForTimeout(300);
    const coopEventCount = await page.$$eval('.compendium-card.is-event-card', els => els.length);
    assertEqual(coopEventCount, 44, 'Coop mode must filter to 44 active events after the 1.0.3 removals');
    passedAssertions++;
    const removedCoopTactics = await page.$$eval('.compendium-card.is-event-card .tooltip-title', els => els.map(el => el.textContent.trim()));
    for (const tactic of ['勢力戰', '頂樓', '和平主義者']) {
      assert(!removedCoopTactics.includes(tactic), `${tactic} must not be shown in co-op after the 1.0.3 notice`);
      passedAssertions++;
    }
    const coopDurations = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-event-card'))
        .find(el => el.querySelector('.tooltip-title')?.textContent.includes('小丑登場'));
      return Object.fromEntries(Array.from(card?.querySelectorAll('.dice-stat-item') || []).map(item => [
        item.querySelector('.dice-stat-label')?.textContent.trim(),
        item.querySelector('.stat-base-val')?.textContent.trim()
      ]));
    });
    assertEqual(coopDurations['合作'], '100s', 'Coop mode must show the coop duration');
    assertEqual(coopDurations['競技'], undefined, 'Coop mode should omit the versus-only duration column');
    passedAssertions += 2;

    // 2. 競技場模式篩選 (55 筆)
    await page.click('#compendium-event-tabs .compendium-tab[data-event-mode="versus"]');
    await page.waitForTimeout(300);
    const vsEventCount = await page.$$eval('.compendium-card.is-event-card', els => els.length);
    assertEqual(vsEventCount, 55, 'Versus mode must filter to 55 events');
    passedAssertions++;
    const versusDurations = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.compendium-card.is-event-card'))
        .find(el => el.querySelector('.tooltip-title')?.textContent.includes('小丑登場'));
      return Object.fromEntries(Array.from(card?.querySelectorAll('.dice-stat-item') || []).map(item => [
        item.querySelector('.dice-stat-label')?.textContent.trim(),
        item.querySelector('.stat-base-val')?.textContent.trim()
      ]));
    });
    assertEqual(versusDurations['合作'], undefined, 'Versus mode should omit the coop-only duration column');
    assertEqual(versusDurations['競技'], '60s', 'Versus mode must show the versus duration');
    passedAssertions += 2;

    // 3. 切換回全部模式，驗證特殊時長事件與「選擇由我決定」1-to-3 心智圖分支
    await page.click('#compendium-event-tabs .compendium-tab[data-event-mode="all"]');
    await page.waitForTimeout(300);

    const timingAndMindmap = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.compendium-card.is-event-card'));
      const findCard = (title) => cards.find(c => c.querySelector('.tooltip-title')?.textContent.includes(title));

      const altarCard = findCard('等價交換');
      const saveCard = findCard('節流');
      const shuffleCard = findCard('大變革') || findCard('重新洗牌');
      const healCard = findCard('復活') || findCard('絕處逢生');
      const augmentCard = findCard('選擇由我決定');

      const treeWrap = document.querySelector('.compendium-event-augment-tree-wrap');
      const mainCard = treeWrap?.querySelector('.augment-tree-main-slot .compendium-card.is-event-card');
      const subCards = Array.from(treeWrap?.querySelectorAll('.augment-sub-card') || []);

      return {
        altarCoop: altarCard?.querySelectorAll('.stat-base-val')[0]?.textContent.trim(),
        altarVs: altarCard?.querySelectorAll('.stat-base-val')[1]?.textContent.trim(),
        saveCoop: saveCard?.querySelectorAll('.stat-base-val')[0]?.textContent.trim(),
        saveVs: saveCard?.querySelectorAll('.stat-base-val')[1]?.textContent.trim(),
        shuffleCoop: shuffleCard?.querySelectorAll('.stat-base-val')[0]?.textContent.trim(),
        healCoop: healCard?.querySelectorAll('.stat-base-val')[0]?.textContent.trim(),
        augmentCoop: augmentCard?.querySelectorAll('.stat-base-val')[0]?.textContent.trim(),
        augmentVs: augmentCard?.querySelectorAll('.stat-base-val')[1]?.textContent.trim(),
        hasMainCard: !!mainCard,
        subCardCount: subCards.length
      };
    });

    assertEqual(timingAndMindmap.altarCoop, '-', '等價交換 coop duration should be -');
    assertEqual(timingAndMindmap.altarVs, '永久', '等價交換 versus duration should be 永久');
    assertEqual(timingAndMindmap.saveCoop, '永久', '節流 coop duration should be 永久');
    assertEqual(timingAndMindmap.saveVs, '永久', '節流 versus duration should be 永久');
    assertEqual(timingAndMindmap.shuffleCoop, '立即生效', '大變革 coop duration should be 立即生效');
    assertEqual(timingAndMindmap.healCoop, '觸發 1 次', '復活 coop duration should be 觸發 1 次');
    assertEqual(timingAndMindmap.augmentCoop, '立即生效', '選擇由我決定 coop duration should honor DisplayTime=false');
    assertEqual(timingAndMindmap.augmentVs, '立即生效', '選擇由我決定 versus duration should honor DisplayTime=false');
    assert(timingAndMindmap.hasMainCard, '選擇由我決定 main card must exist');
    assertEqual(timingAndMindmap.subCardCount, 3, '選擇由我決定 must branch to 3 sub-cards in mindmap');
    passedAssertions += 10;

    // 關閉圖鑑
    await page.click('#compendium-back-btn');
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });
    passedAssertions++;

    // Re-initializing a mounted compendium must not accumulate delegated tag
    // listeners. This protects hot reload/re-bootstrap paths from duplicate
    // popovers and retained view instances.
    const lifecycleTagCallbacks = await page.evaluate(() => {
      const view = window.RD2App.views.compendiumView;
      let callbackCount = 0;
      const originalCallback = view.onShowTagPopover;
      view.onShowTagPopover = () => { callbackCount += 1; };
      view.init();
      view.init();
      view.open();
      // The lifecycle check runs after the event section above. Restore the
      // dice section so a tag-bearing card is present for the delegated click.
      view.category = 'dice';
      view.branch = 'all';
      view.render({ animated: false });
      const tag = document.querySelector('#compendium-overlay .tooltip-tag-inline');
      tag?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      view.onShowTagPopover = originalCallback;
      return callbackCount;
    });
    assertEqual(lifecycleTagCallbacks, 1, 'Compendium init must not duplicate delegated tag listeners');
    passedAssertions++;
    await page.click('#compendium-back-btn');
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });

    // Re-entering the app must not retain the previous view tree.
    // A second Application.init() previously left the prior CompendiumView's
    // delegated listener mounted, so one tag click reached the callback twice.
    const applicationReinitTagCallbacks = await page.evaluate(async () => {
      const app = window.RD2App;
      await app.init();
      const tooltip = app.views.tooltipView;
      let callbackCount = 0;
      const originalCallback = tooltip.showTagPopover;
      tooltip.showTagPopover = () => { callbackCount += 1; };
      app.views.compendiumView.open();
      const tag = document.querySelector('#compendium-overlay .tooltip-tag-inline');
      tag?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      tooltip.showTagPopover = originalCallback;
      app.views.compendiumView.close();
      return callbackCount;
    });
    assertEqual(applicationReinitTagCallbacks, 1, 'Application re-entry must dispose the previous CompendiumView');
    passedAssertions++;
    await page.waitForSelector('#compendium-overlay', { state: 'hidden', timeout: 3000 });

    assertNoUnexpectedBrowserDiagnostics(browserInstance, 'compendium suite');
    const durationMs = Date.now() - startTime;
    console.log(`\n🎉 Compendium & Events Suite Passed! (${passedAssertions} assertions in ${(durationMs / 1000).toFixed(2)}s)`);

    return {
      suite: 'compendium_events',
      name: 'Compendium & Events Suite',
      passed: true,
      durationMs,
      assertions: passedAssertions,
      errors: [],
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`\n❌ Compendium & Events Suite Failed in ${(durationMs / 1000).toFixed(2)}s:`, err);
    const failure = await captureFailureArtifacts({
      suiteName: 'compendium-events',
      error: err,
      browser: options.browser || process.env.TEST_BROWSER || 'chromium',
      browserInstance,
      baseUrl: serverInstance?.baseUrl
    });
    return {
      suite: 'compendium_events',
      name: 'Compendium & Events Suite',
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
if (directEntry?.endsWith('compendium_events.suite.mjs')) {
  const result = await runCompendiumEventsSuite();
  process.exitCode = result.passed ? 0 : 1;
}
