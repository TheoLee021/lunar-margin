import { useState } from 'react'

const repository = 'https://github.com/TheoLee021/lunar-margin'
const base = `${repository}/blob/main/docs/evidence-library`

const sections = [
  {
    number: '01',
    title: 'Physics & Methods',
    subtitle: 'How the lunar environment is calculated',
    description:
      'LOLA terrain, SPICE ephemerides, horizon profiles, solar and Earth access, transfer-model assumptions.',
    href: `${base}/physics.md`,
    type: 'COMPUTED · LIMITATIONS DOCUMENTED',
  },
  {
    number: '02',
    title: 'Economics & Logistics',
    subtitle: 'What a delivery-cost estimate means',
    description:
      'Cost formulas, public-source tariffs, assumptions, uncertainty, and why estimates are not confirmed provider fares.',
    href: `${base}/economics.md`,
    type: 'MODEL ESTIMATES · NOT COMMERCIAL QUOTES',
  },
  {
    number: '03',
    title: 'Scenarios & Forecasts',
    subtitle: 'What happens when mission plans change',
    description:
      'Baseline, delay, and alternative-site comparisons; conditional lunar-infrastructure futures for 2027–2032.',
    href: `${base}/scenarios.md`,
    type: 'ILLUSTRATIVE · CONDITIONAL FORECASTS',
  },
  {
    number: '04',
    title: 'Validation & Evidence',
    subtitle: 'What we have tested—and what we have not',
    description:
      'Independent-accuracy checks, numerical convergence, UX benchmark plan, provenance, and known model limits.',
    href: `${base}/validation.md`,
    type: 'VERIFICATION PLAN · OPEN LIMITATIONS',
  },
] as const

export default function ResearchLibrary() {
  const [showSources, setShowSources] = useState(false)
  return (
    <main className="min-h-svh bg-[#050607] px-4 py-8 text-[#ebe8e2] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-sky-300">
              Lunar Margin / Research & Evidence
            </p>
            <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">
              Beyond the Map.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400 sm:text-base">
              Explore the physics, economic assumptions, mission scenarios, and
              verification evidence behind our lunar landing site and date
              analyses.
            </p>
          </div>
          <a href="/" className="hud-button">
            ← Back to Mission Planner
          </a>
        </header>
        <section
          aria-label="Research areas"
          className="grid gap-4 md:grid-cols-2"
        >
          {sections.map((section) => (
            <article
              key={section.number}
              className="flex flex-col rounded-xl border border-white/15 bg-white/[0.035] p-5"
            >
              <span className="font-mono text-xs text-sky-300">
                {section.number} / RESEARCH AREA
              </span>
              <h2 className="mt-5 text-xl font-semibold">{section.title}</h2>
              <p className="mt-1 text-sm text-neutral-300">{section.subtitle}</p>
              <p className="mt-4 flex-1 text-sm leading-relaxed text-neutral-400">
                {section.description}
              </p>
              <span className="mt-5 text-[10px] uppercase tracking-wide text-amber-300">
                {section.type}
              </span>
              <a
                className="mt-4 inline-flex w-fit rounded border border-white/20 px-3 py-2 text-sm text-neutral-100 hover:border-sky-300"
                target="_blank"
                rel="noopener noreferrer"
                href={section.href}
              >
                Read evidence document ↗
              </a>
            </article>
          ))}
        </section>
        <section className="mt-8 rounded-xl border border-white/15 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Data Sources & Technical Documentation
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                Review the exact public datasets, calculation API, and
                candidate-search methodology. These are the canonical
                technical references for the codebase.
              </p>
            </div>
            <button
              className="hud-button"
              type="button"
              aria-expanded={showSources}
              onClick={() => setShowSources((shown) => !shown)}
            >
              {showSources ? 'Hide references' : 'Show references'}
            </button>
          </div>
          {showSources && (
            <ul className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <li>
                <a
                  className="text-sky-300 underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${repository}/blob/main/docs/data.md`}
                >
                  NASA data and SPICE / LOLA versions
                </a>
              </li>
              <li>
                <a
                  className="text-sky-300 underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${repository}/blob/main/docs/candidates.md`}
                >
                  Candidate search methodology
                </a>
              </li>
              <li>
                <a
                  className="text-sky-300 underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${repository}/blob/main/docs/api.md`}
                >
                  Analysis and pricing API contracts
                </a>
              </li>
              <li>
                <a
                  className="text-sky-300 underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={repository}
                >
                  Source code and README
                </a>
              </li>
              <li>
                <a
                  className="text-sky-300 underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${base}/README.md`}
                >
                  Full evidence library index
                </a>
              </li>
            </ul>
          )}
        </section>
        <footer className="mt-8 border-t border-white/10 pt-5 text-xs leading-relaxed text-neutral-500">
          <p>
            Research and screening tool — not certified landing safety
            analysis, guaranteed RF connectivity, operational solar-power
            assessment, or a verified commercial fare.
          </p>
          <p className="mt-2">
            Public source documents are versioned in GitHub. Additional
            cloud-drive resources may be linked later once access is configured.
          </p>
        </footer>
      </div>
    </main>
  )
}
