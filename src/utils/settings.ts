import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AppSettings {
  // 결제/구매 confirm prompt 기본값. true면 Y(default 'yes'), false면 N(default 'no').
  defaultConfirmYes: boolean;
  // 내역 조회 시 번호/조 등 베팅 상세를 숨기고 당첨 관련 정보만 출력.
  briefHistory: boolean;
  // 구매/당첨 내역 조회 후 요약 블록 추가 출력 여부.
  summarizeHistory: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultConfirmYes: false,
  briefHistory: false,
  summarizeHistory: false,
};

const SETTINGS_DIR = path.resolve(process.cwd(), '.lottery-auto');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

let cache: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    cache = { ...DEFAULT_SETTINGS, ...parsed };
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
