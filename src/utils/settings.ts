import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AppSettings {
  // 결제/구매 confirm prompt 기본값. true면 Y(default 'yes'), false면 N(default 'no').
  defaultConfirmYes: boolean;
  // 실제 구매/충전 없이 결제 직전까지만 진행.
  testMode: boolean;
  // 내역 조회 시 번호/조 등 베팅 상세를 숨기고 당첨 관련 정보만 출력.
  briefHistory: boolean;
  // 구매/당첨 내역 조회 후 요약 블록 추가 출력 여부.
  summarizeHistory: boolean;
  // "모두 자동 구매"에서 연금복권을 모든 조로 구매할지 여부.
  autoAllPensionAllGroups: boolean;
  // 위 옵션을 자동 활성화하기 위한 최소 예치금.
  autoAllPensionAllGroupsMinDeposit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultConfirmYes: false,
  testMode: false,
  briefHistory: false,
  summarizeHistory: false,
  autoAllPensionAllGroups: false,
  autoAllPensionAllGroupsMinDeposit: 25000,
};

const SETTINGS_DIR = path.resolve(process.cwd(), '.lottery-auto');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
const MIN_AUTO_ALL_PENSION_ALL_GROUPS_DEPOSIT = 5000;

let cache: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    cache = normalizeSettings(parsed);
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export async function saveSettings(next: AppSettings): Promise<void> {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  cache = { ...next };
}

export function getSettingsSync(): AppSettings {
  return cache ?? { ...DEFAULT_SETTINGS };
}

function normalizeSettings(parsed: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...parsed };
  const minDeposit = Number(merged.autoAllPensionAllGroupsMinDeposit);
  return {
    ...merged,
    autoAllPensionAllGroups: merged.autoAllPensionAllGroups === true,
    autoAllPensionAllGroupsMinDeposit:
      Number.isFinite(minDeposit) && minDeposit >= MIN_AUTO_ALL_PENSION_ALL_GROUPS_DEPOSIT
        ? Math.floor(minDeposit)
        : DEFAULT_SETTINGS.autoAllPensionAllGroupsMinDeposit,
  };
}
