import { input, select, confirm } from '@inquirer/prompts';
import { openSession, type Session } from '../auth/session.js';
import { log } from '../utils/log.js';
import { randomPensionNumbers, validatePensionDigits } from '../utils/numbers.js';
import { PENSION_MAX_GAMES_PER_PURCHASE, purchasePension, type UpsellDialogAction } from '../games/pension720.js';
import { loadSettings } from '../utils/settings.js';
import { ensureSufficientDeposit } from './chargeDeposit.js';

const MAX_CHAINED_GAMES = 50;

export async function promptPensionUpsellAction(): Promise<UpsellDialogAction> {
  return (await select({
    message:
      '결제 중 "모든조 구매 시 1·2등 동시 당첨 가능 (총 21.6억). 정말 구매하시겠습니까?" 안내가 뜨면?',
    choices: [
      { name: '확인 — 원래 선택대로 결제 진행 (권장)', value: 'accept' },
      { name: '취소 — 결제 중단', value: 'dismiss' },
    ],
    default: 'accept',
  })) as UpsellDialogAction;
}

export async function runPensionPurchase(existing?: Session): Promise<void> {
  const mode = (await select({
    message: '번호 선택 방식',
    choices: [
      { name: '자동 (랜덤)', value: 'auto' },
      { name: '수동 (직접 입력)', value: 'manual' },
    ],
  })) as 'auto' | 'manual';

  const gameCount = Number(
    await input({
      message: `게임 수 (1~${MAX_CHAINED_GAMES}, ${PENSION_MAX_GAMES_PER_PURCHASE}게임 단위로 연속 구매)`,
      default: '1',
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > MAX_CHAINED_GAMES) {
          return `1~${MAX_CHAINED_GAMES} 사이의 정수를 입력해주세요`;
        }
        return true;
      },
    })
  );

  const games: { group: 'all' | number; digits: string }[] = [];
  if (mode === 'manual') {
    for (let i = 0; i < gameCount; i++) {
      const groupRaw = await select({
        message: `게임 ${i + 1} 조 선택`,
        choices: [
          { name: '모든 조', value: 'all' },
          { name: '1조', value: '1' },
          { name: '2조', value: '2' },
          { name: '3조', value: '3' },
          { name: '4조', value: '4' },
          { name: '5조', value: '5' },
        ],
      });
      const group: 'all' | number = groupRaw === 'all' ? 'all' : Number(groupRaw);
      const digits = await input({
        message: `게임 ${i + 1} 6자리 번호`,
        validate: validatePensionDigits,
      });
      games.push({ group, digits });
    }
  } else {
    for (let i = 0; i < gameCount; i++) {
      const r = randomPensionNumbers();
      games.push({ group: r.group, digits: r.digits });
    }
  }

  const totalPrice = games.reduce((sum, g) => sum + (g.group === 'all' ? 5000 : 1000), 0);

  log.info('선택된 번호:');
  games.forEach((g, i) =>
    log.dim(
      `  ${i + 1}. ${g.group === 'all' ? '모든 조 (5,000원)' : `${g.group}조 (1,000원)`} ${mode === 'auto' ? '(자동)' : g.digits}`,
    ),
  );
  log.info(`총 결제 예정 금액: ${totalPrice.toLocaleString()}원`);
  const batches = chunkGames(games, PENSION_MAX_GAMES_PER_PURCHASE);
  if (batches.length > 1) {
    log.info(`구매는 ${PENSION_MAX_GAMES_PER_PURCHASE}게임 단위로 ${batches.length}회 나누어 진행합니다.`);
  }

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

  const upsellDialogAction = await promptPensionUpsellAction();

  const session = existing ?? (await openSession());
  try {
    if (!settings.testMode) {
      const depositCheck = await ensureSufficientDeposit(session, totalPrice);
      if (!depositCheck.ok) {
        log.warn('예치금이 부족하여 구매를 진행하지 않습니다.');
        return;
      }
    }

    let purchasedGames = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const batchPrice = calculatePensionPrice(batch);
      log.step(
        `연금복권 구매 ${i + 1}/${batches.length}: ${batch.length}게임 · ${batchPrice.toLocaleString()}원`,
      );

      const result = await purchasePension(session.page, {
        mode,
        games: batch,
        gameCount: batch.length,
        dryRun: settings.testMode,
        upsellDialogAction,
      });

      if (!result.ok) {
        log.error(result.message);
        if (purchasedGames > 0) {
          log.warn(`앞선 ${purchasedGames}게임은 구매 완료됐을 수 있습니다. 구매내역에서 확인해주세요.`);
        }
        return;
      }

      purchasedGames += batch.length;
      log.success(`[${i + 1}/${batches.length}] ${result.message}`);
    }

    log.success(`연금복권 연속 구매 완료: ${purchasedGames}게임`);
  } finally {
    if (!existing) await session.close();
  }
}

type PensionGame = { group: 'all' | number; digits: string };

function chunkGames<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function calculatePensionPrice(games: PensionGame[]): number {
  return games.reduce((sum, g) => sum + (g.group === 'all' ? 5000 : 1000), 0);
}
