import { input, select, confirm } from '@inquirer/prompts';
import type { Page } from 'playwright';
import type { Session } from '../auth/session.js';
import { config } from '../config.js';
import { log } from '../utils/log.js';
import { loadSettings } from '../utils/settings.js';
import { getDeposit } from './deposit.js';

const PRESET_AMOUNTS = [5000, 10000, 20000, 30000, 50000, 100000, 150000] as const;
const MIN_AMOUNT = 5000;
const MAX_AMOUNT = 150_000;
const DEPOSIT_REFLECT_TIMEOUT_MS = 5 * 60 * 1000;
const DEPOSIT_POLL_INTERVAL_MS = 10 * 1000;

export interface VirtualAccountInfo {
  orderNo: string;
  amount: number;
  accountHolder: string;
  bankName: string;
  accountNumber: string;
  formattedAccount: string;
  payMethodName: string;
  issuedAt: string;
}

export interface ChargeResult {
  ok: boolean;
  depositBefore: number;
  depositAfter: number;
  charged: number;
  message: string;
  virtualAccount?: VirtualAccountInfo;
}

/**
 * 예치금 충전(가상계좌 발급) 흐름.
 *
 * 사이트에서 제공하는 고정 가상계좌 발급까지 자동화한다.
 * 실제 송금은 은행 앱/계좌이체가 필요하므로 사용자가 진행하고,
 * 완료 후 잔액 반영을 최대 5분간 확인한다.
 */
export async function runChargeDeposit(session: Session, suggestedMin?: number): Promise<ChargeResult> {
  const amount = await promptChargeAmount(suggestedMin);
  if (!amount) {
    return { ok: false, depositBefore: 0, depositAfter: 0, charged: 0, message: '충전 취소' };
  }

  const settings = await loadSettings();
  if (settings.testMode) {
    return {
      ok: false,
      depositBefore: 0,
      depositAfter: 0,
      charged: 0,
      message: `테스트 모드 ON: 가상계좌 발급을 진행하지 않았습니다 (선택 금액 ${amount.toLocaleString()}원).`,
    };
  }

  if (suggestedMin && amount < suggestedMin) {
    log.warn(
      `가상계좌 1회 선택 가능 금액은 최대 ${MAX_AMOUNT.toLocaleString()}원입니다. 부족분 ${suggestedMin.toLocaleString()}원보다 적은 ${amount.toLocaleString()}원으로 진행합니다.`,
    );
  }

  log.info(`가상계좌 발급을 시작합니다 (입금 예정 금액 ${amount.toLocaleString()}원).`);

  const depositBefore = await getDeposit(session.page).catch(() => 0);

  let virtualAccount: VirtualAccountInfo;
  try {
    virtualAccount = await issueVirtualAccount(session.page, amount);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return { ok: false, depositBefore, depositAfter: depositBefore, charged: 0, message };
  }

  log.success('가상계좌 발급 완료');
  log.info(`입금 금액: ${virtualAccount.amount.toLocaleString()}원`);
  log.info(`가상계좌: ${virtualAccount.bankName} ${virtualAccount.formattedAccount}`);
  log.info(`계좌주명: ${virtualAccount.accountHolder}`);
  if (virtualAccount.orderNo) log.dim(`  주문번호: ${virtualAccount.orderNo}`);
  if (virtualAccount.issuedAt) log.dim(`  발급일시: ${virtualAccount.issuedAt}`);
  printVirtualAccountOcrBlock(virtualAccount);
  log.dim('  은행 앱에서 위 계좌로 정확한 입금 금액을 송금하면 예치금으로 반영됩니다.');

  const proceed = await confirm({
    message: '송금을 완료했나요? 잔액 반영을 최대 5분간 확인합니다.',
    default: settings.defaultConfirmYes,
  });

  if (!proceed) {
    return {
      ok: false,
      depositBefore,
      depositAfter: depositBefore,
      charged: 0,
      virtualAccount,
      message: '가상계좌 발급 완료. 송금 후 다시 구매를 진행하면 잔액을 재확인합니다.',
    };
  }

  log.info('잔액 반영 확인 중...');
  const depositAfter = await waitForDepositIncrease(session.page, depositBefore);
  const charged = Math.max(0, depositAfter - depositBefore);

  if (charged <= 0) {
    return {
      ok: false,
      depositBefore,
      depositAfter,
      charged: 0,
      virtualAccount,
      message: `잔액 변동이 확인되지 않습니다 (${depositBefore.toLocaleString()}원 → ${depositAfter.toLocaleString()}원). 송금 반영까지 시간이 더 걸릴 수 있어요.`,
    };
  }

  return {
    ok: true,
    depositBefore,
    depositAfter,
    charged,
    virtualAccount,
    message: `충전 반영 확인: +${charged.toLocaleString()}원 (잔액 ${depositAfter.toLocaleString()}원)`,
  };
}

