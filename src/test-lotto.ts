import { chromium } from 'playwright';
import { config } from './config.js';
import { log } from './utils/log.js';
import { purchaseLotto } from './games/lotto645.js';
import { randomLottoNumbers } from './utils/numbers.js';

async function main() {
  const mode = (process.argv[2] as 'auto' | 'manual') ?? 'auto';
  const gameCount = Number(process.argv[3] ?? '3');

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

    const games = mode === 'manual' ? Array.from({ length: gameCount }, () => randomLottoNumbers()) : [];

    log.info(`모드: ${mode}, 게임수: ${gameCount}`);
    if (games.length) games.forEach((g, i) => log.dim(`  ${i + 1}. ${g.join(', ')}`));

    const result = await purchaseLotto(page, {
      mode,
      games,
      gameCount,
      dryRun: true,
    });

    await page.screenshot({ path: '.debug/lotto-final.png', fullPage: true });

    if (result.ok) log.success(result.message);
    else log.error(result.message);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    await page.screenshot({ path: '.debug/lotto-error.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
