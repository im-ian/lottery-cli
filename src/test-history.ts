import { chromium } from 'playwright';
import { config } from './config.js';
import { log } from './utils/log.js';
import { fetchLedger } from './features/history.js';

async function main() {
  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMoMs });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    log.step('로그인');
    await page.goto(config.urls.login, { waitUntil: 'domcontentloaded' });
    await page.fill('#inpUserId', config.userId);
    await page.fill('#inpUserPswdEncn', config.userPw);
    await page.click('#btnLogin');
    await page.waitForTimeout(2500);

    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setMonth(today.getMonth() - 1);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const entries = await fetchLedger(page, fmt(monthAgo), fmt(today));
    log.info(`결과: ${entries.length}건`);
    entries.forEach((e, i) => {
      console.log(`  ${i + 1}. ${JSON.stringify(e)}`);
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(console.error);
