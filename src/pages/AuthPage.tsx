// src/pages/AuthPage.tsx
import { useState, type FormEvent, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { Link } from 'react-router-dom';
import '../css/AuthPage.css';

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, register, isAuthenticated } = useSettings();
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      // Redirect handled by router
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }

    setIsLoading(true);
    
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
      setIsLoading(false);
    }
  };

  const handleToggleForm = () => {
    setError('');
    setIsFading(true);
    setTimeout(() => {
      setIsLogin(prev => !prev);
      setIsFading(false);
    }, 300);
  };

  return (
    <div className="auth-container">
      <div className="auth-background">
        <div className="circle circle-1"></div>
        <div className="circle circle-2"></div>
        <div className="circle circle-3"></div>
      </div>
      
      <div className={`auth-form-wrapper ${isFading ? 'fading' : ''}`}>
        {/* --- START OF THE FIX --- */}
        <img src="/lyseris.svg" alt="Lyseris AI Logo" className="auth-logo" />
        {/* --- END OF THE FIX --- */}
        <h2 className="auth-subtitle">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
        
        <form onSubmit={handleSubmit}>
          {error && <p className="auth-error">{error}</p>}
          <div className="auth-form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="auth-form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          
          {isLogin && (
            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <Link 
                to="/forgot-password" 
                style={{ 
                  color: 'var(--accent-primary)', 
                  fontSize: '14px',
                  textDecoration: 'none',
                  fontWeight: '500'
                }}
              >
                Forgot Password?
              </Link>
            </div>
          )}
          
          <button type="submit" className="auth-button" disabled={isLoading}>
            {isLoading ? (
              <div className="auth-loader"></div>
            ) : isLogin ? (
              'Login'
            ) : (
              'Register'
            )}
          </button>
        </form>

        <p className="auth-toggle">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}
          <button onClick={handleToggleForm} disabled={isLoading}>
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthPage;