import type { AnalysisKind } from '../api/analysis'
import type { RunDetail, SearchThresholds } from '../api/candidates'
import type { Thresholds } from '../analysis/derive'
import {
  count,
  fractionText,
  hoursText,
  type StepId,
  type WindowLike,
} from './derive'

// 단계마다의 설명 문구와 숫자. 일반 사용자가 읽는 말로 쓴다.

type Config = RunDetail['config']
type Summary = RunDetail['summary']

export interface StepContent {
  title: string
  what: string
  why: string
  numbers: { label: string; value: string }[]
}

function countText(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('ko-KR')}개`
}

function spacingText(meters: number | null): string {
  if (meters === null) return '—'
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`
}

function percentText(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`
}

/** 분석 기간의 길이. 임무 기간처럼 짧으면 일, 길면 년으로 말한다 (14일을 1년으로 올림하지 않는다). */
export function windowSpanText(window: WindowLike): string {
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(window.end) - Date.parse(window.start)) / 86_400_000,
    ),
  )
  return days < 366 ? `${days}일` : `${Math.round(days / 365.25)}년`
}

/**
 * 48시간 미만의 한도는 입력한 그대로 시간으로 보여 준다 (24시간을 "1일"로 바꾸지 않는다).
 * 그 이상은 기존처럼 일 단위로 읽기 쉽게 쓴다.
 */
function limitHours(hours: number): string {
  return hours < 48 ? `${Math.round(hours * 10) / 10}시간` : hoursText(hours)
}

/** 정해진 임계값만 문장으로. 비어 있으면 빈 배열이다. */
export function thresholdLines(thresholds: SearchThresholds): string[] {
  const lines: string[] = []
  if (thresholds.min_sun_fraction !== null)
    lines.push(`일조율 ${fractionText(thresholds.min_sun_fraction)} 이상`)
  if (thresholds.max_sun_dark_hours !== null)
    lines.push(`최장 암흑 ${limitHours(thresholds.max_sun_dark_hours)} 이하`)
  if (thresholds.min_earth_fraction !== null)
    lines.push(
      `지구 가시율 ${fractionText(thresholds.min_earth_fraction)} 이상`,
    )
  if (thresholds.max_earth_blackout_hours !== null)
    lines.push(
      `최장 통신 두절 ${limitHours(thresholds.max_earth_blackout_hours)} 이하`,
    )
  if (thresholds.max_terrain_slope_degrees != null)
    lines.push(
      `250 m 지역 경사 P95 ${thresholds.max_terrain_slope_degrees}° 이하 (DEM 표본 100%)`,
    )
  return lines
}

/** 탐색의 임계값을 분석 상세 화면의 기준 판정 형식으로 바꾼다 (정해진 것만). */
export function thresholdsFor(
  kind: AnalysisKind,
  thresholds: SearchThresholds,
): Thresholds {
  const fraction =
    kind === 'illumination'
      ? thresholds.min_sun_fraction
      : thresholds.min_earth_fraction
  const dark =
    kind === 'illumination'
      ? thresholds.max_sun_dark_hours
      : thresholds.max_earth_blackout_hours
  const result: Thresholds = {}
  if (fraction !== null) result.minVisibleFraction = fraction
  if (dark !== null) result.maxDarkHours = dark
  return result
}

export function stepContent(
  step: StepId,
  config: Config,
  summary: Summary,
): StepContent {
  const c = summary.counts
  const grid = spacingText(config.grid_spacing_m)
  const coarse = spacingText(config.coarse_spacing_m)
  const span = windowSpanText(config.window)
  const roi = `남위 ${Math.abs(config.roi.max_lat_deg)}° 이남`

  switch (step) {
    case 'coarse':
      return {
        title: '1. 거친 격자로 먼저 훑기',
        what:
          config.coarse_spacing_m === null
            ? `이 실행은 거친 단계 없이 처음부터 ${grid} 간격으로 계산했습니다. 그래서 이 단계의 지도는 비어 있습니다.`
            : `관심 구역(${roi})을 ${coarse} 간격의 성긴 점으로 먼저 훑습니다. 각 점에서 ${span} 동안 태양과 지구가 지형 수평선 위에 얼마나 떠 있는지(일조율, 지구 가시율)를 대략 계산합니다. 지도의 색이 밝을수록 높은 값입니다.`,
        why: '구역 전체를 처음부터 촘촘히 계산하면 너무 오래 걸립니다. 먼저 성기게 훑어서 어디가 유망한지 찾습니다. 지형 수평선은 한 지점에서 사방을 둘러볼 때 산이 하늘을 가리는 높이입니다.',
        numbers: [
          {
            label: '거친 격자 점',
            value: countText(count(c, 'coarse_sampled')),
          },
          { label: '점 간격', value: coarse },
          { label: '계산한 기간', value: span },
        ],
      }
    case 'refine': {
      const promoted = count(c, 'promoted_coarse')
      const sampled = count(c, 'coarse_sampled')
      return {
        title: '2. 유망한 곳만 세밀화',
        what: `조건을 통과한 거친 점은 점수(일조율과 지구 가시율의 가중 평균) 순으로, 조건 미달인 점은 한도에 가까운 순으로 검토합니다. 좁은 유망 지점을 놓치지 않도록 미달 지점도 포함해 상위 ${Math.round(config.refine_fraction * 100)}%를 고르고, 그 주변만 ${grid} 간격으로 다시 계산하기로 합니다. 지도의 주황색이 다시 계산할 영역입니다.`,
        why: '가능성이 낮은 곳에 계산 시간을 쓰지 않고, 유망한 곳에 집중해서 후보 위치를 더 정확하게 찾기 위해서입니다.',
        numbers: [
          { label: '세밀화로 고른 거친 점', value: countText(promoted) },
          {
            label: '거친 점 중 비율',
            value:
              promoted !== null && sampled !== null && sampled > 0
                ? percentText(promoted / sampled)
                : '—',
          },
          {
            label: '고르는 상위 비율',
            value: percentText(config.refine_fraction),
          },
        ],
      }
    }
    case 'fine':
      return {
        title: '3. 세밀 결과',
        what: `고른 영역을 ${grid} 간격으로 다시 계산했습니다. 세밀화하지 않은 곳은 거친 값을 그대로 남깁니다. 지도는 둘을 합친 최종 값입니다.`,
        why: '후보 위치를 수백 m 단위로 비교하려면 촘촘한 값이 필요합니다. 다만 격자가 높이 지도 해상도보다 거칠면 폭이 좁은 일조 지점을 놓칠 수 있습니다.',
        numbers: [
          {
            label: '세밀하게 계산한 점',
            value: countText(count(c, 'refined')),
          },
          {
            label: '거친 값으로 남은 점',
            value: countText(count(c, 'coarse_only')),
          },
          { label: '전체 샘플', value: countText(count(c, 'sampled_total')) },
          { label: '세밀 간격', value: grid },
        ],
      }
    case 'filter': {
      const lines = thresholdLines(config.thresholds)
      return {
        title: '4. 필수 조건으로 거르기',
        what:
          lines.length === 0
            ? '임계값이 아직 정해지지 않아 계산에 성공한 모든 점이 적격입니다. 초록이 적격, 빨강이 제외, 회색이 판정 불가입니다. 분포를 보고 임계값을 정하면 이 단계에서 걸러집니다.'
            : `다음 조건을 모두 만족하는 점만 적격입니다: ${lines.join(', ')}. 초록이 적격, 빨강이 제외, 회색이 판정 불가입니다.`,
        why: '조건은 "반드시 지켜야 하는 것"이고 점수는 "높을수록 좋은 것"이라 따로 다룹니다. 지형 경사 조건은 DEM 표본이 불완전하거나 값을 계산하지 못하면 제외합니다. 다른 결측 지표는 0으로 치지 않고 적용하지 못한 조건으로 기록합니다.',
        numbers: [
          { label: '적격', value: countText(count(c, 'eligible')) },
          { label: '제외', value: countText(count(c, 'excluded')) },
          { label: '판정 불가', value: countText(count(c, 'unevaluated')) },
          {
            label: '수평선 불완전',
            value: countText(count(c, 'horizon_incomplete')),
          },
        ],
      }
    }
    case 'regions':
      return {
        title: '5. 연결 영역 찾기',
        what: '적격한 점 중 서로 맞닿은 점(대각선 포함)을 하나의 "영역"으로 묶습니다. 지도에서 영역마다 다른 색으로 칠했습니다.',
        why: '이웃한 점들은 사실상 같은 장소입니다. 영역으로 묶어 두면 한 곳에서 비슷한 점만 잔뜩 뽑지 않고, 서로 다른 유망 지역을 고르게 담을 수 있습니다.',
        numbers: [
          { label: '연결 영역', value: countText(count(c, 'regions')) },
        ],
      }
    case 'select':
      return {
        title: '6. 서로 떨어진 대표 후보 선정',
        what: `영역마다 점수가 가장 높은 점을 먼저 하나씩 뽑고, 남는 자리는 점수 순으로 채웁니다. 이미 뽑힌 후보에서 ${spacingText(config.min_separation_m)} 이상 떨어진 점만 고르며 최대 ${config.top_k}개입니다. 번호가 순위입니다.`,
        why: '점수 상위 점들은 대부분 같은 곳에 몰려 있습니다. 최소 거리와 영역별 대표 규칙으로 지리적으로 서로 다른 유망 지역을 후보로 삼습니다.',
        numbers: [
          { label: '선정된 후보', value: countText(count(c, 'selected')) },
          { label: '최소 간격', value: spacingText(config.min_separation_m) },
          { label: '후보 수 한도(Top-K)', value: `${config.top_k}개` },
          {
            label: '점수 가중치(일조 : 지구)',
            value: `${config.weights.sun} : ${config.weights.earth}`,
          },
        ],
      }
  }
}
