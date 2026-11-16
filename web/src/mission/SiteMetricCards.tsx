import type { Candidate, SearchConfig } from '../api/candidates'
import { RequirementMarginPanel } from './RequirementMarginPanel'
import { formatAmount } from './requirementMargins'
import { siteMetrics } from './siteMetrics'

/** The selected candidate's six saved metrics, with where they come from folded away. */
export function SiteMetricCards({
  candidate,
  config,
}: {
  candidate: Candidate
  config: SearchConfig
}) {
  const { window, observer_height_m } = config
  return (
    <>
      <dl className="grid grid-cols-2 gap-2" aria-label="Candidate metrics">
        {siteMetrics(candidate, config).map((metric) => (
          <div
            key={metric.key}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
          >
            <dt className="flex items-baseline justify-between gap-2 text-xs text-neutral-400">
              <span>{metric.label}</span>
              {metric.basis ? (
                <span className="text-[10px] text-sky-300">{metric.basis}</span>
              ) : null}
            </dt>
            <dd className="font-mono text-lg">
              {metric.value === null
                ? '—'
                : formatAmount(metric.value, metric.unit)}
            </dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-neutral-300">Details</summary>
        <RequirementMarginPanel candidate={candidate} config={config} />
        <p className="mt-3 leading-relaxed text-neutral-400">
          Saved search result · {window.start.slice(0, 10)} →{' '}
          {window.end.slice(0, 10)} UTC · {window.step_minutes} min step ·
          observer height {observer_height_m} m · computed from NASA LOLA and
          SPICE
          <br />
          {config.rf
            ? 'Communication and the longest comm outage follow the nominal RF link: a blocked line of sight means no link, and both the availability and the longest outage count towards the ranking score. Real ground stations, schedules, atmosphere and multipath are not modelled.'
            : 'Communication and the longest comm outage only tell whether terrain hides the Earth’s centre. They do not mean link quality.'}
          {candidate.terrain ? (
            <>
              <br />
              Local slope and roughness are the P95 within{' '}
              {candidate.terrain.assessment_radius_m} m of the candidate centre.
              Landing safety has not been verified.
            </>
          ) : null}
        </p>
      </details>
    </>
  )
}
