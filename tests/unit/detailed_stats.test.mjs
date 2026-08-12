import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  formatStatValue,
  aggregateDetailedStats,
} from '../../src/domain/detailed_stats.js';
import { DetailedStatsView } from '../../src/ui/detailed_stats_view.js';
import { AppStore } from '../../src/app/store/app_store.js';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const treeData = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'site', 'data', 'dice_tree.json'), 'utf8')
);

test('detailed_stats: formatStatValue formats integers and decimals cleanly', () => {
  assert.equal(formatStatValue(0), '0');
  assert.equal(formatStatValue(35), '35');
  assert.equal(formatStatValue(38.5), '38.5');
  assert.equal(formatStatValue(4.55), '4.55');
  assert.equal(formatStatValue(10.0), '10');
  assert.equal(formatStatValue(NaN), '0');
  assert.equal(formatStatValue(null), '0');
});

test('detailed_stats: aggregateDetailedStats calculates full normal mode stats across all 5 branches', () => {
  const result = aggregateDetailedStats(treeData.nodes, null);

  assert.ok(result.global.length === 3, 'Global stats should have 3 entries (All Dice Dmg, Initial SP, Max HP)');
  assert.equal(result.global[0].text, '所有骰子子彈傷害增加1026%');
  assert.equal(result.global[1].text, '起始SP增加200');
  assert.equal(result.global[2].text, '最大生命值增加50');

  for (const branchId of [1, 2, 3, 4, 5]) {
    const branch = result.branches[branchId];
    assert.ok(branch, `Branch ${branchId} should exist`);
    assert.ok(branch.name, `Branch ${branchId} should have a localized name`);
    assert.ok(branch.color, `Branch ${branchId} should have a theme color`);
    assert.ok(branch.stats.length > 0, `Branch ${branchId} should have stat entries`);
  }
});

test('detailed_stats: aggregateDetailedStats in simulation mode respects allocated ranks', () => {
  // Scenario 1: Empty simulation (0 allocated nodes)
  const emptyResult = aggregateDetailedStats(treeData.nodes, {});
  assert.equal(emptyResult.global.length, 0);
  for (const branchId of [1, 2, 3, 4, 5]) {
    assert.equal(emptyResult.branches[branchId].stats.length, 0);
  }

  // Scenario 2: Unlocking specific nodes
  // Node 1115 is "粉碎強化" (TrashDelay01, Nature, value=30, max_rank=1)
  // Node 1102 is "所有骰子傷害" (DiceAttackUpPerV2, Nature, value=10, rank_add=1.2, max_rank=50)
  // Node 1112 is "起始SP增加" (PlayerStartSpUpV1, Nature, value=40, max_rank=1)
  const activeRanks = {
    '1115': 1,
    '1102': 10, // base 10 + (10 - 1) * 1.2 = 10 + 10.8 = 20.8
    '1112': 1   // base 40
  };

  const simResult = aggregateDetailedStats(treeData.nodes, activeRanks);
  
  // Check global stats (Dice dmg + Initial SP)
  assert.equal(simResult.global.length, 2);
  assert.equal(simResult.global[0].totalValue, 20.8);
  assert.equal(simResult.global[0].text, '所有骰子子彈傷害增加20.8%');
  assert.equal(simResult.global[1].totalValue, 40);
  assert.equal(simResult.global[1].text, '起始SP增加40');

  // Check nature stat (branch 1)
  const natureBranch = simResult.branches[1];
  assert.equal(natureBranch.stats.length, 1);
  assert.equal(natureBranch.stats[0].text, '粉碎冷卻時間減少30秒');

  // Other branches should be empty
  for (const branchId of [2, 3, 4, 5]) {
    assert.equal(simResult.branches[branchId].stats.length, 0);
  }
});

test('detailed_stats: defensive input handling for null/undefined/empty nodes', () => {
  const resultNull = aggregateDetailedStats(null);
  assert.deepEqual(resultNull.global, []);
  assert.equal(Object.keys(resultNull.branches).length, 5);

  const resultEmpty = aggregateDetailedStats({});
  assert.deepEqual(resultEmpty.global, []);
});

test('DetailedStatsView: lifecycle, open, close, and DOM rendering', () => {
  const dom = {
    triggerBtn: {
      setAttribute(k, v) { this[k] = v; },
      classList: {
        add(c) { this[c] = true; },
        remove(c) { delete this[c]; },
      }
    },
    modal: {
      hidden: true,
      removeAttribute(k) { delete this[k]; },
      setAttribute(k, v) { this[k] = v; },
      classList: {
        add(c) { this[c] = true; },
        remove(c) { delete this[c]; },
      }
    },
    contentSlot: {
      innerHTML: ''
    },
    closeBtn: {}
  };

  const store = new AppStore({
    nodes: treeData.nodes,
    simulationMode: false,
    simulationPlan: { ranks: {} }
  });

  const view = new DetailedStatsView({ store, container: {} });
  view._triggerBtn = dom.triggerBtn;
  view._modal = dom.modal;
  view._contentSlot = dom.contentSlot;
  view._closeBtn = dom.closeBtn;
  view._initialized = true;

  // Open modal
  view.open();
  assert.equal(view.isOpen, true);
  assert.equal(dom.modal.hidden, false);
  assert.ok(dom.contentSlot.innerHTML.includes('detailed-stats-group'));
  assert.ok(dom.contentSlot.innerHTML.includes('所有骰子子彈傷害增加'));

  // Close modal (immediate for test)
  view.close(true);
  assert.equal(view.isOpen, false);
  assert.equal(dom.modal.hidden, true);

  view.destroy();
  assert.equal(view._initialized, false);
});

test('DetailedStatsView: strips localized incremental markup and ignores viewport churn', () => {
  const view = new DetailedStatsView({
    store: {},
    container: {},
    localization: {
      source: () => '所有骰子子彈傷害增加{0}%<color=#00FF00>(+{1}%)</color>'
    }
  });

  assert.equal(
    view._formatItem({ sourceKey: 'stat_all_dice_damage', totalValue: 1026 }),
    '所有骰子子彈傷害增加1026%'
  );

  view.isOpen = true;
  let renderCount = 0;
  view.render = () => { renderCount += 1; };
  view._handleStoreUpdate({}, { type: 'UPDATE_VIEWPORT' });
  view._handleStoreUpdate({}, { type: 'SET_VIEWPORT' });
  view._handleStoreUpdate({}, { type: 'SIMULATION_UNLOCK_NODE' });
  assert.equal(renderCount, 1, 'Viewport updates must not rebuild the detailed stats DOM');
});
