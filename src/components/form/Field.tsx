import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

type FieldProps = {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/**
 * One labelled control.
 *
 * Every input on this site goes through here, so there is no way to ship one
 * without a real <label>. Placeholders are not labels: they vanish when typing
 * starts, which is exactly when someone filling a form under stress needs to
 * be reminded what the box is for.
 */
export function Field({ label, hint, error, required = false, children }: FieldProps) {
  const { t } = useI18n()
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
        {required ? (
          <span className="text-shindur" aria-hidden="true">
            {' '}
            *
          </span>
        ) : (
          <span className="ml-1.5 font-normal text-muted">{t('form.optional')}</span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}

      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}

      {error && (
        // Announced when it appears, so a screen reader user is not left
        // wondering why the form did not submit.
        <p id={errorId} role="alert" className="text-sm font-bold text-shindur">
          {error}
        </p>
      )}
    </div>
  )
}

const controlBase =
  'w-full min-h-12 rounded-md border-2 bg-raise px-3 text-ink placeholder:text-muted/70 ' +
  'shadow-ink-1 transition-colors'

export function inputClass(invalid: boolean, className?: string) {
  return cn(controlBase, invalid ? 'border-shindur' : 'border-line', className)
}

export function Input({
  invalid = false,
  className,
  ...rest
}: { invalid?: boolean } & React.ComponentProps<'input'>) {
  return <input className={inputClass(invalid, className)} aria-invalid={invalid} {...rest} />
}

export function Select({
  invalid = false,
  className,
  children,
  ...rest
}: { invalid?: boolean } & React.ComponentProps<'select'>) {
  return (
    <select className={inputClass(invalid, className)} aria-invalid={invalid} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({
  invalid = false,
  className,
  ...rest
}: { invalid?: boolean } & React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={inputClass(invalid, cn('min-h-24 py-2', className))}
      aria-invalid={invalid}
      {...rest}
    />
  )
}

/**
 * A checkbox with a large hit area. The whole row is tappable, because a 16px
 * box is not a target on a cheap phone held one-handed in a hospital corridor.
 */
export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: { label: ReactNode; hint?: string } & React.ComponentProps<'input'>) {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <div className={cn('rounded-md border-2 border-line bg-raise p-3 shadow-ink-1', className)}>
      <div className="flex gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-6 shrink-0 accent-nil"
          aria-describedby={hint ? hintId : undefined}
          {...rest}
        />
        <label htmlFor={id} className="min-h-6 cursor-pointer text-sm leading-snug font-bold">
          {label}
        </label>
      </div>
      {hint && (
        <p id={hintId} className="mt-2 pl-9 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
