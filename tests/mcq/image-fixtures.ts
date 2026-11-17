// Small real PNG and JPEG pictures for the MCQ tests, drawn with @napi-rs/canvas.
import { createCanvas } from '@napi-rs/canvas'
import { bytesToDataUrl } from '../../src/mcq/core/images'
import type { QuestionImage } from '../../src/mcq/core/model'

export function pngImage(width: number, height: number, colour = '#c33'): QuestionImage {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, width, height)
  return { src: bytesToDataUrl(new Uint8Array(canvas.toBuffer('image/png')), 'image/png'), width, height }
}

export function jpegImage(width: number, height: number): QuestionImage {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#36c'
  ctx.fillRect(0, 0, width, height)
  return { src: bytesToDataUrl(new Uint8Array(canvas.toBuffer('image/jpeg')), 'image/jpeg'), width, height }
}
