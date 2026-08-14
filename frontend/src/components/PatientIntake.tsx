import React, { useState, useEffect, useRef } from 'react';
import { runOfflineSymptomAnalysis } from '../utils/offlineEngine';
import API_URL from '../config';

const OFFLINE_DRAFTS_KEY = 'vaanidoc_session_drafts';

const LANGUAGES = [
  { name: 'Auto Detect (સ્વય่ม ચିહ્નો)', code: 'auto', defaultText: 'Describe your symptoms naturally, we will detect the language.' },
  { name: 'Hindi (हिंदी)', code: 'hi-IN', defaultText: 'मुझे दो दिन से बुखार है और खाँसी आ रही है।' },
  { name: 'Tamil (தமிழ்)', code: 'ta-IN', defaultText: 'கடந்த இரண்டு நாட்களாக எனக்கு கடுமையான காய்ச்சல் உள்ளது.' },
  { name: 'Telugu (తెలుగు)', code: 'te-IN', defaultText: 'నాకు మూడు రోజుల నుండి జ్వరం మరియు దగ్గు ఉంది.' },
  { name: 'Marathi (मराठी)', code: 'mr-IN', defaultText: 'मला दोन दिवसांपासून ताप आणि खोकला आहे.' },
  { name: 'Bengali (বাংলা)', code: 'bn-IN', defaultText: 'আমার দুদিন ধরে জ্বর এবং কাশি হচ্ছে।' },
  { name: 'Gujarati (ગુજરાતી)', code: 'gu-IN', defaultText: 'મને બે દિવસથી તાવ અને ખાંसी છે।' },
  { name: 'Kannada (ಕನ್ನಡ)', code: 'kn-IN', defaultText: 'ನನಗೆ ಎರಡು ದಿನಗಳಿಂದ ಜ್ವರ ಮತ್ತು ಕೆಮ್ಮು ಇದೆ.' },
  { name: 'Malayalam (മലയാളം)', code: 'ml-IN', defaultText: 'എനിക്ക് രണ്ടു ദിവസമായി പനിയും ചുമയുമുണ്ട്.' },
  { name: 'Punjabi (ਪੰਜਾਬੀ)', code: 'pa-IN', defaultText: 'ਮੈਨੂੰ ਦੋ दिनਾਂ ਤੋਂ ਬੁਖਾਰ ਅਤੇ ਖੰਘ ਹੈ।' },
  { name: 'Odia (ଓଡ଼ିଆ)', code: 'or-IN', defaultText: 'ମୋତେ ଦୁଇ ଦିନ ହେବ ଜ୍ଵର ଏବଂ କାଶ ହେଉଛି।' },
  { name: 'Hinglish / English', code: 'en-IN', defaultText: 'Mujhe do din se fever hai aur cough ho raha hai.' }
];

interface PatientIntakeProps {
  isOnline: boolean;
  onNewIntakeCreated: (intake: any) => void;
  lowBandwidthMode: boolean;
}

