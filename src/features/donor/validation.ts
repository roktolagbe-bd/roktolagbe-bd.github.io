import type { TKey } from '@/lib/i18n'
import type { BloodGroup } from '@/lib/blood'
import type { Coords } from '@/lib/geolocation'

export type DonorForm = {
  fullName: string
  displayName: string
  bloodGroup: BloodGroup | ''

  phone: string
  whatsapp: string
  email: string
  facebookUrl: string

  districtId: number | null
  /** PUBLIC. The neighbourhood, e.g. "গুলশান-১". Auto-filled, editable. */
  areaName: string
  /** PRIVATE. House and road. Released to one accepted requester, never shown. */
  addressLine: string
  coords: Coords | null

  dateOfBirth: string
  weightKg: string
  lastDonationDate: string

  consentEmail: boolean
  consentPublicListing: boolean
  confirmEligible: boolean
}

export const emptyDonorForm: DonorForm = {
  fullName: '',
  displayName: '',
  bloodGroup: '',
  phone: '',
  whatsapp: '',
  email: '',
  facebookUrl: '',
  districtId: null,
  areaName: '',
  addressLine: '',
  coords: null,
  dateOfBirth: '',
  weightKg: '',
  lastDonationDate: '',
  consentEmail: true,
  consentPublicListing: true,
  confirmEligible: false,
}

export type Errors = Partial<Record<keyof DonorForm, TKey>>

/* Eligibility thresholds used across Bangladesh. The checker page and this
   form must agree, so they read from here. */
/**
 * How long a public area name may be. Matches the check constraint on
 * donors.area_name.
 *
 * The number is doing privacy work, not tidiness work. "উত্তরা সেক্টর ১৩" is
 * fifteen characters; a street address does not fit. Keeping the public field
 * too small to hold a doorstep is a cheaper guarantee than trusting everyone
 * to read the hint under it.
 */
export const MAX_AREA_NAME = 60

/**
 * Whether a public area name looks like somebody's front door.
 *
 * Not a blocker, because it cannot be one: "সেক্টর ১৩" and "বাড়ি ১৩" differ by
 * a word, and false positives on a required-feeling field are worse than the
 * thing they prevent. This drives a warning the user can ignore.
 *
 * A run of four or more digits is the signal. Area names carry small numbers
 * (Gulshan 1, Sector 13, Mirpur 10); holding numbers and postcodes do not.
 */
export function looksLikeStreetAddress(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  // Bangla digits are separate code points and would otherwise slip past \d.
  const ascii = text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
  return /\d{4,}/.test(ascii) || /,.*\d/.test(ascii)
}

export const MIN_AGE = 18
export const MAX_AGE = 65
export const MIN_WEIGHT_KG = 45
export const COOLDOWN_DAYS = 120

/**
 * Phone numbers, stored as plain international digits.
 *
 * Bangladesh is checked strictly, because we know the shape: 88 followed by
 * 01[3-9] and eight more digits. Everything else is checked loosely, since a
 * donor visiting from Riyadh or a relative in London asking on someone's
 * behalf is a real case and inventing per-country rules we cannot test would
 * reject valid numbers.
 *
 * Still accepts what people type by hand: 01712345678, +8801712345678, or any
 * of those with spaces and dashes.
 */
const BD_PATTERN = /^(?:\+?88)?(01[3-9]\d{8})$/

export function normalisePhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-()+]/g, '')
  if (!cleaned) return null

  const bd = BD_PATTERN.exec(cleaned)
  if (bd) return `88${bd[1]}`

  // A non-Bangladeshi number, already in international form from PhoneInput.
  // 8 to 15 digits covers every country's international format.
  if (/^\d{8,15}$/.test(cleaned) && !cleaned.startsWith('880')) return cleaned

  return null
}

/** 8801712345678 -> 01712-345678, which is how it is read aloud here. */
export function formatPhone(normalised: string): string {
  const local = normalised.startsWith('88') ? normalised.slice(2) : normalised
  return local.length === 11 ? `${local.slice(0, 5)}-${local.slice(5)}` : local
}

export function yearsSince(dateString: string): number | null {
  if (!dateString) return null
  const then = new Date(dateString)
  if (Number.isNaN(then.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - then.getFullYear()
  const monthDiff = now.getMonth() - then.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < then.getDate())) age--
  return age
}

export function daysSince(dateString: string): number | null {
  if (!dateString) return null
  const then = new Date(dateString)
  if (Number.isNaN(then.getTime())) return null
  return Math.floor((Date.now() - then.getTime()) / 86_400_000)
}

/** The date a donor becomes eligible again, or null if they already are. */
export function nextEligibleDate(lastDonation: string): Date | null {
  const days = daysSince(lastDonation)
  if (days == null || days >= COOLDOWN_DAYS) return null
  const then = new Date(lastDonation)
  then.setDate(then.getDate() + COOLDOWN_DAYS)
  return then
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validation runs per step so someone is told about a problem on the screen
 * where they can fix it, not after four steps of typing.
 */
export function validateStep(step: number, form: DonorForm): Errors {
  const errors: Errors = {}

  if (step === 0) {
    if (form.fullName.trim().length < 2) errors.fullName = 'validation.nameRequired'
    if (!form.bloodGroup) errors.bloodGroup = 'validation.bloodGroupRequired'
  }

  if (step === 1) {
    if (!form.phone.trim()) errors.phone = 'validation.phoneRequired'
    else if (!normalisePhone(form.phone)) errors.phone = 'validation.phoneInvalid'

    if (form.whatsapp.trim() && !normalisePhone(form.whatsapp)) {
      errors.whatsapp = 'validation.phoneInvalid'
    }
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
      errors.email = 'validation.emailInvalid'
    }
    // Email is how a donor hears about a request. Asking for it only when they
    // opted in keeps the promise that we will not collect what we do not use.
    if (form.consentEmail && !form.email.trim()) {
      errors.email = 'validation.emailNeededForAlerts'
    }
    if (form.facebookUrl.trim() && !/facebook\.com|fb\.com|fb\.me/i.test(form.facebookUrl)) {
      errors.facebookUrl = 'validation.facebookInvalid'
    }
  }

  if (step === 2) {
    if (!form.districtId) errors.districtId = 'validation.districtRequired'
    if (form.areaName.trim().length > MAX_AREA_NAME) errors.areaName = 'validation.areaTooLong'
  }

  if (step === 3) {
    const age = yearsSince(form.dateOfBirth)
    if (form.dateOfBirth && age != null) {
      if (age < MIN_AGE) errors.dateOfBirth = 'validation.tooYoung'
      else if (age > MAX_AGE) errors.dateOfBirth = 'validation.tooOld'
    }

    const weight = Number(form.weightKg)
    if (form.weightKg && (Number.isNaN(weight) || weight < MIN_WEIGHT_KG)) {
      errors.weightKg = 'validation.tooLight'
    }

    if (form.lastDonationDate) {
      const days = daysSince(form.lastDonationDate)
      if (days == null || days < 0) errors.lastDonationDate = 'validation.dateInFuture'
    }

    if (!form.confirmEligible) errors.confirmEligible = 'validation.mustConfirm'
  }

  return errors
}

export function firstErrorStep(form: DonorForm): number | null {
  for (let step = 0; step < 4; step++) {
    if (Object.keys(validateStep(step, form)).length > 0) return step
  }
  return null
}
