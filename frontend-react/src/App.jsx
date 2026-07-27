import React from 'react';
import HilaBotMiniApp from './hilabot-miniapp-preview';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("App Crash:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: '#ff4d4d', background: '#0f172a', height: '100vh', fontFamily: 'monospace' }}>
          <h2>⚠️ Runtime Error Captured</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#f8fafc' }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          <p style={{ color: '#94a3b8' }}>Check component imports and global variables.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <HilaBotMiniApp />
    </ErrorBoundary>
  );
}

export default App;
