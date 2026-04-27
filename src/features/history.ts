import { select, input } from '@inquirer/prompts';
import type { Page } from 'playwright';
import { openSession, type Session } from '../auth/session.js';
import { config } from '../config.js';
import { log } from '../utils/log.js';

export interface LedgerEntry {
  date: string;
  name: string;
  round: string;
  numbers: string;
  quantity: string;
  result: string;
  prize: string;
  drawDate: string;
  claimStatus: string;
}

export async function runHistory(existing?: Session): Promise<void> {
  const range = (await select({
    message: '조회 기간',
    choices: [
      { name: '당일', value: 'today' },
      { name: '최근 1주일', value: 'week' },
      { name: '최근 1개월', value: 'month' },
      { name: '직접 입력', value: 'custom' },
    ],
  })) as 'today' | 'week' | 'month' | 'custom';

  let start: string;
  let end: string;
  if (range === 'custom') {
    start = await input({
      message: '시작일 (YYYY-MM-DD)',
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || 'YYYY-MM-DD 형식',
    });
    end = await input({
      message: '종료일 (YYYY-MM-DD)',
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || 'YYYY-MM-DD 형식',
    });
  } else {
    const today = new Date();
    const startDate = new Date(today);
    if (range === 'week') startDate.setDate(today.getDate() - 7);
    else if (range === 'month') startDate.setMonth(today.getMonth() - 1);
    start = fmt(startDate);
    end = fmt(today);
  }

  const session = existing ?? (await openSession());
  try {
    const entries = await fetchLedger(session.page, start, end);
    printLedger(entries, start, end);
  } finally {
    if (!existing) await session.close();
  }
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchLedger(page: Page, start: string, end: string): Promise<LedgerEntry[]> {
  log.step('구매/당첨 내역 페이지 진입');
  await page.goto(config.urls.myLedger, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  log.step(`기간 설정: ${start} ~ ${end}`);
  const startFmt = start.replace(/-/g, '-');
  const endFmt = end.replace(/-/g, '-');

  await page.evaluate(
    ({ s, e }) => {
      const si = document.querySelector<HTMLInputElement>('#srchStrDt');
      const ei = document.querySelector<HTMLInputElement>('#srchEndDt');
      if (si) si.value = s;
      if (ei) ei.value = e;
    },
    { s: startFmt, e: endFmt },
  );

  log.step('조회 실행');
  await page.click('#btnSrch');
  await page.waitForTimeout(2500);

  const noList = page.locator('.no-list');
  if ((await noList.count()) > 0 && (await noList.isVisible().catch(() => false))) {
    return [];
  }

  const rows = page.locator('#winning-history-list .whl-body .whl-row');
  const count = await rows.count();
  const entries: LedgerEntry[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const entry: LedgerEntry = {
      date: await textOf(row, '.col-date1'),
      name: await textOf(row, '.col-name'),
      round: await textOf(row, '.col-th'),
      numbers: await textOf(row, '.col-num'),
      quantity: await textOf(row, '.col-ea'),
      result: await textOf(row, '.col-result'),
      prize: await textOf(row, '.col-am'),
      drawDate: await textOf(row, '.col-date2'),
      claimStatus: await textOf(row, '.col-yn2'),
    };
    entries.push(entry);
  }

  return entries;
}

async function textOf(row: import('playwright').Locator, sel: string): Promise<string> {
  return (await row.locator(sel).first().innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
}

function printLedger(entries: LedgerEntry[], start: string, end: string): void {
  log.info(`조회 기간: ${start} ~ ${end}`);
  if (entries.length === 0) {
    log.warn('조회된 내역이 없습니다');
    return;
  }
  log.success(`총 ${entries.length}건`);
  const now = new Date();
  entries.forEach((e, i) => {
    const base = `  ${i + 1}. [${e.date}] ${e.name} ${e.round} · ${e.numbers} · ${e.quantity} · ${e.result} ${e.prize ? `(${e.prize})` : ''}`;
    const countdown = isPending(e.result) ? formatDrawCountdown(e.name, now) : '';
    log.dim(`${base}${countdown}`);
  });
}

function isPending(result: string): boolean {
  return /미추첨/.test(result);
}

function getDrawWeekday(gameName: string): number | null {
  // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  if (/연금복권/.test(gameName)) return 4; // 매주 목요일
  if (/로또/.test(gameName)) return 6; // 매주 토요일
  return null; // 스피또 등 즉석복권
}

function nextDrawDate(gameName: string, now: Date): Date | null {
  const drawDay = getDrawWeekday(gameName);
  if (drawDay === null) return null;

  const target = new Date(now);
  target.setHours(20, 35, 0, 0);

  const todayDay = now.getDay();
  let daysAhead = (drawDay - todayDay + 7) % 7;
  if (daysAhead === 0 && now.getTime() > target.getTime()) {
    daysAhead = 7;
  }
  target.setDate(now.getDate() + daysAhead);
  return target;
}

function formatDrawCountdown(gameName: string, now: Date): string {
  const target = nextDrawDate(gameName, now);
  if (!target) return '';

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return ' · 추첨 진행 중';

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  const weekdayKo = ['일', '월', '화', '수', '목', '금', '토'][target.getDay()];

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (days === 0 && hours < 1) parts.push(`${minutes}분`);

  return ` · 추첨까지 ${parts.join(' ') || '곧'} (${mm}/${dd} ${weekdayKo} 20:35)`;
}
