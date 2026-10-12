import { AlertTriangle, ArrowRight, LoaderCircle } from 'lucide-react';

export function LoadingState({ label = 'Connecting your workspace…' }: { label?: string }) {
  return (
    <div className="state-card loading-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-card error-state" role="alert">
      <AlertTriangle size={21} aria-hidden="true" />
      <div>
        <strong>We couldn’t reach your workspace.</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button className="button button-quiet button-small" type="button" onClick={onRetry}>
          Try again <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="empty-state">
      <div className="empty-orb" aria-hidden="true"><span /></div>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}
