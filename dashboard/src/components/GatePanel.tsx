import React from 'react';
import { motion } from 'framer-motion';
import { gateAblation } from '../data/results';

const sectionAnim = {
  hidden: { y: 30, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

const kappas = [0.4, 0.8, 1.2, 2.4];
const d0Scales = [0.6, 0.8, 1.0];

function getColor(pct: number): string {
  if (pct >= 99) return 'var(--green)';
  if (pct >= 80) return 'var(--amber)';
  if (pct >= 60) return '#F97316';
  return 'var(--red)';
}

function getBg(pct: number): string {
  if (pct >= 99) return 'rgba(34, 197, 94, 0.08)';
  if (pct >= 80) return 'rgba(234, 179, 8, 0.08)';
  if (pct >= 60) return 'rgba(249, 115, 22, 0.08)';
  return 'rgba(239, 68, 68, 0.08)';
}

const zones = [
  { label: 'Near training data', condition: 'd(x) < d0', result: 'σ ≈ 1.0', desc: 'Full residual correction applied', color: 'var(--green)' },
  { label: 'Transition zone', condition: 'd(x) ≈ d0', result: 'σ ∈ (0, 1)', desc: 'Smooth blend between residual and nominal', color: 'var(--amber)' },
  { label: 'Far OOD', condition: 'd(x) >> d0', result: 'σ → 0', desc: 'Graceful fallback to nominal PID', color: 'var(--red)' },
];

export default function GatePanel() {
  const ungated = gateAblation.find((r) => r.kappa === null);
  const pidBaseline = gateAblation.find((r) => r.kappa === 'PID');

  return (
    <motion.section className="section" variants={sectionAnim} initial="hidden" whileInView="show" viewport={{ once: true }}>
      <div className="section-label">Safety Gate Analysis</div>
      <h2 className="section-title">
        Table V: <em>Gate Ablation at 6.0 m/s (OOD)</em>
      </h2>
      <p className="section-desc">
        How the gate parameters kappa and d0_scale affect performance when the
        platform speed exceeds the training distribution.
      </p>

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Envelope Success Heatmap</div>
            <span className="chart-pill green">300 trials/cell</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(3, 1fr)', gap: 4 }}>
            <div />
            {d0Scales.map((d) => (
              <div key={d} style={{
                textAlign: 'center',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                padding: '0.5rem 0',
                fontFamily: 'var(--font-mono)',
              }}>
                d0×{d}
              </div>
            ))}

            {kappas.map((k, ki) => (
              <React.Fragment key={`row-${k}`}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  paddingRight: 8,
                  justifyContent: 'flex-end',
                }}>
                  κ={k}
                </div>
                {d0Scales.map((d) => {
                  const cell = gateAblation.find((r) => r.kappa === k && r.d0_scale === d);
                  const pct = cell?.envelope_pct ?? 0;
                  return (
                    <motion.div
                      key={`${k}-${d}`}
                      className="heatmap-cell"
                      style={{ background: getBg(pct), border: `1px solid ${getColor(pct)}20` }}
                      initial={{ scale: 0.85, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: ki * 0.04 + d0Scales.indexOf(d) * 0.04 }}
                      whileHover={{ scale: 1.04 }}
                    >
                      <div className="heatmap-cell-value" style={{ color: getColor(pct) }}>
                        {pct.toFixed(1)}%
                      </div>
                      <div className="heatmap-cell-label" style={{ color: getColor(pct) }}>
                        σ={cell?.mean_sigma?.toFixed(2) ?? '—'}
                      </div>
                    </motion.div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1px',
            marginTop: '1.5rem',
            background: 'var(--border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            border: '1px solid var(--border)',
          }}>
            <div style={{ padding: '1rem', background: 'var(--surface-hover)', textAlign: 'center' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Ungated (Res-NG)</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--green)' }}>
                {ungated?.envelope_pct.toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                σ=1.000
              </div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--surface-hover)', textAlign: 'center' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>PID Baseline</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--amber)' }}>
                {pidBaseline?.envelope_pct.toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                no residual
              </div>
            </div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Gate Mechanism</div>
          </div>

          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            padding: '1.25rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            lineHeight: 1.8,
            marginBottom: '1.5rem',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginBottom: 4 }}>// Eq 12: Chebyshev distance</div>
            <span style={{ color: 'var(--cyan)' }}>d(x) = max_i |x_i - mu_i| / sigma_i</span>
            <br /><br />
            <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginBottom: 4 }}>// Eq 13: Smooth decay</div>
            <span style={{ color: 'var(--cyan)' }}>sigma(x) = exp(-max(0, d(x) - d0) / kappa)</span>
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {zones.map((z, i) => (
              <motion.div
                key={z.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 * i }}
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-elevated)',
                  borderLeft: `3px solid ${z.color}`,
                  transition: 'background 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{z.label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: z.color,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: `${z.color}10`,
                  }}>
                    {z.result}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {z.condition}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {z.desc}
                </div>
              </motion.div>
            ))}
          </div>

          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(34, 197, 94, 0.06)',
            border: '1px solid rgba(34, 197, 94, 0.15)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            The gate ensures safety: at 6.0 m/s (OOD), the gated controller
            achieves 100% success with κ ≥ 0.4 and d0_scale ≥ 0.8.
          </div>
        </div>
      </div>
    </motion.section>
  );
}
