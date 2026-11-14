import { useEffect, useState } from 'react'
import { fetchHealth } from './api/client'
import type { AnalysisKind, AnalysisParams } from './api/analysis'
import { AnalysisForm } from './analysis/AnalysisForm'
import { ComparePanel } from './analysis/ComparePanel'
import { pinId, type Pinned } from './analysis/pins'
import {
  parseForm,
  parseThresholds,
  type FormErrors,
  type FormValues,
  type ThresholdInputs,
} from './analysis/derive'
import { ResultView } from './analysis/ResultView'
import { useAnalysis } from './analysis/useAnalysis'

type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

type Tab = 'result' | 'compare'

const MAX_PINS = 3

const INITIAL_VALUES: FormValues = {
  lat: '-89.7',
  lon: '130',
  start: '2027-01-01T00:00',
  end: '2027-02-01T00:00',
  stepMinutes: '30',
  observerHeightM: '0',
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  const [kind, setKind] = useState<AnalysisKind>('illumination')
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES)
  const [errors, setErrors] = useState<FormErrors>({})
  const [thresholdInputs, setThresholdInputs] = useState<ThresholdInputs>({
    minVisiblePercent: '',
    maxDarkHours: '',
  })
  const [tab, setTab] = useState<Tab>('result')
  const [pins, setPins] = useState<readonly Pinned[]>([])
  const [lastRequest, setLastRequest] = useState<{
    kind: AnalysisKind
    params: AnalysisParams
  } | null>(null)
  const { state, run } = useAnalysis()

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth({ signal: controller.signal })
      .then(() => setHealth({ kind: 'ok' }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setHealth({ kind: 'error', message })
      })
    return () => controller.abort()
  }, [])

  const { thresholds, errors: thresholdErrors } =
    parseThresholds(thresholdInputs)

  function submit() {
    const parsed = parseForm(values)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setLastRequest({ kind, params: parsed.params })
    setTab('result')
    run(kind, parsed.params)
  }

  function pinCurrent() {
    if (state.status !== 'ok') return
    const id = pinId(state.kind, state.data)
    setPins((current) =>
      current.length >= MAX_PINS || current.some((pin) => pin.id === id)
        ? current
        : [...current, { id, kind: state.kind, data: state.data }],
    )
  }

  const currentPinId =
    state.status === 'ok' ? pinId(state.kind, state.data) : null

  return (
    <div className="min-h-svh bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-800 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Lunar Margin</h1>
          <span className="text-sm text-neutral-400">
            달 남극 일조·지구 가시성 분석
          </span>
        </div>
        <p data-testid="api-status" className="text-xs text-neutral-500">
          {health.kind === 'loading' && 'Connecting to API…'}
          {health.kind === 'ok' && 'API connected'}
          {health.kind === 'error' && `API unavailable: ${health.message}`}
        </p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-6 lg:grid-cols-[22rem_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <AnalysisForm
            kind={kind}
            onKindChange={setKind}
            values={values}
            onValuesChange={(patch) =>
              setValues((current) => ({ ...current, ...patch }))
            }
            errors={errors}
            thresholds={thresholdInputs}
            thresholdErrors={thresholdErrors}
            onThresholdsChange={(patch) =>
              setThresholdInputs((current) => ({ ...current, ...patch }))
            }
            loading={state.status === 'loading'}
            onSubmit={submit}
          />
        </aside>

        <main className="flex min-w-0 flex-col gap-5">
          <div
            role="tablist"
            aria-label="보기"
            className="flex gap-1 border-b border-neutral-800"
          >
            {(
              [
                ['result', '분석 결과'],
                ['compare', `지점 비교 (${pins.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                  tab === value
                    ? 'border-neutral-100 text-neutral-100'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'compare' ? (
            <ComparePanel
              pins={pins}
              thresholds={thresholds}
              onRemove={(id) =>
                setPins((current) => current.filter((pin) => pin.id !== id))
              }
              onClear={() => setPins([])}
            />
          ) : (
            <>
              {state.status === 'idle' ? (
                <div
                  data-testid="analysis-idle"
                  className="rounded-xl border border-dashed border-neutral-800 px-6 py-16 text-center"
                >
                  <p className="text-base text-neutral-200">
                    착륙 후보 지점의 일조와 지구 가시성을 확인하세요
                  </p>
                  <p className="mt-2 text-sm text-neutral-500">
                    왼쪽에서 위치와 기간을 정하고 &lsquo;분석 실행&rsquo;을
                    누르세요. 예시 좌표 버튼으로 바로 시작할 수도 있습니다.
                  </p>
                </div>
              ) : null}
              {state.status === 'loading' ? (
                <div
                  data-testid="analysis-loading"
                  role="status"
                  className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 px-6 py-16 text-sm text-neutral-300"
                >
                  <span className="size-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-100" />
                  지형 수평선과 천체 위치를 계산하는 중…
                </div>
              ) : null}
              {state.status === 'error' ? (
                <div
                  data-testid="analysis-error"
                  role="alert"
                  className="rounded-xl border border-red-500/40 bg-red-500/10 px-6 py-6"
                >
                  <p className="text-sm font-semibold text-red-300">
                    분석을 불러오지 못했습니다
                  </p>
                  <p className="mt-1 text-xs break-words text-red-200/80">
                    {state.message}
                  </p>
                  {lastRequest ? (
                    <button
                      type="button"
                      onClick={() => {
                        run(lastRequest.kind, lastRequest.params)
                      }}
                      className="mt-3 rounded-md border border-red-400/50 px-3 py-1.5 text-xs text-red-200 hover:border-red-300"
                    >
                      다시 시도
                    </button>
                  ) : null}
                </div>
              ) : null}
              {state.status === 'ok' ? (
                <ResultView
                  key={currentPinId}
                  kind={state.kind}
                  data={state.data}
                  thresholds={thresholds}
                  pinned={pins.some((pin) => pin.id === currentPinId)}
                  pinDisabled={pins.length >= MAX_PINS}
                  onPin={pinCurrent}
                />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
