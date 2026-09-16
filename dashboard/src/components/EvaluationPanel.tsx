import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import { evaluationResults, controllerColors } from '../data/results';

const sectionAnim = {
  hidden: { y: 30, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

const speeds = [0.0, 1.5, 3.0, 5.0, 6.0];
const controllers = ['PD', 'PID', 'PID+DOB', 'Res-NG', 'Res-G'];

function getBarData() {
  return speeds.map((vp) => {
    const row: any = { speed: `${vp}${vp > 4 ? ' (OOD)' : ''}` };
    controllers.forEach((ctrl) => {
      const r = evaluationResults.find((e) => e.vp === vp && e.controller === ctrl);
      row[ctrl] = r ? r.envelope_pct : 0;
    });
    return row;
  });
}

function getRadarData(vp: number) {
  const metrics = ['rms_phi', 'peak_phi', 'delta_vy', 'abs_vz'] as const;
  const labels: Record<string, string> = { rms_phi: 'RMS Roll', peak_phi: 'Peak Roll', delta_vy: 'Lat. Vel.', abs_vz: 'Impact Speed' };
  const maxVals: Record<string, number> = { rms_phi: 0.1, peak_phi: 0.3, delta_vy: 1.0, abs_vz: 0.5 };
  return metrics.map((m) => {
    const row: any = { metric: labels[m] };
    controllers.forEach((ctrl) => {
      const r = evaluationResults.find((e) => e.vp === vp && e.controller === ctrl);
      row[ctrl] = r ? Math.min(r[m] / maxVals[m], 1) * 100 : 0;
    });
    return row;
  });
}

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

function SuccessBar({ pct }: { pct: number }) {
  const color = pct >= 99 ? 'var(--green)' : pct >= 80 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="success-bar">
        <motion.div
          className="success-bar-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as const }}
          style={{ background: color }}
        />
      </div>
      <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

export default function EvaluationPanel() {
  const [selectedSpeed, setSelectedSpeed] = useState(6.0);

  return (
    <motion.section id="evaluation" className="section" variants={sectionAnim} initial="hidden" whileInView="show" viewport={{ once: true }}>
      <div className="section-label">Monte Carlo Evaluation</div>
      <h2 className="section-title">
        Table III: <em>Envelope Success Rates</em>
      </h2>
      <p className="section-desc">
        500 randomised trials per condition. Landing envelope: |phi| &le; 0.10 rad,
        |vz| &le; 0.75 m/s, |delta_vy| &le; 0.75 m/s.
      </p>

      <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.5rem', background: 'var(--surface)' }}>
        <div className="chart-card-header">
          <div className="chart-card-title">Envelope Success by Platform Speed</div>
          <span className="chart-pill green">500 trials/condition</span>
        </div>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={getBarData()} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#232323" />
            <XAxis dataKey="speed" stroke="#666" fontSize={11} tickLine={false} />
            <YAxis stroke="#666" fontSize={11} tickLine={false} domain={[0, 110]} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '0.78rem', fontFamily: 'var(--font-body)' }} />
            {controllers.map((ctrl) => (
              <Bar key={ctrl} dataKey={ctrl} fill={controllerColors[ctrl]} radius={[3, 3, 0, 0]} opacity={0.85} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Performance Radar</div>
            <select className="metric-select" value={selectedSpeed} onChange={(e) => setSelectedSpeed(Number(e.target.value))}>
              {speeds.map((s) => (
                <option key={s} value={s}>{s} m/s{s > 4 ? ' (OOD)' : ''}</option>
              ))}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <RadarChart data={getRadarData(selectedSpeed)} outerRadius="75%">
              <PolarGrid stroke="#232323" />
              <PolarAngleAxis dataKey="metric" stroke="#666" fontSize={10} />
              <PolarRadiusAxis tick={false} axisLine={false} />
              {controllers.map((ctrl) => (
                <Radar key={ctrl} name={ctrl} dataKey={ctrl} stroke={controllerColors[ctrl]} fill={controllerColors[ctrl]} fillOpacity={0.08} strokeWidth={2} />
              ))}
            </RadarChart>
          </ResponsiveContainer>
          <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Lower is better (values normalised to envelope limits)
          </div>
        </div>

        <div className="chart-card" style={{ overflow: 'auto', maxHeight: 440 }}>
          <div className="chart-card-header">
            <div className="chart-card-title">Detailed Results</div>
            <span className="chart-pill amber">Table III</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Speed</th>
                <th>Controller</th>
                <th>RMS phi</th>
                <th>|vz|</th>
                <th>Envelope</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {evaluationResults.map((r, i) => (
                  <motion.tr
                    key={`${r.vp}-${r.controller}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                  >
                    <td>
                      {r.vp.toFixed(1)}
                      {r.vp > 4 && <span className="ood-badge">OOD</span>}
                    </td>
                    <td style={{ color: controllerColors[r.controller] || 'var(--text)' }}>
                      {r.controller}
                    </td>
                    <td>{r.rms_phi.toFixed(4)}</td>
                    <td>{r.abs_vz.toFixed(3)}</td>
                    <td><SuccessBar pct={r.envelope_pct} /></td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>
    </motion.section>
  );
}
