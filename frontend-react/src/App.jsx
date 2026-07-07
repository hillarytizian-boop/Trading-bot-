import { useState, useEffect } from 'react';
import HilaBotMiniApp from './hilabot-miniapp-preview';
import Login from './Login';
import { supabase } from './supabaseClient';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  if (loading) return <div style={{ background: '#0E1621', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#E7ECF0' }}>Loading...</div>;

  if (!user) return <Login onLogin={setUser} />;

  return <HilaBotMiniApp user={user} />;
}

export default App;
