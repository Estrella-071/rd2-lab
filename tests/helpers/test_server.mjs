import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '..', '..');
const siteDir = path.resolve(process.env.VERIFY_SITE_DIR || path.join(websiteDir, 'site'));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.skel': 'application/octet-stream',
  '.atlas': 'text/plain; charset=utf-8',
};

/**
 * 啟動測試用 HTTP 伺服器
 * @param {number} [port=0] 指定端口（0 為隨機可用端口）
 * @returns {Promise<{ server: http.Server, baseUrl: string, port: number, close: () => Promise<void> }>}
 */
export async function startTestServer(port = 0) {
  const currentSiteDir = path.resolve(process.env.VERIFY_SITE_DIR || path.join(websiteDir, 'site'));
  const shares = new Map();
  const codesByPayload = new Map();
  let nextShareId = 0;
  const base62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const encodeShareCode = (value) => {
    let code = '';
    let remaining = value;
    do {
      code = base62[remaining % 62] + code;
      remaining = Math.floor(remaining / 62);
    } while (remaining > 0);
    return code.padStart(6, '0');
  };
  const json = (res, body, status = 200, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');

      // The browser suite emulates the Pages Function locally so share-link
      // flows exercise the same six-character API contract without requiring
      // a remote D1 binding.
      if (parsedUrl.pathname === '/api/shares' && req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          json(res, { ok: false, error: 'unsupported-media-type' }, 415);
          return;
        }
        let requestBody = '';
        let requestTooLarge = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (requestTooLarge) return;
          requestBody += chunk;
          if (requestBody.length > 4096 + 256) {
            requestTooLarge = true;
            requestBody = '';
          }
        });
        req.on('end', () => {
          if (requestTooLarge) {
            json(res, { ok: false, error: 'share-payload-too-large' }, 413);
            return;
          }
          try {
            const body = JSON.parse(requestBody);
            const encoded = body?.encoded;
            if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 4096 || !/^[0-9A-Za-z]+$/.test(encoded)) {
              json(res, { ok: false, error: 'invalid-share-payload' }, 400);
              return;
            }
            const existingCode = codesByPayload.get(encoded);
            if (existingCode) {
              json(res, { ok: true, code: existingCode }, 200, { 'Cache-Control': 'no-store' });
              return;
            }
            let code = encodeShareCode(nextShareId++);
            while (shares.has(code)) code = encodeShareCode(nextShareId++);
            shares.set(code, encoded);
            codesByPayload.set(encoded, code);
            json(res, { ok: true, code }, 201, { 'Cache-Control': 'no-store' });
          } catch {
            json(res, { ok: false, error: 'invalid-json' }, 400);
          }
        });
        return;
      }
      const shareMatch = /^\/api\/shares\/([0-9A-Za-z]{6})$/.exec(parsedUrl.pathname);
      if (shareMatch && req.method === 'GET') {
        const code = shareMatch[1];
        const encoded = shares.get(code);
        if (!encoded) {
          json(res, { ok: false, error: 'share-not-found' }, 404);
          return;
        }
        json(res, { ok: true, code, encoded }, 200, { 'Cache-Control': 'public, max-age=60' });
        return;
      }
      let relativePath;
      try {
        relativePath = decodeURIComponent(parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname);
      } catch {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }

      let filePath = path.resolve(currentSiteDir, `.${relativePath}`);
      if (filePath !== currentSiteDir && !filePath.startsWith(`${currentSiteDir}${path.sep}`)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) && /^\/(?:zh-tw|en|ja|ko|simulation)(?:\/|$)/.test(relativePath)) {
        filePath = path.join(currentSiteDir, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      const stream = fs.createReadStream(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      stream.pipe(res);
    });

    server.on('error', reject);

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const serverPort = typeof address === 'object' && address ? address.port : port;
      const baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve({
        server,
        baseUrl,
        port: serverPort,
        close: () => new Promise((resClose) => server.close(resClose)),
      });
    });
  });
}

/**
 * 啟動瀏覽器與頁面環境
 * @param {Object} options
 * @param {string} [options.browserType='chromium'] 'chromium' | 'firefox' | 'webkit'
 * @param {boolean} [options.headless=true]
 * @param {{ width: number, height: number }} [options.viewport={ width: 1280, height: 800 }]
 * @param {string} [options.locale='zh-TW'] Browser locale exposed to the page
 * @returns {Promise<{ browser: import('playwright').Browser, page: import('playwright').Page, close: () => Promise<void> }>}
 */
export async function createTestBrowser(options = {}) {
  const browserTypeStr = options.browserType || process.env.TEST_BROWSER || 'chromium';
  const headless = options.headless !== undefined ? options.headless : true;
  const viewport = options.viewport || { width: 1280, height: 800 };
  const locale = options.locale || 'zh-TW';

  let launcher = chromium;
  if (browserTypeStr === 'firefox') launcher = firefox;
  if (browserTypeStr === 'webkit') launcher = webkit;

  const browser = await launcher.launch({ headless });
  const context = await browser.newContext({ viewport, locale });
  await context.addInitScript(() => {
    window.__RD2_TEST_MODE__ = true;
  });
  const diagnostics = {
    console: [],
    pageErrors: [],
    requestFailures: []
  };
  const observedPages = new WeakSet();
  const observePage = (page) => {
    if (observedPages.has(page)) return;
    observedPages.add(page);
    page.on('console', (message) => {
      diagnostics.console.push({ type: message.type(), text: message.text(), url: page.url() });
    });
    page.on('pageerror', (error) => {
      diagnostics.pageErrors.push({ message: error.message, stack: error.stack || null, url: page.url() });
    });
    page.on('requestfailed', (request) => {
      diagnostics.requestFailures.push({
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText || null
      });
    });
  };
  context.on('page', observePage);
  const page = await context.newPage();
  observePage(page);

  let traceActive = false;
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceActive = true;
  } catch {
    // A browser may not support tracing in a constrained environment. The
    // page diagnostics and failure screenshot remain available in that case.
  }

  return {
    browser,
    context,
    page,
    diagnostics,
    saveTrace: async (tracePath) => {
      if (!traceActive) return false;
      try {
        await context.tracing.stop({ path: tracePath });
        return true;
      } finally {
        traceActive = false;
      }
    },
    close: async () => {
      if (traceActive) {
        try {
          await context.tracing.stop();
        } catch {
          // Ignore trace cleanup errors while closing the browser.
        }
        traceActive = false;
      }
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export { siteDir, websiteDir };
