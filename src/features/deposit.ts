import type { Page } from 'playwright';
import { config } from '../config.js';

/**
 * 실시간 예치금 조회.
 *
 * 메인 페이지의 헤더 "예치금" 표시는 충전 서비스 점검/캐시 등의 이유로
 * 실제 잔액과 다를 수 있음. 로또 구매 페이지의 "보유 예치금" 필드가
 * 결제 API 기준 실제 사용 가능 잔액이라 이 값을 권위있는 출처로 사용.
 */
export async function getDeposit(page: Page): Promise<number> {
  const url = page.url();
  if (!url.includes('ol.dhlottery.co.kr') || !url.includes('game645')) {
    await page.goto(config.urls.lotto645Buy, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);
  }

  const deposit = await page
    .locator('body')
    .first()
    .evaluate(() => {
      const text = document.body.innerText || '';
      // "보유예치금\n15,000\n원" 또는 "보유예치금 15,000원"
      const m = text.match(/보유\s*예치금\s*([\d,]+)\s*원/);
      if (m && m[1]) return Number(m[1].replace(/,/g, ''));
      return NaN;
    })
    .catch(() => NaN);

  return Number.isNaN(deposit) ? 0 : deposit;
}
