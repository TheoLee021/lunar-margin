// SVG 경로 문자열 헬퍼. 좌표는 소수 첫째 자리로 줄여 DOM 크기를 아낀다.

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function linePath(
  points: readonly (readonly [number, number])[],
): string {
  let d = ''
  for (const [index, point] of points.entries()) {
    d += `${index === 0 ? 'M' : 'L'}${round1(point[0])} ${round1(point[1])}`
  }
  return d
}

/** 값을 [domainMin, domainMax] → [rangeMin, rangeMax] 로 선형 변환한다. */
export function scale(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2
  return (
    rangeMin +
    ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin)
  )
}
