import { input, select, confirm } from '@inquirer/prompts';
import { openSession, type Session } from '../auth/session.js';
import { log } from '../utils/log.js';
import { parseLottoNumbers, randomLottoNumbers, validateLottoNumbers } from '../utils/numbers.js';
import { purchaseLotto, formatLottoReceiptLines } from '../games/lotto645.js';

export async function runLottoPurchase(existing?: Session): Promise<void> {
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
      default: '5',
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) return '1~5 사이의 정수를 입력해주세요';
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

  const ok = await confirm({
    message: `${gameCount}게임 · ${totalPrice.toLocaleString()}원 실제 구매 진행?`,
    default: false,
  });
  if (!ok) {
    log.warn('취소');
    return;
  }

  const session = existing ?? (await openSession());
  try {
    const result = await purchaseLotto(session.page, {
      mode,
      games,
      gameCount,
      dryRun: false,
    });
    if (result.ok) {
      log.success(result.message);
      for (const line of formatLottoReceiptLines(result)) log.dim(`  ${line}`);
    } else log.error(result.message);
  } finally {
    if (!existing) await session.close();
  }
}
