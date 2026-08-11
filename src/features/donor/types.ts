import type { DonorForm, Errors } from './validation'

export type StepProps = {
  form: DonorForm
  errors: Errors
  update: (patch: Partial<DonorForm>) => void
}
