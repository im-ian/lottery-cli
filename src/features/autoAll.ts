import { confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import type { Session } from '../auth/session.js';
import { log } from '../utils/log.js';
import { randomLottoNumbers, randomPensionNumbers } from '../utils/numbers.js';
import { purchaseLotto, formatLottoReceiptLines } from '../games/lotto645.js';
import { purchasePension } from '../games/pension720.js';
import { promptPensionUpsellAction } from './pensionPurchase.js';
import { loadSettings } from '../utils/settings.js';
import type { WeeklyStatus } from './weeklyStatus.js';

const GAMES_PER_TYPE = 5;
const LOTTO_GAME_PRICE = 1000;
const PENSION_GAME_PRICE = 1000;

export async function runAutoAll(session: Session, status: WeeklyStatus | null): Promise<void> {
  const buyLotto = !status?.lotto645.purchased;
  const buyPension = !status?.pension720.purchased;

  log.info('모두 자동 구매 계획:');
  console.log(
    buyLotto
      ? pc.cyan(`  · 로또 6/45 자동 ${GAMES_PER_TYPE}게임 (${(GAMES_PER_TYPE * LOTTO_GAME_PRICE).toLocaleString()}원)`)
      : pc.dim(`  · 로또 6/45 — 이번 주 이미 구매함, 건너뜀`),
  );
  console.log(
    buyPension
      ? pc.cyan(`  · 연금복권 720+ 자동 ${GAMES_PER_TYPE}게임 (${(GAMES_PER_TYPE * PENSION_GAME_PRICE).toLocaleString()}원)`)
      : pc.dim(`  · 연금복권 720+ — 이번 주 이미 구매함, 건너뜀`),
  );

  if (!buyLotto && !buyPension) {
    log.warn('두 종류 모두 이번 주 이미 구매한 상태 → 실행할 작업 없음');
    return;
  }

  const total =
    (buyLotto ? GAMES_PER_TYPE * LOTTO_GAME_PRICE : 0) +
    (buyPension ? GAMES_PER_TYPE * PENSION_GAME_PRICE : 0);
  log.info(`총 결제 예정 금액: ${total.toLocaleString()}원`);

  const settings = await loadSettings();
  const ok = await confirm({
    message: `${total.toLocaleString()}원 실제 구매 진행?`,
    default: settings.defaultConfirmYes,
  });
  if (!ok) {
    log.warn('취소');
    return;
  }

  const upsellDialogAction = buyPension ? await promptPensionUpsellAction() : 'accept';

  if (buyLotto) {
    console.log();
    log.step('── [1/2] 로또 6/45 자동 구매 ──');
    try {
      const games = Array.from({ length: GAMES_PER_TYPE }, () => randomLottoNumbers());
      const result = await purchaseLotto(session.page, {
        mode: 'auto',
        games,
        gameCount: GAMES_PER_TYPE,
        dryRun: false,
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
      const games = Array.from({ length: GAMES_PER_TYPE }, () => {
        const r = randomPensionNumbers();
        return { group: r.group as number | 'all', digits: r.digits };
      });
      const result = await purchasePension(session.page, {
        mode: 'auto',
        games,
        gameCount: GAMES_PER_TYPE,
        dryRun: false,
        upsellDialogAction,
      });
      if (result.ok) log.success(`[연금] ${result.message}`);
      else log.error(`[연금] ${result.message}`);
    } catch (err) {
      log.error(`[연금] 예외: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
