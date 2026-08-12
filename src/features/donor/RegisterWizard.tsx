import { useCallback, useMemo, useRef, useState } from 'react'
import { m } from '@/lib/motion'
import { Stepper } from '@/components/Stepper'
import { Button } from '@/components/Button'
import { Honeypot, useFormTiming } from '@/components/form/Honeypot'
import { useI18n, type TKey } from '@/lib/i18n'
import { useReducedMotion } from '@/lib/hooks'
import { usePlaces } from '@/lib/places'
import { isSupabaseConfigured } from '@/lib/supabase'
import type { BloodGroup } from '@/lib/blood'

import { StepIdentity } from './steps/StepIdentity'
import { StepContact } from './steps/StepContact'
import { StepLocation } from './steps/StepLocation'
import { StepEligibility } from './steps/StepEligibility'
import { ShareCard } from './ShareCard'
import { emptyDonorForm, validateStep, type DonorForm, type Errors } from './validation'
import { submitDonor, type SubmitResult } from './submit'

const STEP_TITLES: TKey[] = [
  'register.step.identity',
  'register.step.contact',
  'register.step.location',
  'register.step.eligibility',
]

const FAILURE_MESSAGE: Record<string, TKey> = {
  not_configured: 'register.error.notConfigured',
  duplicate_phone: 'register.error.duplicatePhone',
  rate_limited: 'register.error.rateLimited',
  offline: 'register.error.offline',
  unknown: 'register.error.unknown',
}

export function RegisterWizard() {
  const { t, lang } = useI18n()
  const reduced = useReducedMotion()
  const { districts } = usePlaces()
  const timing = useFormTiming(4)

  const [step, setStep] = useState(0)
  const [form, setForm] = useState<DonorForm>(emptyDonorForm)
  const [errors, setErrors] = useState<Errors>({})
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<TKey | null>(null)
  const [done, setDone] = useState<{
    fullName: string
    bloodGroup: BloodGroup
    areaName: string | null
    districtName: string | null
    certificateToken: string
  } | null>(null)

  // Focus moves to the new step's heading so a screen reader announces it and
  // a keyboard user is not left at the bottom of the previous step.
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const update = useCallback((patch: Partial<DonorForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    // Clear the errors for whatever was just edited, so a message disappears
    // the moment it stops being true rather than lingering until the next
    // submit.
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof DonorForm)[]) delete next[key]
      return next
    })
  }, [])

  const goTo = useCallback((next: number) => {
    setStep(next)
    setFailure(null)
    requestAnimationFrame(() => {
      headingRef.current?.focus()
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    })
  }, [])

  const next = () => {
    const stepErrors = validateStep(step, form)
    setErrors(stepErrors)
    if (Object.keys(stepErrors).length > 0) return
    if (step < STEP_TITLES.length - 1) goTo(step + 1)
  }

  const back = () => {
    if (step > 0) goTo(step - 1)
  }

  const districtName = useMemo(() => {
    const district = districts.find((d) => d.id === form.districtId)
    if (!district) return null
    return lang === 'bn' ? district.name_bn : district.name_en
  }, [districts, form.districtId, lang])

  const submit = async () => {
    const stepErrors = validateStep(step, form)
    setErrors(stepErrors)
    if (Object.keys(stepErrors).length > 0) return

    // Both bot checks fail silently on purpose. Telling a script which signal
    // caught it just teaches whoever wrote it what to fix.
    if (honeypot.trim() !== '' || timing.tooFast()) {
      setFailure('register.error.unknown')
      return
    }

    setSubmitting(true)
    setFailure(null)

    const result: SubmitResult = await submitDonor(form)
    setSubmitting(false)

    if (result.ok) {
      setDone({
        fullName: form.fullName.trim(),
        bloodGroup: form.bloodGroup as BloodGroup,
        areaName: form.areaName.trim() || null,
        districtName,
        certificateToken: result.certificateToken,
      })
      return
    }
    setFailure(FAILURE_MESSAGE[result.reason] ?? 'register.error.unknown')
  }

  if (done) {
    return (
      <ShareCard
        fullName={done.fullName}
        bloodGroup={done.bloodGroup}
        areaName={done.areaName}
        districtName={done.districtName}
        certificateToken={done.certificateToken}
      />
    )
  }

  const stepProps = { form, errors, update }
  const isLast = step === STEP_TITLES.length - 1

  return (
    <section className="mx-auto max-w-xl px-4 py-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-hero font-extrabold outline-none"
      >
        {t('page.register.title')}
      </h1>
      <p className="mt-2 text-muted">{t('register.intro')}</p>

      {!isSupabaseConfigured && (
        <p role="status" className="mt-4 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('register.error.notConfigured')}
        </p>
      )}

      <div className="mt-6">
        <Stepper steps={STEP_TITLES.map((key) => t(key))} current={step} />
      </div>

      <form
        className="relative mt-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (isLast) void submit()
          else next()
        }}
        noValidate
      >
        <Honeypot value={honeypot} onChange={setHoneypot} />

        <m.div
          key={step}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.25, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {step === 0 && <StepIdentity {...stepProps} />}
          {step === 1 && <StepContact {...stepProps} />}
          {step === 2 && <StepLocation {...stepProps} />}
          {step === 3 && <StepEligibility {...stepProps} />}
        </m.div>

        {failure && (
          <p role="alert" className="mt-5 rounded-md border-2 border-line bg-shindur-fill px-3 py-2.5 text-sm font-bold text-tile-ink">
            {t(failure)}
          </p>
        )}

        <div className="mt-8 flex gap-3">
          {step > 0 && (
            <Button type="button" variant="secondary" size="lg" onClick={back}>
              {t('common.back')}
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" disabled={submitting}>
            {submitting
              ? t('register.submitting')
              : isLast
                ? t('register.submit')
                : t('common.next')}
          </Button>
        </div>
      </form>
    </section>
  )
}
