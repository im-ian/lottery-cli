import { select } from '@inquirer/prompts';
import pc from 'picocolors';
import { openSession, type Session } from './auth/session.js';
import { log } from './utils/log.js';
import { runLottoPurchase } from './features/lottoPurchase.js';
import { runPensionPurchase } from './features/pensionPurchase.js';
import { runSpeettoPurchase } from './features/speettoPurchase.js';
import { runHistory } from './features/history.js';
import { getWeeklyStatus, type WeeklyStatus } from './features/weeklyStatus.js';
import { getDeposit } from './features/deposit.js';
import { runAutoAll } from './features/autoAll.js';
import { runSettingsMenu } from './features/settings.js';
import { runOpenSite } from './features/openSite.js';
import { runChargeDeposit } from './features/chargeDeposit.js';
import { loadSettings } from './utils/settings.js';

async function main() {
  log.info('동행복권 자동 CLI');
  await loadSettings();

  let session: Session | null = null;
  try {
    try {
      session = await openSession();
    } catch (err) {
      log.warn(`세션 열기 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
    }

    while (true) {
      if (session) {
        try {
          const deposit = await getDeposit(session.page);
          console.log(pc.cyan(`  💰 보유 예치금: ${deposit.toLocaleString()}원`));
        } catch {
          // ignore deposit fetch errors silently
        }
      }

      const action = await select({
        message: '무엇을 할까요?',
        choices: [
          { name: '복권 구매', value: 'buy' },
          { name: '구매내역/당첨 결과 조회', value: 'history' },
          { name: '예치금 충전', value: 'charge' },
          { name: '동행복권 사이트 열기', value: 'open-site' },
          { name: '설정', value: 'settings' },
          { name: '종료', value: 'exit' },
        ],
      });

      if (action === 'exit') {
        log.info('종료합니다. 안녕히 가세요 👋');
        break;
      }

      if (action === 'settings') {
        try {
          await runSettingsMenu();
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
        }
        console.log();
        continue;
      }

      if (action === 'open-site') {
        try {
          await runOpenSite();
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
        }
        console.log();
        continue;
      }

      if (!session) session = await openSession();

      try {
        if (action === 'history') {
          await runHistory(session);
        } else if (action === 'buy') {
          await runBuyFlow(session);
        } else if (action === 'charge') {
          const result = await runChargeDeposit(session);
          if (result.ok) log.success(result.message);
          else log.warn(result.message);
        }
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
      }

      console.log();
    }
  } finally {
    if (session) await session.close();
  }
}

async function runBuyFlow(session: Session): Promise<void> {
  log.step('이번 주 구매 현황 확인 중...');
  let status: WeeklyStatus | null = null;
  try {
    status = await getWeeklyStatus(session.page);
    printWeeklyStatus(status);
  } catch (err) {
    log.warn(`구매 현황 확인 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
  }

  const lottoBoughtReason = status?.lotto645.purchased
    ? `이미 구매함 — 다음 회차는 ${status.lotto645.nextDrawAt} 이후`
    : false;
  // 연금복권 720+ 는 회차당 다회 구매 가능 → 이미 구매했어도 disable 하지 않음.

  const game = await select({
    message: '어떤 복권을 구매할까요? (Esc: 메인으로)',
    choices: [
      {
        name: '⚡ 모두 자동 구매 (로또 5게임 + 연금 5게임, 최대 10,000원)',
        value: 'auto-all',
        disabled: lottoBoughtReason,
      },
      {
        name: '로또 6/45',
        value: 'lotto645',
        disabled: lottoBoughtReason,
      },
      {
        name: '연금복권 720+',
        value: 'pension720',
      },
      { name: '스피또 (온라인 구매 불가 — 안내만)', value: 'speetto' },
      { name: '◀ 메인으로 돌아가기', value: 'back' },
    ],
  });

  if (game === 'back') return;
  if (game === 'auto-all') await runAutoAll(session, status);
  else if (game === 'lotto645') await runLottoPurchase(session);
  else if (game === 'pension720') await runPensionPurchase(session);
  else if (game === 'speetto') await runSpeettoPurchase();
}

function printWeeklyStatus(s: WeeklyStatus): void {
  log.info('이번 회차 구매 현황:');
  const fmt = (label: string, st: { purchased: boolean; count: number; lastRound: string; nextDrawAt: string }) =>
    st.purchased
      ? pc.green(
          `  ✓ ${label}: ${st.count}건${st.lastRound ? ` (${st.lastRound}회차)` : ''} · 다음 회차 구매: ${st.nextDrawAt} 이후`,
        )
      : pc.dim(`  · ${label}: 미구매 · 이번 회차 마감: ${st.nextDrawAt}`);
  console.log(fmt('로또 6/45', s.lotto645));
  console.log(fmt('연금복권 720+', s.pension720));
}

main().catch((err) => {
  if (err instanceof Error && /(ExitPromptError|force closed|User force closed)/i.test(err.message)) {
    log.info('종료합니다. 👋');
    return;
  }
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
