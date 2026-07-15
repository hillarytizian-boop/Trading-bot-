import { Suspense, lazy } from 'react';

// Lazy load the main app (reduces initial bundle)
const HilaBotMiniApp = lazy(() => import('./hilabot-miniapp-preview'));

function App() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#0E1621',
        color: '#E7ECF0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: '4px solid rgba(42,171,238,0.2)',
          borderTop: '4px solid #2AABEE',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ fontSize: 16, color: '#6C7883' }}>Loading Hila Bot...</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    }>
      <HilaBotMiniApp />
    </Suspense>
  );
}

export default App;
