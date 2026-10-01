# Learner PDFs are processed entirely in the browser

Scanned tests are learners' personal work, so no PDF content may leave the teacher's machine. The app is a static site with no backend: rendering and export both run client-side, and a Content-Security-Policy with `connect-src 'none'` makes the browser itself refuse any network request from the page, so the claim is enforced rather than promised. No analytics, no third-party scripts or fonts; all libraries (including the pdf.js worker) are self-hosted. The only thing persisted is the teacher's reasons list and last-used out-of value, in the browser's local storage, never the PDF or its annotations.

The UI states this plainly when a PDF is opened. The trade-off is giving up server-side features (shared marking, cloud storage, accounts, OCR).
