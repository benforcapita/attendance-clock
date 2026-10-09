import type { PersistenceMeta } from '../storage/attendanceDb';

type PersistenceBadgeProps = {
  meta: PersistenceMeta;
  saving?: boolean;
};

export function PersistenceBadge({ meta, saving = false }: PersistenceBadgeProps) {
  const label = saving ? 'Saving attendance…' : meta.syncState === 'synced'
    ? `Saved to ${meta.fileName ?? 'attendance.csv'}`
    : meta.syncState === 'permission-required'
      ? 'File permission required'
      : 'Saved locally — export pending';

  return (
    <p className={`persistence-badge persistence-badge--${saving ? 'pending' : meta.syncState}`} role="status" aria-live="polite">
      {label}
    </p>
  );
}
