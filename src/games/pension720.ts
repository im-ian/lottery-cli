import type { Page, FrameLocator, Dialog } from 'playwright';
import { config } from '../config.js';
import { log } from '../utils/log.js';

export interface PensionPurchaseRequest {
  mode: 'auto' | 'manual';
  games: { group: 'all' | number; digits: string }[];
  gameCount: number;
  dryRun: boolean;
}

export interface PensionPurchaseResult {
  ok: boolean;
  message: string;
}

export async function purchasePension(page: Page, req: PensionPurchaseRequest): Promise<PensionPurchaseResult> {
  log.step('연금복권 구매 페이지 진입');
  await page.goto(config.urls.pensionBuy, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const frame = page.frameLocator('#ifrm_tab');
  try {
    await frame.locator('.lotto720_btn_auto_number').first().waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    return { ok: false, message: '연금복권 게임 프레임 로드 실패 (판매 마감 혹은 사이트 변경)' };
  }

  for (let i = 0; i < req.games.length; i++) {
    const g = req.games[i]!;
    log.step(`게임 ${i + 1} 등록: ${g.group === 'all' ? '모든 조' : `${g.group}조`} / ${req.mode === 'auto' ? '자동' : g.digits}`);
    await waitForLoadingDone(frame);
    await selectGroup(frame, g.group);
    if (req.mode === 'auto') {
      await frame.locator('.lotto720_btn_auto_number').first().click();
    } else {
      await enterDigits(frame, g.digits);
    }
    await frame.locator('.lotto720_btn_confirm_number').first().click();
    await waitForLoadingDone(frame);
    await dismissRecommendPopup(frame);
  }

  await waitForLoadingDone(frame);
  await dismissRecommendPopup(frame);
  return await clickBuyWithDialogs(page, frame, req.dryRun);
}

async function waitForLoadingDone(frame: FrameLocator): Promise<void> {
  const loading = frame.locator('#ajax_loading');
  try {
    await loading.waitFor({ state: 'hidden', timeout: 10000 });
  } catch {
    // 로딩 엘리먼트가 없거나 이미 숨겨진 경우
  }
}

async function dismissRecommendPopup(frame: FrameLocator): Promise<void> {
  const popup = frame.locator('#lotto720_popup_recomand');
  if ((await popup.count()) > 0 && (await popup.isVisible().catch(() => false))) {
    log.dim('    추천 팝업 감지 → 닫기');
    const closeBtn = popup.locator('.lotto720_popup_btn_close, .lotto720_popup_bottom_btn_close').first();
    if ((await closeBtn.count()) > 0) {
      await closeBtn.click({ force: true }).catch(() => {});
    } else {
      await frame.locator('body').evaluate(() => {
        const el = document.querySelector<HTMLElement>('#lotto720_popup_recomand');
        if (el) el.style.display = 'none';
      }).catch(() => {});
    }
    await frame.locator('#lotto720_popup_recomand').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
}

async function selectGroup(frame: FrameLocator, group: 'all' | number): Promise<void> {
  // 동행복권 내부 코드가 쓰는 방식 그대로: $($(".jogroup")[index]).click()
  // index 0 = 모든조, 1~5 = 1조~5조. 이 click 핸들러가 #classnum + #set_type을 업데이트함.
  const index = group === 'all' ? 0 : group;

  const state = await frame
    .locator('body')
    .first()
    .evaluate((_, idx) => {
      interface JQElement {
        click: () => unknown;
      }
      interface JQFn {
        (sel: string | HTMLElement): JQElement & { [k: number]: HTMLElement };
      }
      const w = window as unknown as { $?: JQFn; jQuery?: JQFn };
      const $ = w.$ ?? w.jQuery;
      if ($) {
        const groups = $('.jogroup');
        const target = groups[idx];
        if (target) $(target).click();
      } else {
        const groups = document.querySelectorAll<HTMLElement>('.jogroup');
        groups[idx]?.click();
      }
      return {
        classnum: (document.querySelector<HTMLInputElement>('#classnum')?.value ?? ''),
        setType: (document.querySelector<HTMLInputElement>('#set_type')?.value ?? ''),
      };
    }, index)
    .catch(() => ({ classnum: '', setType: '' }));

  const expected = group === 'all' ? { classnum: '', setType: 'SA' } : { classnum: String(group), setType: 'S' };
  if (state.classnum !== expected.classnum || state.setType !== expected.setType) {
    log.warn(
      `    조 선택 반영 실패: 기대 classnum=${expected.classnum} set_type=${expected.setType} / 실제 classnum=${state.classnum} set_type=${state.setType}`,
    );
  } else {
    log.dim(`    선택 반영: classnum=${state.classnum || '(empty=모든조)'} set_type=${state.setType}`);
  }
}

async function enterDigits(frame: FrameLocator, digits: string): Promise<void> {
  if (!/^\d{6}$/.test(digits)) throw new Error(`잘못된 6자리 번호: ${digits}`);

  // 동행복권 내부 로직과 동일한 방식으로 jQuery click.
  // digit → numsgroup 인덱스 매핑: 1→0, 2→1, ..., 9→8, 0→9
  const resultDigits = await frame
    .locator('body')
    .first()
    .evaluate((_, d) => {
      interface JQElement {
        click: () => unknown;
      }
      interface JQFn {
        (sel: string | HTMLElement): JQElement & { [k: number]: HTMLElement };
      }
      const w = window as unknown as { $?: JQFn; jQuery?: JQFn };
      const $ = w.$ ?? w.jQuery;
      if (!$) return { filled: '', error: 'jQuery 미탐지' };

      const numsgroup = $('.numsgroup');
      for (let j = 0; j < 6; j++) {
        const ch = d[j];
        if (ch === undefined) continue;
        const digit = parseInt(ch, 10);
        const idx = digit === 0 ? 9 : digit - 1;
        const target = numsgroup[idx];
        if (target) $(target).click();
      }

      const filled = Array.from({ length: 6 }, (_, i) =>
        (document.querySelector<HTMLInputElement>(`#num${i + 1}`)?.value ?? ''),
      ).join('');
      return { filled, error: '' };
    }, digits)
    .catch((err) => ({ filled: '', error: String(err) }));

  if (resultDigits.error) {
    log.warn(`    숫자 입력 문제: ${resultDigits.error}`);
  } else if (resultDigits.filled !== digits) {
    log.warn(`    숫자 입력 결과 불일치: 기대 ${digits} / 실제 ${resultDigits.filled || '(없음)'}`);
  } else {
    log.dim(`    숫자 입력 확인: ${resultDigits.filled}`);
  }
}

async function clickBuyWithDialogs(page: Page, frame: FrameLocator, dryRun: boolean): Promise<PensionPurchaseResult> {
  const dialogs: { type: string; message: string }[] = [];

  const handler = async (dialog: Dialog) => {
    const t = dialog.type();
    const m = dialog.message();
    dialogs.push({ type: t, message: m });
    log.info(`[dialog] ${t}: ${m.replace(/\n/g, ' ')}`);

    if (t === 'confirm') {
      // 1단계 confirm: 모든조 구매 권유 dialog. dryRun이어도 일단 accept해야 in-frame popup까지 볼 수 있음.
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  };

  const depositBefore = await readPensionDeposit(frame);
  log.info(`구매 전 예치금: ${depositBefore.toLocaleString()}원`);

  page.on('dialog', handler);
  try {
    log.step('구매하기 클릭 → native confirm');
    await frame.locator('.lotto720_btn_pay').first().click();
    await page.waitForTimeout(1500);
  } finally {
    page.off('dialog', handler);
  }

  const alertDialog = dialogs.find((d) => d.type === 'alert');
  if (alertDialog && /예치금/.test(alertDialog.message)) {
    return { ok: false, message: `예치금 부족: ${alertDialog.message.replace(/\n/g, ' ')}` };
  }

  const confirmPopup = frame.locator('#lotto720_popup_confirm');
  await confirmPopup.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const popupVisible = await confirmPopup.isVisible().catch(() => false);

  if (!popupVisible) {
    if (alertDialog) {
      return { ok: false, message: `alert: ${alertDialog.message.replace(/\n/g, ' ')}` };
    }
    return { ok: false, message: '구매 확인 팝업이 나타나지 않음' };
  }

  const cartSummary = (await frame.locator('.lotto720_popup_confirm_list').innerText().catch(() => '')).trim();
  log.info(`장바구니 확인: ${cartSummary.replace(/\s+/g, ' ').slice(0, 200)}`);

  if (dryRun) {
    log.warn('DRY_RUN: "구매 요청 번호" 팝업 취소');
    await frame.locator('#lotto720_popup_confirm .lotto720_popup_bottom_btn_close').first().click().catch(() => {});
    return { ok: true, message: `DRY_RUN 완료 (장바구니: ${cartSummary.replace(/\s+/g, ' ').slice(0, 200)})` };
  }

  log.step('doOrderRequest 호출 (실제 결제)');
  await frame.locator('#lotto720_popup_confirm a[onclick*="doOrderRequest"]').first().click();

  const payPopup = frame.locator('#lotto720_popup_pay');
  const paid = await payPopup
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (paid) {
    const orderNo = (await frame.locator('#lotto720_popup_pay .orderNo').innerText().catch(() => '')).trim();
    const orderDate = (await frame.locator('#lotto720_popup_pay .orderDate').innerText().catch(() => '')).trim();
    const depositAfter = await readPensionDeposit(frame);
    const deducted = depositBefore - depositAfter;
    return {
      ok: true,
      message: `구매 완료 (${deducted > 0 ? `차감 ${deducted.toLocaleString()}원, ` : ''}잔액 ${depositAfter.toLocaleString()}원)${orderNo ? ` · 거래번호 ${orderNo}` : ''}${orderDate ? ` · ${orderDate}` : ''}`,
    };
  }

  await page.waitForTimeout(2000);
  const depositAfter = await readPensionDeposit(frame);
  const deducted = depositBefore - depositAfter;
  if (deducted > 0) {
    return {
      ok: true,
      message: `구매 완료 (예치금 차감 ${deducted.toLocaleString()}원, 잔액 ${depositAfter.toLocaleString()}원). 상세 내역은 "구매내역 조회"에서 확인하세요.`,
    };
  }

  const lateAlert = dialogs.slice(1).find((d) => d.type === 'alert');
  if (lateAlert) {
    return { ok: false, message: `alert: ${lateAlert.message.replace(/\n/g, ' ')}` };
  }

  return {
    ok: false,
    message: '결제 완료 팝업이 뜨지 않았고 잔액 변동도 없음. "구매내역 조회"로 직접 확인해주세요.',
  };
}

async function readPensionDeposit(frame: FrameLocator): Promise<number> {
  const text = await frame.locator('body').innerText().catch(() => '');
  const m = text.match(/보유중인\s*예치금\s*([\d,]+)\s*원/);
  if (!m || !m[1]) return 0;
  return Number(m[1].replace(/,/g, ''));
}
