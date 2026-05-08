import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { log } from '../utils/log.js';

/**
 * OS 기본 브라우저에서 동행복권 메인 페이지를 연다.
 * playwright 자동화 세션과 분리되어 있어 사용자가 자유롭게 탐색 가능.
 */
export async function runOpenSite(): Promise<void> {
  const url = config.urls.main;
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  const args = platform === 'win32' ? ['', url] : [url];

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      shell: platform === 'win32',
    });
    child.unref();
    log.success(`브라우저에서 동행복권 사이트를 열었습니다: ${url}`);
  } catch (err) {
    log.error(`브라우저 실행 실패: ${err instanceof Error ? err.message : String(err)}`);
    log.dim(`수동 접속: ${url}`);
  }
}
