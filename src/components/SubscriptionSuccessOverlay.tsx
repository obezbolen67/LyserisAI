// src/components/SubscriptionSuccessOverlay.tsx
import { FiCheckCircle } from 'react-icons/fi';
import Portal from './Portal';
import '../css/SubscriptionSuccessOverlay.css';

interface SubscriptionSuccessOverlayProps {
  onClose: () => void;
}

const SubscriptionSuccessOverlay = ({ onClose }: SubscriptionSuccessOverlayProps) => {
  return (
    <Portal>
      <div className="sub-success-overlay" role="dialog" aria-modal="true" aria-label="Subscription successful">
        <div className="sub-success-backdrop" onClick={onClose} />
        <div className="sub-success-card">
          <div className="confetti" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <div className="icon-wrap">
            <FiCheckCircle size={36} />
          </div>
          <h2 className="title">Welcome to Pro 🎉</h2>
          <p className="subtitle">Thanks for upgrading! You now have access to:</p>
          <ul className="feature-list">
            <li>Voice chat included</li>
            <li>Priority access to high-performance models</li>
            <li>Code Interpreter & File Analysis</li>
            <li>Web Search capabilities</li>
            <li>Bring your own API keys</li>
            <li>Priority support</li>
          </ul>
          <button className="cta-button" onClick={onClose}>Start exploring</button>
        </div>
      </div>
    </Portal>
  );
};

export default SubscriptionSuccessOverlay;
