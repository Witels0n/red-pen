import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

/** Where GitHub Pages serves the site. Change this one value to move the site. */
export const BASE = '/red-pen/'

/**
 * Every page on the site: the landing page plus one page per Tool.
 * Adding a Tool means adding its page here and its entry in src/landing/tools.ts.
 */
export const PAGES = {
  landing: 'index.html',
  mark: 'mark/index.html',
  qr: 'qr/index.html',
} as const

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
  "manifest-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'red-pen-csp',
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
  base: BASE,
  plugins: [
    contentSecurityPolicy(),
    // Offline-first: precaches every page and asset so the whole site works without a
    // connection after one visit. See docs/adr/0002-multi-page-offline-site.md.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Red Pen',
        short_name: 'Red Pen',
        description: 'Free tools for teachers. Everything runs in your browser, so files are never uploaded.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#fdfdfb',
        theme_color: '#d3212d',
        lang: 'en-ZA',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'Mark a test', url: `${BASE}mark/`, icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] }],
      },
      workbox: {
        // woff2 only: every browser that supports service workers reads woff2.
        globPatterns: ['**/*.{html,js,mjs,css,woff2,svg,png,webmanifest}'],
        // The pdf.js worker is larger than Workbox's 2 MB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: null,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Never inline assets as data: URIs; the pdf.js worker must be a real, self-hosted file.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, file]) => [name, resolve(import.meta.dirname, file)])),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
