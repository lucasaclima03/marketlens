export const NUMERIC_SCALE = 2;

export function roundToScale(value: number, scale: number = NUMERIC_SCALE): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}
