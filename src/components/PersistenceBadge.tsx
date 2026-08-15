import type { PersistenceMeta } from '../storage/attendanceDb';

type PersistenceBadgeProps = {
  meta: PersistenceMeta;
};

export function PersistenceBadge({ meta }: PersistenceBadgeProps) {
  const label = meta.syncState === 'synced'
    ? `Saved to ${meta.fileName ?? 'attendance.csv'}`
    : meta.syncState === 'permission-required'
      ? 'File permission required'
      : 'Saved locally — export pending';

  return (
    <p className={`persistence-badge persistence-badge--${meta.syncState}`} role="status" aria-live="polite">
      {label}
    </p>
  );
}
