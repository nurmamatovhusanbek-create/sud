'use client'

import { toast } from 'sonner'

/**
 * A case number (or any identifier) that copies itself when clicked. It sits inside list rows that open a detail on click, so the
 * click stops here: the number copies, the rest of the row still opens the case. Enter and Space work too (a keyboard user lands on
 * it with Tab). Feedback is the app's toast; `what` is the Uzbek name of the thing in the message («Ish raqami nusxalandi»).
 */
export function CopyText({ text, what = 'Ish raqami', className = '', tag = 'b' }: { text: string; what?: string; className?: string; tag?: 'b' | 'span' }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} nusxalandi`)
    } catch {
      toast.error('Nusxalab boʻlmadi')
    }
  }
  const Tag = tag
  return (
    <Tag
      className={`copy-id mono ${className}`.trim()}
      role="button"
      tabIndex={0}
      title="Nusxalash uchun bosing"
      aria-label={`${what} ${text}: nusxalash`}
      data-copy-id
      onClick={(e) => { e.stopPropagation(); void copy() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); void copy() }
      }}
    >
      {text}
    </Tag>
  )
}
