import { input, select, confirm } from '@inquirer/prompts';
import { openSession, type Session } from '../auth/session.js';
import { log } from '../utils/log.js';
import { parseLottoNumbers, randomLottoNumbers, validateLottoNumbers } from '../utils/numbers.js';
import { LOTTO_MAX_GAMES_PER_ROUND, purchaseLotto, formatLottoReceiptLines } from '../games/lotto645.js';
import { loadSettings } from '../utils/settings.js';
import { ensureSufficientDeposit } from './chargeDeposit.js';

type LottoPromptMode = 'auto' | 'manual' | 'back';

export async function runLottoPurchase(existing?: Session): Promise<void> {
  const mode = await select<LottoPromptMode>({
    message: '번호 선택 방식',
    choices: [
      { name: '자동 (랜덤)', value: 'auto' },
      { name: '수동 (직접 입력)', value: 'manual' },
      { name: '◀ 메인으로 돌아가기', value: 'back' },
    ],
  });

  if (mode === 'back') return;

  const gameCount = Number(
    await input({
      message: `게임 수 (1~${LOTTO_MAX_GAMES_PER_ROUND}, 로또는 회차당 최대 ${LOTTO_MAX_GAMES_PER_ROUND}게임)`,
      default: String(LOTTO_MAX_GAMES_PER_ROUND),
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) {
          return `1~${LOTTO_MAX_GAMES_PER_ROUND} 사이의 정수를 입력해주세요`;
        }
        if (n > LOTTO_MAX_GAMES_PER_ROUND) {
          return `로또 6/45는 한 회차 최대 ${LOTTO_MAX_GAMES_PER_ROUND}게임(5,000원)까지만 구매할 수 있습니다`;
        }
        return true;
      },
    })
  );

  const games: number[][] = [];
  if (mode === 'manual') {
    for (let i = 0; i < gameCount; i++) {
      const raw = await input({
        message: `게임 ${i + 1} 번호 6개 (공백/쉼표 구분, 1~45)`,
        validate: (v) => validateLottoNumbers(parseLottoNumbers(v)),
      });
      games.push(parseLottoNumbers(raw).sort((a, b) => a - b));
    }
  } else {
    for (let i = 0; i < gameCount; i++) games.push(randomLottoNumbers());
  }

  const totalPrice = gameCount * 1000;

  log.info('선택된 번호:');
  if (mode === 'auto') {
    log.dim(`  자동 ${gameCount}게임 (서버가 랜덤 발급)`);
  } else {
    games.forEach((g, i) => log.dim(`  ${i + 1}. ${g.join(', ')}`));
  }
  log.info(`총 결제 예정 금액: ${totalPrice.toLocaleString()}원 (게임당 1,000원 × ${gameCount})`);

  const settings = await loadSettings();
  if (settings.testMode) {
    log.warn('테스트 모드 ON: 실제 결제는 진행하지 않고 결제 확인 팝업에서 취소합니다.');
  }
  const ok = await confirm({
    message: settings.testMode
      ? `${gameCount}게임 · ${totalPrice.toLocaleString()}원 테스트 구매 플로우 진행?`
      : `${gameCount}게임 · ${totalPrice.toLocaleString()}원 실제 구매 진행?`,
    default: settings.defaultConfirmYes,
  });
  if (!ok) {
    log.warn('취소되었습니다.');
    return;
  }

  const session = existing ?? (await openSession());
  try {
    if (!settings.testMode) {
      const depositCheck = await ensureSufficientDeposit(session, totalPrice);
      if (!depositCheck.ok) {
        log.warn('예치금이 부족하여 구매를 진행하지 않습니다.');
        return;
      }
    }

    const result = await purchaseLotto(session.page, {
      mode,
      games,
      gameCount,
      dryRun: settings.testMode,
    });
    if (result.ok) {
      log.success(result.message);
      for (const line of formatLottoReceiptLines(result)) log.dim(`  ${line}`);
    } else log.error(result.message);
  } finally {
    if (!existing) await session.close();
  }
}