async function promptChargeAmount(suggestedMin?: number): Promise<number | null> {
  const presetChoices = PRESET_AMOUNTS.map((v) => ({
    name: `${v.toLocaleString()}원`,
    value: String(v),
  }));

  const pickRaw = await select<string>({
    message: suggestedMin
      ? `충전 금액 선택 (필요 최소 ${suggestedMin.toLocaleString()}원)`
      : '충전 금액 선택',
    choices: [
      ...presetChoices,
      { name: '직접 입력 (지원 금액으로 올림)', value: 'custom' },
      { name: '◀ 메인으로 돌아가기', value: 'cancel' },
    ],
    default: String(normalizeToSupportedAmount(suggestedMin ?? 10000) ?? MAX_AMOUNT),
  });

  if (pickRaw === 'cancel') {
    return null;
  }

  let amount: number;
  if (pickRaw === 'custom') {
    const raw = await input({
      message: `충전 금액 (${MIN_AMOUNT.toLocaleString()}~${MAX_AMOUNT.toLocaleString()}원)`,
      default: String(Math.min(Math.max(suggestedMin ?? 10000, MIN_AMOUNT), MAX_AMOUNT)),
      validate: (v) => {
        const n = parseAmountInput(v);
        if (!Number.isInteger(n)) return '정수 금액을 입력해주세요';
        if (n < MIN_AMOUNT) return `최소 ${MIN_AMOUNT.toLocaleString()}원 이상`;
        if (n > MAX_AMOUNT) return `최대 ${MAX_AMOUNT.toLocaleString()}원 이하`;
        return true;
      },
    });
    const requested = parseAmountInput(raw);
    amount = normalizeToSupportedAmount(requested) ?? MAX_AMOUNT;
    if (amount !== requested) {
      log.warn(`동행복권 페이지가 지원하는 금액 단위에 맞춰 ${requested.toLocaleString()}원 → ${amount.toLocaleString()}원으로 진행합니다.`);
    }
  } else {
    amount = Number(pickRaw);
  }

  return amount;
}

