import { motion } from 'framer-motion';
import { networkStats } from '../data/results';

const sectionAnim = {
  hidden: { y: 30, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

const layers = [
  { size: 24, type: 'input' as const, label: '4×6 window' },
  { size: 64, type: 'hidden' as const, label: 'tanh' },
  { size: 64, type: 'hidden' as const, label: 'tanh' },
  { size: 32, type: 'hidden' as const, label: 'tanh' },
  { size: 2, type: 'output' as const, label: 'linear' },
];

const typeColors = {
  input: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.3)', text: '#3B82F6' },
  hidden: { bg: 'rgba(6, 182, 212, 0.1)', border: 'rgba(6, 182, 212, 0.3)', text: '#06B6D4' },
  output: { bg: 'rgba(236, 72, 153, 0.1)', border: 'rgba(236, 72, 153, 0.3)', text: '#EC4899' },
};

const features = [
  { name: 'phi', desc: 'Roll angle', unit: 'rad' },
  { name: 'p', desc: 'Roll rate', unit: 'rad/s' },
  { name: 'z', desc: 'Altitude', unit: 'm' },
  { name: 'vz', desc: 'Descent rate', unit: 'm/s' },
  { name: 'u_phi', desc: 'Roll torque cmd', unit: 'N·m' },
  { name: 'u_z', desc: 'Vertical accel cmd', unit: 'm/s²' },
];

const outputs = [
  { name: 'tau_phi_DAGE', desc: 'Estimated DAGE roll torque', color: '#06B6D4' },
  { name: 'a_GE', desc: 'Estimated ground-effect acceleration', color: '#EC4899' },
];

const pipeline = [
  { step: '1', label: 'Generate 460 trajectories', detail: '400 train + 60 val' },
  { step: '2', label: 'Build windowed datasets', detail: '24-dim input, 2-dim target' },
  { step: '3', label: 'Subsample to 200K', detail: 'Balanced training set' },
  { step: '4', label: 'Adam + LR decay', detail: 'lr=8e-4, decay 0.94×/epoch' },
  { step: '5', label: 'Early stopping', detail: 'Patience 6 on val MSE' },
  { step: '6', label: 'Calibrate gate d0', detail: '99th percentile distance' },
];

export default function NetworkPanel() {
  return (
    <motion.section className="section" variants={sectionAnim} initial="hidden" whileInView="show" viewport={{ once: true }}>
      <div className="section-label">Neural Architecture</div>
      <h2 className="section-title">
        Residual MLP <em>Architecture</em>
      </h2>
      <p className="section-desc">
        Compact pure-NumPy network designed for real-time embedded deployment.
        No deep-learning framework required.
      </p>

      <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.5rem' }}>
        <div className="chart-card-header">
          <div className="chart-card-title">Network Flow</div>
          <span className="chart-pill blue">{networkStats.parameters.toLocaleString()} params</span>
        </div>

        <div className="network-flow">
          {layers.map((layer, i) => {
            const c = typeColors[layer.type];
            return (
              <motion.div
                key={i}
                style={{ display: 'flex', alignItems: 'center' }}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, type: 'spring', stiffness: 250, damping: 20 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <motion.div
                    className="layer-node"
                    style={{ background: c.bg, borderColor: c.border, color: c.text }}
                    whileHover={{ scale: 1.08, y: -2 }}
                  >
                    {layer.size}
                  </motion.div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {layer.label}
                  </div>
                </div>
                {i < layers.length - 1 && (
                  <span className="layer-arrow" style={{ padding: '0 6px' }}>→</span>
                )}
              </motion.div>
            );
          })}
        </div>

        <div className="stats-grid" style={{ marginTop: '1rem' }}>
          <div className="stat-cell" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ color: '#06B6D4' }}>{networkStats.parameters.toLocaleString()}</div>
            <div className="stat-label">Parameters</div>
          </div>
          <div className="stat-cell" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ color: '#3B82F6' }}>{networkStats.macs.toLocaleString()}</div>
            <div className="stat-label">MACs / Forward</div>
          </div>
          <div className="stat-cell" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ color: '#EC4899' }}>tanh</div>
            <div className="stat-label">Activation</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Input Features (×4 timesteps)</div>
          </div>
          {features.map((f, i) => (
            <motion.div
              key={f.name}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: i < features.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: '#3B82F6', minWidth: 50 }}>
                  {f.name}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{f.desc}</span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 4, background: 'var(--surface-elevated)' }}>
                {f.unit}
              </span>
            </motion.div>
          ))}
          <div style={{
            marginTop: '0.75rem',
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(59, 130, 246, 0.06)',
            border: '1px solid rgba(59, 130, 246, 0.12)',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
          }}>
            6 features × 4 timesteps = 24-dim input
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Output Predictions</div>
          </div>
          {outputs.map((o, i) => (
            <motion.div
              key={o.name}
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              style={{
                padding: '1.25rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-elevated)',
                borderLeft: `3px solid ${o.color}`,
                marginBottom: '0.75rem',
              }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 600, color: o.color, marginBottom: 4 }}>
                {o.name}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{o.desc}</div>
            </motion.div>
          ))}

          <div style={{ marginTop: '1.5rem' }}>
            <div className="chart-card-title" style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>Training Pipeline</div>
            {pipeline.map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: i < pipeline.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: 'var(--surface-elevated)', border: '1px solid var(--border)',
                  display: 'grid', placeItems: 'center',
                  fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0,
                }}>
                  {s.step}
                </span>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.detail}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
