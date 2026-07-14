import { describe, expect, it } from 'vitest'

import { buttonVariants } from '@/components/ui/button'

describe('buttonVariants', () => {
  it('keeps pointer hover feedback inside the original hit box', () => {
    const classes = buttonVariants()

    expect(classes).toContain('hover:bg-primary/90')
    expect(classes).not.toContain('hover:-translate-y')
    expect(classes).not.toMatch(/active[^ ]*:translate-y/)
  })
})
