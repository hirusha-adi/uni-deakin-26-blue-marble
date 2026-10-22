'use client'

import type { RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

/** Brief feedback for an action; live counters and attempt rows stay untouched. */
export function useFeedbackMotion(
  scope: RefObject<HTMLElement | null>,
  trigger: unknown,
  enabled = true,
  selector = '[data-motion-result]',
) {
  useGSAP(() => {
    const element = scope.current
    if (!element || !enabled) return

    const targets = element.matches(selector)
      ? [element]
      : Array.from(element.querySelectorAll<HTMLElement>(selector))
    if (!targets.length) return

    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(targets, { opacity: 0.55, y: 6 }, {
        opacity: 1,
        y: 0,
        duration: 0.22,
        ease: 'power1.out',
        clearProps: 'opacity,transform',
        overwrite: 'auto',
      })
    })

    return () => media.revert()
  }, { scope, dependencies: [trigger, enabled, selector], revertOnUpdate: true })
}
