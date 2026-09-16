import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Header from './components/Header';
import Hero from './components/Hero';
import TrainingPanel from './components/TrainingPanel';
import EvaluationPanel from './components/EvaluationPanel';
import MismatchPanel from './components/MismatchPanel';
import GatePanel from './components/GatePanel';
import NetworkPanel from './components/NetworkPanel';

const pageTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.3 } },
};

function App() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="app">
      <div className="crosshatch-bg" />

      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="main-content">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" {...pageTransition}>
              <Hero />
              <TrainingPanel />
              <EvaluationPanel />
              <MismatchPanel />
              <GatePanel />
              <NetworkPanel />
            </motion.div>
          )}

          {activeTab === 'training' && (
            <motion.div key="training" {...pageTransition}>
              <div style={{ height: '2rem' }} />
              <TrainingPanel />
              <NetworkPanel />
            </motion.div>
          )}

          {activeTab === 'evaluation' && (
            <motion.div key="evaluation" {...pageTransition}>
              <div style={{ height: '2rem' }} />
              <EvaluationPanel />
            </motion.div>
          )}

          {activeTab === 'mismatch' && (
            <motion.div key="mismatch" {...pageTransition}>
              <div style={{ height: '2rem' }} />
              <MismatchPanel />
            </motion.div>
          )}

          {activeTab === 'gate' && (
            <motion.div key="gate" {...pageTransition}>
              <div style={{ height: '2rem' }} />
              <GatePanel />
            </motion.div>
          )}

          {activeTab === 'network' && (
            <motion.div key="network" {...pageTransition}>
              <div style={{ height: '2rem' }} />
              <NetworkPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="footer">
        <div className="footer-title">DAGE-Bench v1.0</div>
        Residual Compensation of Dynamic Asymmetric Ground-Effect Disturbance for UAV Landing
      </footer>
    </div>
  );
}

export default App;
