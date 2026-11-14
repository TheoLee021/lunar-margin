import type { AnalysisKind } from '../api/analysis'

// 종류별 화면 문구와 색. 용어 설명은 일반 사용자 기준으로 쓴다.
export interface KindCopy {
  tab: string
  body: string
  bodyShort: string
  fractionLabel: string
  fractionHint: string
  darkLabel: string
  darkHint: string
  thirdLabel: string
  thirdHint: string
  windowLabel: string
  darkPeriodLabel: string
  /** 기준 판정 문구용 짧은 용어 */
  fractionWord: string
  darkWord: string
  /** 시계열·궤적 선 색 (Tailwind stroke/fill/text 클래스) */
  stroke: string
  fill: string
  bg: string
  text: string
  badge: string
}

export const KIND_COPY: Record<AnalysisKind, KindCopy> = {
  illumination: {
    tab: '태양 일조',
    body: '태양',
    bodyShort: '일조',
    fractionLabel: '평균 일조율',
    fractionHint:
      '분석 기간 중 태양이 지형 수평선 위에 떠 있어 햇빛을 받은 시간의 비율입니다. 높을수록 태양광 발전에 유리합니다.',
    darkLabel: '최장 연속 암흑 시간',
    darkHint:
      '햇빛이 한 번도 들지 않고 이어진 가장 긴 시간입니다. 길수록 배터리·보온 부담이 커집니다.',
    thirdLabel: '24시간당 일조 창 횟수',
    thirdHint:
      '태양이 수평선 위로 떠오르는 "일조 창"이 하루 평균 몇 번 열리는지입니다. 0에 가까우면 햇빛이 드물다는 뜻입니다.',
    windowLabel: '일조 창',
    darkPeriodLabel: '암흑 구간',
    fractionWord: '일조율',
    darkWord: '최장 연속 암흑',
    stroke: 'stroke-amber-400',
    fill: 'fill-amber-400',
    bg: 'bg-amber-400',
    text: 'text-amber-300',
    badge: 'bg-amber-400/15 text-amber-300',
  },
  'earth-visibility': {
    tab: '지구 가시성',
    body: '지구',
    bodyShort: '통신',
    fractionLabel: '평균 지구 가시율',
    fractionHint:
      '분석 기간 중 지구가 지형 수평선 위에 보여 직접 통신이 가능한 시간의 비율입니다.',
    darkLabel: '최장 통신 두절 시간',
    darkHint:
      '지구가 지형에 가려 연결이 끊긴 채 이어진 가장 긴 시간입니다. 길수록 자율 운용 기간이 길어집니다.',
    thirdLabel: '지구 고도각',
    thirdHint:
      '지구가 보이는 동안 수평선에서 올려다본 평균 각도입니다. 클수록 지형에 가릴 여유가 큽니다.',
    windowLabel: '통신 가능 구간',
    darkPeriodLabel: '통신 두절 구간',
    fractionWord: '지구 가시율',
    darkWord: '최장 통신 두절',
    stroke: 'stroke-sky-400',
    fill: 'fill-sky-400',
    bg: 'bg-sky-400',
    text: 'text-sky-300',
    badge: 'bg-sky-400/15 text-sky-300',
  },
}

export interface Preset {
  name: string
  lat: number
  lon: number
}

// 예시 좌표이며 확정된 착륙 후보지가 아니다. 2027-01 한 달 기준 값은 api/README.md 참고.
export const PRESETS: readonly Preset[] = [
  { name: 'Connecting Ridge 부근 (일조·통신 양호)', lat: -89.5, lon: 222 },
  { name: 'Malapert 산 부근 (고지대)', lat: -86, lon: 0 },
  { name: '극점 부근 고지대', lat: -89.8, lon: 210 },
  { name: 'Shackleton 크레이터 안쪽 (영구 음영 예시)', lat: -89.7, lon: 130 },
]
