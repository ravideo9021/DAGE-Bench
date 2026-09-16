import { motion } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import { trainingCurves, networkStats } from '../data/results';

const sectionAnim = {
  hidden: { y: 30, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

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
      <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: '0.7rem' }}>Epoch {label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value.toFixed(5)}
        </div>
      ))}
    </div>
  );
}

const summaryStats = [
  { label: 'Architecture', value: networkStats.architecture, mono: true },
  { label: 'Final Train MSE', value: networkStats.finalTrainLoss.toFixed(5) },
  { label: 'Final Val MSE', value: networkStats.finalValLoss.toFixed(5) },
  { label: 'Parameters', value: networkStats.parameters.toLocaleString() },
  { label: 'MACs / Forward', value: networkStats.macs.toLocaleString() },
  { label: 'Activation', value: networkStats.activation },
];

export default function TrainingPanel() {
  return (
    <motion.section className="section" variants={sectionAnim} initial="hidden" whileInView="show" viewport={{ once: true }}>
      <div className="section-label">Training Pipeline</div>
      <h2 className="section-title">
        Residual MLP <em>Training Convergence</em>
      </h2>
      <p className="section-desc">
        Adam optimiser with LR decay (0.94x/epoch), dropout (5%), and input noise injection.
        Early stopping after {networkStats.epochs} epochs with patience 6.
      </p>

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Loss Curves</div>
            <span className="chart-pill green">Converged</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={trainingCurves}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232323" />
              <XAxis dataKey="epoch" stroke="#666" fontSize={11} tickLine={false} />
              <YAxis stroke="#666" fontSize={11} tickLine={false} tickFormatter={(v) => v.toFixed(3)} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '0.78rem', fontFamily: 'var(--font-body)' }} />
              <Line type="monotone" dataKey="train" name="Train MSE" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3B82F6' }} />
              <Line type="monotone" dataKey="val" name="Validation MSE" stroke="#EC4899" strokeWidth={2} dot={false} strokeDasharray="6 3" activeDot={{ r: 4, fill: '#EC4899' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Validation Loss Detail</div>
            <span className="chart-pill blue">MSE</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={trainingCurves}>
              <defs>
                <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#232323" />
              <XAxis dataKey="epoch" stroke="#666" fontSize={11} tickLine={false} />
              <YAxis stroke="#666" fontSize={11} tickLine={false} tickFormatter={(v) => v.toFixed(4)} domain={[0, 'auto']} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="val" name="Validation MSE" stroke="#06B6D4" strokeWidth={2} fill="url(#valGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <motion.div
        className="stats-grid"
        style={{ marginTop: '1.5rem' }}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
      >
        {summaryStats.map((s) => (
          <div key={s.label} className="stat-cell" style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: s.mono ? 'var(--font-mono)' : 'var(--font-body)',
              fontWeight: 600,
              fontSize: s.mono ? '0.82rem' : '1.1rem',
              color: 'var(--text)',
              marginBottom: 4,
            }}>
              {s.value}
            </div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </motion.div>
    </motion.section>
  );
}
