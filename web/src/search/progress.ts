import type { RunState } from '../api/candidates'

// 탐색 진행 표시에 쓰는 순수 함수. 상태 파일(GET /candidates/runs/{id}/status)의
// stage / done / total 은 "그 단계 안에서" 센 값이라, 전체 진행률을 만들어 내지 않는다.

export const POLL_INTERVAL_MS = 2000
export const MAX_POLL_FAILURES = 3

export interface ProgressStage {
  id: 'queued' | 'coarse' | 'fine' | 'writing' | 'done'
  label: string
  text: string
}

export const PROGRESS_STAGES: readonly ProgressStage[] = [
  {
    id: 'queued',
    label: '대기',
    text: '탐색을 시작할 준비를 하고 있습니다. 계산 프로세스가 뜨는 데 몇 초가 걸립니다.',
  },
  {
    id: 'coarse',
    label: '거친 격자 계산',
    text: '관심 구역을 성긴 간격의 점으로 먼저 훑어서 어디가 유망한지 찾고 있습니다.',
  },
  {
    id: 'fine',
    label: '세밀 격자 계산',
    text: '유망한 곳만 촘촘한 점으로 다시 계산하고 있습니다. 가장 오래 걸리는 단계입니다.',
  },
  {
    id: 'writing',
    label: '결과 저장',
    text: '조건으로 거르고, 영역을 묶고, 후보를 뽑은 뒤 지도 이미지와 결과 파일을 저장하고 있습니다.',
  },
  {
    id: 'done',
    label: '완료',
    text: '탐색이 끝났습니다. 곧 결과를 보여 드립니다.',
  },
]

const STAGE_INDEX: Readonly<Record<string, number>> = {
  queued: 0,
  starting: 0,
  coarse: 1,
  fine: 2,
  writing: 3,
  done: 4,
}

/** 지금 몇 번째 단계인가. 끝난 실행은 항상 마지막, 모르는 단계 이름은 처음으로 본다. */
export function stageIndex(stage: string, state: RunState): number {
  if (state === 'done') return 4
  return STAGE_INDEX[stage] ?? 0
}

/** 현재 단계 안에서 몇 %인가. 전체 개수를 아직 모르면 null (없는 값을 지어내지 않는다). */
export function stagePercent(done: number, total: number): number | null {
  if (!(total > 0)) return null
  return Math.round(Math.min(Math.max(done / total, 0), 1) * 100)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total}초`
  if (total < 3600) return `${Math.floor(total / 60)}분 ${pad2(total % 60)}초`
  return `${Math.floor(total / 3600)}시간 ${pad2(Math.floor((total % 3600) / 60))}분`
}

/** 서버가 알려 준 시작 시각이 있으면 그것으로, 없으면 화면이 따라가기 시작한 시각으로 센다. */
export function elapsedSeconds(
  startedAtIso: string | null,
  fallbackStartMs: number,
  nowMs: number,
): number {
  const parsed = startedAtIso === null ? Number.NaN : Date.parse(startedAtIso)
  const start = Number.isNaN(parsed) ? fallbackStartMs : parsed
  return Math.max(0, Math.floor((nowMs - start) / 1000))
}

/** 연속 실패 횟수. 한 번 성공하면 0 으로 돌아간다. */
export function pollFailureCount(previous: number, ok: boolean): number {
  return ok ? 0 : previous + 1
}

export function shouldGiveUp(failures: number): boolean {
  return failures >= MAX_POLL_FAILURES
}

export function isTerminal(state: RunState): boolean {
  return state === 'done' || state === 'failed'
}
