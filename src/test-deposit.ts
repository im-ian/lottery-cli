import { chromium } from 'playwright';
import { config } from './config.js';
import { log } from './utils/log.js';
import { getDeposit } from './features/deposit.js';

async function main() {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(config.urls.login, { waitUntil: 'domcontentloaded' });
    await page.fill('#inpUserId', config.userId);
    await page.fill('#inpUserPswdEncn', config.userPw);
    await page.click('#btnLogin');
    await page.waitForTimeout(2500);

    const deposit = await getDeposit(page);
    log.success(`보유 예치금: ${deposit.toLocaleString()}원`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(console.error);
