import { m } from '@/lib/motion'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

type Props = {
  steps: string[]
  current: number
}

/**
 * Progress through the registration wizard.
 *
 * Shows how many steps are left, because "how much more of this is there" is
 * the question that makes people abandon a form. The current step is named,
 * not just numbered.
 */
export function Stepper({ steps, current }: Props) {
  const { t, n } = useI18n()
  const total = steps.length
  const percent = ((current + 1) / total) * 100

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold">
          {steps[current]}
        </p>
        <p className="text-sm text-muted tabular-nums">
          {t('form.stepOf', { current: n(current + 1), total: n(total) })}
        </p>
      </div>

      <div
        className="mt-2 h-3 w-full overflow-hidden rounded-full border-2 border-line bg-sunk"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={steps[current]}
      >
        <m.div
          className="h-full bg-nil"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </div>

      <ol className="mt-2 flex gap-1.5" aria-hidden="true">
        {steps.map((label, index) => (
          <li
            key={label}
            className={cn(
              'h-1 flex-1 rounded-full',
              index <= current ? 'bg-ink' : 'bg-line-soft',
            )}
          />
        ))}
      </ol>
    </div>
  )
}
