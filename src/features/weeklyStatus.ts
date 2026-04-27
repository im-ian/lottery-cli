import type { Page } from 'playwright';
import { fetchLedger, type LedgerEntry } from './history.js';

export interface ProductStatus {
  purchased: boolean;
  count: number;
  lastRound: string;
  /** 이 회차 시작일 (구매 판정 boundary). YYYY-MM-DD */
  roundStart: string;
  /** 이번 회차 추첨일 (= 다음 회차 판매 시작 시점). 문자열로 포맷됨. */
  nextDrawAt: string;
}

export interface WeeklyStatus {
  lotto645: ProductStatus;
  pension720: ProductStatus;
}

const LOTTO_DRAW_DOW = 6; // 토요일 (0=일,6=토)
const PENSION_DRAW_DOW = 4; // 목요일
const LOTTO_DRAW_HOUR = 20; // 20:35 추첨 (마감 20:00)
const LOTTO_DRAW_MIN = 35;
const PENSION_DRAW_HOUR = 19; // 19:00 추첨
const PENSION_DRAW_MIN = 0;
const KOREAN_DOW = ['일', '월', '화', '수', '목', '금', '토'];

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 직전 추첨일의 다음날 자정을 반환.
 * 예: 오늘이 월요일(2026-04-27), 로또(토)면 직전 토요일=2026-04-25 → boundary=2026-04-26 00:00.
 * 추첨이 끝나서 새 회차 판매가 시작된 시점. 이 시간 이후 구매가 "현재 회차" 구매.
 */
function getRoundStartDate(today: Date, drawDow: number): Date {
  const d = new Date(today);
  const dow = d.getDay();
  const daysSinceLastDraw = (dow - drawDow + 7) % 7;
  d.setDate(d.getDate() - daysSinceLastDraw + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseEntryDate(raw: string): Date | null {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * 다음 추첨일시(= 다음 회차 판매가 시작되는 시점) 반환.
 */
function getNextDrawAt(today: Date, drawDow: number, hour: number, minute: number): Date {
  const d = new Date(today);
  const dow = d.getDay();
  let daysUntil = (drawDow - dow + 7) % 7;
  if (daysUntil === 0) {
    const drawnAlready = d.getHours() > hour || (d.getHours() === hour && d.getMinutes() >= minute);
    if (drawnAlready) daysUntil = 7;
  }
  d.setDate(d.getDate() + daysUntil);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function fmtDateTime(d: Date): string {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dow = KOREAN_DOW[d.getDay()] ?? '';
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} (${dow}) ${time}`;
}

export async function getWeeklyStatus(page: Page): Promise<WeeklyStatus> {
  const today = new Date();
  const lottoStart = getRoundStartDate(today, LOTTO_DRAW_DOW);
  const pensionStart = getRoundStartDate(today, PENSION_DRAW_DOW);
  const earliest = lottoStart.getTime() < pensionStart.getTime() ? lottoStart : pensionStart;

  const entries = await fetchLedger(page, fmt(earliest), fmt(today));

  const filterCurrentRound = (matchName: (n: string) => boolean, since: Date): LedgerEntry[] =>
    entries.filter((e) => {
      if (!matchName(e.name)) return false;
      const dt = parseEntryDate(e.date);
      return dt !== null && dt.getTime() >= since.getTime();
    });

  const lotto = filterCurrentRound((n) => /로또/.test(n), lottoStart);
  const pension = filterCurrentRound((n) => /연금/.test(n), pensionStart);

  const lottoNextDraw = getNextDrawAt(today, LOTTO_DRAW_DOW, LOTTO_DRAW_HOUR, LOTTO_DRAW_MIN);
  const pensionNextDraw = getNextDrawAt(today, PENSION_DRAW_DOW, PENSION_DRAW_HOUR, PENSION_DRAW_MIN);

  return {
    lotto645: {
      purchased: lotto.length > 0,
      count: lotto.length,
      lastRound: lotto[0]?.round ?? '',
      roundStart: fmt(lottoStart),
      nextDrawAt: fmtDateTime(lottoNextDraw),
    },
    pension720: {
      purchased: pension.length > 0,
      count: pension.length,
      lastRound: pension[0]?.round ?? '',
      roundStart: fmt(pensionStart),
      nextDrawAt: fmtDateTime(pensionNextDraw),
    },
  };
}
