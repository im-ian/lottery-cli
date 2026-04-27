import { chromium } from 'playwright';
import { config } from './config.js';
import { log } from './utils/log.js';
import { purchasePension } from './games/pension720.js';
import { randomPensionNumbers } from './utils/numbers.js';

async function main() {
  const mode = (process.argv[2] as 'auto' | 'manual') ?? 'auto';
  const gameCount = Number(process.argv[3] ?? '1');

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

    const games = Array.from({ length: gameCount }, () => {
      const r = randomPensionNumbers();
      return { group: r.group as number | 'all', digits: r.digits };
    });
    log.info(`모드: ${mode}, 게임수: ${gameCount}`);
    games.forEach((g, i) => log.dim(`  ${i + 1}. ${g.group}조 ${g.digits}`));

    const result = await purchasePension(page, { mode, games, gameCount, dryRun: true });

    await page.screenshot({ path: '.debug/pension-final.png', fullPage: true });

    if (result.ok) log.success(result.message);
    else log.error(result.message);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    await page.screenshot({ path: '.debug/pension-error.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
