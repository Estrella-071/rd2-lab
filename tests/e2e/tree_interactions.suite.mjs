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
    await page.waitForSelector('button.tree-node-semantic[data-node-id]', { timeout: 5000 });
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
    const nodeCount = await page.$$eval('button.tree-node-semantic[data-node-id]', els => els.length);
    assertEqual(nodeCount, 239, 'Must have exactly 239 nodes in DAG');
    const visualSvgCount = await page.$$eval('#scene svg', els => els.length);
    assertEqual(visualSvgCount, 0, 'Canvas map must not mount an SVG visual layer');
    passedAssertions += 2;

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

    // Canvas node accessibility: every interactive node must be reachable from
    // the keyboard and activate the same selection path as a pointer click.
    const keyboardNodeContract = await page.$eval('button.tree-node-semantic[data-node-id="1001"]', (el) => ({
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
    const layerOrder = await page.$eval('#scene', (scene) => {
      const renderRoot = scene.querySelector('.tree-render-root');
      return [...(renderRoot || scene).children].map((element) => element.className);
    });
    const activeEdgeLayerIndex = layerOrder.indexOf('tree-canvas-layer tree-active-edge-canvas');
    const centerLayerIndex = layerOrder.indexOf('tree-canvas-layer tree-center-canvas');
    const nodeLayerIndex = layerOrder.indexOf('tree-canvas-layer tree-node-canvas');
    assert(
      activeEdgeLayerIndex >= 0 && activeEdgeLayerIndex < centerLayerIndex && centerLayerIndex < nodeLayerIndex,
      `Dynamic edge canvas must be painted below center and node layers: ${layerOrder.join(' > ')}`
    );
    passedAssertions++;

    const rasterLayerContract = await page.$eval('#scene', (scene) => {
      const host = scene.querySelector('.tree-frame-surface');
      const children = [...(host ? host.children : [])].map((element) => element.className);
      const dimMask = host?.querySelector('canvas.tree-full-dim-mask-surface');
      const edgeDimMask = host?.querySelector('canvas.tree-full-edge-dim-mask-surface');
      const renderer = window.RD2App?.mapRenderer;
      return {
        children,
        staticIndex: children.indexOf('tree-static-surface'),
        coverageMaskIndex: children.indexOf('tree-frame-coverage-mask'),
        activeEdgeIndex: children.indexOf('tree-active-edge-surface'),
        nodeArtIndex: children.indexOf('tree-node-art-surface'),
        edgeDimMaskIndex: children.indexOf('tree-full-edge-dim-mask-surface'),
        dimMaskIndex: children.indexOf('tree-full-dim-mask-surface'),
        dynamicIndex: children.findIndex((className) => String(className).includes('tree-dynamic-surface')),
        edgeDimMask: edgeDimMask ? {
          ready: edgeDimMask.dataset.canvasReady === 'true',
          active: edgeDimMask.dataset.active === 'true',
          width: edgeDimMask.width,
          height: edgeDimMask.height,
          cssWidth: Number.parseFloat(edgeDimMask.style.width || '0'),
          cssHeight: Number.parseFloat(edgeDimMask.style.height || '0'),
          renderBounds: edgeDimMask.dataset.renderBounds || '',
          visibility: edgeDimMask.style.visibility
        } : null,
        dimMask: dimMask ? {
          ready: dimMask.dataset.canvasReady === 'true',
          width: dimMask.width,
          height: dimMask.height,
          cssWidth: Number.parseFloat(dimMask.style.width || '0'),
          cssHeight: Number.parseFloat(dimMask.style.height || '0'),
          renderBounds: dimMask.dataset.renderBounds || ''
        } : null,
        edgeComposite: renderer?.activeEdgeCanvas === renderer?.staticCanvas
          && renderer?.activeEdgeContext === renderer?.staticContext
          && renderer?.staticCanvas?.dataset.edgeComposite === 'true'
          && renderer?.staticCanvas?.style.opacity === '1'
      };
    });
    assert(
      rasterLayerContract.edgeComposite
        && rasterLayerContract.staticIndex >= 0
        && rasterLayerContract.coverageMaskIndex === -1
        && rasterLayerContract.activeEdgeIndex === -1
        && rasterLayerContract.edgeDimMaskIndex > rasterLayerContract.staticIndex
        && rasterLayerContract.edgeDimMaskIndex < rasterLayerContract.nodeArtIndex
        && rasterLayerContract.nodeArtIndex < rasterLayerContract.dimMaskIndex
        && rasterLayerContract.dimMaskIndex < rasterLayerContract.dynamicIndex
        && rasterLayerContract.staticIndex < rasterLayerContract.nodeArtIndex
        && rasterLayerContract.nodeArtIndex < rasterLayerContract.dynamicIndex,
      `Committed Canvas order must use one static edge composite below node art and dynamic overlays without a bounded coverage mask: ${rasterLayerContract.children.join(' > ')}`
    );
    assert(
        rasterLayerContract.edgeDimMask?.ready
        && !rasterLayerContract.edgeDimMask.active
        && rasterLayerContract.edgeDimMask.width === 1
        && rasterLayerContract.edgeDimMask.height === 1
        && rasterLayerContract.edgeDimMask.cssWidth >= 3999
        && rasterLayerContract.edgeDimMask.cssHeight >= 3399
        && rasterLayerContract.edgeDimMask.renderBounds.startsWith('0:0:4000:3400:full-map-edge'),
      `Edge dim mask must be a ready fixed full-map surface: ${JSON.stringify(rasterLayerContract.edgeDimMask)}`
    );
    assert(
      rasterLayerContract.dimMask?.ready
        && rasterLayerContract.dimMask.width > 0
        && rasterLayerContract.dimMask.height > 0
        && rasterLayerContract.dimMask.cssWidth >= 3999
        && rasterLayerContract.dimMask.cssHeight >= 3399
        && rasterLayerContract.dimMask.renderBounds.startsWith('0:0:4000:3400:'),
      `Dim mask must be a ready full-map surface independent of viewport bounds: ${JSON.stringify(rasterLayerContract.dimMask)}`
    );
    passedAssertions += 3;

    const staticSurfaceContract = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.tree-static-surface');
      const context = canvas?.getContext?.('2d');
      if (!canvas || !context) return { opaque: false, sample: null };
      const sample = context.getImageData(0, 0, 1, 1).data;
      return { opaque: sample[3] === 255, sample: [...sample] };
    });
    assert(
      staticSurfaceContract.opaque,
      `Static Canvas must precompose its transparent tile pixels against the map surface: ${staticSurfaceContract.sample || 'unavailable'}`
    );
    passedAssertions++;

    const pressContract = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      const button = document.querySelector('button.tree-node-semantic[data-node-id="1001"]');
      if (!renderer || !button) return null;
      const before = renderer.nodeCanvas?.dataset.nodeVisualSignature || '';
      button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 701, button: 0, bubbles: true }));
      const during = {
        className: button.className,
        pressedNodeId: renderer._pressedNodeId,
        signature: renderer.nodeCanvas?.dataset.nodeVisualSignature || '',
        nodeArtPressed: renderer.nodeArtCanvas?.dataset.pressedNode || ''
      };
      button.dispatchEvent(new PointerEvent('pointerup', { pointerId: 701, button: 0, bubbles: true }));
      return {
        during,
        released: {
          className: button.className,
          pressedNodeId: renderer._pressedNodeId,
          signature: renderer.nodeCanvas?.dataset.nodeVisualSignature || ''
        },
        changedWhilePressed: before !== during.signature
      };
    });
    assert(pressContract?.during.className.includes('is-pressing'), 'Pointerdown must expose the semantic node press state');
    assertEqual(String(pressContract?.during.pressedNodeId), '1001', 'Pointerdown must shrink the pressed node on the Canvas surface');
    assertEqual(String(pressContract?.during.nodeArtPressed), '1001', 'Pointerdown must update the node-art Canvas immediately');
    assert(pressContract?.changedWhilePressed, 'Pressed node must redraw with a distinct visual signature');
    assert(!pressContract?.released.className.includes('is-pressing') && pressContract?.released.pressedNodeId === null, 'Pointerup must restore the node press state');
    passedAssertions += 4;

    const immediatePrerequisiteSetup = await page.evaluate(async () => {
      const app = window.RD2App;
      const renderer = app?.mapRenderer;
      const controller = app?.viewportController;
      if (!app || !renderer || !controller) return null;
      app.selectNodeUseCase?.deselect?.();
      controller.resetToCenter(true);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Exercise a real semantic-button pointer sequence on a node with
      // prerequisites. A programmatic click skips the press/release redraws
      // that can invalidate the node-art signature used by the state overlay.
      const button = document.querySelector('button.tree-node-semantic[data-node-id="1301"]');
      if (!button || !app.navigateViewportUseCase?.centerOnNodeForTooltip) return null;
      const revisionBeforeClick = renderer._sceneRevision;
      const originalCenter = app.navigateViewportUseCase.centerOnNodeForTooltip;
      const upstreamIds = new Set(['1301']);
      let upstreamChanged = true;
      while (upstreamChanged) {
        upstreamChanged = false;
        for (const edge of renderer.model?.edges || []) {
          if (!upstreamIds.has(String(edge.to)) || upstreamIds.has(String(edge.from))) continue;
          upstreamIds.add(String(edge.from));
          upstreamChanged = true;
        }
      }
      const dimSampleNode = (renderer.model?.nodes || []).find((node) => (
        String(node.id) !== '1301'
        && !upstreamIds.has(String(node.id))
        && renderer._nodeIntersects?.(node, renderer._renderBounds)
      ));
      const sampleFullMapDimMaskAlpha = (node) => {
        const canvas = renderer.fullMapDimMaskCanvas;
        const context = renderer.fullMapDimMaskContext;
        const bounds = renderer._fullMapBounds?.();
        const pixelScale = Number(canvas?.dataset.pixelScale || 1);
        if (!canvas || !context || !bounds || !node || !Number.isFinite(pixelScale)) return 0;
        const worldSize = 160;
        const left = Math.max(0, Math.floor((node.x - worldSize / 2 - bounds.left) * pixelScale));
        const top = Math.max(0, Math.floor((node.y - worldSize / 2 - bounds.top) * pixelScale));
        const right = Math.min(canvas.width, Math.ceil((node.x + worldSize / 2 - bounds.left) * pixelScale));
        const bottom = Math.min(canvas.height, Math.ceil((node.y + worldSize / 2 - bounds.top) * pixelScale));
        const width = right - left;
        const height = bottom - top;
        if (width <= 0 || height <= 0) return 0;
        const pixels = context.getImageData(left, top, width, height).data;
        let alpha = 0;
        for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
        return alpha;
      };
      window.__IMMEDIATE_PREREQ_CONTRACT__ = {
        revisionBeforeClick,
        originalCenter,
        dimSampleNodeId: dimSampleNode?.id || null,
        dimMaskBeforeAlpha: sampleFullMapDimMaskAlpha(dimSampleNode),
        sampleFullMapDimMaskAlpha,
        result: null
      };
      app.navigateViewportUseCase.centerOnNodeForTooltip = function (...args) {
        const stateAfterClick = app.store.getState();
        const dimNode = renderer.model?.nodesById?.get?.(String(window.__IMMEDIATE_PREREQ_CONTRACT__.dimSampleNodeId));
        const dimMaskAfterAlpha = window.__IMMEDIATE_PREREQ_CONTRACT__.sampleFullMapDimMaskAlpha(dimNode);
        const overviewEdge = renderer.overviewEdgeCanvas;
        const overviewDynamic = renderer.overviewDynamicCanvas;
        const expectedActiveEdges = (renderer.model?.edges || []).filter((edge) => (
          edge.isActive
          || (renderer.model?.hasFilter && edge.isFilterActive)
          || (renderer.model?.isSimulation && edge.isSimulationActive)
        )).length;
        window.__IMMEDIATE_PREREQ_CONTRACT__.result = {
          cameraMovingAtClick: document.body.classList.contains('is-navigating')
            || document.body.classList.contains('is-zooming'),
          modelHasPrereq: renderer.model?.hasPrereqHighlight === true,
          committedFrameHasPrereq: renderer._sceneFrameModel?.hasPrereqHighlight === true,
          sameModel: renderer._sceneFrameModel === renderer.model,
          committedSynchronously: renderer._sceneRevision > revisionBeforeClick
            && renderer.scene?.dataset.sceneRevision === String(renderer._sceneRevision),
          storeHasPrereq: stateAfterClick.activePrereqIds?.size > 0,
          queuedFrame: Boolean(renderer._sceneQueuedRequest),
          nodeArtSignatureMatches: renderer._nodeArtKey === renderer._nodeArtSignature({
            model: renderer.model,
            bounds: renderer._renderBounds,
            boundsKey: renderer._renderBoundsKey,
            resolution: renderer._sceneFrameResolution
          }),
          dimMaskBeforeAlpha: window.__IMMEDIATE_PREREQ_CONTRACT__.dimMaskBeforeAlpha,
          dimMaskAfterAlpha,
          dimMaskCommittedSynchronously: renderer._fullMapDimMaskModel === renderer.model
            && renderer._fullMapDimMaskActive === true
            && dimNode?.isDimmed === true
            && dimMaskAfterAlpha > window.__IMMEDIATE_PREREQ_CONTRACT__.dimMaskBeforeAlpha + 100,
          overviewEdgeStateSynchronized: overviewEdge?.dataset.modelRevision === String(renderer._sceneRevision)
            && overviewEdge?.dataset.edgeComposite === 'true'
            && Number(overviewEdge?.dataset.activeEdgeCount || -1) === expectedActiveEdges,
          overviewSelectionStateSynchronized: overviewDynamic?.dataset.modelRevision === String(renderer._sceneRevision)
            && overviewDynamic?.dataset.selectedNode === String(stateAfterClick.selectedNodeId || ''),
          selectionAnimationStateSynchronized: renderer.selectionAnimationCanvas?.dataset.modelRevision === String(renderer._sceneRevision)
            && renderer.selectionAnimationCanvas?.dataset.selectedNode === String(stateAfterClick.selectedNodeId || '')
        };
        const returnValue = originalCenter.apply(this, args);
        window.__IMMEDIATE_PREREQ_CONTRACT__.result.cameraMovingAfterClick = document.body.classList.contains('is-navigating')
          || document.body.classList.contains('is-zooming');
        return returnValue;
      };
      const rect = button.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    if (immediatePrerequisiteSetup) {
      await page.mouse.move(
        immediatePrerequisiteSetup.left + immediatePrerequisiteSetup.width / 2,
        immediatePrerequisiteSetup.top + immediatePrerequisiteSetup.height / 2
      );
      await page.mouse.down();
      await page.waitForTimeout(16);
      await page.mouse.up();
    }
    const immediatePrerequisiteContract = await page.evaluate(async () => {
      const contract = window.__IMMEDIATE_PREREQ_CONTRACT__;
      const result = contract?.result || null;
      if (contract?.originalCenter && window.RD2App?.navigateViewportUseCase) {
        window.RD2App.navigateViewportUseCase.centerOnNodeForTooltip = contract.originalCenter;
      }
      delete window.__IMMEDIATE_PREREQ_CONTRACT__;
      window.RD2App?.selectNodeUseCase?.deselect?.();
      await new Promise((resolve) => setTimeout(resolve, 620));
      window.RD2App?.viewportController?.resetToCenter(true);
      return result;
    });
    assert(!immediatePrerequisiteContract?.cameraMovingAtClick,
      'Prerequisite state must commit before the automatic camera transition starts');
    assert(immediatePrerequisiteContract?.cameraMovingAfterClick,
      'The tooltip camera transition must start after click-time state commit');
    assert(immediatePrerequisiteContract?.storeHasPrereq && immediatePrerequisiteContract?.modelHasPrereq,
      'Prerequisite state must be built immediately from the click action');
    assert(immediatePrerequisiteContract?.committedFrameHasPrereq && immediatePrerequisiteContract?.sameModel
      && immediatePrerequisiteContract?.committedSynchronously,
      'Prerequisite highlight must be committed to the existing Canvas frame in the click event');
    assert(immediatePrerequisiteContract?.nodeArtSignatureMatches,
      'Press/release redraws must preserve the node-art signature required by the next selection overlay');
    assert(!immediatePrerequisiteContract?.queuedFrame, 'Immediate prerequisite overlay must not wait in the settled-frame queue');
    assert(immediatePrerequisiteContract?.dimMaskCommittedSynchronously,
      `Full-map dim mask must be painted in the same click-time Canvas commit before camera movement starts (before=${immediatePrerequisiteContract?.dimMaskBeforeAlpha}, after=${immediatePrerequisiteContract?.dimMaskAfterAlpha})`);
    assert(immediatePrerequisiteContract?.overviewEdgeStateSynchronized,
      'Full-map line highlights must synchronize before the automatic camera transition starts');
    assert(immediatePrerequisiteContract?.overviewSelectionStateSynchronized
      && immediatePrerequisiteContract?.selectionAnimationStateSynchronized,
      'Full-map selection frame must synchronize before the automatic camera transition starts');
    passedAssertions += 10;

    const immediatePrerequisiteToggleContract = await page.evaluate(async () => {
      const app = window.RD2App;
      const renderer = app?.mapRenderer;
      const controller = app?.viewportController;
      const button = document.getElementById('toggle-prereq-btn');
      if (!app || !renderer || !controller || !button || !app.navigateViewportUseCase?.centerOnPrereqPath) return null;
      app.selectNodeUseCase?.deselect?.();
      controller.resetToCenter(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Use a node with a real prerequisite path; root nodes correctly skip
      // the optional camera fit because there is nothing to fit.
      app.selectNodeUseCase?.execute?.('5102', {
        point: app.nodePositions.get('5102'),
        nodePositions: app.nodePositions
      });
      app.store.dispatch({ type: 'SET_SHOW_PREREQ_MODE', payload: false });

      const originalCenter = app.navigateViewportUseCase.centerOnPrereqPath;
      let result = null;
      app.navigateViewportUseCase.centerOnPrereqPath = function (...args) {
        const stateAfterClick = app.store.getState();
        result = {
          cameraMovingAtClick: document.body.classList.contains('is-navigating')
            || document.body.classList.contains('is-zooming'),
          showPrereqMode: stateAfterClick.showPrereqMode === true,
          modelHasPrereq: renderer.model?.hasPrereqHighlight === true,
          committedFrameHasPrereq: renderer._sceneFrameModel?.hasPrereqHighlight === true,
          sameModel: renderer._sceneFrameModel === renderer.model,
          queuedFrame: Boolean(renderer._sceneQueuedRequest)
        };
        const returnValue = originalCenter.apply(this, args);
        result.cameraMovingAfterClick = document.body.classList.contains('is-navigating')
          || document.body.classList.contains('is-zooming');
        return returnValue;
      };
      button.click();
      app.navigateViewportUseCase.centerOnPrereqPath = originalCenter;

      app.selectNodeUseCase?.deselect?.();
      await new Promise((resolve) => setTimeout(resolve, 620));
      controller.resetToCenter(true);
      app.store.dispatch({ type: 'SET_SHOW_PREREQ_MODE', payload: true });
      return result;
    });
    assert(!immediatePrerequisiteToggleContract?.cameraMovingAtClick,
      'Prerequisite toggle must commit before its automatic camera transition starts');
    assert(immediatePrerequisiteToggleContract?.cameraMovingAfterClick
      && immediatePrerequisiteToggleContract?.showPrereqMode,
      'Prerequisite toggle must start camera navigation only after the click-time state change');
    assert(immediatePrerequisiteToggleContract?.modelHasPrereq
      && immediatePrerequisiteToggleContract?.committedFrameHasPrereq
      && immediatePrerequisiteToggleContract?.sameModel,
      'Prerequisite toggle must commit the highlighted Canvas frame in the click event');
    assert(!immediatePrerequisiteToggleContract?.queuedFrame,
      'Prerequisite toggle must not wait in the settled-frame queue');
    passedAssertions += 5;

    // Reset the camera and let the committed 1x frame finish before the
    // resolution promotion contract below. The prerequisite click above may
    // have left a settled 2x candidate in flight even after resetToCenter().
    await page.waitForFunction(() => {
      const renderer = window.RD2App?.mapRenderer;
      const canvases = [renderer?.activeEdgeCanvas, renderer?.centerCanvas, renderer?.centerStatsCanvas, renderer?.nodeCanvas, renderer?.stateCanvas, renderer?.selectionCanvas];
      return renderer?.currentResolution === 1
        && renderer?.desiredResolution === 1
        && !renderer?._sceneFramePromise
        && canvases.every((canvas) => canvas?.dataset.renderedScale === '1');
    }, null, { timeout: 8000 });

    const initialViewport = await page.evaluate(() => {
      const viewport = window.RD2App?.viewportController?._state;
      const renderer = window.RD2App?.mapRenderer;
      return {
        viewport: viewport ? { scale: viewport.scale, x: viewport.x, y: viewport.y } : null,
        resolution: renderer?.currentResolution || 1
      };
    });
    await page.evaluate(() => {
      // 1.4x is inside the 2x bucket once the density headroom is applied;
      // 2.0x intentionally promotes to the 3x bucket.
      window.RD2App?.viewportController?.zoomTo(1.4, 2000, 1700, true);
    });
    await page.waitForFunction(() => {
      const renderer = window.RD2App?.mapRenderer;
      const expected = String(renderer?.currentResolution || '');
      const layers = [renderer?.activeEdgeCanvas, renderer?.centerCanvas, renderer?.centerStatsCanvas, renderer?.nodeCanvas, renderer?.stateCanvas, renderer?.selectionCanvas];
      return renderer?.currentResolution === 2
        && renderer?.desiredResolution === 2
        && layers.every((canvas) => canvas?.dataset.renderedScale === expected)
        && renderer?.nodeCanvas?.dataset.canvasReady === 'true';
    }, null, { timeout: 8000 });
    const highResolutionContract = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      const canvases = [renderer?.activeEdgeCanvas, renderer?.centerCanvas, renderer?.centerStatsCanvas, renderer?.nodeCanvas, renderer?.stateCanvas, renderer?.selectionCanvas];
      return {
        currentResolution: renderer?.currentResolution,
        desiredResolution: renderer?.desiredResolution,
        renderedScales: canvases.map((canvas) => canvas?.dataset.renderedScale || null),
        nodeReady: renderer?.nodeCanvas?.dataset.canvasReady === 'true'
      };
    });
    assertEqual(highResolutionContract.currentResolution, 2, 'Settled 2x zoom must promote the map to the 2x raster bucket');
    assertEqual(highResolutionContract.desiredResolution, 2, 'The desired raster bucket must follow the settled viewport scale');
    assert(highResolutionContract.renderedScales.every((scale) => scale === '2') && highResolutionContract.nodeReady, 'All dynamic Canvas layers must switch atomically to the settled raster bucket');
    passedAssertions += 3;
    await page.evaluate((initial) => {
      const controller = window.RD2App?.viewportController;
      if (!controller || !initial?.viewport) return;
      Object.assign(controller._state, initial.viewport);
      controller.requestRender();
    }, initialViewport);
    await page.waitForFunction((resolution) => {
      const renderer = window.RD2App?.mapRenderer;
      const expected = String(resolution);
      return renderer?.currentResolution === resolution
        && [renderer.activeEdgeCanvas, renderer.centerCanvas, renderer.centerStatsCanvas, renderer.nodeCanvas, renderer.stateCanvas, renderer.selectionCanvas]
          .every((canvas) => canvas?.dataset.renderedScale === expected);
    }, initialViewport.resolution, { timeout: 8000 });
    await page.focus('button.tree-node-semantic[data-node-id="1001"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    const keyboardSelectedId = await page.evaluate(() => window.__TEST_HOOKS__.getState().selectedNodeId);
    assertEqual(String(keyboardSelectedId), '1001', 'Enter on a focused tree node must select it');
    await page.evaluate(() => window.__TEST_HOOKS__.closeTooltip(true));
    await page.waitForSelector('#tooltip', { state: 'hidden', timeout: 3000 });
    await page.focus('button.tree-node-semantic[data-node-id="1001"]');
    await page.keyboard.press('Space');
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    const spaceSelectedId = await page.evaluate(() => window.__TEST_HOOKS__.getState().selectedNodeId);
    assertEqual(String(spaceSelectedId), '1001', 'Space on a focused tree node must select it');
    const nodeClickFilterState = await page.evaluate(() => {
      const state = window.__TEST_HOOKS__.getState();
      return {
        factions: [...(state.filters?.factions || [])],
        nodeTypes: [...(state.filters?.nodeTypes || [])]
      };
    });
    assertEqual(nodeClickFilterState.factions.length, 0, 'Activating a semantic node must not apply a faction filter');
    assertEqual(nodeClickFilterState.nodeTypes.length, 0, 'Activating a semantic node must not apply a node type filter');
    passedAssertions += 8;
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
    await page.waitForFunction(() => {
      const minimap = document.getElementById('minimap-panel');
      return document.body.classList.contains('is-zooming')
        && minimap
        && Number.parseFloat(window.getComputedStyle(minimap).opacity) >= 0.8;
    }, null, { timeout: 1000 });
    const minimapOpacity = await page.$eval('#minimap-panel', (element) => Number.parseFloat(window.getComputedStyle(element).opacity));
    assert(zoomFadeCheck.hasZoomingClass, 'Body should have .is-zooming class on wheel');
    assert(zoomFadeCheck.topbarOpacity >= 0.9, 'Topbar must stay visible during zoom');
    assert(minimapOpacity >= 0.8, 'Minimap should fade in during zoom');
    passedAssertions += 3;
    const motionMaskContract = await page.evaluate(() => ({
      localMotionMaskCount: document.querySelectorAll('.tree-motion-mask-surface').length,
      fixedEdgeMask: Boolean(document.querySelector('canvas.tree-full-edge-dim-mask-surface')),
      fixedNodeMask: Boolean(document.querySelector('canvas.tree-full-dim-mask-surface'))
    }));
    assert(
      motionMaskContract.localMotionMaskCount === 0
        && motionMaskContract.fixedEdgeMask
        && motionMaskContract.fixedNodeMask,
      `Camera motion must not add a viewport-local dim mask; dimming must remain on fixed world-space surfaces: ${JSON.stringify(motionMaskContract)}`
    );
    passedAssertions++;
    const motionRasterState = await page.evaluate(() => {
      const scene = document.querySelector('.map-scene');
      const style = scene ? window.getComputedStyle(scene) : null;
      return {
        willChange: style?.willChange || ''
      };
    });
    assertEqual(motionRasterState.willChange, 'auto', 'Large Canvas map scene must not be promoted into a low-resolution compositor snapshot during a gesture');
    passedAssertions += 1;

    const canvasTransformContract = await page.evaluate(() => {
      const scene = document.querySelector('.map-scene');
      const renderRoot = [...(scene?.children || [])]
        .find((element) => element.classList?.contains('tree-render-root'));
      const renderLayers = [
        'tree-edge-canvas',
        'tree-frame-canvas',
        'tree-selection-animation-canvas',
        'tree-semantic-layer'
      ];
      return {
        rootTransform: scene ? window.getComputedStyle(scene).transform : '',
        renderRootTransform: renderRoot ? window.getComputedStyle(renderRoot).transform : '',
        renderLayerCount: renderRoot
          ? renderLayers.filter((className) => renderRoot.querySelector(`.${className}`)).length
          : 0
      };
    });
    assertEqual(canvasTransformContract.rootTransform, 'none', 'Canvas map must keep the large scene root untransformed');
    assert(
      canvasTransformContract.renderRootTransform !== 'none'
        && canvasTransformContract.renderLayerCount === 4,
      'Canvas map camera must transform one shared bounded render root'
    );
    passedAssertions += 2;

    await page.waitForFunction(() => {
      const scene = document.querySelector('.map-scene');
      return scene
        && !document.body.classList.contains('is-zooming')
        && !document.body.classList.contains('is-navigating')
        && window.getComputedStyle(scene).willChange !== 'transform';
    }, null, { timeout: 3000 });

    const settledRasterState = await page.evaluate(() => {
      const scene = document.querySelector('.map-scene');
      return {
        willChange: window.getComputedStyle(scene).willChange,
        localMotionMaskCount: document.querySelectorAll('.tree-motion-mask-surface').length
      };
    });
    assert(settledRasterState.willChange === 'auto' || settledRasterState.willChange === 'scroll-position' || settledRasterState.willChange === 'contents', 'Map scene should release its compositor hint after a gesture so the final raster can be sharp');
    assertEqual(settledRasterState.localMotionMaskCount, 0, 'Camera settling must not leave a viewport-local dim mask in the DOM');
    passedAssertions += 2;

    // 指針平移測試 (Drag Pan)
    const heldMotionTileStart = await page.evaluate(() => {
      const vp = document.getElementById('viewport');
      const renderer = window.RD2App?.mapRenderer;
      const before = [...(renderer?.visibleTileCanvases?.keys?.() || [])];
      const renderBounds = renderer?._renderBoundsKey || '';
      const staticCanvas = renderer?.staticCanvas;
      vp.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 640, clientY: 400, bubbles: true }));
      // Cross a tile boundary while the pointer remains down. The committed
      // frame must remain stable during the gesture; rebuilding a large
      // dynamic surface on every pointermove causes dropped frames and can
      // expose an incomplete raster candidate.
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 2000, clientY: 400, bubbles: true }));
      return {
        before,
        renderBounds,
        moving: document.body.classList.contains('is-navigating'),
        staticOpacity: staticCanvas?.style.opacity || '',
        edgeComposite: renderer?.activeEdgeCanvas === staticCanvas
      };
    });
    await page.waitForTimeout(120);
    const heldMotionTileDuring = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      return {
        visible: [...(renderer?.visibleTileCanvases?.keys?.() || [])],
        dynamicBounds: renderer?._renderBoundsKey || '',
        nodeBounds: renderer?.nodeCanvas?.dataset.renderBounds || '',
        stateBounds: renderer?.stateCanvas?.dataset.renderBounds || '',
        staticOpacity: renderer?.staticCanvas?.style.opacity || '',
        edgeComposite: renderer?.activeEdgeCanvas === renderer?.staticCanvas
      };
    });
    assertEqual(heldMotionTileDuring.dynamicBounds, heldMotionTileStart.renderBounds, 'Committed Canvas bounds must remain stable while a pointer drag is active');
    assertEqual(heldMotionTileDuring.nodeBounds, heldMotionTileStart.renderBounds, 'Node surface must not rebuild during an active pointer drag');
    assertEqual(heldMotionTileDuring.stateBounds, heldMotionTileStart.renderBounds, 'Label surface must not rebuild during an active pointer drag');
    assertEqual(heldMotionTileDuring.visible.join('|'), heldMotionTileStart.before.join('|'), 'Visible raster tiles must remain atomically committed during an active pointer drag');
    assertEqual(heldMotionTileStart.staticOpacity, '1', 'The edge composite must start at a fixed opaque CSS alpha');
    assertEqual(heldMotionTileDuring.staticOpacity, heldMotionTileStart.staticOpacity, 'The edge composite CSS alpha must not change during a pointer drag');
    assert(heldMotionTileStart.edgeComposite && heldMotionTileDuring.edgeComposite, 'Active edge diagnostics must remain an alias of the static edge composite during a drag');
    assert(heldMotionTileStart.moving, 'Pointer drag must enter navigation state before release');
    passedAssertions += 8;
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
    await page.waitForFunction((initialBounds) => {
      const renderer = window.RD2App?.mapRenderer;
      const currentBounds = renderer?._renderBoundsKey || '';
      return currentBounds
        && currentBounds !== initialBounds
        && renderer?.nodeCanvas?.dataset.renderBounds === currentBounds
        && renderer?.stateCanvas?.dataset.renderBounds === currentBounds
        && renderer?.activeEdgeCanvas?.dataset.renderBounds === currentBounds
        && renderer?.selectionCanvas?.dataset.renderBounds === currentBounds
        && renderer?.nodeCanvas?.dataset.canvasReady === 'true';
    }, heldMotionTileStart.renderBounds, { timeout: 3000 });
    const heldMotionTileAfter = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      return {
        visible: [...(renderer?.visibleTileCanvases?.keys?.() || [])],
        dynamicBounds: renderer?._renderBoundsKey || '',
        nodeBounds: renderer?.nodeCanvas?.dataset.renderBounds || '',
        stateBounds: renderer?.stateCanvas?.dataset.renderBounds || ''
      };
    });
    assert(
      heldMotionTileAfter.visible.some((path) => !heldMotionTileStart.before.includes(path)),
      'A newly visible raster tile must be mounted after the pointer drag settles'
    );
    assertEqual(heldMotionTileAfter.nodeBounds, heldMotionTileAfter.dynamicBounds, 'Node sprites must swap with the newly visible raster bounds after the drag settles');
    assertEqual(heldMotionTileAfter.stateBounds, heldMotionTileAfter.dynamicBounds, 'Node labels must swap with the newly visible raster bounds after the drag settles');
    passedAssertions += 3;

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
      return viewport
        && Math.abs(viewport.scale - (viewport.baseScale || 1)) < 0.002
        && !document.body.classList.contains('is-navigating')
        && !document.body.classList.contains('is-zooming');
    }, null, { timeout: 2000 });
    const resetZoom = await page.$eval('#zoom-readout', el => el.textContent.trim());
    console.log(`✓ Keyboard zoom verified: ${initialZoom} -> ${zoomedIn} -> reset: ${resetZoom}`);
    assertEqual(resetZoom, '100%', 'Reset shortcut must settle at the desktop base zoom');
    passedAssertions++;

    // 貨幣標籤 Toggle 測試 (預設 OFF)
    const defaultCurrencyOff = await page.evaluate(() => {
      const hasClass = document.body.classList.contains('show-currency-badges');
      return !hasClass && Boolean(document.querySelector('.map-scene .tree-state-surface'));
    });
    assert(defaultCurrencyOff, 'Currency badges must be OFF by default');
    passedAssertions++;

    await page.click('#toggle-currency-btn');
    await page.waitForFunction(() => {
      return document.body.classList.contains('show-currency-badges');
    }, null, { timeout: 2000 });
    passedAssertions++;

    await page.click('#toggle-currency-btn');
    await page.waitForFunction(() => !document.body.classList.contains('show-currency-badges'), null, { timeout: 2000 });
    await page.waitForTimeout(200);

    // ==========================================
    // Tier 2: Multi-rank 滑桿邊界、極值與 Rubber-banding
    // ==========================================
    console.log('--- Tier 2: Interactive Rank Slider & Boundary Bounce ---');
    const node1201 = await page.$('button.tree-node-semantic[data-node-id="1201"]');
    assert(node1201, 'Node 1201 must exist');
    await page.evaluate(() => {
      const el = document.querySelector('button.tree-node-semantic[data-node-id="1201"]');
      if (el) el.click();
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
    passedAssertions += 8;

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
      { key: 'en', tag: 'Bloom', awakeningTag: 'Fruit', name: 'Flower Dice' },
      { key: 'ja', tag: '開花', awakeningTag: '実', name: '花のダイス' },
      { key: 'ko', tag: '개화', awakeningTag: '열매', name: '꽃 주사위' },
      { key: 'zh-tw', tag: '綻放', awakeningTag: '果實', name: '花骰子' },
    ];
    for (const { key, tag, awakeningTag, name } of tooltipLocaleChecks) {
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
      const nodeLabel = await page.evaluate(() => ({
        ariaLabel: document.querySelector('button.tree-node-semantic[data-node-id="1003"]')?.getAttribute('aria-label'),
        renderedLabel: window.RD2App?.mapRenderer?.model?.nodesById?.get('1003')?.label || ''
      }));
      assertEqual(nodeLabel.ariaLabel, name, `${key} semantic node label must use the current localized name`);
      assertEqual(nodeLabel.renderedLabel, name, `${key} Canvas node label must use the current localized name`);
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

    // 第一次空白處只關閉目前 tooltip，前置節點顯示保留；第二次才退出
    // 這次暫時顯示的路徑，但不可改動控制列的勾選狀態。拖曳視野後的
    // 瀏覽器 click 也不得重新選取手指/滑鼠放開處的節點。
    await page.evaluate(() => {
      const state = window.__TEST_HOOKS__.getState();
      if (!state.showPrereqMode) document.getElementById('toggle-prereq-btn')?.click();
      window.__TEST_HOOKS__.showTooltip('5102', true);
    });
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    await page.evaluate(() => {
      document.getElementById('viewport')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForSelector('#tooltip', { state: 'hidden', timeout: 3000 });
    const blankClickState = await page.evaluate(() => {
      const state = window.__TEST_HOOKS__.getState();
      return {
        selectedNodeId: state.selectedNodeId,
        activePrereqCount: state.activePrereqIds?.size || 0,
        showPrereqMode: state.showPrereqMode,
        sceneHasPrereqHighlight: document.querySelector('.map-scene')?.classList.contains('has-tree-prereq') || false,
        unrelatedNodeDimmed: [...(window.RD2App?.mapRenderer?.model?.nodes || [])]
          .find((node) => !node.isPrereq)?.isDimmed ?? false
      };
    });
    assertEqual(blankClickState.selectedNodeId, null, 'Blank map click should clear the selected node');
    assert(blankClickState.activePrereqCount > 0, 'First blank map click should preserve the active prerequisite path');
    assertEqual(blankClickState.showPrereqMode, true, 'Blank map click should preserve prerequisite display mode after closing the tooltip');
    assert(blankClickState.sceneHasPrereqHighlight, 'First blank map click should keep prerequisite highlighting visible');
    assert(blankClickState.unrelatedNodeDimmed, 'First blank map click should keep unrelated nodes dimmed while prerequisites remain visible');
    await page.evaluate(() => {
      document.getElementById('viewport')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const secondBlankClickState = await page.evaluate(() => ({
      selectedNodeId: window.__TEST_HOOKS__.getState().selectedNodeId,
      activePrereqCount: window.__TEST_HOOKS__.getState().activePrereqIds?.size || 0,
      sceneHasPrereqHighlight: document.querySelector('.map-scene')?.classList.contains('has-tree-prereq') || false,
      showPrereqMode: window.__TEST_HOOKS__.getState().showPrereqMode
    }));
    assertEqual(secondBlankClickState.selectedNodeId, null, 'Second blank map click should keep the selected node cleared');
    assertEqual(secondBlankClickState.activePrereqCount, 0, 'Second blank map click should exit the temporary prerequisite display');
    assert(!secondBlankClickState.sceneHasPrereqHighlight, 'Second blank map click should remove prerequisite highlighting');
    assertEqual(secondBlankClickState.showPrereqMode, true, 'Second blank map click must not uncheck prerequisite mode');
    passedAssertions += 7;

    await page.evaluate(() => window.__TEST_HOOKS__.showTooltip('1001', true));
    await page.waitForSelector('#tooltip:not([hidden])', { timeout: 3000 });
    await page.evaluate(() => window.__TEST_HOOKS__.closeTooltip(true));
    await page.waitForSelector('#tooltip', { state: 'hidden', timeout: 3000 });
    const dragNode = await page.$('button.tree-node-semantic[data-node-id="1001"]');
    const dragBox = await dragNode?.boundingBox();
    assert(dragBox, 'Drag regression fixture node 1001 must be visible');
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(220);
    await page.mouse.move(dragBox.x + dragBox.width / 2 + 90, dragBox.y + dragBox.height / 2 + 45, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const dragClickState = await page.evaluate(() => ({
      selectedNodeId: window.__TEST_HOOKS__.getState().selectedNodeId,
      tooltipHidden: document.getElementById('tooltip')?.hidden === true
    }));
    assertEqual(dragClickState.selectedNodeId, null, 'Long-press tree drag must not reselect a node on release');
    assert(dragClickState.tooltipHidden, 'Long-press tree drag must leave the node tooltip closed');
    passedAssertions += 3;

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
    const perkFilterLabel = await page.$eval('.type-chip[data-type="PERK"]', (element) => element.textContent.trim());
    assertEqual(perkFilterLabel, '支援', 'The PERK filter must use the canonical 支援 label');
    passedAssertions += 6;
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
      const model = window.RD2App?.mapRenderer?.model;
      const matchedNode = [...(model?.nodes || [])].find((node) => node.isMatching);
      const dimmedNode = [...(model?.nodes || [])].find((node) => node.isDimmed);
      return {
        matchedOpacity: matchedNode && !matchedNode.isDimmed ? 1 : 0,
        dimmedOpacity: dimmedNode ? 0.2 : 1
      };
    });
    assert(highlightCheck.matchedOpacity >= 0.9, 'Search matched node opacity should be >= 0.9');
    assert(highlightCheck.dimmedOpacity <= 0.25, 'Unmatched node opacity should be <= 0.25');
    passedAssertions += 2;

    const dimMaskBeforePan = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      const canvas = renderer?.fullMapDimMaskCanvas;
      const edgeCanvas = renderer?.fullMapEdgeDimMaskCanvas;
      return canvas ? {
        active: renderer._fullMapDimMaskActive === true,
        width: canvas.width,
        height: canvas.height,
        renderBounds: canvas.dataset.renderBounds || '',
        visibility: canvas.style.visibility,
        edge: edgeCanvas ? {
          active: renderer._fullMapEdgeDimMaskActive === true,
          width: edgeCanvas.width,
          height: edgeCanvas.height,
          pixelScale: Number(edgeCanvas.dataset.pixelScale || '0'),
          renderBounds: edgeCanvas.dataset.renderBounds || '',
          visibility: edgeCanvas.style.visibility
        } : null
      } : null;
    });
    await page.evaluate(() => window.RD2App?.viewportController?.pan?.(-240, 0));
    await page.waitForTimeout(60);
    const dimMaskAfterPan = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      const canvas = renderer?.fullMapDimMaskCanvas;
      const edgeCanvas = renderer?.fullMapEdgeDimMaskCanvas;
      return canvas ? {
        active: renderer._fullMapDimMaskActive === true,
        width: canvas.width,
        height: canvas.height,
        renderBounds: canvas.dataset.renderBounds || '',
        visibility: canvas.style.visibility,
        edge: edgeCanvas ? {
          active: renderer._fullMapEdgeDimMaskActive === true,
          width: edgeCanvas.width,
          height: edgeCanvas.height,
          pixelScale: Number(edgeCanvas.dataset.pixelScale || '0'),
          renderBounds: edgeCanvas.dataset.renderBounds || '',
          visibility: edgeCanvas.style.visibility
        } : null
      } : null;
    });
    assert(
      dimMaskBeforePan?.active
        && dimMaskAfterPan?.active
        && dimMaskAfterPan.width === dimMaskBeforePan.width
        && dimMaskAfterPan.height === dimMaskBeforePan.height
        && dimMaskAfterPan.renderBounds === dimMaskBeforePan.renderBounds
        && dimMaskAfterPan.visibility === 'visible',
      `Full-map dim mask must remain stable while the camera range changes: before=${JSON.stringify(dimMaskBeforePan)}, after=${JSON.stringify(dimMaskAfterPan)}`
    );
    assert(
      dimMaskBeforePan?.edge?.active
        && dimMaskAfterPan?.edge?.active
        && dimMaskBeforePan.edge.pixelScale === 0.25
        && dimMaskAfterPan.edge.pixelScale === dimMaskBeforePan.edge.pixelScale
        && dimMaskBeforePan.edge.width > 500
        && dimMaskBeforePan.edge.height > 400
        && dimMaskAfterPan.edge.width === dimMaskBeforePan.edge.width
        && dimMaskAfterPan.edge.height === dimMaskBeforePan.edge.height
        && dimMaskAfterPan.edge.renderBounds === dimMaskBeforePan.edge.renderBounds
        && dimMaskAfterPan.edge.visibility === 'visible',
      `Full-map edge dim mask must remain stable while the camera range changes: before=${JSON.stringify(dimMaskBeforePan?.edge)}, after=${JSON.stringify(dimMaskAfterPan?.edge)}`
    );
    passedAssertions += 2;

    const overviewDimmingContract = await page.evaluate(() => {
      const renderer = window.RD2App?.mapRenderer;
      const overview = renderer?.overviewCanvas;
      const overviewEdge = renderer?.overviewEdgeCanvas;
      const overviewNodeArt = renderer?.overviewNodeArtCanvas;
      const overviewDynamic = renderer?.overviewDynamicCanvas;
      const overviewParent = overview?.parentElement?.className || '';
      const frameHost = overview?.parentElement;
      const activeEdge = renderer?.activeEdgeCanvas
        && renderer.activeEdgeCanvas !== renderer.staticCanvas
        ? renderer.activeEdgeCanvas
        : null;
      const surfaceOrder = frameHost
          ? [
            overview,
            overviewEdge,
            overviewNodeArt,
            overviewDynamic,
            renderer?.staticCanvas,
            renderer?.fullMapEdgeDimMaskCanvas,
            activeEdge,
            renderer?.nodeArtCanvas,
            renderer?.fullMapDimMaskCanvas,
            renderer?.dynamicCanvas
          ].filter(Boolean).map((surface) => [...frameHost.children].indexOf(surface))
        : [];
      return {
        ready: overview?.dataset.canvasReady === 'true',
        edgeReady: overviewEdge?.dataset.canvasReady === 'true',
        foregroundReady: overviewNodeArt?.dataset.canvasReady === 'true'
          && overviewDynamic?.dataset.canvasReady === 'true',
        nodeDimming: overview?.dataset.nodeDimming || '',
        edgeDimming: overview?.dataset.edgeDimming || '',
        continuity: overview?.dataset.continuity || '',
        visible: overview?.style.visibility || '',
        edgeVisible: overviewEdge?.style.visibility || '',
        foregroundVisible: overviewNodeArt?.style.visibility === 'visible'
          && overviewDynamic?.style.visibility === 'visible',
        sameFrameHost: overviewParent === 'tree-frame-surface',
        edgeSameFrameHost: overviewEdge?.parentElement === overview?.parentElement,
        foregroundSameFrameHost: overviewNodeArt?.parentElement === overview?.parentElement
          && overviewDynamic?.parentElement === overview?.parentElement,
        fullMapDimMaskCount: document.querySelectorAll('.tree-full-dim-mask-surface').length,
        fullMapEdgeDimMaskCount: document.querySelectorAll('.tree-full-edge-dim-mask-surface').length,
        activeEdgeIndex: activeEdge ? [...frameHost.children].indexOf(activeEdge) : -1,
        nodeArtIndex: renderer?.nodeArtCanvas ? [...frameHost.children].indexOf(renderer.nodeArtCanvas) : -1,
        edgeDimMaskIndex: renderer?.fullMapEdgeDimMaskCanvas ? [...frameHost.children].indexOf(renderer.fullMapEdgeDimMaskCanvas) : -1,
        layerZIndexes: [
          overview,
          renderer?.fullMapEdgeDimMaskCanvas,
          overviewEdge,
          overviewNodeArt,
          renderer?.fullMapDimMaskCanvas,
          overviewDynamic
        ].map((surface) => surface ? getComputedStyle(surface).zIndex : ''),
        surfaceOrder,
        localMaskCount: document.querySelectorAll('.tree-motion-mask-surface, .tree-frame-coverage-mask').length
      };
    });
    assert(
      overviewDimmingContract.ready
        && overviewDimmingContract.edgeReady
        && overviewDimmingContract.foregroundReady
        && overviewDimmingContract.nodeDimming === 'fixed-full-map-mask'
        && overviewDimmingContract.edgeDimming === 'fixed-full-map-mask'
        && overviewDimmingContract.continuity === 'full-map'
        && overviewDimmingContract.visible === 'visible'
        && overviewDimmingContract.edgeVisible === 'visible'
        && overviewDimmingContract.foregroundVisible
        && overviewDimmingContract.sameFrameHost
        && overviewDimmingContract.edgeSameFrameHost
        && overviewDimmingContract.foregroundSameFrameHost
        && overviewDimmingContract.fullMapDimMaskCount === 1
        && overviewDimmingContract.fullMapEdgeDimMaskCount === 1
        && JSON.stringify(overviewDimmingContract.layerZIndexes) === JSON.stringify(['0', '2', '3', '3', '4', '5'])
        && (overviewDimmingContract.activeEdgeIndex === -1
          || (overviewDimmingContract.edgeDimMaskIndex < overviewDimmingContract.activeEdgeIndex
            && overviewDimmingContract.activeEdgeIndex < overviewDimmingContract.nodeArtIndex))
        && JSON.stringify(overviewDimmingContract.surfaceOrder) === JSON.stringify(
          overviewDimmingContract.activeEdgeIndex >= 0
            ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
            : [0, 1, 2, 3, 4, 5, 6, 7, 8]
        )
        && overviewDimmingContract.localMaskCount === 0,
      `Overview continuity content must stay in the fixed-mask stacking context: ${JSON.stringify(overviewDimmingContract)}`
    );
    passedAssertions++;

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
