import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './store/AppStore.jsx';
import App from './App.jsx';
import './styles.css';

/* Tournament-mode pages are lazy chunks: LOCAL mode (the default
   route) never loads the Firebase SDK and keeps working fully
   offline. Routing is hash-based so it works on any static host. */
const TournamentApp = lazy(() => import('./tournament/TournamentApp.jsx'));
const DashboardPage = lazy(() => import('./tournament/DashboardPage.jsx'));
const AdminPage = lazy(() => import('./tournament/AdminPage.jsx'));
const VotePage = lazy(() => import('./tournament/VotePage.jsx'));
const VoteResultsPage = lazy(() => import('./tournament/VoteResultsPage.jsx'));

const parseHash = () => {
  const [page, ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  const parts = rest.map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return { page: page || '', parts };
};

function Root() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const fallback = <div className="route-loading">LOADING…</div>;
  switch (route.page) {
    case 'tournament': {
      // QR self-join link: #/tournament/join/<code>/<passcode>
      const join = route.parts[0] === 'join' && route.parts[1]
        ? { tid: route.parts[1], passcode: route.parts[2] || '' } : null;
      return <Suspense fallback={fallback}><TournamentApp join={join} /></Suspense>;
    }
    case 'dashboard':
      return <Suspense fallback={fallback}><DashboardPage tid={route.parts[0] || null} /></Suspense>;
    case 'admin':
      return <Suspense fallback={fallback}><AdminPage /></Suspense>;
    case 'vote':
      return <Suspense fallback={fallback}><VotePage tid={route.parts[0] || null} /></Suspense>;
    case 'vote-results':
      return <Suspense fallback={fallback}><VoteResultsPage tid={route.parts[0] || null} /></Suspense>;
    default:
      return <AppProvider><App /></AppProvider>;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
