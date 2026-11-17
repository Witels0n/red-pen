// Merge fields: {Name}, {Award}, {Date} and any other column of the Recipient list, filled in per
// learner. Pure; see tests/certificates/merge.test.ts.

/** One learner (or other recipient) and the values of their merge fields. */
export type Recipient = Record<string, string>

/** A field name as it is matched: case and spacing do not matter, so {learner id} finds "Learner ID". */
export function fieldKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

type Part = { text: string } | { field: string }

/**
 * Splits a template into text and {Field} parts. Doubled braces are literal: "{{" is "{" and "}}" is
 * "}". A "{" without a closing "}" on the same line, or with nothing inside, is kept as text.
 */
export function parseTemplate(template: string): Part[] {
  const parts: Part[] = []
  let text = ''
  for (let i = 0; i < template.length; i++) {
    const c = template[i]
    if (c === '{' && template[i + 1] === '{') {
      text += '{'
      i++
    } else if (c === '}' && template[i + 1] === '}') {
      text += '}'
      i++
    } else if (c === '{') {
      const close = template.indexOf('}', i + 1)
      const inner = close < 0 ? '' : template.slice(i + 1, close)
      if (close < 0 || inner.trim() === '' || /[{\n]/.test(inner)) {
        text += c
        continue
      }
      if (text) parts.push({ text })
      text = ''
      parts.push({ field: inner.trim() })
      i = close
    } else {
      text += c
    }
  }
  if (text) parts.push({ text })
  return parts
}

/** The distinct field names a template uses, in the order they first appear. */
export function templateFields(template: string): string[] {
  const seen = new Map<string, string>()
  for (const p of parseTemplate(template))
    if ('field' in p && !seen.has(fieldKey(p.field))) seen.set(fieldKey(p.field), p.field)
  return [...seen.values()]
}

/** Fields a template uses that no column provides, so the teacher can be told before printing. */
export function unknownFields(templates: readonly string[], fields: readonly string[]): string[] {
  const known = new Set(fields.map(fieldKey))
  const out = new Map<string, string>()
  for (const t of templates) for (const f of templateFields(t)) if (!known.has(fieldKey(f))) out.set(fieldKey(f), f)
  return [...out.values()]
}

function lookup(recipient: Recipient, field: string): string | undefined {
  const key = fieldKey(field)
  for (const [name, value] of Object.entries(recipient)) if (fieldKey(name) === key) return value
  return undefined
}

/**
 * Fills in a template for one recipient. A field the recipient has but leaves blank becomes empty,
 * and the spaces around it are tidied, so "for {Subject} excellence" never prints a double space.
 * A field nobody has stays as typed ("{Awrd}"), so a typo shows on the preview instead of vanishing.
 */
export function fillTemplate(template: string, recipient: Recipient): string {
  const lines = template.split(/\r?\n/).map((line) => {
    let out = ''
    let blanked = false
    for (const p of parseTemplate(line)) {
      if ('text' in p) out += p.text
      else {
        const value = lookup(recipient, p.field)
        if (value === undefined) out += `{${p.field}}`
        else {
          const tidy = value.replace(/\s+/g, ' ').trim()
          if (tidy === '') blanked = true
          out += tidy
        }
      }
    }
    return blanked
      ? out
          .replace(/ {2,}/g, ' ')
          .replace(/ +([,.;:!?)])/g, '$1')
          .trim()
      : out
  })
  return lines.join('\n')
}
