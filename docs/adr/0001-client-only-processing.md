# Files are processed entirely in the browser

Teachers open learners' personal work (scanned tests) and other school files in Red Pen, so no file content may leave the teacher's machine, in any tool. The site is static with no backend: every tool reads, renders and writes files client-side, and a Content-Security-Policy with `connect-src 'none'` on every page makes the browser itself refuse any network request from the page, so the claim is enforced rather than promised. No analytics, no third-party scripts or fonts; all libraries, fonts and the pdf.js worker are self-hosted. The only things persisted are small settings in the browser's local storage (for the marker: the reasons list, last-used out-of value and ink colour), never a file or its annotations. The one exception is opt-in: Sign and fill can remember the teacher's signature and initials (as images, under `red-pen.sign.` keys) only when they tick "Remember on this device", and offers a button to forget them. They are never stored by default and never leave the browser.

The UI states this plainly: on the landing page and on each tool's open screen. The trade-off is giving up server-side features (shared marking, cloud storage, accounts, OCR).

The offline service worker (ADR 0002) does not weaken this: it only fetches the site's own files, and the pages' `connect-src 'none'` is unchanged.
