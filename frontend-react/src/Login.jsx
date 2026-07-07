import { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      let result;
      if (mode === 'login') {
        result = await supabase.auth.signInWithPassword({ email, password });
      } else {
        result = await supabase.auth.signUp({ email, password });
      }
      if (result.error) throw result.error;
      onLogin(result.data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0E1621', color: '#E7ECF0', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif' }}>
      <div style={{ background: '#17212B', padding: 40, borderRadius: 20, width: 360, border: '1px solid rgba(255,255,255,0.07)' }}>
        <h1 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Hila Bot</h1>
        <form onSubmit={handleSubmit}>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: 12, marginBottom: 12, borderRadius: 8, background: '#0E1621', border: '1px solid rgba(255,255,255,0.1)', color: '#E7ECF0' }} required />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: 12, marginBottom: 12, borderRadius: 8, background: '#0E1621', border: '1px solid rgba(255,255,255,0.1)', color: '#E7ECF0' }} required />
          <button type="submit" style={{ width: '100%', padding: 12, background: '#2AABEE', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        {error && <p style={{ color: '#FF5E5E', textAlign: 'center', marginTop: 12 }}>{error}</p>}
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14, color: '#6C7883' }}>
          {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
          <span onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={{ color: '#2AABEE', cursor: 'pointer' }}>
            {mode === 'login' ? 'Sign Up' : 'Log In'}
          </span>
        </p>
      </div>
    </div>
  );
}
