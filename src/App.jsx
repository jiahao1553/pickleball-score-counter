import { useEffect, useState } from 'react';
import { useApp } from './store/AppStore.jsx';
import { SetupScreen } from './components/SetupScreen.jsx';
import { CourtScreen } from './components/CourtScreen.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { TeamsModal } from './components/TeamsModal.jsx';
import { WinnerOverlay } from './components/WinnerOverlay.jsx';

export default function App() {
  const { match, rallyWon, undo, togglePause, endMatch, nextMatch } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);

  const onCourt = !!match;
  const winnerShown = match && match.finished;

  // close leftover modals when the match ends
  useEffect(() => {
    if (!match) setSettingsOpen(false);
  }, [match]);

  /* keyboard shortcuts for desktop judges */
  useEffect(() => {
    const onKey = (e) => {
      if (!onCourt) return;
      if (e.target.tagName === 'INPUT') return;
      if (settingsOpen || teamsOpen) return;
      if (winnerShown && e.key !== 'u' && e.key !== 'Backspace') return;
      if (e.key === 'ArrowLeft' || e.key === 'a') rallyWon('A');
      else if (e.key === 'ArrowRight' || e.key === 'l') rallyWon('B');
      else if (e.key === 'u' || e.key === 'Backspace') { e.preventDefault(); undo(); }
      else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCourt, settingsOpen, teamsOpen, winnerShown, rallyWon, undo, togglePause]);

  return (
    <div id="app">
      {!onCourt && (
        <SetupScreen
          onStart={() => {}}
          onManageTeams={() => setTeamsOpen(true)}
        />
      )}
      {onCourt && (
        <CourtScreen onOpenSettings={() => setSettingsOpen(true)} />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onManageTeams={() => setTeamsOpen(true)}
          onEndMatch={() => { setSettingsOpen(false); endMatch(); }}
        />
      )}
      {teamsOpen && <TeamsModal onClose={() => setTeamsOpen(false)} />}
      {winnerShown && <WinnerOverlay onNextMatch={nextMatch} />}

      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}
