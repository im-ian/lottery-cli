import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';
import { log } from '../utils/log.js';

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export function isSession(x: unknown): x is Session {
  return !!x && typeof x === 'object' && 'page' in x && 'close' in x;
}

export async function openSession(): Promise<Session> {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMoMs,
  });

  const storageStatePath = config.paths.storageState;
  const useStored = existsSync(storageStatePath);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(useStored ? { storageState: storageStatePath } : {}),
  });

  const page = await context.newPage();

  if (!useStored || !(await isLoggedIn(page))) {
    await login(page);
    const dir = dirname(storageStatePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await context.storageState({ path: storageStatePath });
    log.success('세션 저장 완료');
  } else {
    log.success('저장된 세션 재사용');
  }

  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto(config.urls.main, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText().catch(() => '');
  return /로그아웃/.test(body) && !/로그인이\s*필요|로그인을\s*해주세요/.test(body);
}

async function login(page: Page): Promise<void> {
  log.step('로그인 시도 중...');
  await page.goto(config.urls.login, { waitUntil: 'domcontentloaded' });

  await page.locator('#inpUserId').waitFor({ state: 'visible', timeout: 10000 });
  await page.fill('#inpUserId', config.userId);
  await page.fill('#inpUserPswdEncn', config.userPw);

  await page.click('#btnLogin');
  await page.waitForTimeout(2500);

  if (!(await isLoggedIn(page))) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/자동입력\s*방지|보안문자|캡차|captcha/i.test(bodyText)) {
      log.warn('캡차가 감지되었습니다. 브라우저 창에서 직접 로그인해주세요.');
      log.dim('브라우저에서 로그인 완료 후 Enter를 누르면 이어갑니다.');
      if (config.headless) {
        throw new Error('캡차 대응 실패: HEADLESS=false로 다시 실행해주세요.');
      }
      await waitForEnter();
      if (!(await isLoggedIn(page))) throw new Error('로그인 실패 — 수동 로그인도 안됨');
    } else {
      throw new Error('로그인 실패 — 아이디/비밀번호를 확인하세요.');
    }
  }
  log.success('로그인 성공');
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve();
    });
  });
}
