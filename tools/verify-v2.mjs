// v2 迭代闭环验证：全新浏览器加载 → demo 写章 → 检查 v2 面板/快照/无404/无报错
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/vm/preinstall/npm-global/lib/node_modules/playwright');

const BASE = 'http://127.0.0.1:8787/Agent2026N1W/';
const browser = await chromium.launch({
  executablePath: '/opt/browser/chrome',
  headless: true,
});
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
const badRequests = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('requestfailed', (req) => badRequests.push(`${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}`));
page.on('response', (res) => {
  if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) {
    badRequests.push(`HTTP ${res.status()} ${res.url()}`);
  }
});

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);

// 1. 标题
const title = await page.title();
console.log('TITLE:', title);

// 2. 侧边栏应有“头号写手”入口
const navText = await page.locator('nav').innerText().catch(() => '');
console.log('NAV_HAS_V2:', navText.includes('头号写手'));

// 3. 进入创作台跑 demo（点击“原创演示”或直接找按钮）
async function clickButtonByText(text) {
  const btn = page.locator(`button:has-text("${text}")`).first();
  if (await btn.count()) { await btn.click(); return true; }
  return false;
}

// 创作台 → 成文并润色（真实写章流程）
await clickButtonByText('创作台');
await page.waitForTimeout(800);
const writeClicked = await clickButtonByText('成文并润色');
console.log('WRITE_CLICKED:', writeClicked);
await page.waitForTimeout(16000);
const bodyAfterWrite = await page.locator('body').innerText();
console.log('WRITE_OK:', bodyAfterWrite.includes('AI味专项审核'));
console.log('WRITE_ERR:', bodyAfterWrite.includes('未写入章节') || bodyAfterWrite.includes('失败'));

// 4. 打开头号写手面板
await clickButtonByText('头号写手');
await page.waitForTimeout(2500);
const v2Text = await page.locator('body').innerText();
console.log('V2_PANEL_RENDERED:', v2Text.includes('头号写手增强'));
console.log('V2_HAS_IDEA_PANEL:', v2Text.includes('灵感库'));
console.log('V2_HAS_PACING:', v2Text.includes('节奏与文风'));
console.log('V2_HAS_GUIDES:', v2Text.includes('写作指南库'));
console.log('V2_HAS_EDIT:', v2Text.includes('多轮编辑'));

// 5. 快照：检查 v2Mechanism 已写入最近章节（通过页面节奏面板文案判断）
const pacingText = await page.locator('body').innerText();
console.log('PACING_SHOWING_DATA:', /情绪 |信息密度/.test(pacingText));
console.log('CHANGES_SHOWING:', pacingText.includes('变更声明'));
console.log('PACING_BRANCH:', pacingText.includes('先选择作品并写出至少一章') ? 'no-chapter' : pacingText.includes('还没有 v2 机制数据') ? 'no-v2data' : pacingText.includes('情绪 ') ? 'has-data' : 'unknown');
console.log('HAS_CHAPTER_COUNT:', /第 \d+ 章/.test(pacingText));

// 6. 灵感库：新增一条
await page.locator('input[placeholder="情节点/人物/场景…"]').fill('码头线索');
await page.locator('textarea[placeholder^="灵感内容"]').fill('第七码头夜班记录本里夹着一张写有“潮汐线”的纸条，来自失踪的前任仓库管理员。');
await clickButtonByText('存入灵感库');
await page.waitForTimeout(2500);
const bodyAfterIdea = await page.locator('body').innerText();
console.log('IDEA_SAVED:', bodyAfterIdea.includes('码头线索'));

// 7. 指南库展开
await clickButtonByText('章节指南');
await page.waitForTimeout(800);
const guideExpanded = await page.locator('body').innerText();
console.log('GUIDE_EXPANDED:', guideExpanded.includes('开场：用一个具体动作或物件切入'));

console.log('CONSOLE_ERRORS:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none');
console.log('PAGE_ERRORS:', pageErrors.length ? pageErrors.slice(0, 5) : 'none');
console.log('BAD_REQUESTS:', badRequests.length ? badRequests.slice(0, 8) : 'none');

await browser.close();
process.exit(consoleErrors.length || pageErrors.length || badRequests.length ? 1 : 0);
