import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { colourWarnings } from './contrast'
import { canCopyImage, canvasToPng, copyPng, downloadBlob, drawToCanvas, loadImage, readAsDataUrl } from './export'
import { byteLength, makeMatrix, MAX_BYTES, type ErrorCorrection, type QrMatrix } from './matrix'
import { buildPayload, exportFileName, type Content, type ContentType, type WifiSecurity } from './payload'
import { renderSvg, type EyeStyle, type ModuleShape, type QrLogo, type QrStyle } from './render'
import { loadSettings, saveSettings, type StyleSettings } from './settings'

registerOffline(mountSiteHeader({ toolName: 'QR codes' }))

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

const form = el<HTMLFormElement>('settings')
const preview = el('preview')
const previewEmpty = el('preview-empty')
const payloadInfo = el('payload-info')
const warningsEl = el('warnings')
const exportStatus = el('export-status')
const pngButton = el<HTMLButtonElement>('download-png')
const svgButton = el<HTMLButtonElement>('download-svg')
const copyButton = el<HTMLButtonElement>('copy-image')

const inputs = {
  linkUrl: el<HTMLInputElement>('link-url'),
  text: el<HTMLTextAreaElement>('text-body'),
  wifiSsid: el<HTMLInputElement>('wifi-ssid'),
  wifiPassword: el<HTMLInputElement>('wifi-password'),
  wifiSecurity: el<HTMLSelectElement>('wifi-security'),
  wifiHidden: el<HTMLInputElement>('wifi-hidden'),
  emailAddress: el<HTMLInputElement>('email-address'),
  emailSubject: el<HTMLInputElement>('email-subject'),
  emailBody: el<HTMLTextAreaElement>('email-body'),
  contactName: el<HTMLInputElement>('contact-name'),
  contactPhone: el<HTMLInputElement>('contact-phone'),
  contactEmail: el<HTMLInputElement>('contact-email'),
  contactOrg: el<HTMLInputElement>('contact-org'),
  fg: el<HTMLInputElement>('fg'),
  bg: el<HTMLInputElement>('bg'),
  moduleShape: el<HTMLSelectElement>('module-shape'),
  eyeStyle: el<HTMLSelectElement>('eye-style'),
  margin: el<HTMLInputElement>('margin'),
  ecl: el<HTMLSelectElement>('ecl'),
  exportSize: el<HTMLSelectElement>('export-size'),
  logoSize: el<HTMLInputElement>('logo-size'),
  logoPadding: el<HTMLInputElement>('logo-padding'),
  logoFile: el<HTMLInputElement>('logo-input'),
}

interface LoadedLogo {
  href: string
  name: string
  image: HTMLImageElement
}

let logo: LoadedLogo | null = null

// The page always opens with the example content; only the style is remembered.
form.reset()
applySettings(loadSettings())
copyButton.hidden = !canCopyImage()

function applySettings(s: StyleSettings): void {
  inputs.fg.value = s.foreground
  inputs.bg.value = s.background
  inputs.moduleShape.value = s.moduleShape
  inputs.eyeStyle.value = s.eyeStyle
  inputs.margin.value = String(s.margin)
  inputs.ecl.value = s.errorCorrection
  inputs.exportSize.value = String(s.exportSize)
  inputs.logoSize.value = String(s.logoSize)
  inputs.logoPadding.checked = s.logoPadding
}

/** The error correction level the teacher chose, ignoring the logo override. */
let chosenEcl = inputs.ecl.value as ErrorCorrection

function readSettings(): StyleSettings {
  return {
    foreground: inputs.fg.value,
    background: inputs.bg.value,
    moduleShape: inputs.moduleShape.value as ModuleShape,
    eyeStyle: inputs.eyeStyle.value as EyeStyle,
    margin: Number(inputs.margin.value),
    errorCorrection: chosenEcl,
    exportSize: Number(inputs.exportSize.value),
    logoSize: Number(inputs.logoSize.value),
    logoPadding: inputs.logoPadding.checked,
  }
}

