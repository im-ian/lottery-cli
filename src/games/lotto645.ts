import type { Page } from 'playwright';
import { config } from '../config.js';
import { log } from '../utils/log.js';

export interface LottoPurchaseRequest {
  mode: 'auto' | 'manual';
  games: number[][]; // each: 6 numbers 1~45 (manual). For auto: ignored; gameCount used.
  gameCount: number; // 1~5
  dryRun: boolean; // if true, cancel confirmation popup
}

export interface LottoPurchaseResult {
  ok: boolean;
  message: string;
  deposit?: number;
  reservationNumber?: string;
  rounds?: string;
  games?: { pick: string; numbers: number[] }[];
}

export async function purchaseLotto(page: Page, req: LottoPurchaseRequest): Promise<LottoPurchaseResult> {
  log.step('로또 구매 페이지 진입');
  await page.goto(config.urls.lotto645Buy, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  const deposit = await readDeposit(page);
  log.info(`보유 예치금: ${deposit.toLocaleString()}원`);

  if (req.mode === 'auto') {
    await selectAllAuto(page, req.gameCount);
  } else {
    await selectManualGames(page, req.games);
  }

  log.step('구매하기 클릭');
  await page.click('#btnBuy');

  const popupResult = await handleBuyPopup(page, req.dryRun);
  return popupResult;
}

async function readDeposit(page: Page): Promise<number> {
  const deposit = await page
    .locator('body')
    .first()
    .evaluate(() => {
      const text = document.body.innerText || '';
      const m = text.match(/보유\s*예치금\s*([\d,]+)\s*원/);
      if (m && m[1]) return Number(m[1].replace(/,/g, ''));
      return NaN;
    })
    .catch(() => NaN);
  return Number.isNaN(deposit) ? 0 : deposit;
}

async function selectAllAuto(page: Page, count: number): Promise<void> {
  log.step(`자동 ${count}게임 선택`);
  await page.click('#num2');
  await page.waitForTimeout(300);
  await page.selectOption('#amoundApply', String(count));
  await page.waitForTimeout(200);
  await page.click('#btnSelectNum');
  await page.waitForTimeout(500);
  await acceptJsAlerts(page);
}

async function selectManualGames(page: Page, games: number[][]): Promise<void> {
  log.step(`수동 ${games.length}게임 선택`);
  await page.click('#num1');
  await page.waitForTimeout(300);

  for (let i = 0; i < games.length; i++) {
    const nums = games[i]!;
    log.dim(`  게임 ${i + 1}: ${nums.join(', ')}`);

    const autoChecked = await page.locator('#checkAutoSelect').isChecked().catch(() => false);
    if (autoChecked) await page.locator('label[for="checkAutoSelect"]').click();

    for (const n of nums) {
      await page.locator(`label[for="check645num${n}"]`).click();
    }

    await page.selectOption('#amoundApply', '1');
    await page.click('#btnSelectNum');
    await page.waitForTimeout(400);
    await acceptJsAlerts(page);
  }
}

async function acceptJsAlerts(page: Page): Promise<void> {
  const alertText = await page.locator('#popupLayerAlert').innerText().catch(() => '');
  if (alertText.trim()) {
    log.dim(`  alert: ${alertText.trim().slice(0, 80)}`);
    await page.locator('#popupLayerAlert input[value="확인"], #popupLayerAlert .confirm').first().click().catch(() => {});
  }
}

async function handleBuyPopup(page: Page, dryRun: boolean): Promise<LottoPurchaseResult> {
  await page.waitForTimeout(1500);

  const alert = page.locator('#popupLayerAlert');
  if ((await alert.count()) > 0 && (await alert.isVisible().catch(() => false))) {
    const msg = (await alert.innerText().catch(() => '')).trim();
    await alert.locator('input.confirm, a.confirm').first().click().catch(() => {});
    return { ok: false, message: `alert: ${msg}` };
  }

  const confirm = page.locator('#popupLayerConfirm');
  if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
    const msg = (await confirm.innerText().catch(() => '')).trim();
    log.info(`확인 팝업: ${msg.slice(0, 150)}`);

    if (dryRun) {
      log.warn('DRY_RUN: 확인 팝업을 취소합니다 (실제 결제 진행 안 함)');
      await confirm.locator('input[onclick*="false"], a[onclick*="false"]').first().click().catch(() => {});
      return { ok: true, message: 'DRY_RUN 완료: 결제 확인 직전까지 검증됨' };
    }

    const depositBefore = await readDeposit(page);
    await confirm.locator('input[onclick*="true"], a[onclick*="true"]').first().click();
    await page.waitForTimeout(4000);

    const receiptCandidates = ['#popReceipt', '.popup_reserved', '.popup_receipt', '#popupLayerAlert'];
    let receiptText = '';
    for (const sel of receiptCandidates) {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        receiptText = (await loc.innerText().catch(() => '')).trim();
        if (receiptText) break;
      }
    }

    // 영수증 신뢰성 신호: 회차/발행일/복권번호/지급기한 같은 영수증 고유 키워드 포함
    const isReceipt = !!receiptText && /(\d{3,4}\s*회|발\s*행\s*일|추\s*첨\s*일|지급\s*기한|구매\s*번호|구매내역)/.test(receiptText);

    // 영수증이 떠 있는 동안 메인 페이지 잔액은 갱신되지 않을 수 있음 → 영수증 닫고 재확인
    if (isReceipt) {
      await closeAnyReceipt(page);
      await page.waitForTimeout(800);
    }
    const depositAfter = await readDeposit(page);
    const deducted = depositBefore - depositAfter;

    const balancePart =
      deducted > 0
        ? ` (예치금 차감 ${deducted.toLocaleString()}원, 잔액 ${depositAfter.toLocaleString()}원)`
        : depositAfter > 0
          ? ` (잔액 ${depositAfter.toLocaleString()}원)`
          : '';

    if (isReceipt || deducted > 0) {
      return {
        ok: true,
        message: `구매 완료${balancePart}${receiptText ? `\n${receiptText.slice(0, 400)}` : ''}`,
      };
    }

    if (receiptText) {
      return { ok: false, message: `예상치 못한 응답: ${receiptText.slice(0, 300)}` };
    }

    return {
      ok: false,
      message: '구매 결과를 확인할 수 없음. "구매내역 조회"로 직접 확인해주세요.',
    };
  }

  return { ok: false, message: '구매 팝업이 나타나지 않음' };
}

async function closeAnyReceipt(page: Page): Promise<void> {
  const closers = [
    '#popReceipt .btn_close, #popReceipt input[onclick*="close"], #popReceipt a[onclick*="close"]',
    '.popup_reserved .btn_close',
    '.popup_receipt .btn_close',
    '#popupLayerAlert input.confirm, #popupLayerAlert .confirm',
  ];
  for (const sel of closers) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
    }
  }
}
