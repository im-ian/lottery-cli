import { input, select, confirm } from '@inquirer/prompts';
import { openSession, type Session } from '../auth/session.js';
import { log } from '../utils/log.js';
import { randomPensionNumbers, validatePensionDigits } from '../utils/numbers.js';
import { purchasePension, type UpsellDialogAction } from '../games/pension720.js';

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
      message: '게임 수 (1~5)',
      default: '1',
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) return '1~5 사이의 정수를 입력해주세요';
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

  const ok = await confirm({
    message: `${gameCount}게임 · ${totalPrice.toLocaleString()}원 실제 구매 진행?`,
    default: false,
  });
  if (!ok) {
    log.warn('취소');
    return;
  }

  const upsellDialogAction = await promptPensionUpsellAction();

  const session = existing ?? (await openSession());
  try {
    const result = await purchasePension(session.page, {
      mode,
      games,
      gameCount,
      dryRun: false,
      upsellDialogAction,
    });
    if (result.ok) log.success(result.message);
    else log.error(result.message);
  } finally {
    if (!existing) await session.close();
  }
}
