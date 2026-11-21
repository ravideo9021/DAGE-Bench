import { CheckCircle2, XCircle, BadgeCheck } from 'lucide-react';
import { STEPS, type Check } from '../sim/checks';

export function VerifySheet({ checks, onClose }: { checks: Check[]; onClose: () => void }) {
  const allOk = checks.length === STEPS.length && checks.every((c) => c.ok);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="verify-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <BadgeCheck size={34} strokeWidth={1.6} style={{ color: allOk ? 'var(--ok)' : 'var(--text-3)', flex: 'none' }} />
          <div>
            <h2 id="verify-title">{allOk ? 'Verified against the reference' : 'Running checks…'}</h2>
            <p>The browser port is checked against the Python benchmark every time it loads.</p>
          </div>
        </div>
        <div className="sheet-b">
          {STEPS.map((s, i) => {
            const c = checks[i];
            return (
              <div key={s.label} className="check-row">
                {c ? (c.ok ? <CheckCircle2 size={19} style={{ color: 'var(--ok)' }} /> : <XCircle size={19} style={{ color: 'var(--crit)' }} />) : <span className="spinner" />}
                <span>{s.label}</span>
                <span className="r">{c?.result ?? ''}</span>
              </div>
            );
          })}
        </div>
        <div className="sheet-f">
          <button type="button" className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
