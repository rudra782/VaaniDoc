import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import API_URL from '../config';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

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
  possibleCauses?: { name: string; reasoning: string; confidence: 'low' | 'moderate' | 'higher' }[];
  missingInformation?: string[];
  recommendedNextSteps?: string[];
  selfCareGuidance?: string[];
  precautions?: string[];
  medicationConsiderations?: { nameOrClass: string; purpose: string; conditionsForUse: string; safetyNotes: string }[];
  medicationSafetySummary?: string;
  followUpGuidance?: string[];
  consultationAnswers?: { question: string; answer: string }[];
  clinicianNotes?: string;
  vitals?: Record<string, string>;
  examinationNotes?: string;
  consultationCompleteness?: number;
  completenessMissingItems?: string[];
  suggestedExamination?: string[];
  possibleInvestigations?: { name: string; reason: string; priority: 'optional' | 'consider' | 'recommended' }[];
  warningSignsToWatchFor?: string[];
  analysisVersion?: number;
  lastAnalyzedAt?: string;
  isConsultationFinalized?: boolean;
  assessmentStage?: string;
  confidence?: number;
  data?: {
    smart_questions?: string[];
    treatment_draft?: string;
    patient_friendly_summary?: string;
    red_flags?: string[];
    confidence?: number;
    possible_causes?: IntakeSession['possibleCauses'];
    missing_information?: string[];
    recommended_next_steps?: string[];
    self_care_guidance?: string[];
    precautions?: string[];
    medication_considerations?: IntakeSession['medicationConsiderations'];
    medication_safety_summary?: string;
    follow_up_guidance?: string[];
  };
  isOfflineGenerated?: boolean;
}

type SessionUrgency = 'Low' | 'Medium' | 'High' | 'Emergency';
const normalizeUrgency = (value: unknown): SessionUrgency => {
  const match = String(value ?? '').trim().toLowerCase();
  if (match === 'emergency') return 'Emergency';
  if (match === 'high') return 'High';
  if (match === 'medium') return 'Medium';
  return 'Low';
};

