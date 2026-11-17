import { describe, expect, it } from 'vitest'
import { assessmentFromFile, assessmentToFile } from '../../src/mcq/core/assessment-file'
import {
  checkImageSrc,
  encodingFor,
  fitImage,
  fitWithin,
  hasTransparency,
  imageInfo,
  MAX_IMAGE_BYTES,
  sourceProblem,
} from '../../src/mcq/core/images'
import {
  hasPrintedContent,
  optionImage,
  withOptionCount,
  withOptionImage,
  withQuestion,
  withQuestionImage,
} from '../../src/mcq/core/model'
import { keepImages, questionsFromCsv, questionsToCsv } from '../../src/mcq/core/questions-csv'
import { assessment } from './fixtures'
import { jpegImage, pngImage } from './image-fixtures'

describe('downscaling', () => {
  it('fits the longer side within 1000 px, keeping the aspect ratio, and never enlarges', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1000, height: 750 })
    expect(fitWithin(1200, 2400)).toEqual({ width: 500, height: 1000 })
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 })
    expect(fitWithin(5000, 3)).toEqual({ width: 1000, height: 1 })
  })

  it('keeps PNG for transparency and uses JPEG at 0.85 otherwise', () => {
    expect(hasTransparency([0, 0, 0, 255, 9, 9, 9, 255])).toBe(false)
    expect(hasTransparency([0, 0, 0, 255, 9, 9, 9, 128])).toBe(true)
    expect(encodingFor(true)).toEqual({ type: 'image/png' })
    expect(encodingFor(false)).toEqual({ type: 'image/jpeg', quality: 0.85 })
  })

  it('refuses files that are not pictures, or are very large, with a sentence', () => {
    expect(sourceProblem({ name: 'notes.pdf', type: 'application/pdf', size: 1000 })).toMatch(/is not a picture/)
    expect(sourceProblem({ name: 'logo.svg', type: 'image/svg+xml', size: 1000 })).toMatch(/is not a picture/)
    expect(sourceProblem({ name: 'big.jpg', type: 'image/jpeg', size: 30 * 1024 * 1024 })).toMatch(
      /too large \(30\.0 MB\)/,
    )
    expect(sourceProblem({ name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 })).toBeNull()
    expect(sourceProblem({ name: 'paste.png', type: '', size: 10 })).toBeNull()
  })
})

describe('checking stored pictures', () => {
  it('reads the size of a PNG and a JPEG from their bytes', () => {
    const png = pngImage(30, 20)
    const jpeg = jpegImage(17, 41)
    expect(checkImageSrc(png.src)).toMatchObject({ ok: true, image: { width: 30, height: 20 } })
    expect(checkImageSrc(jpeg.src)).toMatchObject({ ok: true, image: { width: 17, height: 41 } })
    expect(imageInfo(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })

  it('refuses other types, a wrong type label, broken data and pictures over the cap', () => {
    const png = pngImage(10, 10)
    expect(checkImageSrc('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toEqual({
      ok: false,
      problem: 'must be a PNG or JPEG picture',
    })
    expect(checkImageSrc(png.src.replace('image/png', 'image/jpeg'))).toMatchObject({ ok: false })
    expect(checkImageSrc('data:image/png;base64,!!!')).toMatchObject({ ok: false })
    expect(checkImageSrc('https://example.com/a.png')).toMatchObject({ ok: false })
    expect(checkImageSrc(42)).toMatchObject({ ok: false })
    const huge = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100)}`
    expect(checkImageSrc(huge)).toMatchObject({ ok: false, problem: expect.stringContaining('at most 3.0 MB') })
  })

  it('draws a picture as large as fits, but not beyond 150 dots per inch', () => {
    expect(fitImage({ width: 1000, height: 500 }, 300, 100)).toEqual({ width: 200, height: 100 })
    expect(fitImage({ width: 1000, height: 200 }, 300, 100)).toEqual({ width: 300, height: 60 })
    const small = fitImage({ width: 150, height: 150 }, 500, 500)
    expect(small.width).toBeCloseTo(72)
  })
})

describe('pictures in questions', () => {
  it('follow their option when the option count changes, and count as content to print', () => {
    const a = assessment(2)
    const pic = pngImage(8, 8)
    let q = withOptionImage(a.questions[0], 3, pic)
    expect(q.optionImages).toEqual([null, null, null, pic])
    expect(hasPrintedContent([q])).toBe(true)
    expect(withOptionCount(q, 5).optionImages).toEqual([null, null, null, pic, null])
    expect(withOptionCount(q, 3).optionImages).toBeUndefined()
    q = withOptionImage(q, 3, null)
    expect(q.optionImages).toBeUndefined()
    expect(hasPrintedContent([withQuestionImage(a.questions[0], pic)])).toBe(true)
    expect(hasPrintedContent(a.questions)).toBe(false)
  })

  it('travel in the Assessment file and are checked on import', () => {
    let a = assessment(3)
    const pic = pngImage(12, 9)
    a = withQuestion(a, 0, withQuestionImage(a.questions[0], pic))
    a = withQuestion(a, 1, withOptionImage(a.questions[1], 1, jpegImage(5, 5)))
    const back = assessmentFromFile(assessmentToFile(a))
    expect(back).toEqual({ ok: true, assessment: a })

    const file = JSON.parse(assessmentToFile(a))
    file.assessment.questions[1].optionImages[1].src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    file.assessment.questions[0].image = { src: pic.src.replace('image/png', 'image/jpeg'), width: 1, height: 1 }
    const bad = assessmentFromFile(JSON.stringify(file))
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.problems).toEqual([
      'This Assessment file has problems:',
      'Question 1: the picture must be a PNG or JPEG picture.',
      'Question 2: the picture for option B must be a PNG or JPEG picture.',
    ])
  })

  it('take their size from the picture itself, not from what the file says', () => {
    let a = assessment(1)
    const pic = pngImage(12, 9)
    a = withQuestion(a, 0, withQuestionImage(a.questions[0], pic))
    const file = JSON.parse(assessmentToFile(a))
    file.assessment.questions[0].image.width = 99999
    const back = assessmentFromFile(JSON.stringify(file))
    expect(back.ok && back.assessment.questions[0].image).toEqual(pic)
  })

  it('are not in the questions CSV, and can be kept by question number on import', () => {
    let a = assessment(3)
    const stem = pngImage(4, 4)
    const optionB = pngImage(6, 6, '#3c3')
    const optionD = pngImage(7, 7, '#33c')
    a = withQuestion(a, 0, withQuestionImage(a.questions[0], stem))
    a = withQuestion(a, 0, withOptionImage(a.questions[0], 1, optionB))
    a = withQuestion(a, 2, withOptionImage(a.questions[2], 3, optionD))
    const csv = questionsToCsv(a.questions)
    expect(csv).not.toContain('data:image')
    // The new file has two questions, the second with three options.
    const result = questionsFromCsv('number,question,A,B,C,answer\n1,One,a,b,c,A\n2,Two,a,b,,B\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const kept = keepImages(a.questions, result.questions)
    expect(kept[0].image).toEqual(stem)
    expect(optionImage(kept[0], 1)).toEqual(optionB)
    expect(kept[1].image).toBeUndefined()
    expect(kept).toHaveLength(2)
    // Without keeping, the imported questions have no pictures.
    expect(result.questions.some((q) => q.image || q.optionImages)).toBe(false)
  })
})
