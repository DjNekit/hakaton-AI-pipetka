import type { ApplicationStatus } from '../model'

const COLORS: Record<ApplicationStatus, string> = {
  review: 'text-amber-500',
  normcontrol: 'text-indigo-500',
  approved: 'text-emerald-500',
  rejected: 'text-muted-foreground',
}

export function StatusIcon({
  status,
  className = 'size-3.5',
}: {
  status: ApplicationStatus
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={`${COLORS[status]} shrink-0 ${className}`}
    >
      {status === 'review' && (
        <>
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )}
      {status === 'normcontrol' && (
        <>
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M7 3.5a3.5 3.5 0 1 1-3.5 3.5H7z" fill="currentColor" />
        </>
      )}
      {status === 'approved' && (
        <>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path
            d="M4.5 7.2l1.7 1.7 3.3-3.6"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === 'rejected' && (
        <>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path
            d="M5 5l4 4M9 5l-4 4"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}
