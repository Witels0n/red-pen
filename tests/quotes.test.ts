import { describe, expect, it } from 'vitest'
import { QUOTES, quoteDealer } from '../src/landing/quotes'

describe('landing page quotes', () => {
  it('credits every quote to a person and a work', () => {
    for (const quote of QUOTES) {
      expect(quote.text.trim()).not.toBe('')
      expect(quote.who.trim()).not.toBe('')
      expect(quote.source.trim()).not.toBe('')
    }
  })

  it('deals every quote before repeating any', () => {
    const deal = quoteDealer()
    const seen = new Set(QUOTES.map(() => deal()))
    expect(seen.size).toBe(QUOTES.length)
  })

  it('never shows the same quote twice in a row', () => {
    const deal = quoteDealer(QUOTES.slice(0, 2))
    let previous = deal()
    for (let i = 0; i < 50; i++) {
      const next = deal()
      expect(next).not.toBe(previous)
      previous = next
    }
  })
})
