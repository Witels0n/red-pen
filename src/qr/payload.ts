// Pure builders that turn what the teacher types into the text a QR code carries.

export type ContentType = 'link' | 'text' | 'wifi' | 'email' | 'contact'

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass'

export interface WifiContent {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}

export interface EmailContent {
  address: string
  subject: string
  body: string
}

export interface ContactContent {
  name: string
  phone: string
  email: string
  organisation: string
}

export type Content =
  | { type: 'link'; url: string }
  | { type: 'text'; text: string }
  | ({ type: 'wifi' } & WifiContent)
  | ({ type: 'email' } & EmailContent)
  | ({ type: 'contact' } & ContactContent)

/** Schemes that are complete without "//", so they must not get https:// in front. */
const OPAQUE_SCHEMES = /^(mailto|tel|sms|smsto|geo):/i

/** "example.com/x" -> "https://example.com/x". Keeps any explicit scheme. Empty stays empty. */
export function normaliseUrl(input: string): string {
  const url = input.trim()
  if (url === '') return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || OPAQUE_SCHEMES.test(url)) return url
  return `https://${url.replace(/^\/+/, '')}`
}

/** Backslash-escapes the characters the WIFI: format reserves: \ ; , : and ". */
export function escapeWifi(value: string): string {
  return value.replace(/[\\;,:"]/g, (c) => `\\${c}`)
}

/** The de facto Wi-Fi format read by phone cameras: WIFI:T:WPA;S:name;P:password;H:true;; */
export function wifiPayload(w: WifiContent): string {
  let out = `WIFI:T:${w.security};S:${escapeWifi(w.ssid)};`
  if (w.security !== 'nopass') out += `P:${escapeWifi(w.password)};`
  if (w.hidden) out += 'H:true;'
  return `${out};`
}

/** RFC 6068 mailto: link. Line breaks in the body are sent as CRLF, as the RFC asks. */
export function mailtoPayload(e: EmailContent): string {
  const address = encodeURIComponent(e.address.trim()).replace(/%40/g, '@')
  const query: string[] = []
  if (e.subject) query.push(`subject=${encodeURIComponent(e.subject)}`)
  if (e.body) query.push(`body=${encodeURIComponent(e.body.replace(/\r?\n/g, '\r\n'))}`)
  return `mailto:${address}${query.length ? `?${query.join('&')}` : ''}`
}

/** Escapes a vCard 3.0 text value (RFC 2426): backslash, comma, semicolon and line breaks. */
export function escapeVCard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n')
}

/** Splits "Thandi van der Merwe" into given "Thandi van der" and family "Merwe" for the N field. */
function splitName(name: string): { given: string; family: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { given: parts[0] ?? '', family: '' }
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
}

/** A vCard 3.0 contact card with CRLF line endings. Empty fields are left out. */
export function vCardPayload(c: ContactContent): string {
  const name = c.name.trim()
  const { given, family } = splitName(name)
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  lines.push(`N:${escapeVCard(family)};${escapeVCard(given)};;;`)
  // FN is required in vCard 3.0, so fall back to the organisation or email.
  lines.push(`FN:${escapeVCard(name || c.organisation.trim() || c.email.trim())}`)
  if (c.organisation.trim()) lines.push(`ORG:${escapeVCard(c.organisation.trim())}`)
  if (c.phone.trim()) lines.push(`TEL;TYPE=CELL:${escapeVCard(c.phone.trim())}`)
  if (c.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(c.email.trim())}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/** The text the QR code will carry, or '' when there is nothing to encode yet. */
export function buildPayload(content: Content): string {
  switch (content.type) {
    case 'link':
      return normaliseUrl(content.url)
    case 'text':
      return content.text
    case 'wifi':
      return content.ssid.trim() ? wifiPayload(content) : ''
    case 'email':
      return content.address.trim() ? mailtoPayload(content) : ''
    case 'contact':
      return [content.name, content.phone, content.email, content.organisation].some((v) => v.trim())
        ? vCardPayload(content)
        : ''
  }
}

/** "Hello, World!" -> "hello-world". At most 40 characters; '' when nothing usable is left. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/** A download name such as "qr-example-com.png", based on what the code holds. */
export function exportFileName(content: Content, extension: 'png' | 'svg'): string {
  let source = ''
  switch (content.type) {
    case 'link': {
      const url = normaliseUrl(content.url)
      source = url.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '').replace(/^www\./i, '')
      break
    }
    case 'text':
      source = content.text.split(/\s+/).slice(0, 5).join(' ')
      break
    case 'wifi':
      source = `wifi ${content.ssid}`
      break
    case 'email':
      source = `email ${content.address.split('@')[0]}`
      break
    case 'contact':
      source = content.name || content.organisation
      break
  }
  return `qr-${slugify(source) || 'code'}.${extension}`
}
