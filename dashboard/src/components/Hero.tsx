import { motion } from 'framer-motion';
import { simStats, networkStats } from '../data/results';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

const stats = [
  { label: 'Total Trials', value: '12,500', detail: '500 per condition' },
  { label: 'Parameters', value: '7,906', detail: '7,744 MACs / forward' },
  { label: 'Sim Frequency', value: '100 Hz', detail: 'RK4 integration' },
  { label: 'Controllers', value: '5', detail: 'PD through Res-G' },
  { label: 'Training Epochs', value: String(networkStats.epochs), detail: 'Early stopping' },
  { label: 'State Dim', value: String(simStats.stateDim), detail: '3-channel model' },
];

export default function Hero() {
  return (
    <motion.section
      className="hero"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item} className="hero-badge">
        <span className="hero-badge-dot" />
        Research Benchmark v1.0
      </motion.div>

      <motion.h1 variants={item} className="hero-title">
        Residual Compensation of{' '}
        <em>Dynamic Asymmetric Ground-Effect</em>{' '}
        Disturbance
      </motion.h1>

      <motion.p variants={item} className="hero-desc">
        A pure-Python simulation benchmark evaluating classical and learning-augmented
        controllers for UAV precision landing under DAGE disturbances on moving platforms.
        Monte Carlo validated with {simStats.totalTrials.toLocaleString()} randomised trials.
      </motion.p>

      <motion.div variants={item} className="hero-buttons">
        <a
          className="btn btn-primary"
          href="https://github.com/ravideo9021/DAGE-Bench"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get started
        </a>
        <a className="btn btn-secondary" href="#evaluation">
          View results
        </a>
      </motion.div>

      <motion.div variants={item} className="stats-grid">
        {stats.map((s) => (
          <motion.div
            key={s.label}
            className="stat-cell"
            whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
          >
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-detail">{s.detail}</div>
          </motion.div>
        ))}
      </motion.div>
    </motion.section>
  );
}