async function issueVirtualAccount(page: Page, amount: number): Promise<VirtualAccountInfo> {
  try {
    await page.goto(config.urls.charge, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('#VcAmt').waitFor({ state: 'attached', timeout: 15000 });
    await waitForVirtualAccountInfo(page);
  } catch (err) {
    throw new Error(`충전 페이지 준비 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  const availability = await readVirtualAccountAvailability(page);
  if (availability.virtualAccountUse === 'N') {
    throw new Error(availability.virtualAccountMsg || '가상계좌 충전이 현재 비활성화되어 있습니다.');
  }
  if (availability.virtualMaintenaceUseYn === 'Y') {
    throw new Error(availability.virtualMaintenaceMsg || '은행 점검 시간이라 가상계좌 충전을 진행할 수 없습니다.');
  }

  const buyerName = (await page.locator('#BuyerName').inputValue().catch(() => '')).trim();
  if (!buyerName) throw new Error('계좌주명 정보를 불러오지 못했습니다.');

  await page.locator('#tab2').click();
  const availableToday = await readAvailableVirtualChargeAmount(page);
  if (availableToday !== null && amount > availableToday) {
    throw new Error(
      `오늘 가상계좌 충전 가능 금액은 ${availableToday.toLocaleString()}원입니다. 선택 금액 ${amount.toLocaleString()}원을 진행할 수 없습니다.`,
    );
  }

  await page.locator('#VcAmt').selectOption(String(amount));
  await page.locator('#btnChrg').click();

  try {
    await page.waitForFunction(
      `(() => {
        const charge = document.querySelector('.charge');
        const accountNumber = document.querySelector('#vbankNum')?.value?.trim() ?? '';
        if (!charge || !accountNumber || accountNumber === 'vbankNum') return false;
        const style = window.getComputedStyle(charge);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })()`,
      undefined,
      { timeout: 30000 },
    );
  } catch (err) {
    const pageMessage = await readVisibleMessage(page);
    throw new Error(
      pageMessage
        ? `가상계좌 발급 실패: ${pageMessage}`
        : `가상계좌 발급 결과 확인 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const info = await readVirtualAccountInfo(page);
  if (!info.accountNumber || info.accountNumber === 'vbankNum') {
    throw new Error('가상계좌 번호를 확인하지 못했습니다.');
  }
  if (!Number.isFinite(info.amount)) {
    throw new Error('가상계좌 발급 금액을 확인하지 못했습니다.');
  }
  if (info.amount !== amount) {
    log.warn(`발급 결과 금액이 선택 금액과 다릅니다 (${amount.toLocaleString()}원 → ${info.amount.toLocaleString()}원).`);
  }

  return info;
}

async function waitForVirtualAccountInfo(page: Page): Promise<void> {
  await page
    .waitForFunction(
      `(() => {
        const props = window.MndpChrgM?.props;
        const buyerName = document.querySelector('#BuyerName')?.value?.trim() ?? '';
        return Boolean(props?.virtualAccountUse && buyerName);
      })()`,
      undefined,
      { timeout: 15000 },
    )
    .catch(async () => {
      const buyerName = (await page.locator('#BuyerName').inputValue().catch(() => '')).trim();
      if (!buyerName) throw new Error('가상계좌 충전 정보를 불러오지 못했습니다.');
    });
}

async function readVirtualAccountAvailability(page: Page): Promise<Record<string, string>> {
  const availability = await page.evaluate(`(() => {
    const props = window.MndpChrgM?.props ?? {};
    return {
      virtualAccountUse: props.virtualAccountUse ?? '',
      virtualAccountMsg: props.virtualAccountMsg ?? '',
      virtualMaintenaceUseYn: props.virtualMaintenaceUseYn ?? '',
      virtualMaintenaceMsg: props.virtualMaintenaceMsg ?? '',
    };
  })()`);
  return availability as Record<string, string>;
}

async function readVirtualAccountInfo(page: Page): Promise<VirtualAccountInfo> {
  const raw = (await page.evaluate(`(() => {
    const text = (selector) =>
      document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const value = (selector) => document.querySelector(selector)?.value?.trim() ?? '';
    return {
      orderNo: text('#charge_moid'),
      amountText: text('#charge_amt'),
      accountHolder: text('#charge_mallUserID'),
      accountInfo: text('#charge_vbankNumInfo'),
      payMethodName: text('#charge_payMethodName'),
      issuedAt: text('#charge_payDate'),
      accountNumber: value('#vbankNum'),
    };
  })()`)) as {
    orderNo: string;
    amountText: string;
    accountHolder: string;
    accountInfo: string;
    payMethodName: string;
    issuedAt: string;
    accountNumber: string;
  };

  const bankName = raw.accountInfo.match(/\[\s*([^\]]+)\s*\]/)?.[1]?.trim() ?? '케이뱅크';
  const accountNumber = raw.accountNumber.replace(/\D/g, '') || raw.accountNumber;
  return {
    orderNo: raw.orderNo,
    amount: parseAmountInput(raw.amountText),
    accountHolder: raw.accountHolder,
    bankName,
    accountNumber,
    formattedAccount: formatAccountNumber(accountNumber, raw.accountInfo),
    payMethodName: raw.payMethodName,
    issuedAt: raw.issuedAt,
  };
}

async function readAvailableVirtualChargeAmount(page: Page): Promise<number | null> {
  const text = await page.locator('#avaliableKbankAmt').innerText().catch(() => '');
  const amount = parseAmountInput(text);
  return Number.isFinite(amount) ? amount : null;
}

async function readVisibleMessage(page: Page): Promise<string> {
  const text = await page
    .evaluate(`(() => {
      const selectors = ['[role="dialog"]', '.popup', '.modal', '.layer', '.alert', '.msg', '.ui-dialog'];
      const visibleTexts = selectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
          })
          .map((el) => el.innerText.replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      );
      return visibleTexts[0] ?? '';
    })()`)
    .catch(() => '');

  return String(text).slice(0, 300);
}

async function waitForDepositIncrease(page: Page, depositBefore: number): Promise<number> {
  const deadline = Date.now() + DEPOSIT_REFLECT_TIMEOUT_MS;
  let latest = depositBefore;

  while (Date.now() <= deadline) {
    latest = await getDeposit(page).catch(() => latest);
    if (latest > depositBefore) return latest;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(DEPOSIT_POLL_INTERVAL_MS, remaining));
  }

  return latest;
}

function normalizeToSupportedAmount(amount: number): number | null {
  return PRESET_AMOUNTS.find((v) => v >= amount) ?? null;
}

function parseAmountInput(value: string): number {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : NaN;
}

function formatAccountNumber(accountNumber: string, accountInfo: string): string {
  const fromPage = accountInfo.match(/\]\s*(.+)$/)?.[1]?.trim();
  if (fromPage) return fromPage;

  if (/^\d{14}$/.test(accountNumber)) {
    return `${accountNumber.slice(0, 3)}-${accountNumber.slice(3, 7)}-${accountNumber.slice(7, 10)}-${accountNumber.slice(10)}`;
  }

  return accountNumber;
}

