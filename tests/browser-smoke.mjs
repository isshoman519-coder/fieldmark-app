// Optional end-to-end smoke test. Start `npm run dev` first and install `playwright`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const browser = await chromium.launch({ ...(process.env.CHROMIUM_BIN ? {executablePath:process.env.CHROMIUM_BIN} : {}), headless:true });
const context = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, acceptDownloads:true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/', { waitUntil:'networkidle' });
  await page.screenshot({path:'./tests/home-preview.png',fullPage:true});
  await page.locator('#newProjectHero').click();
  await page.locator('#newTitle').fill('모의 현장 302호');
  await page.locator('#newLocation').fill('서울 관악구 주방');
  await page.getByRole('button',{name:'프로젝트 만들기'}).click();
  await page.waitForSelector('#editorScreen:not(.hidden)');
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width=900;c.height=600;
    const x=c.getContext('2d');
    x.fillStyle='#f4efe6';x.fillRect(0,0,900,600);
    x.fillStyle='#e7d2b8';x.fillRect(140,90,600,430);
    x.fillStyle='#bfa890';x.fillRect(200,145,205,270);
    x.fillStyle='#a1b7b6';x.fillRect(455,145,210,270);
    x.fillStyle='#fff';x.font='32px Arial';x.fillText('SAMPLE ROOM',300,65);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#photoInput').setInputFiles({name:'room.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')});
  await page.waitForFunction(() => document.querySelector('#emptyCanvas').classList.contains('hidden'));
  await page.waitForTimeout(200);
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    left: document.querySelector('#backHome').getBoundingClientRect().left,
    right: document.querySelector('#exportReport').getBoundingClientRect().right,
    stageWidth: document.querySelector('#canvasStage').getBoundingClientRect().width,
  }));
  assert.ok(layout.pageWidth <= layout.viewport + 2, `Horizontal overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.left >= 0 && layout.right <= layout.viewport, `Clipped header: ${JSON.stringify(layout)}`);
  await page.locator('[data-tool="dimension"]').click();
  const stage = await page.locator('#annotationCanvas').boundingBox();
  await page.mouse.move(stage.x+stage.width*.25,stage.y+stage.height*.45);
  await page.mouse.down();
  await page.mouse.move(stage.x+stage.width*.74,stage.y+stage.height*.45,{steps:6});
  await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('#annotationDialog').open);
  await page.locator('#dimensionValue').fill('125');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#annotationDialog').open);
  await page.locator('[data-tool="note"]').click();
  await page.mouse.click(stage.x+stage.width*.36,stage.y+stage.height*.72);
  await page.waitForFunction(()=>document.querySelector('#annotationDialog').open);
  await page.locator('#noteValue').fill('콘센트 위치 확인');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#annotationDialog').open);
  await page.screenshot({path:'./tests/editor-preview.png',fullPage:true});
  const backupPromise = page.waitForEvent('download');
  await page.locator('#backupProject').click();
  const download = await backupPromise;
  assert.match(download.suggestedFilename(),/\.fieldmark\.json$/);
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:/모의 현장 302호/}).first().click();
  await page.waitForSelector('#editorScreen:not(.hidden)');
  await page.evaluate(() => window.print=() => {window.__printed=true;});
  await page.locator('#exportReport').click();
  await page.locator('#confirmReport').click();
  await page.waitForFunction(()=>window.__printed===true);
  assert.equal(await page.locator('#printReport .report-page').count(),1);
  assert.equal(await page.locator('#printReport .report-caption').textContent().then(s=>s.includes('콘센트 위치 확인')),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: project, photo annotation, backup download, persistence, PDF-print report');
} finally {
  await browser.close();
}
