// FexoApp/src/components/LandingNav.tsx
import { Link } from 'react-router-dom';
import '../css/LandingNav.css';

const LandingNav = () => {
  return (
    <nav className="landing-nav">
      <div className="landing-nav-container">
        {/* --- START OF THE FIX --- */}
        <Link to="/" className="landing-nav-logo">
          <img src="/lyseris.svg" alt="Lyseris AI Logo" />
        </Link>
        {/* --- END OF THE FIX --- */}
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-nav-button login">
            Log In
          </Link>
          <Link to="/register" className="landing-nav-button register">
            Register
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default LandingNav;