function printVirtualAccountOcrBlock(info: VirtualAccountInfo): void {
  const transferLines = [
    'OCR VIRTUAL ACCOUNT',
    '',
    `BANK              : ${info.bankName}`,
    `ACCOUNT_NUMBER    : ${info.accountNumber}`,
    `AMOUNT_KRW        : ${info.amount}`,
    `ACCOUNT_HOLDER    : ${info.accountHolder}`,
  ];
  const extraLines = [
    `ACCOUNT_FORMATTED : ${info.formattedAccount}`,
    ...(info.orderNo ? [`ORDER_NO          : ${info.orderNo}`] : []),
    ...(info.issuedAt ? [`ISSUED_AT         : ${info.issuedAt}`] : []),
  ];

  const lines = [...transferLines, ...extraLines];
  const width = Math.max(56, ...lines.map(displayWidth));
  const border = `+${'-'.repeat(width + 2)}+`;
  const separator = `| ${'-'.repeat(width)} |`;

  console.log('');
  console.log(border);
  for (const line of transferLines) {
    console.log(`| ${line}${' '.repeat(width - displayWidth(line))} |`);
  }
  console.log(separator);
  for (const line of extraLines) {
    console.log(`| ${line}${' '.repeat(width - displayWidth(line))} |`);
  }
  console.log(border);
  console.log('');
}

function displayWidth(value: string): number {
  return Array.from(value).reduce((sum, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return sum + (isWideCodePoint(codePoint) ? 2 : 1);
  }, 0);
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/**
 * 구매 직전 예치금이 부족한 경우 충전 여부를 묻고 진행한다.
 *
 * 반환:
 *  - ok=true: 잔액이 required 이상 (충전 했거나 원래 충분)
 *  - ok=false: 사용자 취소 또는 충전 실패
 */
export async function ensureSufficientDeposit(
  session: Session,
  required: number,
): Promise<{ ok: boolean; deposit: number }> {
  const deposit = await getDeposit(session.page).catch(() => 0);
  if (deposit >= required) return { ok: true, deposit };

  const shortage = required - deposit;
  log.warn(
    `예치금 부족: 필요 ${required.toLocaleString()}원 · 보유 ${deposit.toLocaleString()}원 · 부족 ${shortage.toLocaleString()}원`,
  );

  const settings = await loadSettings();
  const wantCharge = await confirm({
    message: '지금 예치금을 충전하시겠습니까?',
    default: settings.defaultConfirmYes,
  });
  if (!wantCharge) return { ok: false, deposit };

  const result = await runChargeDeposit(session, shortage);
  if (result.ok) log.success(result.message);
  else log.warn(result.message);

  return { ok: result.depositAfter >= required, deposit: result.depositAfter };
}
