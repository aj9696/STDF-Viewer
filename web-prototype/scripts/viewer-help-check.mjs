import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { VIEWER_HELP_TOPICS, VIEWER_HELP_BY_ID } from '../site/viewer-help-content.js';

const required = ['overview','histogram','trend','tests','devices','bins','wafers','records','study',
  'dashboard','compare','distributions','scatter','pat','patLots','whatif','spatial','reclassify',
  'values','gallery','pvt','grr','authoring','documents','scope','workspace','terms'];
assert.deepEqual([...VIEWER_HELP_BY_ID.keys()].sort(), required.sort());
assert.equal(VIEWER_HELP_BY_ID.size, VIEWER_HELP_TOPICS.length, 'Topic IDs must be unique');
for (const topic of VIEWER_HELP_TOPICS) {
  for (const related of topic.related ?? []) assert.ok(VIEWER_HELP_BY_ID.has(related), `Unknown related topic: ${related}`);
  const checkSentences = (value, limit) => {
    for (const sentence of value.split(/(?<=[.!?])\s+/u)) {
      const count = sentence.trim().split(/\s+/u).filter(Boolean).length;
      assert.ok(count <= limit, `${topic.id}: ${count} words exceeds ${limit}: ${sentence}`);
    }
    assert.ok(!/\b(?:don't|doesn't|isn't|aren't|it's|you'll|can't|won't)\b/iu.test(value), `${topic.id}: contraction`);
  };
  for (const instruction of topic.steps ?? []) checkSentences(instruction, 20);
  for (const text of [topic.purpose, ...(topic.results ?? []), ...(topic.limits ?? []), ...(topic.terms ?? []).map(([,text]) => text)]) checkSentences(text, 25);
}

const root = fileURLToPath(new URL('../', import.meta.url)), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome','msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-help-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });
const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="viewer.css"><link rel="stylesheet" href="viewer-help.css"></head><body class="data-viewer"><main><h1>Help fixture</h1><button id="open-help" type="button">Help</button><button id="outside" type="button">Outside action</button></main></body></html>';
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    const file = resolve(site, '.' + pathname); if (!file.startsWith(site + sep)) throw Error('Outside root');
    response.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser; const errors = [], checks = ['All view/tool/reference IDs, valid related topics, conservative sentence limits, and no contractions'];
try {
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const {installViewerHelp} = await import('./viewer-help.js');
    window.helpTopic = 'pat'; window.help = installViewerHelp({getTopic:()=>window.helpTopic});
    document.querySelector('#open-help').addEventListener('click',()=>window.help.open());
  });
  await page.getByRole('button',{name:'Help',exact:true}).click();
  assert.equal(await page.locator('#viewer-help-dialog').getAttribute('data-topic'), 'pat');
  assert.equal(await page.locator('#viewer-help-dialog').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#viewer-help-dialog').evaluate(element => element.matches(':modal')), true);
  assert.equal(await page.evaluate(()=>document.activeElement.id), 'viewer-help-title');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')), 'Close help');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent), 'Statistics and test terms');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')), 'Close help');
  assert.equal(await page.evaluate(()=>{document.querySelector('#outside').focus();return document.querySelector('#viewer-help-dialog').contains(document.activeElement);}), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#viewer-help-dialog').open && document.activeElement.id==='open-help');
  checks.push('Current-topic open, heading focus, modal isolation, Tab loop, Escape dismissal, and trigger focus restoration');

  await page.getByRole('button',{name:'Help',exact:true}).click();
  await page.getByLabel('Topic',{exact:true}).focus();
  for (const topic of VIEWER_HELP_TOPICS) {
    await page.getByLabel('Topic',{exact:true}).selectOption(topic.id);
    assert.equal(await page.locator('#viewer-help-title').textContent(), topic.title);
    assert.equal(await page.evaluate(()=>document.activeElement.id), 'viewer-help-topic');
  }
  await page.getByRole('button',{name:'Statistics',exact:true}).click();
  assert.equal(await page.locator('#viewer-help-dialog').getAttribute('data-topic'), 'tests');
  assert.equal(await page.evaluate(()=>document.activeElement.id), 'viewer-help-title');
  await page.getByRole('button',{name:'Close help'}).click();
  await page.waitForFunction(()=>document.activeElement.id==='open-help');
  await page.evaluate(()=>{window.helpTopic='unknown-topic';});
  await page.getByRole('button',{name:'Help',exact:true}).click();
  assert.equal(await page.locator('#viewer-help-title').textContent(), 'File info');
  checks.push('Every topic renders; Topic retains focus; related topics focus the heading; Close restores focus; unknown IDs have a safe fallback');

  for (const width of [1440,768,390,360]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.help.open('grr'));
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.querySelector('#viewer-help-dialog').getAnimations().map(animation=>animation.finished));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const layout = await page.evaluate(()=>{
      const dialog = document.querySelector('#viewer-help-dialog'), article = dialog.querySelector('article'), rect=dialog.getBoundingClientRect();
      return {right:rect.right,width:rect.width,viewport:innerWidth,overflow:article.scrollWidth>article.clientWidth,
        minControl:Math.min(...[...dialog.querySelectorAll('button,select')].map(item=>item.getBoundingClientRect().height))};
    });
    assert.ok(Math.abs(layout.right-layout.viewport)<1,JSON.stringify(layout)); assert.ok(layout.width<=layout.viewport);
    assert.equal(layout.overflow,false); if(width<=520)assert.ok(layout.minControl>=44);
    await page.screenshot({path:resolve(output,`help-${width}.png`)});
  }
  await page.evaluate(()=>window.help.open('terms'));
  assert.equal(await page.locator('.viewer-help-content').evaluate(element=>element.scrollHeight>element.clientHeight),true);
  await page.locator('.viewer-help-content').evaluate(element=>element.scrollTop=element.scrollHeight);
  assert.equal(await page.getByRole('button',{name:'Close help'}).isVisible(),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#viewer-help-dialog').evaluate(element=>getComputedStyle(element).animationName),'none');
  checks.push('1440/768/390/360px layout, internal scrolling, visible Close, 44px phone controls, and reduced-motion preference');
  await page.evaluate(()=>window.help.destroy());
  assert.equal(await page.locator('#viewer-help-dialog').count(),0);
  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({channel,checks,errors},null,2));
  console.log(JSON.stringify({channel,passed:checks.length,checks,output},null,2));
} finally { await browser?.close(); await new Promise(done=>server.close(done)); }
