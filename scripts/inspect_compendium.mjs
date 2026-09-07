import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { startTestServer } = await import('../tests/helpers/test_server.mjs');

const server = await startTestServer(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
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

// Screenshot of boss_4 card
const boss4 = page.locator('.compendium-card[data-compendium-id="boss_4"]');
await boss4.scrollIntoViewIfNeeded();
await boss4.screenshot({ path: 'artifacts/boss_4_card.png' });

// Screenshot of boss_18 card
const boss18 = page.locator('.compendium-card[data-compendium-id="boss_18"]');
await boss18.scrollIntoViewIfNeeded();
await boss18.screenshot({ path: 'artifacts/boss_18_card.png' });

// Also let's switch to Grid mode and screenshot monsters in grid mode
await page.click('.compendium-view-toggle button[data-view="grid"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/compendium_monsters_grid.png' });

await browser.close();
await server.close();
