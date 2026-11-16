/** The order a mission is worked out in. Every stage can be opened directly from the others. */
const STAGES = [
  { id: 'search', label: 'Search' },
  { id: 'schedule', label: 'Schedule & Cost' },
  { id: 'compare', label: 'Compare Sites' },
  { id: 'explore', label: '3D Explore' },
] as const
export type Stage = (typeof STAGES)[number]['id']

export function StageNav({
  current,
  hrefFor,
  onNavigate,
}: {
  current: Stage
  hrefFor: (stage: Stage) => string
  /** A plain click. Modified clicks follow `hrefFor`, so a stage can open in a new tab. */
  onNavigate: (stage: Stage) => void
}) {
  return (
    <nav aria-label="Mission planning stages" className="hud-panel p-1">
      <ol className="flex items-center gap-0.5 text-xs">
        {STAGES.map((stage, index) => (
          <li key={stage.id} className="flex items-center gap-0.5">
            {index > 0 ? (
              <span aria-hidden="true" className="text-neutral-500">
                ›
              </span>
            ) : null}
            <a
              href={hrefFor(stage.id)}
              aria-current={stage.id === current ? 'step' : undefined}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                event.preventDefault()
                onNavigate(stage.id)
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 whitespace-nowrap text-neutral-300 hover:bg-white/10 aria-[current=step]:bg-neutral-100 aria-[current=step]:font-semibold aria-[current=step]:text-neutral-950"
            >
              <span className="font-mono text-[10px] opacity-70">
                {index + 1}
              </span>
              {/* On a phone only the current stage keeps its name; the others keep their number. */}
              <span
                className={stage.id === current ? undefined : 'max-sm:sr-only'}
              >
                {stage.label}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
