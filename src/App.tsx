import { useRef, useState, type KeyboardEvent } from 'react';
import { AttendanceController } from './application/attendanceController';
import { HistoryView } from './components/HistoryView';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TodayView } from './components/TodayView';
import { BrowserFileAdapter } from './files/fileAdapter';
import { useAttendance } from './hooks/useAttendance';
import { AttendanceDb } from './storage/attendanceDb';

const files = new BrowserFileAdapter();
const controller = new AttendanceController(new AttendanceDb(), files);

function App() {
  const [activeTab, setActiveTab] = useState<'today' | 'history'>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const todayTabRef = useRef<HTMLButtonElement>(null);
  const historyTabRef = useRef<HTMLButtonElement>(null);
  const {
    snapshot,
    clockIn,
    clockOut,
    updateEntry,
    deleteEntry,
    chooseFolder,
    importCsv,
    exportCsv,
    requestFilePermission,
  } = useAttendance(controller);

  if (!snapshot.initialized) {
    if (snapshot.error) {
      return (
        <main className="app-shell app-shell--blocking">
          <section className="storage-blocker" role="alert" aria-labelledby="storage-error-heading" aria-live="assertive">
            <p className="eyebrow">Storage unavailable</p>
            <h1 id="storage-error-heading">Attendance storage unavailable</h1>
            <p>
              This browser could not open durable local storage. Clocking and file actions are blocked because your attendance data cannot be saved safely.
            </p>
            <p className="attendance-error">{snapshot.error}</p>
          </section>
        </main>
      );
    }
    return <main className="app-shell" aria-busy="true">Loading attendance clock…</main>;
  }

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: 'today' | 'history') => {
    const destination = event.key === 'ArrowRight'
      ? current === 'today' ? 'history' : 'today'
      : event.key === 'ArrowLeft'
        ? current === 'today' ? 'history' : 'today'
        : event.key === 'Home'
          ? 'today'
          : event.key === 'End'
            ? 'history'
            : null;
    if (!destination) return;
    event.preventDefault();
    setActiveTab(destination);
    (destination === 'today' ? todayTabRef : historyTabRef).current?.focus();
  };

  return (
    <main className="app-shell">
      <header className="app-toolbar">
        <nav className="view-tabs" aria-label="Attendance views" role="tablist">
          <button
            ref={todayTabRef}
            id="today-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'today'}
            aria-controls="today-panel"
            tabIndex={activeTab === 'today' ? 0 : -1}
            onClick={() => setActiveTab('today')}
            onKeyDown={(event) => moveTab(event, 'today')}
          >
            Today
          </button>
          <button
            ref={historyTabRef}
            id="history-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            aria-controls="history-panel"
            tabIndex={activeTab === 'history' ? 0 : -1}
            onClick={() => setActiveTab('history')}
            onKeyDown={(event) => moveTab(event, 'history')}
          >
            History
          </button>
        </nav>
        <button
          className="settings-button"
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙ Settings
        </button>
      </header>
      {activeTab === 'today' ? (
        <div id="today-panel" role="tabpanel" aria-labelledby="today-tab">
          <TodayView snapshot={snapshot} onClockIn={clockIn} onClockOut={clockOut} />
        </div>
      ) : (
        <div id="history-panel" role="tabpanel" aria-labelledby="history-tab">
          <HistoryView entries={snapshot.state.entries} onUpdate={updateEntry} onDelete={deleteEntry} />
        </div>
      )}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        snapshot={snapshot}
        folderSupported={files.supportsDirectories()}
        onChooseFolder={chooseFolder}
        onImport={importCsv}
        onExport={exportCsv}
        onGrantAccess={requestFilePermission}
      />
    </main>
  );
}

export default App;
