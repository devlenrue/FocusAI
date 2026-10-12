import { Sparkles } from 'lucide-react';

export function FocusMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="FocusAI">
      <span className="brand-orb" aria-hidden="true">
        <span className="brand-orb-core" />
      </span>
      {!compact && (
        <span className="brand-wordmark">
          Focus<span>AI</span>
        </span>
      )}
    </div>
  );
}

export function IntelligenceBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="intelligence-badge">
      <Sparkles size={13} aria-hidden="true" />
      {children}
    </span>
  );
}
