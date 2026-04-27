import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DHL_USER_ID: z.string().min(1, 'DHL_USER_ID가 .env에 없습니다'),
  DHL_USER_PW: z.string().min(1, 'DHL_USER_PW가 .env에 없습니다'),
  HEADLESS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SLOW_MO_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`환경변수 로드 실패:\n${issues}\n\n.env.example을 참고해 .env 파일을 만들어주세요.`);
}

export const config = {
  userId: parsed.data.DHL_USER_ID,
  userPw: parsed.data.DHL_USER_PW,
  headless: parsed.data.HEADLESS ?? false,
  slowMoMs: parsed.data.SLOW_MO_MS ?? 0,
  urls: {
    main: 'https://www.dhlottery.co.kr/common.do?method=main',
    login: 'https://www.dhlottery.co.kr/login',
    lotto645Buy: 'https://ol.dhlottery.co.kr/olotto/game/game645.do',
    pensionBuy: 'https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LP72',
    myLedger: 'https://www.dhlottery.co.kr/mypage/mylotteryledger',
  },
  paths: {
    storageState: '.auth/storageState.json',
  },
} as const;
