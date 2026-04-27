import { log } from '../utils/log.js';

export async function runSpeettoPurchase(): Promise<void> {
  log.warn('스피또는 온라인 구매를 지원하지 않습니다.');
  log.dim('  · 동행복권 사이트는 "스피또 소개" 페이지만 제공');
  log.dim('  · 스피또 1000/2000/500은 가까운 복권 판매점에서 오프라인 구매 가능');
  log.dim('  · 전자복권(스피드키노, 메가빙고 등)은 게임 내 입찰 방식으로 CLI 자동화 범위를 벗어남');
  log.dim('  · 참고: https://www.dhlottery.co.kr/wnprchsplcsrch/home 에서 판매점 조회');
}
