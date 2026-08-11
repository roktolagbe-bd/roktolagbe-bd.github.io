import { Field, Input } from '@/components/form/Field'
import { BLOOD_GROUPS, splitGroup, tileColorVar } from '@/lib/blood'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import type { StepProps } from '../types'

export function StepIdentity({ form, errors, update }: StepProps) {
  const { t } = useI18n()

  return (
    <div className="grid gap-5">
      <Field label={t('form.fullName')} error={errors.fullName ? t(errors.fullName) : null} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.fullName}
            onChange={(e) => update({ fullName: e.target.value })}
            autoComplete="name"
            enterKeyHint="next"
          />
        )}
      </Field>

      <Field
        label={t('form.displayName')}
        hint={t('form.displayName.hint')}
        error={errors.displayName ? t(errors.displayName) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.displayName}
            onChange={(e) => update({ displayName: e.target.value })}
            placeholder={form.fullName.trim().split(' ')[0] || ''}
          />
        )}
      </Field>

      {/* A radio group, not a dropdown. Blood group is the single most
          important field in the form and it deserves to be one tap. The
          tiles are the same object as the landing page grid. */}
      <fieldset>
        <legend className="text-sm font-bold">
          {t('form.bloodGroup')}
          <span className="text-shindur" aria-hidden="true">
            {' '}
            *
          </span>
        </legend>

        <div className="mt-2 grid grid-cols-4 gap-2">
          {BLOOD_GROUPS.map((group) => {
            const { letters, sign } = splitGroup(group)
            const selected = form.bloodGroup === group
            return (
              <label
                key={group}
                className={cn(
                  'ink-press relative flex aspect-[5/4] cursor-pointer flex-col items-center justify-center',
                  'rounded-[12px] border-2 border-line text-tile-ink shadow-ink-2',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-3',
                  'has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-[color:var(--c-focus)]',
                  selected && 'ring-4 ring-ink ring-offset-2 ring-offset-surface',
                )}
                style={{ backgroundColor: tileColorVar(group) }}
              >
                <input
                  type="radio"
                  name="blood_group"
                  value={group}
                  checked={selected}
                  onChange={() => update({ bloodGroup: group })}
                  className="sr-only"
                />
                <span aria-hidden="true" className="text-xl leading-none font-extrabold sm:text-2xl">
                  {letters}
                </span>
                <span
                  aria-hidden="true"
                  className="mt-1 rounded-sm bg-tile-ink px-1.5 text-xs leading-tight font-extrabold"
                  style={{ color: tileColorVar(group) }}
                >
                  {sign === '+' ? '+' : '−'}
                </span>
                <span className="sr-only">
                  {letters} {sign === '+' ? t('group.positive') : t('group.negative')}
                </span>
                {/* Selection is shown by a ring AND a tick, never by colour
                    alone. */}
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-tile-ink text-[11px] font-extrabold"
                    style={{ color: tileColorVar(group) }}
                  >
                    ✓
                  </span>
                )}
              </label>
            )
          })}
        </div>

        {errors.bloodGroup && (
          <p role="alert" className="mt-2 text-sm font-bold text-shindur">
            {t(errors.bloodGroup)}
          </p>
        )}
      </fieldset>
    </div>
  )
}
