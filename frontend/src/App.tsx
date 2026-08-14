import { useState, useEffect } from 'react';
import { PatientIntake } from './components/PatientIntake';
import { DoctorDashboard } from './components/DoctorDashboard';
import { ValidationDashboard } from './components/ValidationDashboard';
import { LandingPage } from './components/LandingPage';

const OFFLINE_DRAFTS_KEY = 'vaanidoc_session_drafts';

interface IntakeSession {
  sessionId: string;
  timestamp: string;
  patientName: string;
  age: string;
  gender: string;
  languageSpoken: string;
  originalSymptomsText: string;
  translatedSymptomsText: string;
  chiefComplaint: string;
  clinicalSummary: string;
  duration: string;
  severity: string;
  associatedSymptoms: string[];
  symptomCategories: string[];
  urgencyClassification: string;
  urgencyReason: string;
  suggestedSpecialist: string;
  smartQuestions?: string[];
  treatmentDraft?: string;
  patientFriendlySummary?: string;
  redFlags?: string[];
  confidence?: number;
  data?: {
    smart_questions?: string[];
    treatment_draft?: string;
    patient_friendly_summary?: string;
    red_flags?: string[];
    confidence?: number;
  };
  isOfflineGenerated?: boolean;
}

function App() {
  // Path-based custom routing
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [lowBandwidthMode, setLowBandwidthMode] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeSessions, setActiveSessions] = useState<IntakeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [offlineDraftsCount, setOfflineDraftsCount] = useState(0);

  // Synchronize history paths
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    
    // Fetch initial sessions
    fetchActiveSessions();

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    if (path === '/doctor') {
      fetchActiveSessions();
    }
  };

  // Monitor connectivity
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log('App detected: Network is online. Triggering auto-sync...');
      syncOfflineDrafts();
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log('App detected: Network is offline. Switched to local offline mode.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check of offline drafts
    updateOfflineDraftsCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updateOfflineDraftsCount = () => {
    const drafts = JSON.parse(sessionStorage.getItem(OFFLINE_DRAFTS_KEY) || '[]');
    setOfflineDraftsCount(drafts.length);
  };

  const fetchActiveSessions = async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const response = await fetch('http://localhost:5000/api/active-sessions');
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid active sessions response');
      setActiveSessions(data);
    } catch (err) {
      console.warn('Could not fetch active sessions. Server may be offline or unreachable.', err);
      setSessionsError('Unable to load the active intake queue. Check the clinical server connection and try again.');
    } finally {
      setSessionsLoading(false);
    }
  };

  const syncOfflineDrafts = async () => {
    const drafts: IntakeSession[] = JSON.parse(sessionStorage.getItem(OFFLINE_DRAFTS_KEY) || '[]');
    if (drafts.length === 0) return;

    setIsSyncing(true);
    console.log(`Syncing ${drafts.length} offline drafts...`);

    const failedDrafts: IntakeSession[] = [];

    for (const draft of drafts) {
      try {
        const response = await fetch('http://localhost:5000/api/sync-offline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localIntake: draft })
        });

        if (!response.ok) {
          throw new Error('Sync endpoint failed');
        }
      } catch (err) {
        console.error('Failed to sync draft:', draft.sessionId, err);
        failedDrafts.push(draft);
      }
    }

    sessionStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(failedDrafts));
    updateOfflineDraftsCount();
    setIsSyncing(false);
    fetchActiveSessions();
  };

  const handleNewIntakeCreated = (newIntake: any) => {
    updateOfflineDraftsCount();
    if (!isOnline) {
      setActiveSessions(prev => [newIntake, ...prev]);
    } else {
      fetchActiveSessions();
    }
  };

  const handleSessionCleared = (sessionId: string) => {
    setActiveSessions(prev => prev.filter(s => s.sessionId !== sessionId));
    const remainingDrafts = JSON.parse(sessionStorage.getItem(OFFLINE_DRAFTS_KEY) || '[]')
      .filter((draft: IntakeSession) => draft.sessionId !== sessionId);
    sessionStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(remainingDrafts));
    updateOfflineDraftsCount();
  };

  const renderDisclaimer = () => (
    <footer style={{ marginTop: '3.5rem', padding: '1.25rem 0', borderTop: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
      <p style={{ margin: 0, maxWidth: '800px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
        ⚠️ <strong>Medical Disclaimer:</strong> VaaniDoc assists with clinical intake and does not provide a medical diagnosis. 
        Final medical decisions must be made by a qualified healthcare professional.
      </p>
    </footer>
  );

  // 1. Render Landing Homepage (Route: /)
  if (currentPath === '/' || currentPath === '/index.html' || currentPath.includes('/?')) {
    return <LandingPage lowBandwidthMode={lowBandwidthMode} onLowBandwidthChange={setLowBandwidthMode} navigateTo={navigateTo} />;
    return (
      <div className="homepage-container">
        {/* Subtle low bandwidth toggle at top right */}
        <div style={{ alignSelf: 'flex-end', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
          <input 
            id="low-bw"
            type="checkbox" 
            checked={lowBandwidthMode} 
            onChange={(e) => setLowBandwidthMode(e.target.checked)} 
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="low-bw" style={{ cursor: 'pointer', userSelect: 'none' }}>Low Bandwidth Mode</label>
        </div>

        <div className="homepage-logo">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <h1>VaaniDoc</h1>
        </div>

        <div className="homepage-hero">
          <div className="hero-eyebrow"><span></span> Built for low-connectivity clinics</div>
          <h2>"Speak naturally. Let the doctor focus on care."</h2>
          <p>
            VaaniDoc converts multilingual patient conversations into structured clinical intake information for doctors.
          </p>
        </div>

        <div className="trust-strip" aria-label="VaaniDoc capabilities">
          <div><strong>11+</strong><span>Language paths</span></div>
          <div><strong>&lt; 1.2 KB</strong><span>Text-first payload</span></div>
          <div><strong>Session-only</strong><span>Data lifecycle</span></div>
          <div><strong>20 cases</strong><span>Validation suite</span></div>
        </div>

        <div className="homepage-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
            </div>
            <h3>Speak in Your Language</h3>
            <p>Patients can communicate naturally using supported Indian regional languages or type their concerns.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <h3>Structured Clinical Intake</h3>
            <p>AI organizes symptoms, duration, severity, and urgency into a clean EHR chart for clinical teams.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <h3>Privacy First</h3>
            <p>Patient information exists only for the active consultation session and is deleted immediately upon completion.</p>
          </div>
        </div>

        <div className="homepage-cta-group">
          <button 
            type="button" 
            className="btn btn-primary" 
            onClick={() => navigateTo('/patient')}
          >
            Start patient intake <span aria-hidden="true">→</span>
          </button>
          <button 
            type="button" 
            className="btn" 
            onClick={() => navigateTo('/doctor')}
          >
            Open clinician dashboard
          </button>
        </div>

        <div style={{ marginTop: '2rem' }}>
          <button 
            type="button" 
            className="back-to-home" 
            style={{ fontSize: '0.75rem' }}
            onClick={() => navigateTo('/validation')}
          >
            📊 View AI Validation Dashboard
          </button>
        </div>

        {renderDisclaimer()}
      </div>
    );
  }

  // 2. Render validation report dashboard (Route: /validation)
  if (currentPath === '/validation') {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section" onClick={() => navigateTo('/')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <div>
              <h1>VaaniDoc</h1>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button 
              onClick={() => navigateTo('/')} 
              className="view-btn" 
              style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}
            >
              Back to Home
            </button>
          </div>
        </header>

        <main className="main-content">
          <ValidationDashboard />
        </main>

        {renderDisclaimer()}
      </div>
    );
  }

  // 3. Render Patient and Doctor portals
  return (
    <div className="app-container">
      {/* Low Bandwidth Active Notification */}
      {lowBandwidthMode && (
        <div className="offline-banner" style={{ backgroundColor: '#f1f5f9', color: '#475569', borderBottomColor: '#cbd5e1' }}>
          <span>📉 <strong>Low Bandwidth Mode Active:</strong> Dynamic charts and decorative telemetry assets are suspended to optimize transmission.</span>
        </div>
      )}

      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="offline-banner">
          <span>
            ⚠️ <strong>Working Offline:</strong> Low connection detected (&lt; 100 KB/s or fully offline). Symptoms will be triaged using the local on-device rule matching system.
          </span>
          {offlineDraftsCount > 0 && (
            <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
              ({offlineDraftsCount} patient intakes stored locally)
            </span>
          )}
        </div>
      )}

      {/* Syncing Alert Banner */}
      {isSyncing && (
        <div className="offline-banner" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', borderBottomColor: 'var(--primary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner" style={{ animation: 'spin 1.5s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            Syncing cached offline intakes with server...
          </span>
        </div>
      )}

      {/* Calm Clinical Header */}
      <header className="app-header">
        <div className="logo-section" onClick={() => navigateTo('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <div>
            <h1>VaaniDoc</h1>
          </div>
        </div>

        {/* View Toggle */}
        <div className="view-selector">
          <button
            className={`view-btn ${currentPath === '/patient' ? 'active' : ''}`}
            onClick={() => navigateTo('/patient')}
          >
            Intake Terminal
          </button>
          <button
            className={`view-btn ${currentPath === '/doctor' ? 'active' : ''}`}
            onClick={() => navigateTo('/doctor')}
          >
            Clinical Dashboard
          </button>
        </div>

        {/* Network indicators, Sync, and Home back button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {isOnline && offlineDraftsCount > 0 && (
            <button
              className="offline-sync-btn"
              onClick={syncOfflineDrafts}
              disabled={isSyncing}
            >
              Sync {offlineDraftsCount} Draft{offlineDraftsCount > 1 ? 's' : ''}
            </button>
          )}

          <div className="status-indicator">
            <span className={`status-dot ${isOnline ? 'status-online' : 'status-offline'}`}></span>
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          <button 
            onClick={() => navigateTo('/')} 
            className="view-btn" 
            style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}
          >
            Exit Portal
          </button>
        </div>
      </header>

      {/* Main App Page */}
      <main className="main-content">
        {currentPath === '/patient' ? (
          <PatientIntake isOnline={isOnline} onNewIntakeCreated={handleNewIntakeCreated} lowBandwidthMode={lowBandwidthMode} />
        ) : (
          <DoctorDashboard
            initialSessions={activeSessions}
            onSessionCleared={handleSessionCleared}
            lowBandwidthMode={lowBandwidthMode}
            sessionsLoading={sessionsLoading}
            sessionsError={sessionsError}
            onRetrySessions={fetchActiveSessions}
          />
        )}
      </main>

      {renderDisclaimer()}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spinner {
          display: inline-block;
        }
      `}</style>
    </div>
  );
}

export default App;
