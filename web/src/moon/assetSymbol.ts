/** Equipment kinds the scene can badge, so a unit is recognisable before it is close. */
export type AssetSymbol =
  'solar' | 'thermal' | 'printer' | 'trencher' | 'antenna'

// Drawn on a 24-unit grid, stroked only, so one style serves every badge.
const GLYPHS: Readonly<Record<AssetSymbol, string>> = {
  solar:
    '<rect x="4.5" y="8" width="15" height="9" rx="1"/><path d="M4.5 11h15M4.5 14h15M9.5 8v9M14.5 8v9M12 3.5v3"/>',
  thermal:
    '<path d="M5 8h14M5 12h14M5 16h14"/><path d="M8 5.5v2.5M12 5.5v2.5M16 5.5v2.5"/>',
  printer:
    '<rect x="4.5" y="15" width="15" height="4" rx="1"/><path d="M6.5 15V8h11v7"/><path d="M12 8V5"/>',
  trencher:
    '<path d="M4.5 16h15"/><circle cx="8" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/><path d="M6 16v-4h9l3 4"/><path d="M18 12l2-4"/>',
  antenna:
    '<path d="M12 19v-7"/><path d="M6.5 12a5.5 5.5 0 0 1 11 0z"/><path d="M9 19h6"/>',
}

const BADGE_BACKGROUND = '#15191ee6'
const BADGE_STROKE = '#ebe8e2'

/**
 * A data URI for one equipment badge. Inline rather than a file so the scene needs no
 * extra request and the badge cannot go missing at the demo. `accentCss` rims the badge
 * with the unit's Earth verdict, which matters because the sight ray itself is often
 * buried in terrain while the badge always shows.
 */
export function assetSymbolImage(
  symbol: AssetSymbol,
  accentCss?: string,
): string {
  const rim = accentCss
    ? `<rect x="1" y="1" width="22" height="22" rx="4.5" fill="none" stroke="${accentCss}" stroke-width="2"/>`
    : ''
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    `<rect width="24" height="24" rx="5" fill="${BADGE_BACKGROUND}"/>` +
    rim +
    `<g fill="none" stroke="${BADGE_STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[symbol]}</g>` +
    '</svg>'
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
