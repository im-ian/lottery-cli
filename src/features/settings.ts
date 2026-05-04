import { select } from '@inquirer/prompts';
import pc from 'picocolors';
import { loadSettings, saveSettings, type AppSettings } from '../utils/settings.js';

const CURSOR_UP = (n: number) => `\x1b[${n}A`;
const CLEAR_BELOW = '\x1b[0J';

export async function runSettingsMenu(): Promise<void> {
  // 매 루프 직전 이전 출력(헤더 + select 응답 echo) 라인 수만큼 커서 올린 뒤 지워서
  // 같은 자리에 메뉴를 다시 그린다. 이전 CLI 스크롤백은 보존.
  let linesToClear = 0;

  while (true) {
    if (linesToClear > 0) {
      process.stdout.write(CURSOR_UP(linesToClear) + CLEAR_BELOW);
    }

    const current = await loadSettings();
    const header = renderHeader(current);
    for (const line of header) console.log(line);

    const action = await select({
      message: '설정 변경 (Esc: 메인으로)',
      choices: [
        {
          name: `1. confirm 기본 선택값  현재: ${current.defaultConfirmYes ? 'Y' : 'N'}`,
          value: 'defaultConfirmYes',
        },
        {
          name: `2. 조회 결과 요약 출력  현재: ${current.summarizeHistory ? 'ON' : 'OFF'}`,
          value: 'summarizeHistory',
        },
        { name: '메인으로 돌아가기', value: 'back' },
      ],
    });

    // 출력 누적: header 라인 + select 가 resolve 후 남기는 echo 1줄.
    linesToClear = header.length + 1;

    if (action === 'back') return;

    const next: AppSettings = { ...current };
    if (action === 'defaultConfirmYes') next.defaultConfirmYes = !current.defaultConfirmYes;
    else if (action === 'summarizeHistory') next.summarizeHistory = !current.summarizeHistory;

    await saveSettings(next);
    // 토글 결과는 다음 루프에서 갱신된 헤더 텍스트로 즉시 반영됨.
  }
}

function renderHeader(s: AppSettings): string[] {
  return [
    `${pc.cyan('ℹ')} 현재 설정:`,
    pc.dim(`  · confirm 기본 선택값: ${s.defaultConfirmYes ? 'Y (Enter=확인)' : 'N (Enter=취소)'}`),
    pc.dim(`  · 조회 결과 요약 출력: ${s.summarizeHistory ? 'ON' : 'OFF'}`),
  ];
}
