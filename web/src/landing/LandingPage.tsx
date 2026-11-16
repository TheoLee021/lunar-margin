import { useId, useState, type ReactNode } from 'react'
import MoonViewer from '../moon/MoonViewer'
import type { MissionSelection } from '../mission/types'
import {
  DURATIONS,
  parseSearchForm,
  searchFormValues,
  type SearchConditions,
  type SearchErrors,
  type SearchField,
} from './searchForm'

const LIMITS = [
  { key: 'minSunPercent', label: 'Min. sunlight', unit: '%' },
  { key: 'minCommPercent', label: 'Min. communication', unit: '%' },
  { key: 'maxDarknessHours', label: 'Max. continuous darkness', unit: 'h' },
  { key: 'maxBlackoutHours', label: 'Max. communication blackout', unit: 'h' },
  { key: 'maxSlopeDeg', label: 'Max. regional slope', unit: '°' },
  { key: 'maxRoughnessM', label: 'Max. regional roughness', unit: 'm' },
] as const satisfies readonly {
  key: SearchField
  label: string
  unit: string
}[]

const INPUT =
  'w-full min-w-0 rounded-md border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-neutral-100 [color-scheme:dark] placeholder:font-sans placeholder:text-neutral-500 aria-[invalid=true]:border-red-400'

function Field({
  label,
  error,
  errorId,
  children,
}: {
  label: ReactNode
  error: string | undefined
  errorId: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-xs text-neutral-300">
        <span>{label}</span>
        {children}
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** The first screen: nothing but the Moon and the conditions a landing site is searched with. */
export function LandingPage({
  selection,
  nav,
  onSearch,
}: {
  /** What was searched before, so that coming back shows it again. */
  selection: MissionSelection
  nav: ReactNode
  onSearch: (search: SearchConditions) => void
}) {
  const id = useId()
  const [values, setValues] = useState(() => searchFormValues(selection))
  const [errors, setErrors] = useState<SearchErrors>({})
  const errorId = (field: SearchField) => `${id}-${field}-error`
  const input = (field: SearchField) => ({
    className: INPUT,
    value: values[field],
    'aria-invalid': errors[field] !== undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => {
      const value = event.target.value
      setValues((previous) => ({ ...previous, [field]: value }))
    },
  })
  return (
    <main className="relative h-svh overflow-hidden bg-[#050607] text-[#ebe8e2]">
      <MoonViewer />
      <header className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-wide uppercase [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">
          Lunar Margin
        </h1>
        <div className="pointer-events-auto">{nav}</div>
      </header>
      <form
        noValidate
        aria-labelledby={`${id}-title`}
        className="hud-panel absolute top-1/2 left-1/2 flex max-h-[calc(100dvh-128px)] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault()
          const parsed = parseSearchForm(values)
          if (parsed.ok) onSearch(parsed.search)
          else setErrors(parsed.errors)
        }}
      >
        <div>
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            Find a landing site at the lunar south pole
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Set when you land, how long you stay and what every site must offer.
            Schedule and cost come next.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Landing date · UTC"
            error={errors.landing}
            errorId={errorId('landing')}
          >
            <input type="date" {...input('landing')} />
          </Field>
          <Field
            label="Mission duration"
            error={errors.duration}
            errorId={errorId('duration')}
          >
            <select {...input('duration')}>
              {DURATIONS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2 md:grid-cols-3">
          <legend className="float-left col-span-full w-full text-xs font-semibold tracking-wider text-neutral-400 uppercase">
            Requirements
          </legend>
          {LIMITS.map(({ key, label, unit }) => (
            <Field
              key={key}
              label={
                <>
                  {label} <span className="text-neutral-500">· {unit}</span>
                </>
              }
              error={errors[key]}
              errorId={errorId(key)}
            >
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="No limit"
                {...input(key)}
              />
            </Field>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs text-neutral-400">
            An empty limit is not applied. Sunlight and communication cover the
            whole surface mission; slope and roughness are the 95th percentile
            within 250 m of a site.
          </p>
          <button
            type="submit"
            className="rounded-md bg-[var(--sun)] px-6 py-2 text-sm font-semibold text-neutral-950 hover:brightness-110"
          >
            Search
          </button>
        </div>
      </form>
    </main>
  )
}
