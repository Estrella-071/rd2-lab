/**
 * Tier 1/2/3/4 Tree Interactions & DAG Topology Suite
 * 涵蓋 239 節點 DAG 拓撲、前置路徑 BFS、縮放平移、Rank 滑桿邊界與回彈、
 * Dot/Powerup 雙加成合併、標籤 Popover、搜尋高亮與派系優先級
 */
import { startTestServer, createTestBrowser } from '../helpers/test_server.mjs';
import { assert, assertEqual, assertNoUnexpectedBrowserDiagnostics, captureFailureArtifacts } from '../helpers/test_utils.mjs';

export async function runTreeInteractionsSuite(options = {}) {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('🌲 [E2E] Running Tree Interactions & DAG Topology Suite...');
  console.log('========================================');

  let serverInstance = null;
  let browserInstance = null;
  let passedAssertions = 0;

  try {
    // 1. 啟動測試伺服器與瀏覽器
    serverInstance = await startTestServer(options.port || 0);
    const baseUrl = serverInstance.baseUrl;

    browserInstance = await createTestBrowser({
      browserType: options.browser || 'chromium',
      headless: options.headless !== false,
      viewport: { width: 1280, height: 800 }
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
    // Tier 1: 239 節點 DAG 完備性與 DOM 結構
    // ==========================================
    console.log('--- Tier 1: DAG Topology & Node Completeness ---');
    const nodeCount = await page.$$eval('g.node[data-node-id]', els => els.length);
    assertEqual(nodeCount, 239, 'Must have exactly 239 nodes in DAG');
    passedAssertions++;

    // 驗證 5 大派系節點均勻存在 (1: 自然, 2: 工學/光明, 3: 暗黑, 4: 秩序, 5: 渾沌)
    const branchStats = await page.evaluate(() => {
      const treeData = window.TREE_DATA;
      const nodes = Object.values(treeData.nodes || {});
      const branchCounts = {};
      nodes.forEach(n => {
        branchCounts[n.branch] = (branchCounts[n.branch] || 0) + 1;
      });
      return { total: nodes.length, branchCounts };
    });
    assertEqual(branchStats.total, 239, 'TREE_DATA must have 239 nodes');
    assert(Object.keys(branchStats.branchCounts).length >= 5, 'Must contain all 5 branches');
    passedAssertions += 2;
    console.log(`✓ 239 Nodes verified across 5 branches:`, branchStats.branchCounts);

    // SVG node accessibility: every interactive node must be reachable from
    // the keyboard and activate the same selection path as a pointer click.
    const keyboardNodeContract = await page.$eval('g.node[data-node-id="1001"]', (el) => ({
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      label: el.getAttribute('aria-label')
    }));
    assertEqual(keyboardNodeContract.role, 'button', 'Tree nodes must expose button semantics to assistive technology');
    assertEqual(keyboardNodeContract.tabindex, '0', 'Tree nodes must be keyboard focusable');
    assert(keyboardNodeContract.label, 'Tree nodes must expose a non-empty accessible name');
    const sceneAccessibility = await page.$eval('#scene', (el) => ({
      ariaHidden: el.getAttribute('aria-hidden'),
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label')
    }));
    assert(
      sceneAccessibility.ariaHidden !== 'true' && sceneAccessibility.role === 'group' && sceneAccessibility.label,
      `Interactive tree scene must expose a labelled accessibility group (aria-hidden=${sceneAccessibility.ariaHidden}, role=${sceneAccessibility.role}, label=${sceneAccessibility.label})`
    );
    await page.focus('g.node[data-node-id="1001"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    const keyboardSelectedId = await page.evaluate(() => window.__TEST_HOOKS__.getState().selectedNodeId);
    assertEqual(String(keyboardSelectedId), '1001', 'Enter on a focused tree node must select it');
    await page.evaluate(() => window.__TEST_HOOKS__.closeTooltip(true));
    await page.waitForSelector('#tooltip', { state: 'hidden', timeout: 3000 });
    await page.focus('g.node[data-node-id="1001"]');
    await page.keyboard.press('Space');
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    const spaceSelectedId = await page.evaluate(() => window.__TEST_HOOKS__.getState().selectedNodeId);
    assertEqual(String(spaceSelectedId), '1001', 'Space on a focused tree node must select it');
    passedAssertions += 6;
    await page.evaluate(() => window.__TEST_HOOKS__.closeTooltip(true));
    await page.waitForSelector('#tooltip', { state: 'hidden', timeout: 3000 });

    // ==========================================
    // Tier 1/2: 視口控制器、平移、滾輪縮放與鍵盤快捷鍵
    // ==========================================
    console.log('--- Tier 1/2: Viewport Pan / Zoom & Keyboard Controls ---');
    
    // 滾輪縮放測試 (Topbar 保持顯示，Minimap 運動淡入)
    const zoomFadeCheck = await page.evaluate(() => {
      const vp = document.getElementById('viewport');
      vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      const hasZoomingClass = document.body.classList.contains('is-zooming');
      const topbarOpacity = window.getComputedStyle(document.querySelector('.topbar')).opacity;
      return { hasZoomingClass, topbarOpacity: Number.parseFloat(topbarOpacity) };
    });
    await page.waitForTimeout(120);
    const minimapOpacity = await page.$eval('#minimap-panel', (element) => Number.parseFloat(window.getComputedStyle(element).opacity));
    assert(zoomFadeCheck.hasZoomingClass, 'Body should have .is-zooming class on wheel');
    assert(zoomFadeCheck.topbarOpacity >= 0.9, 'Topbar must stay visible during zoom');
    assert(minimapOpacity >= 0.8, 'Minimap should fade in during zoom');
    passedAssertions += 3;
    await page.waitForFunction(() => {
      const scene = document.querySelector('.map-scene');
      return scene && window.getComputedStyle(scene).willChange === 'auto';
    }, null, { timeout: 2000 });

    const settledRasterState = await page.evaluate(() => {
      const scene = document.querySelector('.map-scene');
      const style = scene ? window.getComputedStyle(scene) : null;
      return {
        willChange: style?.willChange || ''
      };
    });
    assertEqual(settledRasterState.willChange, 'auto', 'Settled zoom must repaint the SVG at the current resolution');
    passedAssertions += 1;

    // 指針平移測試 (Drag Pan)
    await page.evaluate(() => {
      const vp = document.getElementById('viewport');
      vp.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 500, clientY: 500, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 550, clientY: 550, bubbles: true }));
    });
    await page.waitForTimeout(180);
    const panFadeCheck = await page.evaluate(() => {
      const isNavigating = document.body.classList.contains('is-navigating');
      const topbarOpacity = Number.parseFloat(window.getComputedStyle(document.querySelector('.topbar')).opacity);
      const minimapOpacity = Number.parseFloat(window.getComputedStyle(document.getElementById('minimap-panel')).opacity);
      return { isNavigating, topbarOpacity, minimapOpacity };
    });
    assert(panFadeCheck.isNavigating, 'Body should have .is-navigating during pan');
    assert(panFadeCheck.topbarOpacity >= 0.9, 'Topbar must stay visible during pan');
    assert(panFadeCheck.minimapOpacity >= 0.8, 'Minimap should fade in during pan');
    passedAssertions += 3;

    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 550, clientY: 550, bubbles: true }));
    });
    await page.waitForTimeout(400);

    // 鍵盤縮放快捷鍵 (+, -, 0)
    const initialZoom = await page.$eval('#zoom-readout', el => el.textContent.trim());
    await page.keyboard.press('+');
    await page.waitForTimeout(300);
    const zoomedIn = await page.$eval('#zoom-readout', el => el.textContent.trim());
    assert(initialZoom !== zoomedIn, `Zoom readout should update on '+' key: ${initialZoom} -> ${zoomedIn}`);
    passedAssertions++;

    await page.keyboard.press('0');
    await page.waitForFunction(() => {
      const viewport = window.__TEST_HOOKS__?.getState?.().viewport;
      return viewport && Math.abs(viewport.scale - (viewport.baseScale || 1)) < 0.002;
    }, null, { timeout: 2000 });
    const resetZoom = await page.$eval('#zoom-readout', el => el.textContent.trim());
    console.log(`✓ Keyboard zoom verified: ${initialZoom} -> ${zoomedIn} -> reset: ${resetZoom}`);
    assertEqual(resetZoom, '100%', 'Reset shortcut must settle at the desktop base zoom');
    passedAssertions++;

    // 貨幣標籤 Toggle 測試 (預設 OFF)
    const defaultCurrencyOff = await page.evaluate(() => {
      const hasClass = document.body.classList.contains('show-currency-badges');
      const badge = document.querySelector('.map-scene .cost-badge');
      const opacity = badge ? Number.parseFloat(window.getComputedStyle(badge).opacity) : 0;
      return !hasClass && opacity < 0.1;
    });
    assert(defaultCurrencyOff, 'Currency badges must be OFF by default');
    passedAssertions++;

    await page.click('#toggle-currency-btn');
    await page.waitForFunction(() => {
      const hasClass = document.body.classList.contains('show-currency-badges');
      const badge = document.querySelector('.map-scene .cost-badge');
      const opacity = badge ? Number.parseFloat(window.getComputedStyle(badge).opacity) : 0;
      return hasClass && opacity > 0.9;
    }, null, { timeout: 2000 });
    passedAssertions++;

    await page.click('#toggle-currency-btn');
    await page.waitForFunction(() => !document.body.classList.contains('show-currency-badges'), null, { timeout: 2000 });
    await page.waitForTimeout(200);

    // ==========================================
    // Tier 2: Multi-rank 滑桿邊界、極值與 Rubber-banding
    // ==========================================
    console.log('--- Tier 2: Interactive Rank Slider & Boundary Bounce ---');
    const node1201 = await page.$('g.node[data-node-id="1201"]');
    assert(node1201, 'Node 1201 must exist');
    await page.evaluate(() => {
      const el = document.querySelector('g.node[data-node-id="1201"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });

    const sliderMax = await page.$eval('.rank-slider-input', el => el.max);
    assertEqual(sliderMax, '50', 'Node 1201 slider max must be 50');
    passedAssertions++;

    // 滑動至 25 階
    await page.evaluate(() => {
      const slider = document.querySelector('.rank-slider-input');
      slider.value = '25';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    const rankBadge25 = await page.$eval('#tooltip-rank-badge', el => el.textContent.trim());
    const costLabel25 = await page.$eval('.meta-line-cost .cost-label', el => el.textContent.trim());
    assertEqual(rankBadge25, '25/50', 'Rank badge should show 25/50');
    assertEqual(costLabel25, '升階消耗', 'Cost label at rank 25 should be 升階消耗');
    passedAssertions += 2;

    // 滑回 1 階 -> label 還原為 解鎖消耗
    await page.evaluate(() => {
      const slider = document.querySelector('.rank-slider-input');
      slider.value = '1';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const costLabel1 = await page.$eval('.meta-line-cost .cost-label', el => el.textContent.trim());
    assertEqual(costLabel1, '解鎖消耗', 'Cost label at rank 1 should revert to 解鎖消耗');
    passedAssertions++;

    // 邊界阻尼 Rubber-banding (< 0% overdrag)
    const overdragResult = await page.evaluate(() => {
      const slider = document.querySelector('.rank-slider-input');
      const rect = slider.getBoundingClientRect();
      slider.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: rect.left + 10, clientY: rect.top + 4, button: 0, bubbles: true }));
      slider.dispatchEvent(new PointerEvent('pointermove', { pointerId: 99, clientX: rect.left - 50, clientY: rect.top + 4, bubbles: true }));
      const overshootX = Number.parseFloat(slider.style.getPropertyValue('--overshoot-x') || '0');
      const isDragging = slider.classList.contains('is-dragging');
      return { overshootX, isDragging };
    });
    assert(overdragResult.overshootX < 0, `Expected negative overshootX during left overdrag, got: ${overdragResult.overshootX}`);
    assert(overdragResult.isDragging, 'Slider should have .is-dragging class during drag');
    passedAssertions += 2;

    // 放開指針並驗證 Spring 回彈至 0px
    const springResult = await page.evaluate(() => {
      const slider = document.querySelector('.rank-slider-input');
      slider.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, bubbles: true }));
      const overshootAfter = Number.parseFloat(slider.style.getPropertyValue('--overshoot-x') || '0');
      return { overshootAfter };
    });
    assertEqual(springResult.overshootAfter, 0, 'OvershootX must spring bounce back to 0px');
    passedAssertions++;

    // 被動技能節點綠色增量驗證 (Node 5109: 所有骰子傷害 (+0.6%))
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('5109', false);
      window.__TEST_HOOKS__.showTooltip('5109', true);
    });
    await page.waitForTimeout(300);
    const hasGreenAdd5109 = await page.evaluate(() => {
      const greenEl = document.querySelector('.detail-copy .stat-green-add');
      return greenEl?.textContent.trim() === '(+0.6%)';
    });
    assert(hasGreenAdd5109, 'Node 5109 must have (+0.6%) green add styling');
    passedAssertions++;

    // ==========================================
    // Tier 3: Dot / Power-up 雙軸合併與標籤 Popover
    // ==========================================
    console.log('--- Tier 3: Dot & Power-up Combined Bonuses & Tag Precision ---');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 掠奪骰子 (Node 5007)
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('5007', false);
      window.__TEST_HOOKS__.showTooltip('5007', true);
    });
    await page.waitForTimeout(400);

    const pStats = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.dice-stat-item')).map(el => ({
        label: el.querySelector('.dice-stat-label')?.textContent.trim(),
        val: el.querySelector('.dice-stat-val')?.textContent.trim()
      }));
    });
    assert(pStats.some(s => s.label === '攻擊力' && s.val.startsWith('1000')), 'Predator attack should be 1000');
    assert(pStats.some(s => s.label === '吞噬增加量' && s.val.startsWith('15')), 'Predator special 吞噬增加量 15');
    assert(pStats.some(s => s.label === '吞噬範圍' && s.val.startsWith('1.2')), 'Predator special 吞噬範圍 1.2');
    passedAssertions += 3;

    // 點擊「強化」按鈕 (Lv 2)
    await page.evaluate(() => document.querySelector('.btn-powerup')?.click());
    await page.waitForTimeout(200);
    const pwrLabel = await page.$eval('.btn-powerup', el => el.textContent.trim());
    assertEqual(pwrLabel, '2', 'Powerup button label should be 2');
    passedAssertions++;

    // 點擊「提升骰點」按鈕 (Dot 2) -> 驗證雙軸加成合併
    await page.evaluate(() => document.querySelector('.btn-dot')?.click());
    await page.waitForTimeout(200);
    const dotLabel = await page.$eval('.btn-dot', el => el.textContent.trim());
    assertEqual(dotLabel, '2', 'Dot button label should be 2');
    passedAssertions++;

    const combinedCheck = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.dice-stat-item'));
      const gainItem = items.find(el => el.querySelector('.dice-stat-label')?.textContent.trim() === '吞噬增加量');
      const speedItem = items.find(el => el.querySelector('.dice-stat-label')?.textContent.trim() === '攻擊速度');
      const goldSpan = gainItem?.querySelector('.stat-bonus-val.is-gold');
      const purpleSpan = gainItem?.querySelector('.stat-bonus-val.is-purple');
      const combinedSpan = gainItem?.querySelector('.stat-bonus-combined');
      const speedGoldSpan = speedItem?.querySelector('.stat-bonus-val.is-gold');
      const speedPurpleSpan = speedItem?.querySelector('.stat-bonus-val.is-purple');
      const speedCombinedSpan = speedItem?.querySelector('.stat-bonus-combined');
      return {
        gold: goldSpan && !goldSpan.hidden ? goldSpan.textContent.trim() : null,
        purple: purpleSpan && !purpleSpan.hidden ? purpleSpan.textContent.trim() : null,
        combined: combinedSpan && !combinedSpan.hidden ? combinedSpan.textContent.trim() : null,
        combinedAriaLabel: combinedSpan?.getAttribute('aria-label'),
        speedGold: speedGoldSpan && !speedGoldSpan.hidden ? speedGoldSpan.textContent.trim() : null,
        speedPurple: speedPurpleSpan && !speedPurpleSpan.hidden ? speedPurpleSpan.textContent.trim() : null,
        speedCombined: speedCombinedSpan && !speedCombinedSpan.hidden ? speedCombinedSpan.textContent.trim() : null
      };
    });
    assertEqual(combinedCheck.gold, null, 'Combined stat should hide the separate gold bonus');
    assertEqual(combinedCheck.purple, null, 'Combined stat should hide the separate purple bonus');
    assertEqual(combinedCheck.combined, '(+50)', 'Combined positive bonus should be (+50)');
    assert(combinedCheck.combinedAriaLabel?.includes('吞噬增加量'), 'Combined bonus should expose a localized accessible label');
    assertEqual(combinedCheck.speedGold, null, 'Combined attack speed should hide the separate gold bonus');
    assertEqual(combinedCheck.speedPurple, null, 'Combined attack speed should hide the separate purple bonus');
    assertEqual(combinedCheck.speedCombined, '(-1.39)', 'Attack speed should combine its two negative bonuses');
    passedAssertions += 7;

    // 點擊合併加成 -> 驗證同款明細卡片分開列出兩個來源
    await page.locator('.dice-stat-bonus-special-combined').first().click();
    await page.waitForTimeout(120);
    const bonusPopover = await page.evaluate(() => {
      const popover = document.querySelector('#stat-bonus-popover');
      return {
        visible: Boolean(popover && !popover.hidden),
        badge: popover?.querySelector('#stat-bonus-popover-badge')?.textContent.trim(),
        rows: Array.from(popover?.querySelectorAll('.stat-bonus-detail-row') || []).map(row => ({
          label: row.querySelector('.stat-bonus-detail-label')?.textContent.trim(),
          value: row.querySelector('.stat-bonus-detail-value')?.textContent.trim()
        }))
      };
    });
    assert(bonusPopover.visible, 'Combined bonus popover must be visible after click');
    assertEqual(bonusPopover.badge, '#吞噬增加量', 'Combined bonus popover should identify the stat');
    assertEqual(JSON.stringify(bonusPopover.rows), JSON.stringify([
      { label: '強化', value: '+25' },
      { label: '提升骰點', value: '+25' }
    ]), 'Combined bonus popover should preserve both source values');
    passedAssertions += 3;

    await page.keyboard.press('Escape');
    const bonusPopoverClosed = await page.$eval('#stat-bonus-popover', el => el.hidden);
    assert(bonusPopoverClosed, 'Escape should close the combined bonus popover');
    passedAssertions++;

    // Dot 升至 3 -> 合併加成變成 (+75)
    await page.evaluate(() => document.querySelector('.btn-dot')?.click());
    await page.waitForTimeout(200);
    const dot3Gain = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.dice-stat-item'));
      const gainItem = items.find(el => el.querySelector('.dice-stat-label')?.textContent.trim() === '吞噬增加量');
      return gainItem?.querySelector('.stat-bonus-combined')?.textContent.trim();
    });
    assertEqual(dot3Gain, '(+75)', 'Dot 3 combined bonus should be (+75)');
    passedAssertions++;

    // 標籤 Popover 驗證 (#吞噬)
    const predatorTagDefinition = await page.evaluate(() => window.TREE_DATA?.tag_definitions?.PREDATOR);
    assert(predatorTagDefinition?.name_zh && predatorTagDefinition?.desc_zh, 'Predator tag must have a localized definition');
    await page.evaluate(() => {
      window.__RD2_TAG_TEST_DATA__ = window.TREE_DATA;
      delete window.TREE_DATA;
    });
    await page.evaluate(() => {
      const chip = document.querySelector('.tooltip-hashtag-chip[data-tag-key="PREDATOR"]');
      if (chip) chip.click();
    });
    await page.waitForTimeout(200);
    const popoverVisible = await page.$eval('#tag-popover', el => !el.hidden);
    const popoverBadge = await page.$eval('#tag-popover-badge', el => el.textContent.trim());
    const popoverDescription = await page.$eval('#tag-popover-desc', el => el.textContent.trim());
    assert(popoverVisible, 'Tag popover must be visible');
    assertEqual(popoverBadge, `#${predatorTagDefinition.name_zh}`, 'Tag popover badge should use the localized tag name');
    assertEqual(popoverDescription, predatorTagDefinition.desc_zh, 'Tag popover should show the tag mechanism description');
    await page.evaluate(() => {
      window.TREE_DATA = window.__RD2_TAG_TEST_DATA__;
      delete window.__RD2_TAG_TEST_DATA__;
    });
    passedAssertions += 3;

    // Tooltip 仍開啟時切換語言，描述中的標籤與下方 hashtag 必須同步更新。
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('1003', false);
      window.__TEST_HOOKS__.showTooltip('1003', true);
    });
    await page.waitForTimeout(300);
    const tooltipLocaleChecks = [
      { key: 'en', tag: 'Bloom', awakeningTag: 'Fruit', name: 'Flower Dice', badgeWidth: 127 },
      { key: 'ja', tag: '開花', awakeningTag: '実', name: '花のダイス', badgeWidth: 106 },
      { key: 'ko', tag: '개화', awakeningTag: '열매', name: '꽃 주사위', badgeWidth: 100 },
      { key: 'zh-tw', tag: '綻放', awakeningTag: '果實', name: '花骰子', badgeWidth: 76 },
    ];
    for (const { key, tag, awakeningTag, name, badgeWidth } of tooltipLocaleChecks) {
      await page.click('#locale-toggle-btn');
      await page.waitForSelector('#locale-widget.is-expanded');
      await page.click(`#locale-widget [data-locale="${key}"]`);
      await page.waitForFunction((expectedLocale) => document.documentElement.lang === expectedLocale, key);
      const tooltipLocale = await page.evaluate(() => {
        const tooltip = document.getElementById('tooltip');
        return {
          text: tooltip?.textContent || '',
          chips: Array.from(tooltip?.querySelectorAll('.tooltip-hashtag-chip') || []).map((chip) => chip.textContent.trim()),
        };
      });
      assert(tooltipLocale.text.includes(tag), `${key} tooltip description must use the current Bloom tag`);
      assert(tooltipLocale.text.includes(awakeningTag), `${key} tooltip awakening must use the current Fruit tag`);
      for (const staleTag of tooltipLocaleChecks.map((entry) => entry.tag).filter((entry) => entry !== tag)) {
        assert(!tooltipLocale.text.includes(staleTag), `${key} tooltip must not retain a stale Bloom tag (${staleTag})`);
      }
      for (const staleAwakeningTag of tooltipLocaleChecks.map((entry) => entry.awakeningTag).filter((entry) => entry !== awakeningTag)) {
        assert(!tooltipLocale.text.includes(staleAwakeningTag), `${key} tooltip must not retain a stale Fruit tag (${staleAwakeningTag})`);
      }
      assertEqual(tooltipLocale.chips[0], `#${tag}`, `${key} tooltip hashtag must use the current Bloom tag`);
      const nodeNameBadge = await page.$eval('g.node[data-node-id="1003"] .node-name-badge', (element) => ({
        text: element.querySelector('.node-name-badge-text')?.textContent.trim(),
        width: Number(element.querySelector('rect')?.getAttribute('width') || 0),
      }));
      assertEqual(nodeNameBadge.text, name, `${key} node name badge must use the current localized name`);
      assertEqual(nodeNameBadge.width, badgeWidth, `${key} node name badge must resize to the current localized name`);
      passedAssertions += 11;
    }

    // Greed (node 5006) tag text.
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('5006', false);
      window.__TEST_HOOKS__.showTooltip('5006', true);
    });
    await page.waitForTimeout(300);
    const greedChips = await page.$$eval('.tooltip-hashtag-chip', els => els.map(e => e.textContent.trim()));
    assertEqual(greedChips.length, 1, 'Greed dice should have exactly 1 hashtag chip');
    assertEqual(greedChips[0], '#SP怪物', 'Greed dice chip must be #SP怪物');
    passedAssertions += 2;

    // 驗證 Tooltip 中已移除解鎖條件與前置節點欄位，並包含獨立的解鎖消耗框
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('5102', false);
      window.__TEST_HOOKS__.showTooltip('5102', true);
    });
    await page.waitForTimeout(300);

    const tooltipCleanliness = await page.evaluate(() => {
      const tooltip = document.getElementById('tooltip');
      const text = tooltip ? tooltip.textContent : '';
      const hasPrereqPills = Boolean(document.querySelector('.node-link-pill'));
      const hasPrereqText = text.includes('前置節點');
      const hasCondText = text.includes('解鎖條件');
      const hasCostPanel = Boolean(document.querySelector('#tooltip-cost-panel:not([hidden])'));
      return { hasPrereqPills, hasPrereqText, hasCondText, hasCostPanel };
    });
    assert(!tooltipCleanliness.hasPrereqPills, 'Tooltip must NOT contain prerequisite pills');
    assert(!tooltipCleanliness.hasPrereqText, 'Tooltip must NOT contain 前置節點 text');
    assert(!tooltipCleanliness.hasCondText, 'Tooltip must NOT contain 解鎖條件 text');
    assert(tooltipCleanliness.hasCostPanel, 'Tooltip must contain an independent cost panel');
    passedAssertions += 4;

    // 切換至節點 5106 驗證 Tooltip 標題與獨立消耗框
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('5106', false);
      window.__TEST_HOOKS__.showTooltip('5106', true);
    });
    await page.waitForTimeout(300);

    const check5106 = await page.evaluate(() => {
      const tooltip = document.getElementById('tooltip');
      const isPlacedBelow = tooltip.classList.contains('is-placed-below');
      const title = document.getElementById('tooltip-title')?.textContent.trim();
      const costLabel = document.querySelector('#tooltip-cost-panel .cost-label')?.textContent.trim();
      return { isPlacedBelow, title, costLabel };
    });
    assert(check5106.title.includes('渾沌召喚2骰點'), 'Node 5106 title should match 渾沌召喚2骰點');
    assert(!check5106.isPlacedBelow, 'Node 5106 tooltip should be above in normal mode');
    assertEqual(check5106.costLabel, '解鎖消耗', 'Node 5106 cost panel should display 解鎖消耗');
    passedAssertions += 3;

    // 原子旋轉加速 (Node 2304): 修正後文案呈現旋轉週期縮短與最多持續時間，不能再顯示獨立持續時間列。
    await page.evaluate(() => {
      window.__TEST_HOOKS__.centerOnNode('2304', false);
      window.__TEST_HOOKS__.showTooltip('2304', true);
    });
    await page.waitForTimeout(300);
    const atomRotationTooltip = await page.evaluate(() => {
      const tooltip = document.getElementById('tooltip');
      return {
        text: tooltip?.textContent || '',
        compactItems: Array.from(tooltip?.querySelectorAll('.stat-compact-item') || []).map((item) => item.textContent.trim())
      };
    });
    assert(atomRotationTooltip.text.includes('旋轉週期縮短0.5秒，效果最多持續5秒'), 'Node 2304 must use the semantic rotation-interval wording');
    assert(!atomRotationTooltip.compactItems.some((item) => item.includes('持續時間')), 'Node 2304 must not synthesize a duplicate duration row');
    passedAssertions += 2;

    // ==========================================
    // Tier 3/4: 搜尋拓撲高亮與派系篩選優先級
    // ==========================================
    console.log('--- Tier 3/4: Search Topology Highlighting & Prereq Priority ---');
    const filterTopBeforeQuery = await page.$eval('#filter-widget', (el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    });
    const searchWidgetContract = await page.evaluate(() => ({
      desktopFieldWidth: document.querySelector('#search-widget .search-field')?.getBoundingClientRect().width || 0,
      hasRemovedSearchCard: !document.querySelector('#search-card, .search-card'),
      hasRemovedSearchHeading: !document.querySelector('#search-heading, .search-card-title, .search-card-badge'),
      hasRemovedSearchClose: !document.querySelector('#search-close-btn, .search-close-btn'),
      ariaExpanded: document.getElementById('search-widget')?.getAttribute('aria-expanded'),
      searchTriggerRect: document.getElementById('search-widget')?.getBoundingClientRect().toJSON(),
      filterRect: document.getElementById('filter-widget')?.getBoundingClientRect().toJSON()
    }));
    assert(searchWidgetContract.desktopFieldWidth >= 300, 'Desktop search must remain an always-visible horizontal field');
    assert(searchWidgetContract.hasRemovedSearchCard, 'Search must not render an independent card window');
    assert(searchWidgetContract.hasRemovedSearchHeading, 'Search must not render a redundant search heading');
    assert(searchWidgetContract.hasRemovedSearchClose, 'Search must not render a redundant close button');
    assertEqual(searchWidgetContract.ariaExpanded, 'true', 'Desktop search must expose its always-expanded field');
    passedAssertions += 5;
    await page.fill('#search-input', '尖刺');
    await page.waitForSelector('#search-widget.has-search-results', { timeout: 3000 });
    await page.waitForTimeout(350);

    const searchResultContract = await page.evaluate(() => {
      const widget = document.getElementById('search-widget');
      const results = document.getElementById('search-results');
      const resultRect = results?.getBoundingClientRect();
      const widgetRect = widget?.getBoundingClientRect();
      const filterRect = document.getElementById('filter-widget')?.getBoundingClientRect();
      return {
        searchCount: document.querySelectorAll('.search-result').length,
        resultsExpanded: results?.getAttribute('aria-hidden') === 'false' && (resultRect?.height || 0) > 0,
        resultsInsideWidget: widget?.contains(results) === true,
        widgetHeight: widgetRect?.height || 0,
        resultsTop: resultRect?.top || 0,
        fieldBottom: document.querySelector('#search-widget .search-field')?.getBoundingClientRect().bottom || 0,
        filterTop: filterRect?.top || 0
      };
    });
    const searchCount = searchResultContract.searchCount;
    assert(searchCount > 0, 'Search for 尖刺 should return results');
    assert(searchResultContract.resultsExpanded, 'Search results must vertically expand only after matches exist');
    assert(searchResultContract.resultsInsideWidget, 'Search results must remain owned by the search widget');
    assertEqual(searchResultContract.widgetHeight, searchWidgetContract.searchTriggerRect.height, 'Search result expansion must keep the trigger height fixed');
    assert(searchResultContract.resultsTop >= searchResultContract.fieldBottom - 1, 'Search results must open directly below the horizontal search field');
    assertEqual(searchResultContract.filterTop, filterTopBeforeQuery.top, 'Search result expansion must not push the filter widget downward');
    passedAssertions += 6;

    const highlightCheck = await page.evaluate(() => {
      const matchedNode = document.querySelector('g.node.is-highlight-match');
      const dimmedNode = document.querySelector('g.node:not(.is-highlight-match)');
      return {
        matchedOpacity: matchedNode ? Number.parseFloat(window.getComputedStyle(matchedNode).opacity) : 0,
        dimmedOpacity: dimmedNode ? Number.parseFloat(window.getComputedStyle(dimmedNode).opacity) : 1
      };
    });
    assert(highlightCheck.matchedOpacity >= 0.9, 'Search matched node opacity should be >= 0.9');
    assert(highlightCheck.dimmedOpacity <= 0.25, 'Unmatched node opacity should be <= 0.25');
    passedAssertions += 2;

    // 清除搜尋
    await page.click('#search-clear');
    await page.waitForTimeout(300);
    const resultsCollapsed = await page.$eval('#search-results', (el) => el.getAttribute('aria-hidden') === 'true');
    assert(resultsCollapsed, 'Clearing search must collapse the result panel');
    passedAssertions++;

    assertNoUnexpectedBrowserDiagnostics(browserInstance, 'tree interactions suite');
    const durationMs = Date.now() - startTime;
    console.log(`\n🎉 Tree Interactions Suite Passed! (${passedAssertions} assertions in ${(durationMs / 1000).toFixed(2)}s)`);

    return {
      suite: 'tree_interactions',
      name: 'Tree Interactions & DAG Topology Suite',
      passed: true,
      durationMs,
      assertions: passedAssertions,
      errors: [],
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`\n❌ Tree Interactions Suite Failed in ${(durationMs / 1000).toFixed(2)}s:`, err);
    const failure = await captureFailureArtifacts({
      suiteName: 'tree-interactions',
      error: err,
      browser: options.browser || process.env.TEST_BROWSER || 'chromium',
      browserInstance,
      baseUrl: serverInstance?.baseUrl
    });
    return {
      suite: 'tree_interactions',
      name: 'Tree Interactions & DAG Topology Suite',
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
if (directEntry?.endsWith('tree_interactions.suite.mjs')) {
  const result = await runTreeInteractionsSuite();
  process.exitCode = result.passed ? 0 : 1;
}
