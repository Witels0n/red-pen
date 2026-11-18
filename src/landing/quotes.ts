/** A line for teachers, shown when someone finds the 10/10 on the landing page. */
export interface Quote {
  text: string
  who: string
  /** The work it comes from, so anyone can look it up. */
  source: string
}

/** Scholars of teaching and learning only. Each line is quoted from the named work. */
export const QUOTES: readonly Quote[] = [
  {
    text: 'What a child can do with assistance today she will be able to do by herself tomorrow.',
    who: 'Lev Vygotsky',
    source: 'Mind in Society',
  },
  {
    text: 'Through others we become ourselves.',
    who: 'Lev Vygotsky',
    source: 'The Genesis of Higher Mental Functions',
  },
  {
    text: 'Whoever teaches learns in the act of teaching, and whoever learns teaches in the act of learning.',
    who: 'Paulo Freire',
    source: 'Pedagogy of Freedom',
  },
  {
    text: 'Knowledge emerges only through invention and re-invention, through the restless, impatient, continuing, hopeful inquiry human beings pursue in the world, with the world, and with each other.',
    who: 'Paulo Freire',
    source: 'Pedagogy of the Oppressed',
  },
  {
    text: 'Reading the world always precedes reading the word.',
    who: 'Paulo Freire',
    source: 'The Importance of the Act of Reading',
  },
  {
    text: 'Any subject can be taught effectively in some intellectually honest form to any child at any stage of development.',
    who: 'Jerome Bruner',
    source: 'The Process of Education',
  },
  {
    text: 'Give the pupils something to do, not something to learn.',
    who: 'John Dewey',
    source: 'Democracy and Education',
  },
  {
    text: 'The most important single factor influencing learning is what the learner already knows.',
    who: 'David Ausubel',
    source: 'Educational Psychology: A Cognitive View',
  },
  {
    text: 'The classroom remains the most radical space of possibility in the academy.',
    who: 'bell hooks',
    source: 'Teaching to Transgress',
  },
]

/**
 * Deals the quotes out in a shuffled order and reshuffles when they run out, so nobody sees the
 * same line twice in a row.
 */
export function quoteDealer(quotes: readonly Quote[] = QUOTES, random: () => number = Math.random): () => Quote {
  let pile: Quote[] = []
  let last: Quote | undefined
  return () => {
    if (pile.length === 0) {
      pile = [...quotes]
      for (let i = pile.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[pile[i], pile[j]] = [pile[j]!, pile[i]!]
      }
      // The next one comes off the end: make sure it is not the one just shown.
      if (pile.length > 1 && pile[pile.length - 1] === last) pile.unshift(pile.pop()!)
    }
    last = pile.pop()!
    return last
  }
}
