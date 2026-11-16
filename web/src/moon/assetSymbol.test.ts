import { describe, expect, it } from 'vitest'
import { assetSymbolImage, type AssetSymbol } from './assetSymbol'

const SYMBOLS: readonly AssetSymbol[] = [
  'solar',
  'thermal',
  'printer',
  'trencher',
  'antenna',
]

describe('assetSymbolImage', () => {
  it('builds an inline SVG image for every kind', () => {
    for (const symbol of SYMBOLS) {
      const image = assetSymbolImage(symbol)
      expect(image.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
      expect(decodeURIComponent(image)).toContain('</svg>')
    }
  })

  it('draws a different glyph for each kind', () => {
    const images = new Set(SYMBOLS.map((symbol) => assetSymbolImage(symbol)))
    expect(images.size).toBe(SYMBOLS.length)
  })

  it('escapes the markup so it survives as a URI', () => {
    expect(assetSymbolImage('solar')).not.toContain('<')
  })

  it('rims the badge with the verdict colour when given one', () => {
    const plain = assetSymbolImage('trencher')
    const rimmed = assetSymbolImage('trencher', '#f87171')
    expect(rimmed).not.toBe(plain)
    expect(decodeURIComponent(rimmed)).toContain('stroke="#f87171"')
    expect(decodeURIComponent(plain)).not.toContain('#f87171')
  })
})
