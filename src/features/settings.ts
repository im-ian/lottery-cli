import { select } from '@inquirer/prompts';
import pc from 'picocolors';
import { log } from '../utils/log.js';
import { loadSettings, saveSettings, type AppSettings } from '../utils/settings.js';

export async function runSettingsMenu(): Promise<void> {
  while (true) {
    const current = await loadSettings();
    printSettings(current);

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
        { name: '◀ 메인으로 돌아가기', value: 'back' },
      ],
    });

    if (action === 'back') return;

    const next: AppSettings = { ...current };
    if (action === 'defaultConfirmYes') next.defaultConfirmYes = !current.defaultConfirmYes;
    else if (action === 'summarizeHistory') next.summarizeHistory = !current.summarizeHistory;

    await saveSettings(next);
    log.success('설정 저장됨');
  }
}

function printSettings(s: AppSettings): void {
  log.info('현재 설정:');
  console.log(pc.dim(`  · confirm 기본 선택값: ${s.defaultConfirmYes ? 'Y (Enter=확인)' : 'N (Enter=취소)'}`));
  console.log(pc.dim(`  · 조회 결과 요약 출력: ${s.summarizeHistory ? 'ON' : 'OFF'}`));
}
