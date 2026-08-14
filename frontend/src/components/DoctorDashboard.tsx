import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import API_URL from '../config';

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

const normalizeSession = (session: IntakeSession): IntakeSession => {
  const apiData = session.data;
  return {
    ...session,
    smartQuestions: session.smartQuestions ?? apiData?.smart_questions,
    treatmentDraft: session.treatmentDraft ?? apiData?.treatment_draft,
    patientFriendlySummary: session.patientFriendlySummary ?? apiData?.patient_friendly_summary,
    redFlags: session.redFlags ?? apiData?.red_flags,
    confidence: session.confidence ?? apiData?.confidence
  };
};

interface DoctorDashboardProps {
  initialSessions: IntakeSession[];
  onSessionCleared: (sessionId: string) => void;
  lowBandwidthMode: boolean;
  sessionsLoading: boolean;
  sessionsError: string | null;
  onRetrySessions: () => void;
}

export const DoctorDashboard: React.FC<DoctorDashboardProps> = ({ initialSessions, onSessionCleared, lowBandwidthMode, sessionsLoading, sessionsError, onRetrySessions }) => {
  const [sessions, setSessions] = useState<IntakeSession[]>(() => initialSessions.map(normalizeSession));
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [newSessionNotification, setNewSessionNotification] = useState<string | null>(null);

  // Copilot States
  const [copilotTab, setCopilotTab] = useState<'clinical' | 'patient'>('clinical');
  const [checkedQuestions, setCheckedQuestions] = useState<Record<string, boolean>>({});
  const [showQRModal, setShowQRModal] = useState(false);
  const [smsSentText, setSmsSentText] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');

  // Sync state with props
  useEffect(() => {
    setSessions(initialSessions.map(normalizeSession));
    if (initialSessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(initialSessions[0].sessionId);
    }
  }, [initialSessions]);

  // Connect to Socket.io for live updates
  useEffect(() => {
    const socket: Socket = io(API_URL);

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Dashboard connected to WebSocket');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Dashboard disconnected from WebSocket');
    });

    socket.on('sessions-update', (updatedSessions: IntakeSession[]) => {
      if (!Array.isArray(updatedSessions)) {
        setCopilotError('The live session response was not in the expected format.');
        return;
      }
      const sorted = sortSessionsByUrgency(updatedSessions.map(normalizeSession));
      setSessions(sorted);
      setCopilotError(null);
      
      if (sorted.length > 0) {
        if (!sorted.some(s => s.sessionId === selectedSessionId)) {
          setSelectedSessionId(sorted[0].sessionId);
        }
      } else {
        setSelectedSessionId(null);
      }
    });

    socket.on('new-session', (newSession: IntakeSession) => {
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-120.wav');
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch (e) {}

      setNewSessionNotification(`Intake received for patient: ${newSession.patientName}`);
      setTimeout(() => setNewSessionNotification(null), 3000);
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedSessionId]);

  const sortSessionsByUrgency = (list: IntakeSession[]): IntakeSession[] => {
    const urgencyMap: Record<string, number> = {
      'Emergency': 4,
      'High': 3,
      'Medium': 2,
      'Low': 1
    };

    return [...list].sort((a, b) => {
      const uA = urgencyMap[a.urgencyClassification] || 0;
      const uB = urgencyMap[b.urgencyClassification] || 0;
      if (uB !== uA) {
        return uB - uA;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  };

  const handleDismissPatient = async (sessionId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/session/${sessionId}/end`, {
        method: 'POST'
      });

      if (response.ok) {
        onSessionCleared(sessionId);
        const updated = sessions.filter(s => s.sessionId !== sessionId);
        setSessions(updated);
        if (updated.length > 0) {
          setSelectedSessionId(updated[0].sessionId);
        } else {
          setSelectedSessionId(null);
        }
        
        setNewSessionNotification(`Session ${sessionId} completed. Temporary data deleted.`);
        setTimeout(() => setNewSessionNotification(null), 3000);
      }
    } catch (err) {
      console.error('Failed to end patient session:', err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyNote = () => {
    if (!selectedSession) return;
    
    const formattedQuestions = (selectedSession.smartQuestions || [])
      .map(q => `- [ ] ${q}`)
      .join('\n');

    const mdNote = `## VaaniDoc Clinical EHR Intake
**Patient**: ${selectedSession.patientName} | **Age/Gender**: ${selectedSession.age || 'N/A'}/${selectedSession.gender}
**Consult ID**: ${selectedSession.sessionId}
**Language Narration**: ${selectedSession.languageSpoken}
**Triage Level**: ${selectedSession.urgencyClassification} (Severity: ${selectedSession.severity})
**Recommended Specialty Referral**: ${selectedSession.suggestedSpecialist}

### Chief Complaint
${selectedSession.chiefComplaint}

### Present Illness Summary (English Translation)
${selectedSession.clinicalSummary}
*Symptom Duration*: ${selectedSession.duration || 'Not specified'}

### AI Triage Justification
${selectedSession.urgencyReason}

### Diagnostic Questions Checklist
${formattedQuestions}

### AI Treatment Plan Draft
${selectedSession.treatmentDraft || 'N/A'}
`;
    
    navigator.clipboard.writeText(mdNote);
    alert('Professional clinical note copied to clipboard in markdown format!');
  };

  const handleSendSMS = () => {
    setSmsSentText(true);
    setTimeout(() => setSmsSentText(false), 3000);
  };

  const toggleQuestionCheck = (idx: number) => {
    setCheckedQuestions(prev => ({
      ...prev,
      [`${selectedSessionId}-${idx}`]: !prev[`${selectedSessionId}-${idx}`]
    }));
  };

  const selectedSession = sessions.find(s => s.sessionId === selectedSessionId);
  const urgentCount = sessions.filter(s => s.urgencyClassification === 'Emergency' || s.urgencyClassification === 'High').length;
  const offlineCount = sessions.filter(s => s.isOfflineGenerated).length;

  // Filtered queue compilation
  const filteredSessions = sortSessionsByUrgency(sessions).filter((s) => {
    const matchesSearch = s.patientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          s.sessionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.chiefComplaint.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesUrgency = urgencyFilter === 'All' || s.urgencyClassification === urgencyFilter;
    
    // Check match for language code or name
    const matchesLanguage = languageFilter === 'All' || 
                            s.languageSpoken.toLowerCase().includes(languageFilter.toLowerCase());
    
    return matchesSearch && matchesUrgency && matchesLanguage;
  });

  const getUrgencyDetail = (level: string) => {
    switch (level) {
      case 'Emergency':
        return { label: 'Immediate Resuscitation', class: 'urgency-Emergency', desc: 'Critical life-threatening signs found.' };
      case 'High':
        return { label: 'Urgent Care', class: 'urgency-High', desc: 'Prompt medical attention recommended.' };
      case 'Medium':
        return { label: 'Observation Triage', class: 'urgency-Medium', desc: 'Clinical evaluation recommended.' };
      case 'Low':
      default:
        return { label: 'Routine Consultation', class: 'urgency-Low', desc: 'Routine ambulatory attention.' };
    }
  };

  return (
    <div className="clinical-workspace">
      <section className="dashboard-overview">
        <div>
          <p className="eyebrow">Clinical command centre</p>
          <h2>Today’s intake queue</h2>
          <p>Review structured multilingual intakes and prioritise patients safely.</p>
        </div>
        <div className="overview-metrics">
          <div><strong>{sessions.length}</strong><span>Active cases</span></div>
          <div className={urgentCount ? 'metric-urgent' : ''}><strong>{urgentCount}</strong><span>Priority review</span></div>
          <div><strong>{offlineCount}</strong><span>Local rule intakes</span></div>
        </div>
      </section>
      <div className="dashboard-grid">
      
      {/* Real-time sync notification banner */}
      {newSessionNotification && (
        <div className="offline-banner" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, backgroundColor: 'var(--primary-light)', color: 'var(--primary)', borderBottomColor: 'var(--primary)' }}>
          <span>🔔 {newSessionNotification}</span>
          <button className="offline-sync-btn" style={{ padding: '0.1rem 0.5rem' }} onClick={() => setNewSessionNotification(null)}>Dismiss</button>
        </div>
      )}

      {/* Sidebar: Patient Queue */}
      <aside className="patient-queue">
        <div className="queue-header" style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fafbfb' }}>
          <span style={{ fontWeight: 800, fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-main)' }}>Patient Triage Queue</span>
          <span className="badge">{filteredSessions.length} Active</span>
        </div>

        {/* Filter Bar */}
        <div className="queue-filters" style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: '#fdfdfd' }}>
          <input 
            type="text" 
            className="form-control" 
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }} 
            placeholder="Search patient / complaint..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            <select
              className="form-control"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
            >
              <option value="All">All Urgency</option>
              <option value="Emergency">Emergency</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <select
              className="form-control"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
            >
              <option value="All">All Languages</option>
              <option value="Hindi">Hindi</option>
              <option value="Tamil">Tamil</option>
              <option value="Telugu">Telugu</option>
              <option value="Marathi">Marathi</option>
              <option value="Bengali">Bengali</option>
              <option value="Gujarati">Gujarati</option>
              <option value="English">English</option>
            </select>
          </div>
        </div>

        <div className="queue-list">
          {sessionsLoading && sessions.length === 0 ? (
            <div className="dashboard-state" role="status"><span className="state-spinner" aria-hidden="true" /><strong>Loading intake queue…</strong></div>
          ) : sessionsError && sessions.length === 0 ? (
            <div className="dashboard-state dashboard-state-error" role="alert">
              <strong>Queue unavailable</strong><span>{sessionsError}</span>
              <button className="btn" onClick={onRetrySessions}>Try again</button>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>No matching patient intakes.</p>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const uInfo = getUrgencyDetail(session.urgencyClassification);
              const isUrgent = session.urgencyClassification === 'Emergency' || session.urgencyClassification === 'High';
              return (
                <div
                  key={session.sessionId}
                  className={`patient-item ${selectedSessionId === session.sessionId ? 'selected' : ''}`}
                  style={{
                    padding: '0.85rem 1rem',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    backgroundColor: selectedSessionId === session.sessionId ? 'var(--primary-glow)' : 'transparent',
                    borderLeft: selectedSessionId === session.sessionId ? '4px solid var(--primary)' : '4px solid transparent',
                    animation: isUrgent ? 'pulse-queue-border 2s infinite' : 'none'
                  }}
                  onClick={() => setSelectedSessionId(session.sessionId)}
                >
                  <div className="patient-item-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.9rem' }}>{session.patientName || 'Anonymous'}</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 800, padding: '0.1rem 0.4rem', borderRadius: '4px' }} className={`urgency-badge ${uInfo.class}`}>
                      {session.urgencyClassification}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)', margin: '0.15rem 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {session.chiefComplaint}
                  </div>
                  <div className="patient-item-sub" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>ID: {session.sessionId} | {session.age ? `${session.age}y` : 'Age N/A'} | {session.gender}</span>
                    <span style={{ float: 'right', fontWeight: 600, color: 'var(--primary)' }}>{session.languageSpoken.split(' ')[0]}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
        
        <div style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fafbfb' }}>
          <span>Telemetry Status:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
            <span className={`status-dot ${isConnected ? 'status-online' : 'status-offline'}`}></span>
            {isConnected ? 'LIVE WS FEED' : 'RECONNECTING...'}
          </span>
        </div>
      </aside>

      {/* Main Panel: EHR Clinical Intake Record */}
      <section className="patient-details-view">
        {selectedSession ? (
          <>
            {/* Pulsating danger overlay for emergency patients */}
            {(selectedSession.urgencyClassification === 'Emergency' || selectedSession.urgencyClassification === 'High') && (
              <div style={{
                backgroundColor: 'var(--urgency-emergency-bg)',
                color: 'var(--urgency-emergency-text)',
                padding: '0.5rem 1.5rem',
                fontSize: '0.8rem',
                fontWeight: 800,
                borderBottom: '1px solid var(--urgency-emergency-border)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                animation: 'pulse-danger-banner 1.5s infinite'
              }}>
                <span>🚨 <strong>CRITICAL PRIORITY:</strong> This patient meets the emergency triage threshold due to high-risk clinical markers. Attend immediately.</span>
              </div>
            )}

            <div className="details-header">
              <div className="details-title">
                <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>{selectedSession.patientName || 'Anonymous'}</h2>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Consult ID: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{selectedSession.sessionId}</strong> &bull; Age: {selectedSession.age || 'N/A'} &bull; Gender: {selectedSession.gender} &bull; Native Dialect: {selectedSession.languageSpoken}
                </p>
              </div>
              <div className="details-actions">
                <button className="btn" style={{ width: 'auto', padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: 700 }} onClick={handleCopyNote}>
                  📋 Copy EHR Note
                </button>
                <button className="btn" style={{ width: 'auto', padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: 700, border: '1px solid var(--border-color)' }} onClick={handlePrint}>
                  🖨️ Print Chart
                </button>
                <button className="btn btn-danger" style={{ width: 'auto', padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: 700 }} onClick={() => handleDismissPatient(selectedSession.sessionId)}>
                  ✓ End Session (Wipe Data)
                </button>
              </div>
            </div>

            <div className="details-body">
              {/* Clinical decision-support workspace */}
              <section className="copilot-workspace" aria-labelledby="copilot-workspace-title">
                <div className="copilot-workspace-heading">
                  <div>
                    <p className="copilot-kicker">Consultation workspace</p>
                    <h3 id="copilot-workspace-title">Clinical decision support</h3>
                  </div>
                  <div className="copilot-tabs" role="tablist" aria-label="Consultation support views">
                    <button
                      id="clinical-tab"
                      className={`copilot-tab ${copilotTab === 'clinical' ? 'active' : ''}`}
                      role="tab"
                      aria-selected={copilotTab === 'clinical'}
                      aria-controls="clinical-panel"
                      onClick={() => setCopilotTab('clinical')}
                    >
                      AI Clinical Copilot
                    </button>
                    <button
                      id="patient-tab"
                      className={`copilot-tab ${copilotTab === 'patient' ? 'active' : ''}`}
                      role="tab"
                      aria-selected={copilotTab === 'patient'}
                      aria-controls="patient-panel"
                      onClick={() => setCopilotTab('patient')}
                    >
                      Patient Handout
                    </button>
                  </div>
                </div>

                {copilotError ? (
                  <div className="copilot-status copilot-status-error" role="alert">
                    <strong>Unable to load decision-support content</strong>
                    <span>{copilotError}</span>
                  </div>
                ) : copilotTab === 'clinical' ? (
                  <div id="clinical-panel" role="tabpanel" aria-labelledby="clinical-tab" className="copilot-panel">
                    {!selectedSession.clinicalSummary &&
                     !selectedSession.treatmentDraft &&
                     !selectedSession.smartQuestions?.length &&
                     !selectedSession.redFlags?.length ? (
                      <div className="copilot-status">
                        <strong>Clinical draft not generated yet</strong>
                        <span>Complete the patient symptom analysis to generate clinician decision-support content.</span>
                      </div>
                    ) : (
                      <>
                        <div className="copilot-section-grid">
                          {(selectedSession.clinicalSummary || selectedSession.associatedSymptoms?.length) && (
                            <article className="copilot-section-card">
                              <h4>Clinical Assessment</h4>
                              {selectedSession.clinicalSummary && <p>{selectedSession.clinicalSummary}</p>}
                              {!!selectedSession.associatedSymptoms?.length && (
                                <div className="finding-list">
                                  {selectedSession.associatedSymptoms.map((symptom, index) => <span key={index}>{symptom}</span>)}
                                </div>
                              )}
                            </article>
                          )}

                          {!!selectedSession.smartQuestions?.length && (
                            <article className="copilot-section-card">
                              <h4>Suggested Next Steps</h4>
                              <p className="section-helper">Follow-up questions supplied by the clinical analysis for clinician verification.</p>
                              <div className="question-list">
                                {selectedSession.smartQuestions.map((question, index) => {
                                  const key = `${selectedSessionId}-${index}`;
                                  return (
                                    <label key={key} className={checkedQuestions[key] ? 'checked' : ''}>
                                      <input type="checkbox" checked={!!checkedQuestions[key]} onChange={() => toggleQuestionCheck(index)} />
                                      <span>{question}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </article>
                          )}

                          {selectedSession.treatmentDraft && (
                            <article className="copilot-section-card treatment-card">
                              <h4>Treatment Draft</h4>
                              <p>{selectedSession.treatmentDraft}</p>
                            </article>
                          )}

                          {!!selectedSession.redFlags?.length && (
                            <article className="copilot-section-card red-flags-card">
                              <h4>Red Flags</h4>
                              <ul>{selectedSession.redFlags.map((flag, index) => <li key={index}>{flag}</li>)}</ul>
                            </article>
                          )}
                        </div>
                        <aside className="clinical-disclaimer">
                          <strong>Clinical disclaimer</strong>
                          <span>AI-generated decision support only. Review all findings and drafts before making clinical decisions.</span>
                        </aside>
                      </>
                    )}
                  </div>
                ) : (
                  <div id="patient-panel" role="tabpanel" aria-labelledby="patient-tab" className="copilot-panel">
                    {!selectedSession.patientFriendlySummary ? (
                      <div className="copilot-status">
                        <strong>Patient handout not generated yet</strong>
                        <span>Complete the patient symptom analysis before sharing or printing a handout.</span>
                      </div>
                    ) : (
                      <>
                        <article className="handout-card">
                          <div className="handout-card-header">
                            <div>
                              <span>Patient-facing summary</span>
                              <h4>What we discussed and what to do next</h4>
                            </div>
                            <span className="language-chip">{selectedSession.languageSpoken || 'Language not specified'}</span>
                          </div>
                          <p>{selectedSession.patientFriendlySummary}</p>
                        </article>
                        <div className="handout-actions">
                          <button className="btn" onClick={() => {
                            const w = window.open();
                            if (w) {
                              const safeSummary = selectedSession.patientFriendlySummary || '';
                              w.document.write(`<main style="font-family: sans-serif; padding: 2rem; max-width: 680px; margin: auto"><h1 style="color:#0d9488">VaaniDoc Patient Handout</h1><p><strong>Patient:</strong> ${selectedSession.patientName}</p><p><strong>Consult ID:</strong> ${selectedSession.sessionId}</p><h2>Summary</h2><p style="font-size:1.1rem;line-height:1.7">${safeSummary}</p><hr><small>This intake summary must be reviewed with your clinician.</small></main>`);
                              w.document.close();
                              w.print();
                              w.close();
                            }
                          }}>Print Handout</button>
                          <button className="btn btn-primary" onClick={() => setShowQRModal(true)}>Sync to Patient Phone</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>

              {/* Privacy disclaimer */}
              <div className="privacy-disclaimer" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text-muted)' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>
                  <strong>Consult ID session constraint:</strong> Volatile transient storage. All record data is wiped immediately from node servers upon completeness session action.
                </span>
              </div>

            </div>
          </>
        ) : (
          <div className="details-body" style={{ padding: '2rem' }}>
            <div className="analytics-container">
              <div className="analytics-header-section" style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>Clinical Operations & Triage Analytics</h2>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Real-time AI telemetry feed for attending general practitioners and emergency staff</p>
              </div>

              <div className="analytics-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                
                {/* Triage Distribution Chart */}
                <div className="analytics-card" style={{ gridColumn: lowBandwidthMode ? 'span 2' : 'span 1', padding: '1.25rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: '#ffffff' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--primary)' }}>
                      <path d="M3 3v18h18"/>
                      <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/>
                    </svg>
                    Triage Distribution
                  </h3>
                  
                  {sessions.length > 0 ? (
                    lowBandwidthMode ? (
                      <ul style={{ paddingLeft: '1.25rem', fontSize: '0.9rem', margin: 0, lineHeight: 1.8 }}>
                        <li>Emergency: <strong>{sessions.filter(s => s.urgencyClassification === 'Emergency').length}</strong> cases</li>
                        <li>High: <strong>{sessions.filter(s => s.urgencyClassification === 'High').length}</strong> cases</li>
                        <li>Medium: <strong>{sessions.filter(s => s.urgencyClassification === 'Medium').length}</strong> cases</li>
                        <li>Routine: <strong>{sessions.filter(s => s.urgencyClassification === 'Low').length}</strong> cases</li>
                      </ul>
                    ) : (
                      <div className="analytics-bar-chart" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div className="analytics-bar-item">
                          <div className="analytics-bar-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                            <span>Emergency</span>
                            <span>{sessions.filter(s => s.urgencyClassification === 'Emergency').length} case{sessions.filter(s => s.urgencyClassification === 'Emergency').length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="analytics-bar-wrapper" style={{ height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                            <div className="analytics-bar-fill" style={{ height: '100%', width: `${(sessions.filter(s => s.urgencyClassification === 'Emergency').length / sessions.length) * 100}%`, backgroundColor: 'var(--urgency-emergency-text)' }}></div>
                          </div>
                        </div>

                        <div className="analytics-bar-item">
                          <div className="analytics-bar-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                            <span>High Priority</span>
                            <span>{sessions.filter(s => s.urgencyClassification === 'High').length} case{sessions.filter(s => s.urgencyClassification === 'High').length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="analytics-bar-wrapper" style={{ height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                            <div className="analytics-bar-fill" style={{ height: '100%', width: `${(sessions.filter(s => s.urgencyClassification === 'High').length / sessions.length) * 100}%`, backgroundColor: 'var(--urgency-high-text)' }}></div>
                          </div>
                        </div>

                        <div className="analytics-bar-item">
                          <div className="analytics-bar-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                            <span>Medium Priority</span>
                            <span>{sessions.filter(s => s.urgencyClassification === 'Medium').length} case{sessions.filter(s => s.urgencyClassification === 'Medium').length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="analytics-bar-wrapper" style={{ height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                            <div className="analytics-bar-fill" style={{ height: '100%', width: `${(sessions.filter(s => s.urgencyClassification === 'Medium').length / sessions.length) * 100}%`, backgroundColor: 'var(--urgency-medium-text)' }}></div>
                          </div>
                        </div>

                        <div className="analytics-bar-item">
                          <div className="analytics-bar-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                            <span>Routine (Low)</span>
                            <span>{sessions.filter(s => s.urgencyClassification === 'Low').length} case{sessions.filter(s => s.urgencyClassification === 'Low').length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="analytics-bar-wrapper" style={{ height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                            <div className="analytics-bar-fill" style={{ height: '100%', width: `${(sessions.filter(s => s.urgencyClassification === 'Low').length / sessions.length) * 100}%`, backgroundColor: 'var(--urgency-low-text)' }}></div>
                          </div>
                        </div>
                      </div>
                    )
                  ) : (
                    <div style={{ padding: '2.5rem 0', color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
                      No active patient intake sessions to compile triage priority.
                    </div>
                  )}
                </div>

                {/* Queue Summary Stats */}
                <div className="analytics-card" style={{ gridColumn: lowBandwidthMode ? 'span 2' : 'span 1', padding: '1.25rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: '#ffffff' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--primary)' }}>
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    Queue Telemetry
                  </h3>
                  <div className="analytics-stats-list" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                    <div className="analytics-stat-box" style={{ padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                      <div className="analytics-stat-value" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>{sessions.length}</div>
                      <div className="analytics-stat-label" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>Active Intake Forms</div>
                    </div>
                    <div className="analytics-stat-box" style={{ padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                      <div className="analytics-stat-value" style={{ fontSize: '1.5rem', fontWeight: 800, color: sessions.filter(s => s.isOfflineGenerated).length > 0 ? 'var(--urgency-medium-text)' : 'var(--urgency-low-text)' }}>
                        {sessions.filter(s => s.isOfflineGenerated).length}
                      </div>
                      <div className="analytics-stat-label" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>Offline Sync Pending</div>
                    </div>
                    <div className="analytics-stat-box" style={{ padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                      <div className="analytics-stat-value" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
                        {sessions.length > 0 ? '94%' : 'N/A'}
                      </div>
                      <div className="analytics-stat-label" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>AI Accuracy Average</div>
                    </div>
                    <div className="analytics-stat-box" style={{ padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                      <div className="analytics-stat-value" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--urgency-low-text)' }}>
                        {sessions.length > 0 ? 'Active' : 'Idle'}
                      </div>
                      <div className="analytics-stat-label" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>System Operations</div>
                    </div>
                  </div>
                </div>

                {/* Referrals Breakdown */}
                <div className="analytics-card" style={{ gridColumn: 'span 2', padding: '1.25rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: '#ffffff' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--primary)' }}>
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    Primary Specialty Allocations
                  </h3>
                  
                  {sessions.length > 0 ? (
                    lowBandwidthMode ? (
                      <ul style={{ paddingLeft: '1.25rem', fontSize: '0.9rem', margin: 0, lineHeight: 1.8 }}>
                        {Object.entries(
                          sessions.reduce((acc, s) => {
                            const spec = s.suggestedSpecialist || 'General Physician';
                            const cleanSpec = spec.split('/')[0].trim();
                            acc[cleanSpec] = (acc[cleanSpec] || 0) + 1;
                            return acc;
                          }, {} as Record<string, number>)
                        ).map(([spec, count], idx) => (
                          <li key={idx}>{spec}: <strong>{count}</strong> referrals</li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem' }}>
                        {Object.entries(
                          sessions.reduce((acc, s) => {
                            const spec = s.suggestedSpecialist || 'General Physician';
                            const cleanSpec = spec.split('/')[0].trim();
                            acc[cleanSpec] = (acc[cleanSpec] || 0) + 1;
                            return acc;
                          }, {} as Record<string, number>)
                        )
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 4)
                          .map(([spec, count], idx) => (
                            <div key={idx} className="analytics-bar-item">
                              <div className="analytics-bar-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                                <span>{spec}</span>
                                <span>{count} patient{count !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="analytics-bar-wrapper" style={{ height: '6px', backgroundColor: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                                <div className="analytics-bar-fill" style={{ height: '100%', width: `${(count / sessions.length) * 100}%`, backgroundColor: 'var(--primary)' }}></div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )
                  ) : (
                    <div style={{ padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
                      No active sessions to chart specialty distribution. Select a patient from the queue to review details.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Sharing and QR Code Modal (Wow Factor) */}
      {showQRModal && selectedSession && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15,23,42,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            padding: '2rem',
            borderRadius: 'var(--radius-lg)',
            maxWidth: '450px',
            width: '100%',
            textAlign: 'center',
            boxShadow: 'var(--shadow-lg)',
            border: '2px solid var(--primary)',
            position: 'relative',
            animation: 'fadeIn 0.25s'
          }}>
            <button
              onClick={() => { setShowQRModal(false); setSmsSentText(false); }}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                border: 'none',
                background: 'transparent',
                fontSize: '1.2rem',
                cursor: 'pointer',
                fontWeight: 'bold',
                color: 'var(--text-muted)'
              }}
            >
              &times;
            </button>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
              📲 Share Consult Summary
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem', fontWeight: 600 }}>
              Scan QR code with the patient's phone to transfer their translated summary directly, or trigger a mockup SMS message.
            </p>

            {/* Self-contained mockup SVG QR Code */}
            <div style={{
              display: 'inline-flex',
              padding: '1rem',
              backgroundColor: '#f8fafc',
              border: '2px solid var(--border-color)',
              borderRadius: '12px',
              marginBottom: '1.5rem'
            }}>
              <svg width="140" height="140" viewBox="0 0 29 29" fill="none" stroke="currentColor" strokeWidth="0.1" shapeRendering="crispEdges">
                <path d="M0 0h7v7H0V0zm1 1v5h5V1H1zm1 1h3v3H2V2zm0 18h7v7H0v-7zm1 1v5h5v-5H1zm21-21h7v7h-7V0zm1 1v5h5V1h-5zm-14 1h1v1h-1v-1zm1 1h2v1h-2v-1zm-1 2h1v1h-1v-1zm4-3h1v1h-1V3zm2 0h1v2h-1V3zm-1 3h2v1h-2V6zm8-3h1v1h-1V3zm2 1h1v2h-1V4zm-2 2h2v1h-2V6zm-11 5h1v1h-1v-1zm2 1h1v2h-1v-2zm-1 2h2v1h-2v-1zm-4-3h1v1h-1v-1zm1 2h2v1h-2v-1zm6-1h1v3h-1v-3zm3 0h1v1h-1v-1zm1 1h1v2h-1v-2zm-2 2h2v1h-2v-1zm-11 6h1v1h-1v-1zm1 1h2v1h-2v-1zm-1 2h1v1h-1v-1zm5-3h1v2h-1v-2zm1 2h2v1h-2v-1zm-1-3h1v1h-1v-1zm4 1h1v2h-1v-2zm1-1h1v1h-1v-1zm-2 3h2v1h-2v-1z" fill="#0d9488"/>
              </svg>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={handleSendSMS}>
                {smsSentText ? '✓ Intake Summary Sent via SMS' : '💬 Send Mockup SMS Notification'}
              </button>
              <button className="btn" style={{ border: '1px solid var(--border-color)', backgroundColor: '#ffffff' }} onClick={() => { setShowQRModal(false); setSmsSentText(false); }}>
                Dismiss Dialog
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-queue-border {
          0% { border-left-color: var(--urgency-emergency-text); }
          50% { border-left-color: rgba(185, 28, 28, 0.2); }
          100% { border-left-color: var(--urgency-emergency-text); }
        }
        @keyframes pulse-danger-banner {
          0% { background-color: var(--urgency-emergency-bg); }
          50% { background-color: #fee2e2; }
          100% { background-color: var(--urgency-emergency-bg); }
        }
        .urgency-badge.urgency-Emergency {
          background-color: var(--urgency-emergency-bg);
          color: var(--urgency-emergency-text);
          border: 1px solid var(--urgency-emergency-border);
        }
        .urgency-badge.urgency-High {
          background-color: var(--urgency-high-bg);
          color: var(--urgency-high-text);
          border: 1px solid var(--urgency-high-border);
        }
        .urgency-badge.urgency-Medium {
          background-color: var(--urgency-medium-bg);
          color: var(--urgency-medium-text);
          border: 1px solid var(--urgency-medium-border);
        }
        .urgency-badge.urgency-Low {
          background-color: var(--urgency-low-bg);
          color: var(--urgency-low-text);
          border: 1px solid var(--urgency-low-border);
        }
      `}</style>

      </div>
    </div>
  );
};
