import { useEffect, useState } from 'react'
import { fetchRunStatus, startSearch, type RunStatus } from '../api/candidates'
import {
  DEFAULT_MISSION_VALUES,
  parseMissionForm,
  windowPreviewText,
  type MissionFormValues,
} from './mission'
import {
  POLL_INTERVAL_MS,
  MAX_POLL_FAILURES,
  PROGRESS_STAGES,
  stageIndex,
  stagePercent,
  formatElapsed,
  elapsedSeconds,
} from './progress'

export function MissionForm({
  initialValues = DEFAULT_MISSION_VALUES,
  onComplete,
}: {
  initialValues?: MissionFormValues
  onComplete: (id: string) => void
}) {
  const [development, setDevelopment] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [values, setValues] = useState(initialValues)
  const [messages, setMessages] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [pollAttempt, setPollAttempt] = useState(0)
  const [pollError, setPollError] = useState<string | null>(null)
  const active =
    runId !== null && status?.state !== 'failed' && status?.state !== 'done'

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  useEffect(() => {
    if (runId === null) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    async function poll() {
      try {
        const next = await fetchRunStatus(runId!, { signal: controller.signal })
        if (controller.signal.aborted) return
        failures = 0
        setPollError(null)
        setStatus(next)
        if (next.state === 'done') {
          onComplete(next.run_id)
          return
        }
        if (next.state === 'failed') return
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        failures += 1
        if (failures >= MAX_POLL_FAILURES) {
          setPollError(error instanceof Error ? error.message : String(error))
          return
        }
      }
      timer = setTimeout(() => {
        void poll()
      }, POLL_INTERVAL_MS)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [runId, pollAttempt, onComplete])

  function update<K extends keyof MissionFormValues>(
    key: K,
    value: MissionFormValues[K],
  ) {
    setValues((previous) => ({ ...previous, [key]: value }))
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseMissionForm(values)
    if (!parsed.ok) {
      setMessages(Object.values(parsed.errors))
      return
    }
    setMessages([])
    setSubmitting(true)
    try {
      const outcome = await startSearch(parsed.request, { development })
      if (outcome.kind === 'invalid') setMessages(outcome.messages)
      else if (outcome.kind === 'busy') {
        setMessages([
          '다른 탐색이 진행 중입니다. 진행 상황을 표시합니다. 완료 후 입력한 조건으로 다시 실행하세요.',
        ])
        setPollError(null)
        setPollAttempt((value) => value + 1)
        setStatus(null)
        setRunId(outcome.runningRunId)
      } else if (outcome.search.state === 'done') {
        setRunId(null)
        setStatus(null)
        setPollError(null)
        onComplete(outcome.search.run_id)
      } else {
        setPollError(null)
        setPollAttempt((value) => value + 1)
        setStatus(null)
        setRunId(outcome.search.run_id)
      }
    } catch (error: unknown) {
      setMessages([error instanceof Error ? error.message : String(error)])
    } finally {
      setSubmitting(false)
    }
  }
  const fields = [
    ['landingDate', '착륙 날짜 (UTC)', 'date'],
    ['durationDays', '임무 기간 (일)', 'number'],
    ['maxDarknessHours', '최대 연속 암흑 (시간)', 'number'],
    ['maxBlackoutHours', '최대 통신 두절 (시간)', 'number'],
  ] as const
  const index = stageIndex(status?.stage ?? 'queued', status?.state ?? 'queued')
  const percent = status ? stagePercent(status.done, status.total) : null
  const inputClass =
    'rounded-md border border-white/15 bg-[#080c0f] px-3 py-2 text-sm text-neutral-100'
  return (
    <section
      className="rounded-xl border border-white/15 bg-[#0f1217]/60 p-5"
      aria-label="임무 조건 입력"
    >
      <h2 className="text-lg font-semibold">임무 조건으로 후보지 찾기</h2>
      <p className="mt-2 text-sm text-neutral-400">
        착륙일부터 임무 종료까지의 일조와 명목 RF 통신을 평가합니다. 지구
        가시성은 지형 LOS 조건으로 사용합니다. 날짜를 추천하는 기능은 아닙니다.
      </p>
      <details className="mt-3 text-xs text-neutral-400">
        <summary className="cursor-pointer">
          RF 기준 조건 · 23.17 GHz / 1 W / 230 kbps / 목표 마진 3 dB
        </summary>
        <p className="mt-2">
          송신·수신 이득 33.2 / 71.1 dBi · 총 손실 1.3 dB · 잡음온도 512 K ·
          구현 손실 3 dB · QPSK 1/4 (Es/N0 −2.35 dB, 효율 0.490243). 실제
          지상국·운용 일정·대기·멀티패스는 반영하지 않습니다.
        </p>
        <p className="mt-2">
          통신 점수 = (RF 가능 비율 + 1 − 최장 두절 / 임무 시간) / 2. 일조와
          통신은 선택한 우선순위로 가중 평균합니다.
        </p>
        <label className="mt-3 flex max-w-xs flex-col gap-1 text-xs text-neutral-300">
          최소 RF 통신 가능 비율 (%)
          <input
            className={inputClass}
            disabled={submitting || active}
            type="number"
            min="0"
            max="100"
            step="any"
            value={values.minCommunicationPercent ?? ''}
            onChange={(event) =>
              update('minCommunicationPercent', event.target.value)
            }
            placeholder="비우면 조건 없음"
          />
        </label>
      </details>
      <label className="mt-4 flex items-center gap-2 text-sm text-cyan-200">
        <input
          type="checkbox"
          checked={development}
          disabled={submitting || active}
          onChange={(event) => setDevelopment(event.target.checked)}
        />
        개발용 빠른 탐색 (20 km → 10 km)
      </label>
      {development ? (
        <p className="mt-2 text-xs text-amber-300">
          동일한 남극 영역을 훨씬 성기게 계산합니다. 좁은 유망 지점을 놓칠 수
          있어 화면·API 동작 확인용으로 사용하세요.
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="mt-4 flex flex-col gap-4"
      >
        <fieldset
          disabled={submitting || active}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 disabled:opacity-60"
        >
          {fields.map(([key, label, type]) => (
            <label
              key={key}
              className="flex flex-col gap-1 text-xs text-neutral-300"
            >
              {label}
              <input
                className={inputClass}
                type={type}
                step={type === 'number' ? 'any' : undefined}
                value={values[key]}
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            최적화 우선순위
            <select
              className={inputClass}
              value={values.priority}
              onChange={(event) => {
                const value = event.target.value
                if (
                  value === 'balanced' ||
                  value === 'solar' ||
                  value === 'earth'
                )
                  update('priority', value)
              }}
            >
              <option value="balanced">균형</option>
              <option value="solar">일조 우선</option>
              <option value="earth">RF 통신 우선</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-xs text-neutral-300">
            <label>
              <input
                type="checkbox"
                checked={values.slopeEnabled}
                onChange={(event) =>
                  update('slopeEnabled', event.target.checked)
                }
              />{' '}
              최대 지형 경사 (도)
            </label>
            <input
              aria-label="최대 지형 경사"
              className={inputClass}
              disabled={!values.slopeEnabled}
              type="number"
              step="any"
              value={values.slopeDegrees}
              onChange={(event) => update('slopeDegrees', event.target.value)}
            />
            <span className="text-amber-300">
              250 m 반경의 DEM 경사 P95에 적용합니다. 지형 자료가 불완전한
              지점은 제외합니다. 착륙 안전 인증은 아닙니다.
            </span>
          </div>
          <label className="flex flex-col gap-2 text-xs text-neutral-300">
            최대 지역 거칠기 (m)
            <input
              aria-label="최대 지역 거칠기"
              className={inputClass}
              type="number"
              min="0"
              step="any"
              value={values.maxRoughnessM ?? ''}
              onChange={(event) => update('maxRoughnessM', event.target.value)}
            />
            <span>
              250 m 지역의 거칠기 P95 · 400 m 창에서 전체 기울기를 제거한
              RMS입니다. 비우면 거칠기로 필터링하지 않습니다.
            </span>
          </label>
          <div className="flex flex-col gap-2 text-xs text-neutral-300">
            <label>
              <input
                type="checkbox"
                checked={values.observerEnabled}
                onChange={(event) =>
                  update('observerEnabled', event.target.checked)
                }
              />{' '}
              관측·장비 높이 (m)
            </label>
            <input
              aria-label="관측·장비 높이"
              className={inputClass}
              disabled={!values.observerEnabled}
              type="number"
              step="any"
              value={values.observerHeightM}
              onChange={(event) =>
                update('observerHeightM', event.target.value)
              }
            />
            <span>미지정 시 지표면 (0 m)</span>
          </div>
        </fieldset>
        <p className="text-xs text-neutral-400">
          분석 기간:{' '}
          {windowPreviewText(values.landingDate, Number(values.durationDays)) ??
            '날짜와 기간을 입력하세요.'}{' '}
          · 시간 한도를 비우면 해당 조건을 적용하지 않습니다.
        </p>
        {messages.length > 0 ? (
          <ul role="alert" className="text-sm text-amber-300">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        <button
          disabled={submitting || active}
          className="self-start rounded-md bg-cyan-300 px-5 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50"
        >
          {submitting
            ? '탐색 요청 중…'
            : active
              ? '탐색 진행 중…'
              : '후보지 탐색 실행'}
        </button>
      </form>
      {runId !== null ? (
        <div
          className="mt-4 space-y-2 rounded-lg border border-white/15 p-4"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm">
            실행 {runId} ·{' '}
            {status?.state === 'failed'
              ? '실패'
              : PROGRESS_STAGES[index]?.label}
          </p>
          <p className="text-xs text-neutral-400">
            {PROGRESS_STAGES[index]?.text}
          </p>
          {status &&
          (status.started_at !== null || status.elapsed_seconds !== null) ? (
            <p className="text-sm text-cyan-200">
              {active ? '경과 시간' : '총 소요 시간'}:{' '}
              {active && status.started_at !== null
                ? formatElapsed(elapsedSeconds(status.started_at, now, now))
                : status.elapsed_seconds !== null
                  ? formatElapsed(status.elapsed_seconds)
                  : '기록 없음'}
            </p>
          ) : null}
          {status?.completed_at ? (
            <p className="text-xs text-neutral-400">
              완료 시각: {status.completed_at}
            </p>
          ) : null}
          {percent !== null ? (
            <>
              <progress className="w-full" max={100} value={percent} />
              <p className="text-xs">
                현재 단계 {status?.done.toLocaleString()} /{' '}
                {status?.total.toLocaleString()} ({percent}%)
              </p>
            </>
          ) : null}
          {status?.state === 'failed' ? (
            <p role="alert" className="text-red-300">
              {status.error ?? '탐색에 실패했습니다. 다시 실행하세요.'}
            </p>
          ) : null}
          {pollError !== null ? (
            <div role="alert">
              <p>진행 상태를 확인할 수 없습니다: {pollError}</p>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setPollError(null)
                  setPollAttempt((value) => value + 1)
                }}
              >
                진행 상태 다시 확인
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
