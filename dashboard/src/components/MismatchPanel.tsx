import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { mismatchResults, controllerColors } from '../data/results';

const sectionAnim = {
  hidden: { y: 30, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

const mismatchControllers = ['PD', 'PID', 'Res-G', 'Res-NG'];
const speeds = [1.5, 3.0, 5.0];

function getBarData() {
  return speeds.map((vp) => {
    const row: any = { speed: `${vp} m/s${vp > 4 ? ' (OOD)' : ''}` };
    mismatchControllers.forEach((ctrl) => {
      const r = mismatchResults.find((e) => e.vp === vp && e.controller === ctrl);
      row[ctrl] = r ? r.envelope_pct : 0;
    });
    return row;
  });
}

const mismatchParams = [
  { param: 'K_phi', scale: '×1.40', desc: 'DAGE torque gain' },
  { param: 'A_GE', scale: '×1.35', desc: 'Ground-effect amplitude' },
  { param: 'L', scale: '×1.30', desc: 'DAGE altitude scale' },
  { param: 'R_z', scale: '×1.40', desc: 'GE altitude scale' },
  { param: 'n', value: '1.6', desc: 'Decay exponent (from 2.0)' },
  { param: 'lambda', value: '1.00', desc: 'Slip fraction (from 0.60)' },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div style={{
      background: 'var(--surface-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: '0.78rem',
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: '0.7rem' }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.fill || p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}%
        </div>
      ))}
    </div>
  );
}

export default function MismatchPanel() {
  return (
    <motion.section className="section" variants={sectionAnim} initial="hidden" whileInView="show" viewport={{ once: true }}>
      <div className="section-label">Robustness Study</div>
      <h2 className="section-title">
        Table IV: <em>Disturbance-Model Mismatch</em>
      </h2>
      <p className="section-desc">
        All six physical parameters altered simultaneously. Tests whether controllers
        generalise when the real disturbance differs from training assumptions.
      </p>

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Mismatch Envelope Success</div>
            <span className="chart-pill amber">Altered params</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={getBarData()} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#232323" />
              <XAxis dataKey="speed" stroke="#666" fontSize={11} tickLine={false} />
              <YAxis stroke="#666" fontSize={11} tickLine={false} domain={[0, 110]} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '0.78rem', fontFamily: 'var(--font-body)' }} />
              {mismatchControllers.map((ctrl) => (
                <Bar key={ctrl} dataKey={ctrl} fill={controllerColors[ctrl]} radius={[3, 3, 0, 0]} opacity={0.85} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Mismatch Parameters</div>
          </div>
          <div>
            {mismatchParams.map((p, i) => (
              <motion.div
                key={p.param}
                initial={{ opacity: 0, x: 16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: i < mismatchParams.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)', fontWeight: 600, fontSize: '0.82rem' }}>
                    {p.param}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {p.desc}
                  </span>
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: 'var(--amber)',
                  fontSize: '0.85rem',
                }}>
                  {p.scale || p.value}
                </span>
              </motion.div>
            ))}
          </div>

          <div style={{
            marginTop: '1.5rem',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            Key finding: PD fails completely at 5.0 m/s (0% success).
            PID drops to 33.8%. Res-G maintains 99.8%.
          </div>
        </div>
      </div>
    </motion.section>
  );
}
