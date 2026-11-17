import './motion.css'

/**
 * Small, cute motion for the whole site. Anything marked data-reveal plays its animation the
 * first time it scrolls into view. CSS does the animating; this only says when. Without
 * JavaScript, or for people who ask for reduced motion, everything simply shows as it is.
 */
export function startMotion(root: Document = document): void {
  if (typeof IntersectionObserver === 'undefined') return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const targets = root.querySelectorAll<HTMLElement>('[data-reveal]')
  if (targets.length === 0) return

  root.documentElement.classList.add('motion')
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-seen')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  )
  for (const target of targets) observer.observe(target)
}

startMotion()
