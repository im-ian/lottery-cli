export function randomLottoNumbers(): number[] {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, 6).sort((a, b) => a - b);
}

export function validateLottoNumbers(input: number[]): string | true {
  if (input.length !== 6) return '번호는 정확히 6개여야 합니다';
  if (new Set(input).size !== 6) return '중복된 번호가 있습니다';
  for (const n of input) {
    if (!Number.isInteger(n) || n < 1 || n > 45) return `${n}은(는) 1~45 범위를 벗어납니다`;
  }
  return true;
}

export function parseLottoNumbers(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => Number(s));
}

export function randomPensionNumbers(): { group: number; digits: string } {
  const group = Math.floor(Math.random() * 5) + 1;
  let digits = '';
  for (let i = 0; i < 6; i++) digits += Math.floor(Math.random() * 10);
  return { group, digits };
}

export function validatePensionDigits(input: string): string | true {
  if (!/^\d{6}$/.test(input)) return '6자리 숫자를 입력해주세요';
  return true;
}
