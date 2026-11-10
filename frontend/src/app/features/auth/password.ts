import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** At least 8 characters, containing letters and numbers. */
export const strongPassword: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const v = String(c.value ?? '');
  if (!v) return null;
  return v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? null : { weak: true };
};

export const matchPassword =
  (field: string): ValidatorFn =>
  (c: AbstractControl): ValidationErrors | null => {
    const other = c.parent?.get(field)?.value;
    return c.value && other !== c.value ? { mismatch: true } : null;
  };

/** 0–4 strength score for the meter. */
export function passwordScore(v: string): number {
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  return s;
}
