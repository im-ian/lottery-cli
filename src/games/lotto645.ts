import type { Page } from 'playwright';
import { config } from '../config.js';
import { log } from '../utils/log.js';

export const LOTTO_MAX_GAMES_PER_ROUND = 5;

export interface LottoPurchaseRequest {
  mode: 'auto' | 'manual';
  games: number[][]; // each: 6 numbers 1~45 (manual). For auto: ignored; gameCount used.
  gameCount: number; // 1~5
  dryRun: boolean; // if true, cancel confirmation popup
}

export interface LottoReceiptGame {
  label: string; // A~E
  pick: string; // '자동' | '수동' | '반자동'
  numbers: number[]; // 6 nums
}

export interface LottoPurchaseResult {
  ok: boolean;
  message: string;
  deposit?: number;
  deducted?: number;
  reservationNumber?: string;
  round?: string;
  issuedAt?: string;
  drawAt?: string;
  claimBy?: string;
  amount?: string;
  games?: LottoReceiptGame[];
}

export async function purchaseLotto(page: Page, req: LottoPurchaseRequest): Promise<LottoPurchaseResult> {
  if (req.gameCount > LOTTO_MAX_GAMES_PER_ROUND || req.games.length > LOTTO_MAX_GAMES_PER_ROUND) {
    return {
      ok: false,
      message: `로또 6/45는 한 회차 최대 ${LOTTO_MAX_GAMES_PER_ROUND}게임(5,000원)까지만 구매할 수 있습니다.`,
    };
  }

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

  const popupResult = await handleBuyPopup(page, req.dryRun, deposit);
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

async function handleBuyPopup(
  page: Page,
  dryRun: boolean,
  initialDeposit: number,
): Promise<LottoPurchaseResult> {
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
    log.info(`확인 팝업: ${msg.replace(/\s+/g, ' ').slice(0, 150)}`);

    if (dryRun) {
      log.warn('DRY_RUN: 확인 팝업을 취소합니다 (실제 결제 진행 안 함)');
      await confirm.locator('input[onclick*="false"], a[onclick*="false"]').first().click().catch(() => {});
      return { ok: true, message: 'DRY_RUN 완료: 결제 확인 직전까지 검증됨' };
    }

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

    const parsed = parseLottoReceipt(receiptText);
    const isReceipt =
      !!parsed && (parsed.games.length > 0 || !!parsed.round || !!parsed.reservationNumber);

    if (isReceipt) {
      await closeAnyReceipt(page);
      await page.waitForTimeout(500);
    }
    // 페이지 reload 없이 readDeposit을 부르면 헤더 DOM이 구매 전 값 그대로라
    // depositAfter == initialDeposit이 되어 차감 금액이 0으로 보임.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    const depositAfter = await readDeposit(page);
    const deducted = initialDeposit > 0 ? initialDeposit - depositAfter : 0;

    const balancePart =
      deducted > 0
        ? ` (예치금 차감 ${deducted.toLocaleString()}원, 잔액 ${depositAfter.toLocaleString()}원)`
        : depositAfter > 0
          ? ` (잔액 ${depositAfter.toLocaleString()}원)`
          : '';

    if (isReceipt || deducted > 0) {
      const result: LottoPurchaseResult = {
        ok: true,
        message: `구매 완료${balancePart}`,
        deposit: depositAfter,
        ...(parsed ?? { games: [] }),
      };
      if (deducted > 0) result.deducted = deducted;
      return result;
    }

    if (receiptText) {
      return { ok: false, message: `예상치 못한 응답: ${receiptText.replace(/\s+/g, ' ').slice(0, 200)}` };
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

interface ParsedReceipt {
  round?: string;
  issuedAt?: string;
  drawAt?: string;
  claimBy?: string;
  reservationNumber?: string;
  amount?: string;
  games: LottoReceiptGame[];
}

const PICK_RE = /^(자\s*동|수\s*동|반\s*자\s*동)$/;
const NUM_LINE_RE = /^([0-4]?\d)$/;
const RESERVATION_RE = /^([\d\s]{20,})\*+$/;
const NOISE_RE = /^(구매내역\s*확인|이\s*번호\s*저장|하트\s*표시.*저장됩니다\.?|복권\s*로또\s*645)$/;

export function parseLottoReceipt(text: string): ParsedReceipt | null {
  if (!text) return null;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOISE_RE.test(l));
  if (lines.length === 0) return null;

  const out: ParsedReceipt = { games: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^제\s*(\d+)\s*회/))) {
      if (m[1]) out.round = m[1];
      continue;
    }
    if ((m = line.match(/^발\s*행\s*일\s*[:：]\s*(.+)$/))) {
      out.issuedAt = m[1]!.trim();
      continue;
    }
    if ((m = line.match(/^추\s*첨\s*일\s*[:：]\s*(.+)$/))) {
      out.drawAt = m[1]!.trim();
      continue;
    }
    if ((m = line.match(/^지급\s*기한\s*[:：]\s*(.+)$/))) {
      out.claimBy = m[1]!.trim();
      continue;
    }
    if ((m = line.match(/^금액\s*[:：]\s*([\d,]+)/))) {
      out.amount = m[1]!.replace(/,/g, '');
      continue;
    }
    if ((m = line.match(RESERVATION_RE))) {
      out.reservationNumber = m[1]!.replace(/\s+/g, ' ').trim();
      continue;
    }
    if (/^[A-E]$/.test(line)) {
      const next = lines[i + 1];
      if (next && PICK_RE.test(next)) {
        const pick = next.replace(/\s+/g, '');
        const nums: number[] = [];
        let j = i + 2;
        while (j < lines.length && nums.length < 6) {
          const nm = lines[j]!.match(NUM_LINE_RE);
          if (!nm) break;
          const n = Number(nm[1]);
          if (n < 1 || n > 45) break;
          nums.push(n);
          j++;
        }
        if (nums.length === 6) {
          out.games.push({ label: line, pick, numbers: nums });
          i = j - 1;
          continue;
        }
      }
    }
  }

  return out;
}

export function formatLottoReceiptLines(result: LottoPurchaseResult): string[] {
  const lines: string[] = [];
  if (result.round) {
    const draw = result.drawAt ? ` · 추첨 ${result.drawAt}` : '';
    lines.push(`제 ${result.round}회${draw}`);
  }
  for (const g of result.games ?? []) {
    const nums = g.numbers.map((n) => String(n).padStart(2, '0')).join(' ');
    lines.push(`  ${g.label}. ${g.pick}  ${nums}`);
  }
  if (result.amount) {
    lines.push(`금액 ${Number(result.amount).toLocaleString()}원`);
  }
  if (result.reservationNumber) {
    lines.push(`복권번호 ${result.reservationNumber}`);
  }
  return lines;
}