const normalizeSession = (session: IntakeSession): IntakeSession => {
  const apiData = session.data;
  return {
    ...session,
    urgencyClassification: normalizeUrgency(session.urgencyClassification),
    smartQuestions: session.smartQuestions ?? apiData?.smart_questions,
    treatmentDraft: session.treatmentDraft ?? apiData?.treatment_draft,
    patientFriendlySummary: session.patientFriendlySummary ?? apiData?.patient_friendly_summary,
    redFlags: session.redFlags ?? apiData?.red_flags,
    confidence: session.confidence ?? apiData?.confidence,
    possibleCauses: session.possibleCauses ?? apiData?.possible_causes,
    missingInformation: session.missingInformation ?? apiData?.missing_information,
    recommendedNextSteps: session.recommendedNextSteps ?? apiData?.recommended_next_steps,
    selfCareGuidance: session.selfCareGuidance ?? apiData?.self_care_guidance,
    precautions: session.precautions ?? apiData?.precautions,
    medicationConsiderations: session.medicationConsiderations ?? apiData?.medication_considerations,
    medicationSafetySummary: session.medicationSafetySummary ?? apiData?.medication_safety_summary,
    followUpGuidance: session.followUpGuidance ?? apiData?.follow_up_guidance,
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
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [consultationDrafts, setConsultationDrafts] = useState<Record<string, { answers: Record<string, string>; clinicianNotes: string; vitals: Record<string, string>; examinationNotes: string }>>({});
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);

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

  const toggleQuestionCheck = (idx: number) => {
    setCheckedQuestions(prev => ({
      ...prev,
      [`${selectedSessionId}-${idx}`]: !prev[`${selectedSessionId}-${idx}`]
    }));
  };

  const selectedSession = sessions.find(s => s.sessionId === selectedSessionId);
  const savedDraft = selectedSession ? consultationDrafts[selectedSession.sessionId] : undefined;
  const draftAnswer = (question: string) => savedDraft?.answers[question] ?? selectedSession?.consultationAnswers?.find(item => item.question === question)?.answer ?? '';
  const updateDraft = (patch: Partial<NonNullable<typeof savedDraft>>) => {
    if (!selectedSession) return;
    const base = savedDraft || { answers: Object.fromEntries((selectedSession.consultationAnswers || []).map(item => [item.question, item.answer])), clinicianNotes: selectedSession.clinicianNotes || '', vitals: selectedSession.vitals || {}, examinationNotes: selectedSession.examinationNotes || '' };
    setConsultationDrafts(previous => ({ ...previous, [selectedSession.sessionId]: { ...base, ...patch } }));
  };
  const handleReanalyze = async () => {
    if (!selectedSession || isReanalyzing) return;
    const draft = savedDraft || { answers: Object.fromEntries((selectedSession.consultationAnswers || []).map(item => [item.question, item.answer])), clinicianNotes: selectedSession.clinicianNotes || '', vitals: selectedSession.vitals || {}, examinationNotes: selectedSession.examinationNotes || '' };
    setIsReanalyzing(true); setConsultationError(null);
    try {
      const response = await fetch(`${API_URL}/api/session/${selectedSession.sessionId}/reanalyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consultationAnswers: Object.entries(draft.answers).map(([question, answer]) => ({ question, answer })), clinicianNotes: draft.clinicianNotes, vitals: draft.vitals, examinationNotes: draft.examinationNotes }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to update assessment.');
      const updated = normalizeSession(await response.json());
      setSessions(previous => previous.map(item => item.sessionId === updated.sessionId ? updated : item));
    } catch (error) { setConsultationError(error instanceof Error ? error.message : 'Unable to update assessment. The previous assessment is still available.'); }
    finally { setIsReanalyzing(false); }
  };
  const handleFinalize = async () => {
    if (!selectedSession || isReanalyzing) return;
    setConsultationError(null);
    try {
      const response = await fetch(`${API_URL}/api/session/${selectedSession.sessionId}/finalize`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to finalize consultation.');
      const updated = normalizeSession(await response.json());
      setSessions(previous => previous.map(item => item.sessionId === updated.sessionId ? updated : item));
      setCopilotTab('patient');
    } catch (error) { setConsultationError(error instanceof Error ? error.message : 'Unable to finalize consultation.'); }
  };
  const handoutSummary = selectedSession?.patientFriendlySummary?.trim().slice(0, 360);
  const handoutQrPayload = selectedSession ? [
    'VaaniDoc Patient Handout',
    selectedSession.patientName?.trim() && `Patient: ${selectedSession.patientName.trim()}`,
    selectedSession.sessionId?.trim() && `Consult ID: ${selectedSession.sessionId.trim()}`,
    selectedSession.languageSpoken?.trim() && `Language: ${selectedSession.languageSpoken.trim()}`,
    handoutSummary && `Summary: ${handoutSummary}`
  ].filter(Boolean).join('\n') : '';
  const urgentCount = sessions.filter(s => s.urgencyClassification === 'Emergency' || s.urgencyClassification === 'High').length;
  const offlineCount = sessions.filter(s => s.isOfflineGenerated).length;

  const handlePrintHandout = () => {
    if (!selectedSession?.patientFriendlySummary) return;
    const printWindow = window.open('', '_blank', 'width=820,height=900');
    if (!printWindow) {
      alert('Please allow pop-ups to print the patient handout.');
      return;
    }
    const detail = (label: string, value: unknown) => `<div class="detail"><span>${label}</span><strong>${escapeHtml(value || 'Not provided')}</strong></div>`;
    const listSection = (title: string, values?: string[]) => values?.length ? `<section><h2>${title}</h2><ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>` : '';
    const causes = selectedSession.possibleCauses?.length ? `<section><h2>What may be causing your symptoms</h2><p>These are possibilities, not confirmed diagnoses.</p><ul>${selectedSession.possibleCauses.map(cause => `<li>${escapeHtml(cause.name)}</li>`).join('')}</ul></section>` : '';
    const redFlags = selectedSession.warningSignsToWatchFor?.length
      ? `<section class="warning"><h2>Warning signs requiring urgent help</h2><ul>${selectedSession.warningSignsToWatchFor.map(flag => `<li>${escapeHtml(flag)}</li>`).join('')}</ul></section>`
      : '';
    printWindow.addEventListener('load', () => {
      printWindow.onafterprint = () => printWindow.close();
      printWindow.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 100);
    }, { once: true });
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>VaaniDoc Patient Handout</title><style>
      *{box-sizing:border-box}body{margin:0;background:#eef6f4;color:#173f3b;font:15px/1.65 Arial,sans-serif}.page{width:min(760px,calc(100% - 32px));margin:24px auto;padding:38px;background:#fff;border:1px solid #cfe2de;border-radius:14px}.brand{padding-bottom:18px;border-bottom:3px solid #0d9488}.brand h1{margin:0;color:#0d9488;font-size:25px}.brand p{margin:3px 0 0;color:#607a76}.details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}.detail{padding:10px 12px;background:#f5faf9;border:1px solid #dce9e6;border-radius:8px}.detail span{display:block;color:#718984;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.detail strong{display:block;margin-top:2px;overflow-wrap:anywhere}section{margin-top:20px}h2{margin:0 0 7px;color:#20514b;font-size:16px}p,ul{margin:0;white-space:pre-wrap}.summary{padding:17px;border-left:4px solid #0d9488;background:#f0fdfa}.warning{padding:15px;border:1px solid #efc4bd;background:#fff7f6;border-radius:8px}.warning h2,.warning li{color:#9f2923}.disclaimer{margin-top:28px;padding-top:14px;border-top:1px solid #dce9e6;color:#667e7a;font-size:11px}@media(max-width:560px){.page{padding:22px}.details{grid-template-columns:1fr}}@media print{body{background:#fff}.page{width:100%;margin:0;padding:20px;border:0;border-radius:0}.no-break,section{break-inside:avoid}@page{size:A4;margin:12mm}}
    </style></head><body><main class="page"><header class="brand"><h1>VaaniDoc</h1><p>Patient Handout</p></header><div class="details">${detail('Patient name', selectedSession.patientName)}${detail('Consult ID', selectedSession.sessionId)}${detail('Age', selectedSession.age)}${detail('Gender', selectedSession.gender)}${detail('Language', selectedSession.languageSpoken)}</div><section class="summary no-break"><h2>What we understood</h2><p>${escapeHtml(selectedSession.patientFriendlySummary)}</p></section>${causes}${listSection('What you can do now', selectedSession.selfCareGuidance)}${listSection('Precautions', selectedSession.precautions)}${redFlags}${listSection('Follow-up recommendation', selectedSession.followUpGuidance)}<footer class="disclaimer"><strong>Clinical disclaimer:</strong> Possible causes are not confirmed diagnoses. This AI-assisted handout must be reviewed with a qualified clinician. Medication considerations are intentionally not included unless a separate clinician approval workflow is provided.</footer></main></body></html>`);
    printWindow.document.close();
  };

  const handleCopyHandoutSummary = async () => {
    if (!selectedSession) return;
    try {
      await navigator.clipboard.writeText(handoutQrPayload);
      setSummaryCopied(true);
      window.setTimeout(() => setSummaryCopied(false), 2000);
    } catch {
      alert('Unable to copy the handout summary. Please check clipboard permissions.');
    }
  };

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
        return { label: 'Emergency', class: 'urgency-Emergency', desc: 'Emergency assessment indicated by the current session.' };
      case 'High':
        return { label: 'Urgent', class: 'urgency-High', desc: 'Prompt medical attention recommended.' };
      case 'Medium':
        return { label: 'Priority Review', class: 'urgency-Medium', desc: 'Clinical evaluation recommended.' };
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
                      {uInfo.label}
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
                backgroundColor: selectedSession.urgencyClassification === 'Emergency' ? 'var(--urgency-emergency-bg)' : 'var(--urgency-high-bg)',
                color: selectedSession.urgencyClassification === 'Emergency' ? 'var(--urgency-emergency-text)' : 'var(--urgency-high-text)',
                padding: '0.5rem 1.5rem',
                fontSize: '0.8rem',
                fontWeight: 800,
                borderBottom: `1px solid ${selectedSession.urgencyClassification === 'Emergency' ? 'var(--urgency-emergency-border)' : 'var(--urgency-high-border)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                animation: 'pulse-danger-banner 1.5s infinite'
              }}>
                <span><strong>{getUrgencyDetail(selectedSession.urgencyClassification).label}:</strong> {selectedSession.urgencyReason}</span>
              </div>
            )}

            <div className="details-header">
              <div className="details-title">
                <span className="overview-stage-label">Stage 1 · Patient Overview</span>
                <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>{selectedSession.patientName || 'Anonymous'}</h2>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Consult ID: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{selectedSession.sessionId}</strong> &bull; Age: {selectedSession.age || 'N/A'} &bull; Gender: {selectedSession.gender} &bull; Native Dialect: {selectedSession.languageSpoken}
                </p>
                <div className="patient-overview-row" aria-label="Patient overview">
                  <span><small>Chief complaint</small><strong>{selectedSession.chiefComplaint}</strong></span>
                  <span><small>Current urgency</small><strong className={getUrgencyDetail(selectedSession.urgencyClassification).class}>{getUrgencyDetail(selectedSession.urgencyClassification).label}</strong></span>
                  <span><small>Suggested specialist</small><strong>{selectedSession.suggestedSpecialist}</strong></span>
                  <span><small>Information completeness</small><strong>{selectedSession.consultationCompleteness ?? 0}%</strong></span>
                </div>
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
                    <p className="copilot-kicker">Stage 2</p>
                    <h3 id="copilot-workspace-title">Guided Consultation</h3>
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
                    <section className="consultation-guide" aria-labelledby="consultation-guide-title">
                      <div className="consultation-progress">
                        <div><p className="copilot-kicker">{selectedSession.assessmentStage || 'Initial Assessment'} · Version {selectedSession.analysisVersion || 1}</p><h4 id="consultation-guide-title">Interactive AI-Guided Consultation</h4></div>
                        <div className="completeness-value"><strong>{selectedSession.consultationCompleteness ?? 0}%</strong><span>Information completeness</span></div>
                      </div>
                      <div className="completeness-track" aria-label={`Information completeness ${selectedSession.consultationCompleteness ?? 0}%`}><span style={{ width: `${selectedSession.consultationCompleteness ?? 0}%` }} /></div>
                      <div className="consultation-facts-grid">
                        <article><h5>Patient Reported</h5><dl><div><dt>Complaint</dt><dd>{selectedSession.chiefComplaint || 'Not established'}</dd></div><div><dt>Original narration</dt><dd>{selectedSession.originalSymptomsText || 'Not specified'}</dd></div><div><dt>Duration</dt><dd>{selectedSession.duration || 'Not specified'}</dd></div><div><dt>Severity</dt><dd>{selectedSession.severity || 'Not specified'}</dd></div><div><dt>Associated symptoms</dt><dd>{selectedSession.associatedSymptoms?.length ? selectedSession.associatedSymptoms.join(', ') : 'None reported'}</dd></div><div><dt>Language</dt><dd>{selectedSession.languageSpoken || 'Not specified'}</dd></div></dl></article>
                        <article><h5>Information Still Needed</h5>{selectedSession.missingInformation?.length ? <ul>{selectedSession.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No additional item identified by the current analysis.</p>} {!!selectedSession.completenessMissingItems?.length && <details><summary>Completeness dimensions still useful</summary><ul>{selectedSession.completenessMissingItems.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</article>
                      </div>
                      <div className="guided-consultation-columns">
                        <div>{!!selectedSession.smartQuestions?.length && <div className="guided-questions"><h5>AI Suggested Questions & Doctor-entered Answers</h5>{selectedSession.smartQuestions.map((question, index) => <label key={index}><span>{question}</span><input className="form-control" value={draftAnswer(question)} onChange={event => updateDraft({ answers: { ...(savedDraft?.answers || Object.fromEntries((selectedSession.consultationAnswers || []).map(item => [item.question, item.answer]))), [question]: event.target.value } })} placeholder="Record the patient's answer; leave blank if unknown" /></label>)}</div>}</div>
                        <div><details className="vitals-panel"><summary>Vitals & Examination (optional)</summary><div className="vitals-grid">{[['temperature','Temperature'],['bpSystolic','BP systolic'],['bpDiastolic','BP diastolic'],['pulse','Pulse'],['spo2','SpO2'],['respiratoryRate','Respiratory rate'],['painScore','Pain score (0–10)']].map(([key,label]) => <label key={key}><span>{label}</span><input className="form-control" value={savedDraft?.vitals[key] ?? selectedSession.vitals?.[key] ?? ''} onChange={event => updateDraft({ vitals: { ...(savedDraft?.vitals || selectedSession.vitals || {}), [key]: event.target.value } })} /></label>)}</div><label><span>Focused Examination Notes</span><textarea className="form-control" value={savedDraft?.examinationNotes ?? selectedSession.examinationNotes ?? ''} onChange={event => updateDraft({ examinationNotes: event.target.value })} placeholder="Record observed examination findings only" /></label></details>
                        <label className="consultation-notes"><span>Additional Consultation Notes</span><textarea className="form-control" value={savedDraft?.clinicianNotes ?? selectedSession.clinicianNotes ?? ''} onChange={event => updateDraft({ clinicianNotes: event.target.value })} placeholder="Add patient-reported context not covered above" /></label></div>
                      </div>
                      {consultationError && <div className="copilot-status copilot-status-error" role="alert">{consultationError}</div>}
                      {isReanalyzing && <p className="reanalyze-status" role="status">Updating clinical assessment...</p>}
                      <div className="consultation-actions"><button className="btn btn-primary" disabled={isReanalyzing} onClick={handleReanalyze}>{isReanalyzing ? 'Updating clinical assessment...' : 'Update Clinical Assessment'}</button><button className="btn" disabled={isReanalyzing} onClick={handleFinalize}>{selectedSession.isConsultationFinalized ? 'Consultation Finalized' : 'Finalize Consultation'}</button></div>
                    </section>
                    <div className="clinical-report-heading"><p className="copilot-kicker">Stage 3</p><h3>Clinical Report</h3><span>Review AI considerations separately from the editable consultation controls.</span></div>
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
                              <p className="evidence-label">Patient reported</p>
                              <p>{selectedSession.originalSymptomsText}</p>
                              <p className="evidence-label">Clinical synthesis</p>
                              {selectedSession.clinicalSummary && <p>{selectedSession.clinicalSummary}</p>}
                              {!!selectedSession.associatedSymptoms?.length && (
                                <div className="finding-list">
                                  {selectedSession.associatedSymptoms.map((symptom, index) => <span key={index}>{symptom}</span>)}
                                </div>
                              )}
                            </article>
                          )}

                          {!!selectedSession.possibleCauses?.length && (
                            <article className="copilot-section-card">
                              <h4>Possible Causes</h4>
                              <p className="section-helper">AI considerations — differential possibilities, not confirmed diagnoses.</p>
                              <div className="cause-list">{selectedSession.possibleCauses.map((cause, index) => <div key={index} className="cause-item"><div><strong>{cause.name}</strong><span className={`confidence-chip confidence-${cause.confidence}`}>{cause.confidence}</span></div><p>{cause.reasoning}</p></div>)}</div>
                            </article>
                          )}

                          {!!selectedSession.missingInformation?.length && <article className="copilot-section-card"><h4>Information Still Needed</h4><ul>{selectedSession.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul></article>}

                          {!!selectedSession.smartQuestions?.length && (
                            <article className="copilot-section-card">
                              <h4>Suggested Questions</h4>
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

                          {!!selectedSession.recommendedNextSteps?.length && <article className="copilot-section-card"><h4>Recommended Next Steps</h4><p className="evidence-label">Clinical action — requires clinician judgment</p><ul>{selectedSession.recommendedNextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></article>}

                          {!!selectedSession.selfCareGuidance?.length && <details className="copilot-section-card secondary-report-card"><summary>Self-Care / Immediate Support</summary><ul>{selectedSession.selfCareGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}

                          {!!selectedSession.precautions?.length && <details className="copilot-section-card secondary-report-card"><summary>Precautions</summary><ul>{selectedSession.precautions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}

                          <details className="copilot-section-card medication-card secondary-report-card">
                            <summary>Medication Considerations · For clinician review</summary>
                            {selectedSession.medicationConsiderations?.length ? <div className="cause-list">{selectedSession.medicationConsiderations.map((option, index) => <div className="cause-item" key={index}><strong>{option.nameOrClass}</strong><p>{option.purpose}</p><p><b>Only if:</b> {option.conditionsForUse}</p><p><b>Safety:</b> {option.safetyNotes}</p></div>)}</div> : <p>{selectedSession.medicationSafetySummary}</p>}
                          </details>

                          {selectedSession.treatmentDraft && (
                            <article className="copilot-section-card treatment-card">
                              <h4>Treatment Draft</h4>
                              <p>{selectedSession.treatmentDraft}</p>
                            </article>
                          )}

                          {!!selectedSession.redFlags?.length && (
                            <article className="copilot-section-card red-flags-card">
                              <h4>Current Red Flags</h4>
                              <p className="section-helper">Reported or detected now — not hypothetical risks.</p>
                              <ul>{selectedSession.redFlags.map((flag, index) => <li key={index}>{flag}</li>)}</ul>
                            </article>
                          )}

                          {!!selectedSession.warningSignsToWatchFor?.length && <details className="copilot-section-card watch-signs-card secondary-report-card"><summary>Warning Signs to Watch For</summary><p className="section-helper">Not currently reported; these do not determine current urgency.</p><ul>{selectedSession.warningSignsToWatchFor.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
                          {!!selectedSession.suggestedExamination?.length && <details className="copilot-section-card secondary-report-card"><summary>Suggested Examination / Monitoring</summary><p className="section-helper">Suggestions for what to check — not examination findings.</p><ul>{selectedSession.suggestedExamination.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
                          <details className="copilot-section-card secondary-report-card"><summary>Possible Investigations</summary>{selectedSession.possibleInvestigations?.length ? <div className="cause-list">{selectedSession.possibleInvestigations.map((item, index) => <div className="cause-item" key={index}><strong>{item.name} · {item.priority}</strong><p>{item.reason}</p></div>)}</div> : <p>More history or examination is needed before deciding whether tests are justified.</p>}</details>

                          <article className="copilot-section-card"><h4>Suggested Specialist</h4><p>{selectedSession.suggestedSpecialist}</p><p className="section-helper">Routing is based on the analyzed broad category and urgency.</p></article>

                          {!!selectedSession.followUpGuidance?.length && <details className="copilot-section-card secondary-report-card"><summary>Follow-Up</summary><ul>{selectedSession.followUpGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
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
                          {!!selectedSession.possibleCauses?.length && <div className="handout-section"><h5>What may be causing your symptoms</h5><p>These are possibilities, not confirmed diagnoses.</p><ul>{selectedSession.possibleCauses.map((cause, index) => <li key={index}>{cause.name}</li>)}</ul></div>}
                          {!!selectedSession.selfCareGuidance?.length && <div className="handout-section"><h5>What you can do now</h5><ul>{selectedSession.selfCareGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                          {!!selectedSession.precautions?.length && <div className="handout-section"><h5>Precautions</h5><ul>{selectedSession.precautions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                          {!!selectedSession.warningSignsToWatchFor?.length && <div className="handout-section handout-warning"><h5>Warning signs requiring urgent help</h5><ul>{selectedSession.warningSignsToWatchFor.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                          {!!selectedSession.followUpGuidance?.length && <div className="handout-section"><h5>Follow-up recommendation</h5><ul>{selectedSession.followUpGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                        </article>
                        <div className="handout-actions">
                          <button className="btn" onClick={handlePrintHandout}>Print Handout</button>
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

      {/* Local, transient patient handout sharing modal */}
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
              onClick={() => { setShowQRModal(false); setSummaryCopied(false); }}
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
              Share Patient Handout
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem', fontWeight: 600 }}>
              Scan this QR code with the patient's phone to view the handout summary.
            </p>

            <div className="qr-frame" style={{
              display: 'inline-flex',
              padding: '1rem',
              backgroundColor: '#f8fafc',
              border: '2px solid var(--border-color)',
              borderRadius: '12px',
              marginBottom: '1.5rem'
            }}>
              <QRCodeSVG
                className="handout-qr"
                value={handoutQrPayload}
                size={240}
                level="H"
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#000000"
                role="img"
                aria-label="QR code containing this patient's handout summary"
              />
            </div>

            <p className="qr-consult-id">Consult ID: <strong>{selectedSession.sessionId || 'Not provided'}</strong></p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={handleCopyHandoutSummary}>
                {summaryCopied ? 'Summary Copied' : 'Copy Summary'}
              </button>
              <button className="btn" style={{ border: '1px solid var(--border-color)', backgroundColor: '#ffffff' }} onClick={() => { setShowQRModal(false); setSummaryCopied(false); }}>
                Close
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
