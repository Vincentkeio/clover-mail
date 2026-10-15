'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/** Fit the desktop shell as one unit; mobile keeps its native responsive layout. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useLayoutEffect(() => {
    const root = frame.current
    if (!root) return
    let request = 0
    let live = true
    const desktop = window.matchMedia('(min-width: 900px)')
    function fit() {
      if (!root) return
      if (!desktop.matches) {
        root.style.removeProperty('--frame-scale')
        root.style.removeProperty('--frame-width')
        root.style.removeProperty('--frame-height')
        root.style.removeProperty('--page-width')
        return
      }
      const width = Math.max(1180, window.innerWidth)
      // Measure at a stable logical width, independent of the previous fit.
      root.style.setProperty('--frame-width', `${width}px`)
      const sidebar = root.querySelector<HTMLElement>('.app-sidebar')
      const collapsed = sidebar?.dataset.collapsed === 'true'
      root.style.setProperty('--page-width', `${Math.min(1120, width - (collapsed ? 72 : 244))}px`)
      const brand = root.querySelector<HTMLElement>('.sidebar-brand')
      const nav = root.querySelector<HTMLElement>('.sidebar-nav')
      const account = root.querySelector<HTMLElement>('.sidebar-account')
      const page = root.querySelector<HTMLElement>('.page-container')
      const navHeight = sidebar?.dataset.collapsed === 'true' ? 0
        : (brand?.offsetHeight ?? 0) + (nav?.scrollHeight ?? 0) + (account?.offsetHeight ?? 0) + 28
      const height = Math.max(navHeight, page?.scrollHeight ?? 0, 1)
      const scale = Math.min(1, window.innerWidth / width, window.innerHeight / height)
      root.style.setProperty('--frame-scale', String(scale))
      root.style.setProperty('--frame-height', `${window.innerHeight / scale}px`)
      root.style.setProperty('--frame-width', `${window.innerWidth / scale}px`)
    }
    function schedule() {
      cancelAnimationFrame(request)
      request = requestAnimationFrame(fit)
    }
    const observer = new ResizeObserver(schedule)
    const page = root.querySelector('.page-container')
    const nav = root.querySelector('.sidebar-nav')
    if (page) observer.observe(page)
    if (nav) observer.observe(nav)
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-collapsed', 'hidden', 'open'] })
    window.addEventListener('resize', schedule)
    desktop.addEventListener('change', schedule)
    void document.fonts.ready.then(() => { if (live) schedule() })
    fit()
    return () => {
      live = false
      cancelAnimationFrame(request)
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      desktop.removeEventListener('change', schedule)
    }
  }, [pathname])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const page = frame.current?.querySelector<HTMLElement>('.page-container')
    const animation = page?.animate([
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 240, easing: 'cubic-bezier(.25,1,.5,1)' })
    return () => animation?.cancel()
  }, [pathname])

  return <div ref={frame} className="app-frame">{children}</div>
}
