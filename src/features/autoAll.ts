import { confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import type { Session } from '../auth/session.js';
import { log } from '../utils/log.js';
import { randomLottoNumbers, randomPensionNumbers } from '../utils/numbers.js';
import { purchaseLotto, formatLottoReceiptLines } from '../games/lotto645.js';
import { purchasePension, type PensionGameSelection } from '../games/pension720.js';
import { calculatePensionPrice, promptPensionUpsellAction } from './pensionPurchase.js';
import { loadSettings } from '../utils/settings.js';
import { ensureSufficientDeposit } from './chargeDeposit.js';
import { getDeposit } from './deposit.js';
import type { WeeklyStatus } from './weeklyStatus.js';

const GAMES_PER_TYPE = 5;
const LOTTO_GAME_PRICE = 1000;

export async function runAutoAll(session: Session, status: WeeklyStatus | null): Promise<void> {
  const settings = await loadSettings();
  const buyLotto = !status?.lotto645.purchased;
  // 연금복권 720+ 는 회차당 다회 구매 가능 → 이미 구매 여부와 무관하게 항상 진행.
  const buyPension = true;
  const pensionAlreadyBought = !!status?.pension720.purchased;
  const deposit = settings.testMode ? null : await getDeposit(session.page).catch(() => null);

  const lottoTotal = buyLotto ? GAMES_PER_TYPE * LOTTO_GAME_PRICE : 0;
  const pensionPlan = buildPensionPlan({
    useAllGroups: settings.autoAllPensionAllGroups,
    minDeposit: settings.autoAllPensionAllGroupsMinDeposit,
    deposit,
    lottoTotal,
    testMode: settings.testMode,
  });

  log.info('모두 자동 구매 계획:');
  console.log(
    buyLotto
      ? pc.cyan(`  · 로또 6/45 자동 ${GAMES_PER_TYPE}게임 (${(GAMES_PER_TYPE * LOTTO_GAME_PRICE).toLocaleString()}원)`)
      : pc.dim(`  · 로또 6/45 — 이번 주 이미 구매함, 건너뜀`),
  );
  console.log(
    pensionAlreadyBought
      ? pc.cyan(`  · ${pensionPlan.label} — 이번 주 이미 구매했지만 추가 구매 진행`)
      : pc.cyan(`  · ${pensionPlan.label}`),
  );
  if (pensionPlan.disabledReason) {
    console.log(pc.dim(`    ↳ 연금 모든 조 자동 구매 비활성화: ${pensionPlan.disabledReason}`));
  }

  if (!buyLotto && !buyPension) {
    log.warn('실행할 작업이 없습니다.');
    return;
  }

  const total = lottoTotal + (buyPension ? pensionPlan.totalPrice : 0);
  log.info(`총 결제 예정 금액: ${total.toLocaleString()}원`);

  if (settings.testMode) {
    log.warn('테스트 모드 ON: 실제 결제는 진행하지 않고 각 결제 확인 팝업에서 취소합니다.');
  }
  const ok = await confirm({
    message: settings.testMode
      ? `${total.toLocaleString()}원 테스트 구매 플로우 진행?`
      : `${total.toLocaleString()}원 실제 구매 진행?`,
    default: settings.defaultConfirmYes,
  });
  if (!ok) {
    log.warn('취소되었습니다.');
    return;
  }

  const upsellDialogAction = buyPension ? await promptPensionUpsellAction() : 'accept';

  if (!settings.testMode) {
    const depositCheck = await ensureSufficientDeposit(session, total);
    if (!depositCheck.ok) {
      log.warn('예치금이 부족하여 구매를 진행하지 않습니다.');
      return;
    }
  }

  if (buyLotto) {
    console.log();
    log.step('── [1/2] 로또 6/45 자동 구매 ──');
    try {
      const games = Array.from({ length: GAMES_PER_TYPE }, () => randomLottoNumbers());
      const result = await purchaseLotto(session.page, {
        mode: 'auto',
        games,
        gameCount: GAMES_PER_TYPE,
        dryRun: settings.testMode,
      });
      if (result.ok) {
        log.success(`[로또] ${result.message}`);
        for (const line of formatLottoReceiptLines(result)) log.dim(`    ${line}`);
      } else log.error(`[로또] ${result.message}`);
    } catch (err) {
      log.error(`[로또] 예외: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (buyPension) {
    console.log();
    log.step('── [2/2] 연금복권 720+ 자동 구매 ──');
    try {
      const result = await purchasePension(session.page, {
        mode: 'auto',
        games: pensionPlan.games,
        gameCount: pensionPlan.games.length,
        dryRun: settings.testMode,
        upsellDialogAction,
      });
      if (result.ok) log.success(`[연금] ${result.message}`);
      else log.error(`[연금] ${result.message}`);
    } catch (err) {
      log.error(`[연금] 예외: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

interface PensionPlanInput {
  useAllGroups: boolean;
  minDeposit: number;
  deposit: number | null;
  lottoTotal: number;
  testMode: boolean;
}

interface PensionPlan {
  games: PensionGameSelection[];
  totalPrice: number;
  label: string;
  disabledReason: string;
}

function buildPensionPlan(input: PensionPlanInput): PensionPlan {
  const standardGames = buildStandardPensionGames();
  const standardPrice = calculatePensionPrice(standardGames);

  if (!input.useAllGroups) {
    return {
      games: standardGames,
      totalPrice: standardPrice,
      label: `연금복권 720+ 자동 ${GAMES_PER_TYPE}게임 (${standardPrice.toLocaleString()}원)`,
      disabledReason: '',
    };
  }

  const allGroupGames = buildAllGroupPensionGames();
  const allGroupPrice = calculatePensionPrice(allGroupGames);
  const requiredTotal = input.lottoTotal + allGroupPrice;
  const minDeposit = Math.max(input.minDeposit, allGroupPrice);

  let disabledReason = '';
  if (!input.testMode && input.deposit === null) {
    disabledReason = '예치금 조회 실패';
  } else if (!input.testMode && input.deposit !== null && input.deposit < minDeposit) {
    disabledReason = `보유 ${input.deposit.toLocaleString()}원 < 최소 ${minDeposit.toLocaleString()}원`;
  } else if (!input.testMode && input.deposit !== null && input.deposit < requiredTotal) {
    disabledReason = `보유 ${input.deposit.toLocaleString()}원 < 구매 예정 ${requiredTotal.toLocaleString()}원`;
  }

  if (disabledReason) {
    return {
      games: standardGames,
      totalPrice: standardPrice,
      label: `연금복권 720+ 자동 ${GAMES_PER_TYPE}게임 (${standardPrice.toLocaleString()}원)`,
      disabledReason,
    };
  }

  return {
    games: allGroupGames,
    totalPrice: allGroupPrice,
    label: `연금복권 720+ 자동 모든 조 ${GAMES_PER_TYPE}세트 (${allGroupPrice.toLocaleString()}원)`,
    disabledReason: '',
  };
}

function buildStandardPensionGames(): PensionGameSelection[] {
  return Array.from({ length: GAMES_PER_TYPE }, () => {
    const r = randomPensionNumbers();
    return { group: r.group, digits: r.digits };
  });
}

function buildAllGroupPensionGames(): PensionGameSelection[] {
  return Array.from({ length: GAMES_PER_TYPE }, () => ({ group: 'all', digits: '' }));
}
