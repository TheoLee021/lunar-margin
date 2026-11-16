import { assumptionLabel, englishMessage } from './plannerCopy'
import type { PricingSettings } from './usePricingSettings'
import { formatPrice, isTransitPossible } from '../api/pricing'
import type { departureAvailability } from '../api/launchSchedule'
import { dayOf, iso, short } from './missionDates'
import type { Schedule } from './types'
import type { useProviderCalendar } from './useProviderCalendar'

const STATE_LABELS = {
  quoted: 'Quote available',
  estimated: 'Estimated cost',
  no_published_quote: 'No published quote',
  no_launch: 'Unavailable',
  search_required: 'Not calculated',
  partial_coverage: 'Partial coverage',
  invalid_transit: 'Invalid transit',
  no_eligible: 'No eligible cells',
  not_computed: 'Not calculated',
  running: 'Searching',
  failed: 'Search failed',
  unavailable: 'Unavailable',
}
export function PriceGrid({
  departures,
  landings,
  draft,
  availability,
  settings,
  onSelect,
  calendar,
}: {
  departures: number[]
  landings: number[]
  draft: Schedule
  settings: PricingSettings
  availability: (departure: string) => ReturnType<typeof departureAvailability>
  onSelect: (departure: string, landing: string) => void
  calendar: ReturnType<typeof useProviderCalendar>
}) {
  const { massNumber, delivery, slopeLimit } = settings
  const data = calendar.data
  const prices =
    data?.cells.flatMap((cell) =>
      cell.mean_min_usd === null ? [] : [cell.mean_min_usd],
    ) ?? []
  const minimum = Math.min(...prices)
  function candidateHref(
    departure: number,
    landing: number,
    runId: string,
    launchId = draft.launchId,
  ) {
    const url = new URL(window.location.href)
    url.pathname = '/'
    url.searchParams.set('view', 'search')
    url.searchParams.delete('planner')
    url.searchParams.set('departure', iso(departure))
    url.searchParams.set('arrival', iso(landing))
    url.searchParams.set('duration', String(draft.duration))
    url.searchParams.set('run', runId)
    url.searchParams.set('max_slope', String(slopeLimit ?? 'none'))
    url.searchParams.set('mass_kg', String(massNumber))
    url.searchParams.set('delivery', delivery)
    if (launchId) url.searchParams.set('launch_id', launchId)
    else url.searchParams.delete('launch_id')
    return `${url.pathname}${url.search}`
  }
  return (
    <>
      {calendar.loading ? <p role="status">Loading prices by date…</p> : null}
      {calendar.error ? (
        <p role="alert">
          {englishMessage(
            calendar.error,
            'Unable to load pricing for these dates.',
          )}{' '}
          <button type="button" onClick={calendar.reload}>
            Retry pricing
          </button>
        </p>
      ) : null}
      {calendar.waiting ? (
        <p role="status">
          Another search is in progress · {calendar.waiting.run_id}
          {calendar.waiting.total > 0
            ? ` · ${calendar.waiting.done.toLocaleString()}/${calendar.waiting.total.toLocaleString()}`
            : ''}
          {' · '}Your dates will be calculated when it finishes.
        </p>
      ) : calendar.calculating ? (
        <p role="status">Calculating prices by date…</p>
      ) : null}
      <div className="grid-scroll">
        <table
          className="cost-grid"
          aria-label="Mean estimated cost by departure and arrival date"
        >
          <thead>
            <tr>
              <th scope="col" className="axis-cell">
                Arrival ↓<br />
                Departure →
              </th>
              {departures.map((d) => (
                <th key={d} scope="col">
                  {short(d)}
                  <small>
                    {new Intl.DateTimeFormat('en-US', {
                      weekday: 'short',
                      timeZone: 'UTC',
                    }).format(d * 86_400_000)}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {landings.map((l) => {
              const row = data?.dates.find((r) => r.landing_date === iso(l))
              const rowOffer = data?.cells.find(
                (c) =>
                  c.landing_date === iso(l) &&
                  c.departure_date === draft.departure,
              )
              return (
                <tr key={l}>
                  <th scope="row">
                    {row?.state === 'completed' &&
                    rowOffer?.status !== 'no_launch' &&
                    availability(draft.departure) === 'scheduled' &&
                    isTransitPossible(draft.departure, iso(l)) ? (
                      <a
                        href={candidateHref(
                          dayOf(draft.departure),
                          l,
                          row.run_id,
                          rowOffer?.lowest_launch_id ?? draft.launchId,
                        )}
                        aria-label={`${short(l)} · Arrival ${iso(l)} · Explore landing sites`}
                      >
                        {short(l)}
                      </a>
                    ) : (
                      short(l)
                    )}
                  </th>
                  {departures.map((d) => {
                    const possible = isTransitPossible(iso(d), iso(l))
                    const offer = data?.cells.find(
                      (cell) =>
                        cell.landing_date === iso(l) &&
                        cell.departure_date === iso(d),
                    )
                    const departureState =
                      offer?.status === 'no_launch'
                        ? 'no_launch'
                        : availability(iso(d))
                    const companyNames = offer?.lowest_company_names.length
                      ? offer.lowest_company_names
                      : data?.selection
                        ? [data.selection.company_name]
                        : []
                    const mean = offer?.mean_min_usd ?? null
                    const label = offer
                      ? STATE_LABELS[offer.status]
                      : calendar.loading
                        ? 'Loading'
                        : 'Not calculated'
                    const selected =
                      dayOf(draft.departure) === d && dayOf(draft.landing) === l
                    const className =
                      mean !== null && mean <= minimum * 1.05
                        ? 'low-cost'
                        : undefined
                    const accessibleLabel = `Departure ${iso(d)}, arrival ${iso(l)}, ${mean !== null ? `${draft.launchId ? 'Provider average' : 'Average minimum cost'} ${formatPrice(mean)}` : label}${mean !== null && companyNames.length ? `, ${companyNames.join(' · ')}` : ''}`
                    const content = (
                      <>
                        <span>{mean !== null ? formatPrice(mean) : label}</span>
                        {mean !== null ? (
                          companyNames.length > 0 ? (
                            <small>{companyNames.join(' · ')}</small>
                          ) : null
                        ) : (
                          <small>
                            {offer?.status === 'partial_coverage'
                              ? `Quotes for ${offer.quoted_grid_count}/${offer.eligible_grid_count} cells`
                              : englishMessage(row?.message ?? '', '') ||
                                `${l - d}-day flight`}
                          </small>
                        )}
                      </>
                    )
                    return (
                      <td key={d}>
                        {departureState !== 'scheduled' ? (
                          <div
                            className="invalid-cell"
                            aria-label={`Departure ${iso(d)}: ${departureState === 'no_launch' ? 'Unavailable' : departureState === 'loading' ? 'Checking schedule' : 'Schedule unknown'}`}
                          >
                            <span
                              className={
                                departureState === 'no_launch'
                                  ? 'unavailable-label'
                                  : undefined
                              }
                            >
                              {departureState === 'no_launch'
                                ? 'Unavailable'
                                : departureState === 'loading'
                                  ? 'Checking schedule'
                                  : 'Schedule unknown'}
                            </span>
                          </div>
                        ) : !possible ? (
                          <div
                            className="invalid-cell"
                            title="Transit must take 3 to 150 days"
                          >
                            —<small>Transit: 3–150 days</small>
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-pressed={selected}
                            aria-label={accessibleLabel}
                            className={className}
                            onClick={() => onSelect(iso(d), iso(l))}
                          >
                            {content}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid-key">
        <span>
          <i />
          Lowest estimates
        </span>
        <span>
          <i />
          Selected dates
        </span>
      </div>
      {data?.selection && (
        <details>
          <summary>Provider pricing details</summary>{' '}
          <section
            aria-label="Pricing model for the selected launch provider"
            className="mb-3 text-sm"
          >
            <p className="text-amber-300">
              {data.selection.company_name} cost estimate ·{' '}
              {data.selection.tariff_basis === 'public_tariff'
                ? 'Published rate'
                : 'Reference rate'}{' '}
              ${data.selection.tariff_usd_per_kg.toLocaleString('en-US')}/kg
              {' · '}Fixed cost $
              {data.selection.fixed_usd.toLocaleString('en-US')}
            </p>
            <p className="hint">
              {data.selection.launch_name} · Mean across all eligible 500 m
              cells · Model estimate only
            </p>
            <details>
              <summary>Sources and assumptions</summary>
              <p className="hint">
                {data.selection.assumptions.map(assumptionLabel).join(' ')}
              </p>
              <a
                href={data.selection.tariff_source.url}
                target="_blank"
                rel="noreferrer"
              >
                {englishMessage(
                  data.selection.tariff_source.title,
                  'Pricing reference',
                )}{' '}
                ↗
              </a>
            </details>
          </section>
        </details>
      )}
    </>
  )
}