function contentType(): ContentType {
  return (form.querySelector<HTMLInputElement>('input[name="type"]:checked')?.value ?? 'link') as ContentType
}

function readContent(): Content {
  switch (contentType()) {
    case 'link':
      return { type: 'link', url: inputs.linkUrl.value }
    case 'text':
      return { type: 'text', text: inputs.text.value }
    case 'wifi':
      return {
        type: 'wifi',
        ssid: inputs.wifiSsid.value,
        password: inputs.wifiPassword.value,
        security: inputs.wifiSecurity.value as WifiSecurity,
        hidden: inputs.wifiHidden.checked,
      }
    case 'email':
      return {
        type: 'email',
        address: inputs.emailAddress.value,
        subject: inputs.emailSubject.value,
        body: inputs.emailBody.value,
      }
    case 'contact':
      return {
        type: 'contact',
        name: inputs.contactName.value,
        phone: inputs.contactPhone.value,
        email: inputs.contactEmail.value,
        organisation: inputs.contactOrg.value,
      }
  }
}

const EMPTY_HINTS: Record<ContentType, string> = {
  link: 'Type a web address to make a code.',
  text: 'Type some text to make a code.',
  wifi: 'Type the network name to make a code.',
  email: 'Type an email address to make a code.',
  contact: 'Fill in at least one detail to make a code.',
}

/** Everything needed to draw or export the current code. */
interface Current {
  content: Content
  matrix: QrMatrix
  style: QrStyle
  qrLogo?: QrLogo
}

let current: Current | null = null

function effectiveEcl(): ErrorCorrection {
  return logo ? 'H' : chosenEcl
}

function render(): void {
  const settings = readSettings()
  const content = readContent()
  const payload = buildPayload(content)
  const level = effectiveEcl()
  const result = makeMatrix(payload, level)
  const bytes = byteLength(payload)
  const warnings: string[] = []

  for (const f of form.querySelectorAll<HTMLElement>('.fields')) f.hidden = f.dataset.type !== content.type
  el('margin-value').textContent = `${settings.margin} ${settings.margin === 1 ? 'module' : 'modules'}`
  el('logo-size-value').textContent = `${Math.round(settings.logoSize * 100)}% of the width`
  inputs.ecl.value = level
  inputs.ecl.disabled = logo !== null
  el('ecl-note').hidden = logo === null

  const style: QrStyle = {
    foreground: settings.foreground,
    background: settings.background,
    moduleShape: settings.moduleShape,
    eyeStyle: settings.eyeStyle,
    margin: settings.margin,
  }
  const qrLogo: QrLogo | undefined = logo
    ? {
        href: logo.href,
        width: logo.image.naturalWidth,
        height: logo.image.naturalHeight,
        size: settings.logoSize,
        padding: settings.logoPadding,
      }
    : undefined

  if (result.ok) {
    current = { content, matrix: result.matrix, style, qrLogo }
    preview.innerHTML = renderSvg(result.matrix, style, qrLogo, { title: 'QR code preview' })
    preview.hidden = false
    previewEmpty.hidden = true
    const version = (result.matrix.size - 17) / 4
    payloadInfo.textContent = `${bytes} of ${MAX_BYTES[level]} bytes · version ${version} (${result.matrix.size} × ${result.matrix.size} modules)`
    if (bytes > 300)
      warnings.push(
        'This is a lot of content for one code. Dense codes are harder to scan from a distance, so print them larger.',
      )
  } else {
    current = null
    preview.innerHTML = ''
    preview.hidden = true
    previewEmpty.hidden = false
    if (result.reason === 'too-long') {
      previewEmpty.textContent = 'Too long to fit in a QR code.'
      payloadInfo.textContent = `${bytes} of ${MAX_BYTES[level]} bytes`
      warnings.push(
        `The content is ${bytes - MAX_BYTES[level]} bytes too long to encode at error correction ${level}. Shorten it${level === 'L' ? '' : logo ? ' or remove the logo' : ' or choose a lower error correction level'}.`,
      )
    } else {
      previewEmpty.textContent = EMPTY_HINTS[content.type]
      payloadInfo.textContent = ''
    }
  }

  warnings.push(...colourWarnings(settings.foreground, settings.background))
  if (settings.margin < 2)
    warnings.push(
      'A quiet zone under 2 modules may not scan, especially when the code is printed next to other things.',
    )

  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const p = document.createElement('p')
      p.className = 'warning'
      p.textContent = w
      return p
    }),
  )
  for (const b of [pngButton, svgButton, copyButton]) b.disabled = current === null
  saveSettings(settings)
}

