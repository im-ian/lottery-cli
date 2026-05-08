import { input, select, confirm } from '@inquirer/prompts';
import type { Session } from '../auth/session.js';
import { config } from '../config.js';
import { log } from '../utils/log.js';
import { loadSettings } from '../utils/settings.js';
import { getDeposit } from './deposit.js';

const PRESET_AMOUNTS = [5000, 10000, 30000, 50000, 100000] as const;
const MIN_AMOUNT = 5000;
const MAX_AMOUNT = 1_000_000;

export interface ChargeResult {
  ok: boolean;
  depositBefore: number;
  depositAfter: number;
  charged: number;
  message: string;
}

/**
 * 예치금 충전(가상계좌 발급) 흐름.
 *
 * 1단계 구현: 결제 페이지를 playwright 세션 브라우저에 띄우고,
 * 사용자가 직접 가상계좌 발급/송금까지 완료하도록 안내.
 * 완료 후 Enter를 누르면 잔액 변동을 재확인해 결과 메시지 출력.
 *
 * 향후 단계에서 결제 페이지 DOM이 확인되면 금액·은행 선택까지
 * 자동화할 수 있도록 prompt 단계는 미리 받아둔다.
 */
export async function runChargeDeposit(session: Session, suggestedMin?: number): Promise<ChargeResult> {
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
      { name: '직접 입력', value: 'custom' },
      { name: '취소', value: 'cancel' },
    ],
    default: suggestedMin
      ? String(PRESET_AMOUNTS.find((v) => v >= suggestedMin) ?? PRESET_AMOUNTS[PRESET_AMOUNTS.length - 1])
      : '10000',
  });

  if (pickRaw === 'cancel') {
    return { ok: false, depositBefore: 0, depositAfter: 0, charged: 0, message: '충전 취소' };
  }

  let amount: number;
  if (pickRaw === 'custom') {
    const raw = await input({
      message: `충전 금액 (${MIN_AMOUNT.toLocaleString()}~${MAX_AMOUNT.toLocaleString()}원, 1,000원 단위)`,
      default: suggestedMin ? String(Math.ceil(suggestedMin / 1000) * 1000) : '10000',
      validate: (v) => {
        const n = Number(v.replace(/,/g, ''));
        if (!Number.isInteger(n)) return '정수 금액을 입력해주세요';
        if (n < MIN_AMOUNT) return `최소 ${MIN_AMOUNT.toLocaleString()}원 이상`;
        if (n > MAX_AMOUNT) return `최대 ${MAX_AMOUNT.toLocaleString()}원 이하`;
        if (n % 1000 !== 0) return '1,000원 단위로 입력해주세요';
        return true;
      },
    });
    amount = Number(raw.replace(/,/g, ''));
  } else {
    amount = Number(pickRaw);
  }

  log.info(`충전 페이지로 이동합니다 (목표 금액 ${amount.toLocaleString()}원).`);
  if (config.headless) {
    log.warn('현재 HEADLESS=true 상태입니다. 가상계좌 발급은 브라우저 화면 작업이 필요합니다.');
    log.dim('  HEADLESS=false로 다시 실행한 뒤 시도해주세요.');
    return {
      ok: false,
      depositBefore: 0,
      depositAfter: 0,
      charged: 0,
      message: 'HEADLESS 모드에서는 충전 진행 불가',
    };
  }

  const depositBefore = await getDeposit(session.page).catch(() => 0);

  try {
    await session.page.goto(config.urls.charge, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (err) {
    log.error(`충전 페이지 이동 실패: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, depositBefore, depositAfter: depositBefore, charged: 0, message: '충전 페이지 이동 실패' };
  }

  log.info('브라우저에서 가상계좌 발급 절차를 진행해주세요:');
  log.dim('  1) 충전 금액 입력 또는 선택');
  log.dim('  2) 가상계좌(무통장 입금) 선택');
  log.dim('  3) 입금자명/은행 선택 후 발급');
  log.dim('  4) 발급된 계좌로 송금 (은행 앱)');
  log.dim('  5) 송금이 반영되면 아래 단계 진행');

  const settings = await loadSettings();
  const proceed = await confirm({
    message: '브라우저에서 가상계좌 발급 및 송금까지 완료했나요? (잔액 반영 확인용)',
    default: settings.defaultConfirmYes,
  });

  if (!proceed) {
    return {
      ok: false,
      depositBefore,
      depositAfter: depositBefore,
      charged: 0,
      message: '사용자가 미완료 처리',
    };
  }

  const depositAfter = await getDeposit(session.page).catch(() => depositBefore);
  const charged = Math.max(0, depositAfter - depositBefore);

  if (charged <= 0) {
    return {
      ok: false,
      depositBefore,
      depositAfter,
      charged: 0,
      message: `잔액 변동이 확인되지 않습니다 (${depositBefore.toLocaleString()}원 → ${depositAfter.toLocaleString()}원). 송금 반영까지 시간이 걸릴 수 있어요.`,
    };
  }

  return {
    ok: true,
    depositBefore,
    depositAfter,
    charged,
    message: `충전 반영 확인: +${charged.toLocaleString()}원 (잔액 ${depositAfter.toLocaleString()}원)`,
  };
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
