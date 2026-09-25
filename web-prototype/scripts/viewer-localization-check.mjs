// Production browser/worker checks. Only product-owned labels are localized.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = fileURLToPath(new URL('../', import.meta.url)), site = resolve(base, 'site'), channel = process.argv[2] ?? 'chrome';
assert.ok(['chrome', 'msedge'].includes(channel));
const output = resolve(base, 'results', `viewer-localization-${channel}-${Date.now()}`); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/harness') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Locale fixture</title>'); return; }
    const path = resolve(site, '.' + decodeURIComponent(pathname)); if (!path.startsWith(site + sep)) throw Error('Outside site');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream'); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], errors = []; let browser, page;
try {
  browser = await chromium.launch({ channel, headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/harness');
  const fixture = await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js'), { patchRecord, joinBytes } = await import('./stdf-encode.js');
    const bytes = new Uint8Array(await (await fetch('./examples/baseline.stdf')).arrayBuffer()), parts = [], numbers = [];
    let at = 0, seq = 0, mirSeq;
    while (at < bytes.length) {
      const length = new DataView(bytes.buffer).getUint16(at, true) + 4; let part = bytes.slice(at, at + length); seq++;
      if (part[2] === 1 && part[3] === 10) { mirSeq = seq; part = patchRecord(part, [{ field: 'LOT_ID', value: 'Mean' }]); }
      if (part[2] === 15 && part[3] === 10) {
        const number = new DataView(part.buffer).getUint32(4, true); if (!numbers.includes(number)) numbers.push(number);
        part = patchRecord(part, [{ field: 'TEST_TXT', value: numbers.indexOf(number) === 0 ? 'Mean' : '<img src=x onerror=window.sourceExecuted=1>' }]);
      }
      parts.push(part); at += length;
    }
    const source = joinBytes(parts), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', source)), byte => byte.toString(16).padStart(2, '0')).join('');
    const client = new DataLibraryClient(); await client.open(); const imported = await client.importFile(new File([source], 'Mean')); await client.close();
    return { id: imported.dataset.id, name: imported.dataset.name, hash, mirSeq };
  });
  const idle = async () => { await page.waitForFunction(() => window.semidataViewer && document.querySelector('#main')?.getAttribute('aria-busy') === 'false'); assert.equal(await page.locator('#viewer-error').isVisible(), false, await page.locator('#viewer-error-text').textContent()); };
  const tool = async name => { await page.locator('#viewer-tool').selectOption(name); await idle(); };
  const switchLanguage = async (locale, current = 'en') => {
    const display = { en: 'Display', ko: '표시', zh: '显示' }, language = { en: 'Navigation language', ko: '탐색 언어', zh: '导航语言' }, save = { en: 'Save settings', ko: '설정 저장', zh: '保存设置' };
    await page.locator('#viewer-settings').click(); await page.getByText(display[current], { exact: true }).click(); await page.getByLabel(language[current], { exact: true }).selectOption(locale); await page.getByRole('button', { name: save[current], exact: true }).click(); await idle();
  };
  await page.goto(`${origin}/viewer.html?dataset=${fixture.id}`); await idle();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  const originalNames = await page.locator('#viewer-tests .test-name').allTextContents(); assert.ok(originalNames.includes('Mean')); assert.ok(originalNames.some(name => name.includes('<img')));
  await tool('pat'); assert.equal(await page.getByRole('button', { name: 'Preview screening', exact: true }).count(), 1);
  await switchLanguage('ko');
  assert.equal(await page.locator('#viewer-tool-label').textContent(), '도구'); assert.equal(await page.locator('#viewer-tool option[value="authoring"]').textContent(), '편집 / 변환'); assert.equal(await page.getByRole('button', { name: '스크리닝 미리보기', exact: true }).count(), 1);
  assert.equal(await page.getByLabel('불합격 빈', { exact: true }).inputValue(), '8');
  assert.deepEqual(await page.locator('#viewer-tests .test-name').allTextContents(), originalNames);
  await page.reload(); await idle(); assert.equal(await page.locator('html').getAttribute('lang'), 'ko'); await tool('pat'); assert.equal(await page.getByRole('button', { name: '스크리닝 미리보기', exact: true }).count(), 1);
  checks.push('English defaults and Korean settings/Tools/PAT controls persist through a real viewer reload');

  await tool('authoring'); assert.equal(await page.getByLabel('소스', { exact: true }).locator('option').textContent(), fixture.name);
  await page.getByLabel('레코드 순번', { exact: true }).fill(String(fixture.mirSeq)); await page.getByRole('button', { name: '레코드 읽기', exact: true }).click(); await idle();
  await page.getByLabel('필드', { exact: true }).selectOption('LOT_ID'); assert.equal(await page.getByLabel('새 값', { exact: true }).inputValue(), 'Mean');
  await page.getByLabel('새 값', { exact: true }).fill('Preview screening <svg onload=window.sourceExecuted=1>');
  await page.evaluate(async () => { const { applyPreferences } = await import('./viewer-preferences.js'); applyPreferences(semidataViewer.getState().settings); });
  assert.equal(await page.getByLabel('새 값', { exact: true }).inputValue(), 'Preview screening <svg onload=window.sourceExecuted=1>');
  assert.equal(await page.getByLabel('필드', { exact: true }).locator('option:checked').textContent(), 'LOT_ID');
  checks.push('Source filenames, typed record field identifiers, source metadata and freeform edit values are never text-matched for translation');

  await tool('patLots'); await page.getByLabel('로트 이름', { exact: true }).fill('Mean'); await page.getByLabel('로트 이름', { exact: true }).press('Tab');
  assert.equal(await page.getByLabel('Mean 피팅', { exact: true }).count(), 1); assert.equal(await page.getByLabel(fixture.name, { exact: true }).locator('option').allTextContents().then(values => values.includes('Mean')), true);
  assert.equal(await page.locator('#viewer-panel legend').filter({ hasText: /^Mean$/ }).count(), 1);
  await tool('reclassify'); assert.equal(await page.getByRole('button', { name: '복합 스크리닝 미리보기', exact: true }).count(), 1); assert.equal(await page.getByLabel('GDBN 반경', { exact: true }).count(), 1);
  checks.push('PAT lot names stay literal while composed form labels and combined screening controls translate');

  await switchLanguage('zh', 'ko'); await tool('documents');
  assert.equal(await page.getByRole('button', { name: '生成报告', exact: true }).count(), 1); assert.equal(await page.getByLabel('Excel 汇总', { exact: true }).count(), 1);
  await page.getByText('页面布局', { exact: true }).click(); assert.equal(await page.getByLabel('页面宽度（mm）', { exact: true }).inputValue(), '210');
  await page.getByLabel('范围', { exact: true }).selectOption('lot'); assert.equal(await page.getByLabel('批次', { exact: true }).locator('option:checked').textContent(), 'Mean');
  await page.getByLabel('标题', { exact: true }).fill('Mean <script>literal title</script>');
  await page.evaluate(async () => { const { applyPreferences } = await import('./viewer-preferences.js'); applyPreferences(semidataViewer.getState().settings); });
  assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), 'Mean <script>literal title</script>');
  await page.screenshot({ path: resolve(output, 'chinese-documents.png'), fullPage: true });
  await page.reload(); await idle(); assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN'); assert.equal(await page.locator('#viewer-tool option[value="patLots"]').textContent(), '按批次 PAT');
  checks.push('Chinese report controls/sections/layout translate, preserve source lot and freeform title, and persist across reload');

  await switchLanguage('en', 'zh'); await tool('pat'); assert.equal(await page.getByRole('button', { name: 'Preview screening', exact: true }).count(), 1); assert.equal(await page.locator('#viewer-tool-label').textContent(), 'Tools');
  assert.deepEqual(await page.locator('#viewer-tests .test-name').allTextContents(), originalNames); assert.equal(await page.locator('#viewer-tests img, #viewer-tests script').count(), 0); assert.equal(await page.evaluate(() => window.sourceExecuted), undefined);
  const source = await page.evaluate(async () => (await semidataViewer.query('overview')).sources[0]); assert.equal(source.sha256, fixture.hash); assert.equal(source.metadata.find(record => record.type === 1 && record.subtype === 10).fields.LOT_ID, 'Mean');
  checks.push('Reversible language changes leave source SHA256, source strings and retained metadata unchanged; hostile source markup remains text');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, errors }, null, 2)); console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) { await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors }, null, 2)); if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); throw error; }
finally { await browser?.close(); await new Promise(done => server.close(done)); }