export const PatientIntake: React.FC<PatientIntakeProps> = ({ isOnline, onNewIntakeCreated, lowBandwidthMode }) => {
  // Input modes: 'speak' or 'type'
  const [inputMode, setInputMode] = useState<'speak' | 'type'>('speak');

  // Form states
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [symptomText, setSymptomText] = useState('');

  // Speech and loading states
  const [isRecording, setIsRecording] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedForm, setSubmittedForm] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionId, setSessionId] = useState('');

  const recognitionRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Canvas wave animation
  useEffect(() => {
    if (!isRecording) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let dataArray = new Uint8Array(0);

    const initAudio = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
      } catch (err) {
        console.warn("Real mic visualizer blocked/failed, using simulated waves.", err);
      }
    };

    initAudio();

    let phase = 0;
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      const width = canvas.width = canvas.parentElement?.clientWidth || 500;
      const height = canvas.height = 100;
      ctx.clearRect(0, 0, width, height);

      // Glassmorphic background matching the theme
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      let volumeSum = 0;
      if (analyser && dataArray.length > 0) {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < dataArray.length; i++) {
          volumeSum += dataArray[i];
        }
      }
      const volumeAvg = dataArray.length > 0 ? (volumeSum / dataArray.length) : 0;
      const amp = analyser ? (volumeAvg * 0.5 + 4) : (18 + Math.sin(phase * 1.5) * 5);

      phase += 0.08;

      // Glow effect
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'rgba(13, 148, 136, 0.6)';

      // Primary wave
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0d9488';
      ctx.beginPath();
      let sliceWidth = width / 100;
      let x = 0;
      for (let i = 0; i < 100; i++) {
        const angle = (i / 100) * Math.PI * 4 + phase;
        const y = height / 2 + Math.sin(angle) * amp * Math.sin((i / 100) * Math.PI);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();

      // Secondary wave
      ctx.shadowBlur = 0; // Turn off glow for performance on second wave
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(20, 184, 166, 0.4)';
      ctx.beginPath();
      x = 0;
      for (let i = 0; i < 100; i++) {
        const angle = (i / 100) * Math.PI * 6 - phase;
        const y = height / 2 + Math.sin(angle) * (amp * 0.65) * Math.sin((i / 100) * Math.PI);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isRecording]);

  // Initialize Session ID on mount
  useEffect(() => {
    const startSession = async () => {
      try {
        const response = await fetch(`${API_URL}/api/session/start`, {
          method: 'POST'
        });
        if (response.ok) {
          const resData = await response.json();
          setSessionId(resData.sessionId);
        }
      } catch (err) {
        setSessionId(`VD-${Math.floor(1000 + Math.random() * 9000)}`);
      }
    };
    startSession();
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setRecognitionSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = selectedLanguage.code === 'auto' ? 'en-IN' : selectedLanguage.code;

      rec.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setSymptomText(prev => {
            const separator = prev.trim() ? ' ' : '';
            return prev + separator + finalTranscript;
          });
        }
      };

      rec.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setErrorMessage('Microphone access denied. Please enable microphone permissions in your browser.');
        } else {
          setErrorMessage(`Speech recognition error: ${event.error}. Please type symptoms manually.`);
        }
        setIsRecording(false);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = rec;
    }
  }, [selectedLanguage]);

  const toggleRecording = () => {
    if (!recognitionRef.current) return;

    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      setErrorMessage('');
      try {
        recognitionRef.current.lang = selectedLanguage.code === 'auto' ? 'en-IN' : selectedLanguage.code;
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
        setErrorMessage('Failed to start microphone. Please try again or type manually.');
      }
    }
  };

  const loadExampleText = () => {
    setSymptomText(selectedLanguage.defaultText);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptomText.trim()) {
      setErrorMessage('Please describe your symptoms by speaking or typing.');
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);

    const patientDetails = { name: name.trim() || 'Anonymous', age, gender };

    // Check offline rules
    if (!isOnline) {
      const offlineResult = runOfflineSymptomAnalysis(
        symptomText,
        selectedLanguage.name,
        patientDetails.name,
        patientDetails.age,
        patientDetails.gender
      );

      const offlineSession = {
        ...offlineResult,
        sessionId: sessionId || `local-${Date.now()}`,
        timestamp: new Date().toISOString(),
        isOfflineGenerated: true
      };

      const existingDrafts = JSON.parse(sessionStorage.getItem(OFFLINE_DRAFTS_KEY) || '[]');
      existingDrafts.push(offlineSession);
      sessionStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(existingDrafts));

      setSubmittedForm(offlineSession);
      onNewIntakeCreated(offlineSession);
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: symptomText,
          language: selectedLanguage.name,
          patientDetails,
          sessionId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze symptoms. Server error.');
      }

      const intakeData = await response.json();
      setSubmittedForm(intakeData);
      onNewIntakeCreated(intakeData);
    } catch (err: any) {
      console.error('Submission error:', err);
      setErrorMessage('Communication error. Falling back to local offline analysis.');
      
      const offlineResult = runOfflineSymptomAnalysis(
        symptomText,
        selectedLanguage.name,
        patientDetails.name,
        patientDetails.age,
        patientDetails.gender
      );
      
      const offlineSession = {
        ...offlineResult,
        sessionId: sessionId || `local-${Date.now()}`,
        timestamp: new Date().toISOString(),
        isOfflineGenerated: true
      };
      
      setSubmittedForm(offlineSession);
      onNewIntakeCreated(offlineSession);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setName('');
    setAge('');
    setGender('Male');
    setSymptomText('');
    setSubmittedForm(null);
    setErrorMessage('');
    setInputMode('speak');
    setSessionId(`VD-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  return (
    <div className="patient-container" style={{ maxWidth: '650px', margin: '1rem auto' }}>
      {!submittedForm ? (
        <form onSubmit={handleSubmit} className="card clinical-card">
          <h2 className="card-title" style={{ fontSize: '1.4rem', borderBottom: 'none', padding: 0, margin: '0 0 0.5rem 0', fontWeight: 800 }}>
            🏥 AI Clinical Intake Portal
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1.5rem 0' }}>
            Consult ID: <strong style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{sessionId || 'Assigning ID...'}</strong>
          </p>

          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-group">
              <label htmlFor="p-name" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Patient Name</label>
              <input
                id="p-name"
                type="text"
                className="form-control"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="p-age" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Age</label>
              <input
                id="p-age"
                type="number"
                min="0"
                max="120"
                className="form-control"
                placeholder="Years"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="p-gender" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Gender</label>
              <select
                id="p-gender"
                className="form-control"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="p-lang" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Spoken Language / Dialect</label>
            <select
              id="p-lang"
              className="form-control"
              value={selectedLanguage.code}
              onChange={(e) => {
                const lang = LANGUAGES.find(l => l.code === e.target.value);
                if (lang) setSelectedLanguage(lang);
              }}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          {/* Segmented Controller */}
          <div className="segmented-control" style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', marginBottom: '1.25rem' }}>
            <button
              type="button"
              className={`segment-btn ${inputMode === 'speak' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '0.5rem',
                border: 'none',
                backgroundColor: inputMode === 'speak' ? 'var(--primary)' : '#ffffff',
                color: inputMode === 'speak' ? '#ffffff' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.8rem',
                transition: 'all 0.2s'
              }}
              onClick={() => {
                setInputMode('speak');
                setErrorMessage('');
              }}
            >
              🎤 Speak Symptoms
            </button>
            <button
              type="button"
              className={`segment-btn ${inputMode === 'type' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '0.5rem',
                border: 'none',
                backgroundColor: inputMode === 'type' ? 'var(--primary)' : '#ffffff',
                color: inputMode === 'type' ? '#ffffff' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.8rem',
                transition: 'all 0.2s'
              }}
              onClick={() => {
                setInputMode('type');
                setErrorMessage('');
              }}
            >
              ⌨️ Type Symptoms
            </button>
          </div>

          {inputMode === 'speak' ? (
            <div className="voice-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem', padding: '1rem', backgroundColor: '#fafbfb', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem' }}>
              {recognitionSupported ? (
                <>
                  <p style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)', margin: 0 }}>
                    Speak naturally. Translation and structured parsing occur upon submission.
                  </p>
                  
                  {isRecording && (
                    <div style={{ width: '100%', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid #1e293b' }}>
                      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100px' }} />
                    </div>
                  )}

                  <button
                    type="button"
                    className={`voice-btn ${isRecording ? 'recording' : ''}`}
                    onClick={toggleRecording}
                    style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '50%',
                      backgroundColor: isRecording ? 'var(--urgency-emergency-text)' : 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 10px rgba(13, 148, 136, 0.3)',
                      transition: 'all 0.3s ease',
                      animation: isRecording ? 'pulse-danger 1.5s infinite' : 'none'
                    }}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                  >
                    {isRecording ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" x2="12" y1="19" y2="22"/>
                      </svg>
                    )}
                  </button>

                  <p style={{ fontSize: '0.8rem', fontWeight: 700, color: isRecording ? 'var(--urgency-emergency-text)' : 'var(--text-muted)', margin: 0 }}>
                    {isRecording ? '⏺️ Transcribing audio live... Tap to stop.' : '🎤 Tap microphone to start recording'}
                  </p>

                  <div className="transcription-box" style={{ width: '100%', marginTop: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Editable Transcription
                    </label>
                    <textarea
                      className="form-control"
                      style={{ fontSize: '0.85rem', width: '100%', minHeight: '80px', resize: 'vertical' }}
                      placeholder="Your voice transcription will populate here. You can edit it manually before final submission."
                      value={symptomText}
                      onChange={(e) => setSymptomText(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '1rem' }}>
                  <p style={{ color: 'var(--urgency-emergency-text)', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
                    Voice transcription is not supported in this browser.
                  </p>
                  <button type="button" className="btn" style={{ padding: '0.3rem 0.65rem' }} onClick={() => setInputMode('type')}>
                    Switch to Manual Typing
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label htmlFor="p-symptoms" style={{ fontSize: '0.8rem', fontWeight: 800 }}>Describe symptoms</label>
                <button
                  type="button"
                  className="view-btn"
                  style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', backgroundColor: '#ffffff' }}
                  onClick={loadExampleText}
                >
                  Load Example Text
                </button>
              </div>
              <textarea
                id="p-symptoms"
                className="form-control"
                rows={5}
                placeholder={`Describe symptoms here... e.g. ${selectedLanguage.defaultText}`}
                value={symptomText}
                onChange={(e) => setSymptomText(e.target.value)}
              />
            </div>
          )}

          {errorMessage && (
            <div style={{ color: 'var(--urgency-emergency-text)', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
              ⚠️ <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem', fontWeight: 800 }}
            disabled={isSubmitting || !symptomText.trim()}
          >
            {isSubmitting ? 'Analyzing symptoms with Gemini API...' : '🚀 Submit to Clinical Queue'}
          </button>
        </form>
      ) : (
        <div className="card clinical-card animate-fade-in" style={{ border: '2px solid var(--primary)' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--primary-light)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', marginBottom: '0.5rem' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ fontSize: '1.4rem', margin: 0, fontWeight: 800 }}>Clinical Intake Registered</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
              Consult ID: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{submittedForm.sessionId}</strong> has been transmitted to the doctor dashboard.
            </p>
          </div>

          <div className="clinical-report" style={{ marginBottom: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', backgroundColor: '#fdfdfd' }}>
            <div className="clinical-section-block" style={{ marginBottom: '0.85rem' }}>
              <h4 className="clinical-section-title" style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Chief Complaint</h4>
              <p className="clinical-section-content" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)', margin: 0 }}>
                {submittedForm.chiefComplaint || submittedForm.chief_complaint}
              </p>
            </div>

            <div className="clinical-section-block" style={{ marginBottom: '0.85rem' }}>
              <h4 className="clinical-section-title" style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Triage Justification</h4>
              <p className="clinical-section-content" style={{ fontSize: '0.85rem', fontStyle: 'italic', margin: 0, color: 'var(--text-body)' }}>
                {submittedForm.urgencyReason || 'Diagnostic severity analysis pending details.'}
              </p>
            </div>

            <div className="clinical-section-block" style={{ margin: 0 }}>
              <h4 className="clinical-section-title" style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Urgency Level</h4>
              <div className={`clinical-urgency-banner urgency-${submittedForm.urgencyClassification || submittedForm.urgency}`} style={{ margin: 0, display: 'inline-block', fontWeight: 800, fontSize: '0.8rem', padding: '0.2rem 0.65rem' }}>
                {submittedForm.urgencyClassification || submittedForm.urgency}
              </div>
            </div>
          </div>

          {submittedForm.isOfflineGenerated && (
            <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'var(--urgency-medium-bg)', color: 'var(--urgency-medium-text)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', marginBottom: '1.5rem', fontWeight: 600, border: '1px solid var(--urgency-medium-border)' }}>
              <span>⚠️ Local offline rules matched. Triage summaries will upgrade using Gemini models automatically once network returns.</span>
            </div>
          )}

          <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={handleReset}>
            Submit New Symptoms Form
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse-danger {
          0% { box-shadow: 0 0 0 0 rgba(185, 28, 28, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(185, 28, 28, 0); }
          100% { box-shadow: 0 0 0 0 rgba(185, 28, 28, 0); }
        }
        .clinical-card {
          box-shadow: var(--shadow-lg);
          border-radius: var(--radius-lg);
        }
      `}</style>
    </div>
  );
};
