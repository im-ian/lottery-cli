import type { Page } from 'playwright';
import { config } from '../config.js';

/**
 * 실시간 예치금 조회.
 *
 * 메인 페이지의 헤더 "예치금" 표시는 충전 서비스 점검/캐시 등의 이유로
 * 실제 잔액과 다를 수 있음. 로또 구매 페이지의 "보유 예치금" 필드가
 * 결제 API 기준 실제 사용 가능 잔액이라 이 값을 권위있는 출처로 사용.
 *
 * 매번 buy 페이지를 새로 로드해 DOM 캐시를 우회한다. (이전엔 이미 buy 페이지면
 * navigation을 스킵해서 구매 직후 stale 값이 그대로 표시되는 문제가 있었음.)
 */
export async function getDeposit(page: Page): Promise<number> {
  await page.goto(config.urls.lotto645Buy, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(500);

  const text = await page.locator('body').first().innerText().catch(() => '');
  // "보유예치금\n15,000\n원" 또는 "보유예치금 15,000원"
  const match = text.match(/보유\s*예치금\s*([\d,]+)\s*원/);
  const deposit = match?.[1] ? Number(match[1].replace(/,/g, '')) : NaN;

  return Number.isNaN(deposit) ? 0 : deposit;
}
