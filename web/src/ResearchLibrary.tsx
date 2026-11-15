const base = 'https://github.com/TheoLee021/lunar-margin/blob/main/docs'

const documents = [
  {
    title: 'Physics & Methods',
    description: 'LOLA, SPICE, horizon and visibility calculations',
    file: 'physics.md',
  },
  {
    title: 'Economics & Logistics',
    description: 'Public rates, price assumptions and uncertainties',
    file: 'economics.md',
  },
  {
    title: 'Scenarios & Forecasts',
    description: 'Delays, alternative sites and conditional forecasts',
    file: 'scenarios.md',
  },
  {
    title: 'Validation & Evidence',
    description: 'Tests, data provenance and model limitations',
    file: 'validation.md',
  },
] as const

export default function ResearchLibrary() {
  return (
    <main className="min-h-svh bg-[#050607] p-6 text-[#ebe8e2]">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 border-b border-white/15 pb-5">
          <h1 className="text-3xl font-semibold">Research & Evidence</h1>
          <p className="mt-3 text-neutral-400">
            Mission models, assumptions, validation and supporting sources.
          </p>
          <a className="hud-button mt-3 inline-flex" href="/">
            Back to Mission Planner
          </a>
        </header>
        <section aria-label="Research documents">
          <ul className="grid gap-4 md:grid-cols-2">
            {documents.map((doc) => (
              <li
                key={doc.file}
                className="rounded-lg border border-white/15 p-5"
              >
                <h2 className="text-lg font-semibold">{doc.title}</h2>
                <p className="mt-2 text-sm text-neutral-400">
                  {doc.description}
                </p>
                <a
                  className="mt-4 inline-flex text-sm text-sky-300"
                  href={`${base}/evidence-library/${doc.file}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read evidence ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section className="mt-8 border-t border-white/15 pt-5">
          <h2 className="text-lg font-semibold">Primary sources</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Data manifests, candidate methods and API contracts.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-sky-300">
            <li>
              <a href={`${base}/data.md`}>NASA data and SPICE kernels</a>
            </li>
            <li>
              <a href={`${base}/candidates.md`}>Candidate search method</a>
            </li>
            <li>
              <a href={`${base}/api.md`}>Technical API contracts</a>
            </li>
          </ul>
        </section>
        <footer className="mt-8 text-xs text-neutral-500">
          Screening tool, not a certified landing or delivery service.
        </footer>
      </div>
    </main>
  )
}
