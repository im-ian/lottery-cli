import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { config } from './config.js';
import { log } from './utils/log.js';

const SHOT_DIR = '.debug';
if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

async function main() {
  log.info(`HEADLESS=${config.headless}`);
  log.info(`USER_ID=${config.userId.slice(0, 2)}*** (길이 ${config.userId.length})`);
  log.info(`USER_PW=*** (길이 ${config.userPw.length})`);

  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMoMs });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    log.step('로그인 페이지 진입');
    await page.goto(config.urls.login, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.screenshot({ path: `${SHOT_DIR}/01-login-page.png`, fullPage: true });

    log.step('입력 필드 탐지');
    await page.locator('#inpUserId').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#inpUserPswdEncn').waitFor({ state: 'visible', timeout: 10000 });

    log.step('자격증명 입력');
    await page.fill('#inpUserId', config.userId);
    await page.fill('#inpUserPswdEncn', config.userPw);
    await page.screenshot({ path: `${SHOT_DIR}/02-filled.png`, fullPage: true });

    log.step('로그인 버튼 클릭');
    await page.click('#btnLogin');

    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOT_DIR}/03-after-submit.png`, fullPage: true });

    log.step('로그인 결과 확인');
    await page.goto(config.urls.main, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOT_DIR}/04-main.png`, fullPage: true });

    const body = await page.locator('body').innerText().catch(() => '');
    const isLoggedIn = /로그아웃/.test(body);
    const hasCaptcha = /자동입력\s*방지|보안문자|캡차|captcha/i.test(body);
    const hasError = /아이디|비밀번호/.test(body) && /잘못|일치|확인/.test(body);

    if (isLoggedIn) {
      log.success('로그인 성공 확인 (로그아웃 링크 감지)');
      const nickname = await page.locator('.nickname, .username, [class*="user"]').first().innerText().catch(() => '(알 수 없음)');
      log.info(`표시 이름: ${nickname}`);
    } else if (hasCaptcha) {
      log.warn('캡차 감지됨 — 수동 로그인 필요');
    } else if (hasError) {
      log.error('로그인 실패 — 아이디/비밀번호 오류 가능성');
    } else {
      log.warn('로그인 상태 불명 — 스크린샷 확인 필요');
    }

    log.dim(`\n스크린샷 저장 위치: ${SHOT_DIR}/`);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    await page.screenshot({ path: `${SHOT_DIR}/error.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