let pending = false
function scheduleRender(): void {
  if (pending) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    render()
  })
}

form.addEventListener('submit', (e) => e.preventDefault())
form.addEventListener('input', scheduleRender)
form.addEventListener('change', scheduleRender)
inputs.ecl.addEventListener('change', () => {
  if (!logo) chosenEcl = inputs.ecl.value as ErrorCorrection
})
inputs.exportSize.addEventListener('change', render)

el('swap-colours').addEventListener('click', () => {
  ;[inputs.fg.value, inputs.bg.value] = [inputs.bg.value, inputs.fg.value]
  render()
})

// ---------- Logo ----------

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const MAX_LOGO_BYTES = 5 * 1024 * 1024
const logoError = el('logo-error')

function showLogoError(message: string): void {
  logoError.textContent = message
  logoError.hidden = message === ''
}

inputs.logoFile.addEventListener('change', async () => {
  const file = inputs.logoFile.files?.[0]
  inputs.logoFile.value = ''
  if (!file) return
  showLogoError('')
  const typeOk = LOGO_TYPES.includes(file.type) || /\.(png|jpe?g|svg)$/i.test(file.name)
  if (!typeOk) return showLogoError('Choose a PNG, JPG or SVG image.')
  if (file.size > MAX_LOGO_BYTES) return showLogoError('That image is over 5 MB. Choose a smaller one.')
  try {
    let href = await readAsDataUrl(file)
    // Some systems report no type for SVG files; label it so browsers will draw it.
    if (/\.svg$/i.test(file.name) && !href.startsWith('data:image/svg+xml'))
      href = href.replace(/^data:[^;,]*/, 'data:image/svg+xml')
    const image = await loadImage(href)
    logo = { href, name: file.name, image }
  } catch {
    return showLogoError('That image could not be read. Try a different file.')
  }
  el<HTMLImageElement>('logo-thumb').src = logo.href
  el('logo-name').textContent = logo.name
  el('logo-empty').hidden = true
  el('logo-set').hidden = false
  render()
})

el('remove-logo').addEventListener('click', () => {
  logo = null
  el<HTMLImageElement>('logo-thumb').removeAttribute('src')
  el('logo-empty').hidden = false
  el('logo-set').hidden = true
  inputs.ecl.value = chosenEcl
  render()
})

// ---------- Export ----------

function setStatus(message: string): void {
  exportStatus.textContent = message
}

function pngBlob(c: Current): Promise<Blob> {
  const size = Number(inputs.exportSize.value)
  const canvas = drawToCanvas(
    c.matrix,
    c.style,
    size,
    c.qrLogo && logo ? { logo: c.qrLogo, image: logo.image } : undefined,
  )
  return canvasToPng(canvas)
}

pngButton.addEventListener('click', async () => {
  if (!current) return
  try {
    downloadBlob(await pngBlob(current), exportFileName(current.content, 'png'))
    setStatus('')
  } catch {
    setStatus('The PNG could not be made. Try the SVG instead.')
  }
})

svgButton.addEventListener('click', () => {
  if (!current) return
  const svg = renderSvg(current.matrix, current.style, current.qrLogo, { pixelSize: Number(inputs.exportSize.value) })
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), exportFileName(current.content, 'svg'))
  setStatus('')
})

copyButton.addEventListener('click', async () => {
  if (!current) return
  try {
    await copyPng(pngBlob(current))
    setStatus('Copied. Paste it into a document or slide.')
  } catch {
    setStatus('Copying is blocked in this browser. Download the PNG instead.')
  }
})

render()
