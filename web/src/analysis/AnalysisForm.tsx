import type { ReactNode } from 'react'
import type { AnalysisKind } from '../api/analysis'
import type {
  FormErrors,
  FormValues,
  ThresholdInputs,
  ThresholdParse,
} from './derive'
import { KIND_COPY, PRESETS, type Preset } from './kinds'

interface Props {
  kind: AnalysisKind
  onKindChange: (kind: AnalysisKind) => void
  values: FormValues
  onValuesChange: (patch: Partial<FormValues>) => void
  errors: FormErrors
  thresholds: ThresholdInputs
  thresholdErrors: ThresholdParse['errors']
  onThresholdsChange: (patch: Partial<ThresholdInputs>) => void
  loading: boolean
  onSubmit: () => void
}

const inputClass =
  'w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-400 aria-[invalid=true]:border-red-500'

function Field(props: {
  id: string
  label: string
  hint?: string
  error?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={props.id}
        className="text-xs font-medium text-neutral-300"
      >
        {props.label}
      </label>
      {props.children}
      {props.hint ? (
        <p className="text-[11px] text-neutral-500">{props.hint}</p>
      ) : null}
      {props.error ? (
        <p
          id={`${props.id}-error`}
          role="alert"
          className="text-[11px] text-red-400"
        >
          {props.error}
        </p>
      ) : null}
    </div>
  )
}

export function AnalysisForm(props: Props) {
  const { values, errors, thresholds, thresholdErrors } = props

  function bind(field: keyof FormValues) {
    return {
      id: `field-${field}`,
      value: values[field],
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': errors[field] ? `field-${field}-error` : undefined,
      onChange: (event: { target: { value: string } }) =>
        props.onValuesChange({ [field]: event.target.value }),
    } as const
  }

  function applyPreset(preset: Preset) {
    props.onValuesChange({ lat: String(preset.lat), lon: String(preset.lon) })
  }

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <div
        role="tablist"
        aria-label="분석 종류"
        className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-900 p-1"
      >
        {(Object.keys(KIND_COPY) as AnalysisKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={props.kind === kind}
            onClick={() => props.onKindChange(kind)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              props.kind === kind
                ? 'bg-neutral-700 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {KIND_COPY[kind].tab}
          </button>
        ))}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
          위치
        </legend>
        <div className="flex flex-wrap gap-1.5" aria-label="예시 좌표">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:border-neutral-400"
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500">
          위 좌표는 예시일 뿐 확정된 착륙 후보지가 아닙니다.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="field-lat"
            label="위도 (°)"
            hint="-90 ~ -80, 남쪽이 음수"
            error={errors.lat}
          >
            <input
              {...bind('lat')}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
          <Field
            id="field-lon"
            label="경도 (°E)"
            hint="동경 기준"
            error={errors.lon}
          >
            <input
              {...bind('lon')}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
        </div>
        <Field
          id="field-observerHeightM"
          label="관측 높이 (m)"
          hint="지표 위 안테나·패널 높이 (0 ~ 100)"
          error={errors.observerHeightM}
        >
          <input
            {...bind('observerHeightM')}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
          기간 (UTC)
        </legend>
        <Field id="field-start" label="시작" error={errors.start}>
          <input
            {...bind('start')}
            type="datetime-local"
            className={inputClass}
          />
        </Field>
        <Field id="field-end" label="끝" hint="최대 3년" error={errors.end}>
          <input
            {...bind('end')}
            type="datetime-local"
            className={inputClass}
          />
        </Field>
        <Field
          id="field-stepMinutes"
          label="계산 간격 (분)"
          hint="5 ~ 360. 짧을수록 정밀하지만 느립니다."
          error={errors.stepMinutes}
        >
          <input
            {...bind('stepMinutes')}
            inputMode="numeric"
            className={inputClass}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
          임무 기준 (선택)
        </legend>
        <p className="text-[11px] text-neutral-500">
          기준을 넣으면 결과가 기준을 만족하는지, 못 한다면 이유가 무엇인지 알려
          줍니다.
        </p>
        <Field
          id="threshold-minVisiblePercent"
          label={`최소 ${KIND_COPY[props.kind].bodyShort} 비율 (%)`}
          error={thresholdErrors.minVisiblePercent}
        >
          <input
            id="threshold-minVisiblePercent"
            className={inputClass}
            inputMode="decimal"
            placeholder="예: 70"
            value={thresholds.minVisiblePercent}
            aria-invalid={thresholdErrors.minVisiblePercent ? true : undefined}
            onChange={(event) =>
              props.onThresholdsChange({
                minVisiblePercent: event.target.value,
              })
            }
          />
        </Field>
        <Field
          id="threshold-maxDarkHours"
          label={`최대 허용 ${props.kind === 'illumination' ? '연속 암흑' : '통신 두절'} (시간)`}
          error={thresholdErrors.maxDarkHours}
        >
          <input
            id="threshold-maxDarkHours"
            className={inputClass}
            inputMode="decimal"
            placeholder="예: 48"
            value={thresholds.maxDarkHours}
            aria-invalid={thresholdErrors.maxDarkHours ? true : undefined}
            onChange={(event) =>
              props.onThresholdsChange({ maxDarkHours: event.target.value })
            }
          />
        </Field>
      </fieldset>

      <button
        type="submit"
        disabled={props.loading}
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60"
      >
        {props.loading ? '계산 중…' : '분석 실행'}
      </button>
    </form>
  )
}
