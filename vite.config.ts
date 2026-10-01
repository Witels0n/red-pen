import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Enforces ADR 0001: the browser itself refuses any network request from the page.
// GitHub Pages cannot set response headers, so the policy ships as a <meta> tag.
// Injected at build time only, because the dev server needs a websocket for HMR.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'pdf-marker-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig({
  base: '/pdf-marker/',
  plugins: [contentSecurityPolicy()],
  build: {
    // Never inline assets as data: URIs; the pdf.js worker must be a real, self-hosted file.
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
