import type { Analysis, AnalysisKind } from '../api/analysis'

export interface Pinned {
  id: string
  kind: AnalysisKind
  data: Analysis
}

/** 같은 조건의 분석은 같은 id 를 가져 중복으로 추가되지 않는다. */
export function pinId(kind: AnalysisKind, data: Analysis): string {
  return [
    kind,
    data.lat,
    data.lon,
    data.start,
    data.end,
    data.step_minutes,
    data.observer_height_m,
  ].join('|')
}
