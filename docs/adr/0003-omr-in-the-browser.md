# Answer sheets are read in the browser with plain TypeScript

MCQ Answer sheets are printed and read back (OMR) on the teacher's device, following ADR 0001. We
wrote the reader in plain TypeScript, running in a Web Worker, rather than using OpenCV.js or any
other WebAssembly library. The site's CSP has no `wasm-unsafe-eval` and we do not want to loosen it;
OpenCV.js is also around 8 MB, which would dominate the offline precache for one Tool. The job is
narrow because we control the sheet: four solid corner squares, a QR in a known place and bubbles at
known positions. Thresholding, connected components, a homography and sampling are a few hundred
lines, and jsQR (pure JavaScript) decodes the QR, with BarcodeDetector used as a hint where the
browser has it.

One pure function, `layoutSheet`, positions everything on the page, and both the PDF printer and the
reader use its output, so the printer cannot place a bubble where the reader does not look. The
layout tests check its invariants once for both.

Every read carries a confidence, and anything uncertain goes to Review instead of being guessed. The
measure we optimise is silent errors (a wrong answer that is not flagged), not raw accuracy. Bubble
darkness is measured against the sheet's own paper (a local paper map, so shadows cancel) and its own
printed black (the corner squares), and the fill thresholds follow the learner's own pencil. Light
marks, erasures, double and crossed-out answers, and any group of bubbles whose printed outlines do
not line up (a bent page or a strong lens) are flagged. The synthetic test matrix
(`tests/omr/synthetic.test.ts`, see `docs/omr.md`) holds the reader to zero silent errors.

## Considered options

- **OpenCV.js or another WASM build**: more general, but needs `wasm-unsafe-eval` and a large download,
  and its generality buys little on a sheet we design.
- **Server-side reading**: ruled out by ADR 0001.
- **Letters printed above the columns instead of inside the bubbles**: cleaner signal, but learners
  lose their place. Letters are printed inside in light grey and their ink is subtracted per letter.
