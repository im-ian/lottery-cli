import { openSession } from './auth/session.js';
import { log } from './utils/log.js';
import { rmSync, existsSync } from 'node:fs';

async function main() {
  if (existsSync('.auth/storageState.json')) {
    rmSync('.auth/storageState.json');
    log.dim('기존 세션 파일 삭제 — 새로 로그인');
  }

  const session = await openSession();
  try {
    log.success('openSession 성공');
    log.info(`현재 URL: ${session.page.url()}`);
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
