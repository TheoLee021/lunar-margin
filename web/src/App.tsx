import { useEffect, useMemo, useState } from 'react'
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
import type { LunarLocation } from './moon/location'
import type { MoonMarker } from './moon/markerLayer'
import MoonViewer from './moon/MoonViewer'

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
  const [resultsOpen, setResultsOpen] = useState(false)
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
    setResultsOpen(true)
    run(kind, parsed.params)
  }

  // Clicking the Moon fills the form's coordinates; the marker follows whatever the form holds.
  function pickLocation({ lat, lon }: LunarLocation) {
    setValues((current) => ({
      ...current,
      lat: lat.toFixed(4),
      lon: lon.toFixed(4),
    }))
  }
  const siteMarkers = useMemo(
    () => analysisSiteMarkers(values.lat, values.lon),
    [values.lat, values.lon],
  )

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
    <main className="relative h-svh overflow-hidden bg-black text-neutral-100">
      <MoonViewer markers={siteMarkers} onPick={pickLocation} />
      {/* Panels float over the Moon; the bottom strip stays clear for the compass and data credits. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3 pb-16 lg:flex-row lg:items-start lg:p-4 lg:pb-16">
        <aside className="pointer-events-auto flex max-h-full w-full shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-950/80 lg:w-[22rem]">
          <header className="flex flex-col gap-1 border-b border-white/10 px-4 py-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                Lunar Margin
              </h1>
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
          <div className="overflow-y-auto p-4">
            <p className="mb-3 text-xs text-neutral-400">
              달을 클릭하면 그 지점의 좌표가 입력됩니다.
            </p>
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
          </div>
        </aside>

        {resultsOpen ? (
          <section
            aria-label="분석 결과"
            className="pointer-events-auto flex max-h-full min-w-0 flex-col gap-5 overflow-y-auto rounded-xl border border-white/10 bg-neutral-950/80 p-4 lg:ml-auto lg:w-[min(48rem,55vw)]"
          >
            <button
              type="button"
              onClick={() => setResultsOpen(false)}
              className="self-end text-xs text-neutral-400 hover:text-neutral-100"
            >
              닫기
            </button>
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
          </section>
        ) : null}
      </div>
    </main>
  )
}

function analysisSiteMarkers(lat: string, lon: string): readonly MoonMarker[] {
  const location = { lat: Number(lat), lon: Number(lon) }
  if (lat.trim() === '' || lon.trim() === '') return []
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon))
    return []
  return [{ id: 'analysis-site', label: '분석 지점', location }]
}
