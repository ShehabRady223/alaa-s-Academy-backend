export type EffectiveStatus = 'draft' | 'archived' | 'scheduled' | 'active' | 'expired';

/** Active/expired are derived from dates, so no cron job is needed to keep them correct. */
export function effectiveStatus(
  e: { status: string; startDate?: Date | null; expiresAt?: Date | null },
  now = new Date(),
): EffectiveStatus {
  if (e.status === 'draft' || e.status === 'archived') return e.status;
  if (e.startDate && e.startDate > now) return 'scheduled';
  if (e.expiresAt && e.expiresAt <= now) return 'expired';
  return 'active';
}
