import React from 'react';
import { BlurText } from './BlurText';

interface LandingPageProps {
  navigateTo: (path: string) => void;
}

const Icon = ({ children }: { children: React.ReactNode }) => <div className="feature-icon">{children}</div>;

export const LandingPage: React.FC<LandingPageProps> = ({ navigateTo }) => (
  <div className="landing-page">
    <header className="landing-nav">
      <button className="brand-lockup" onClick={() => navigateTo('/')} aria-label="VaaniDoc home">
        <span className="brand-mark">V</span><span>VaaniDoc</span>
      </button>
    </header>

    <main className="landing-hero">
      <section className="hero-copy">
        <div className="hero-eyebrow"><span></span> Built for connected care, anywhere</div>
        <BlurText
          as="h1"
          text={<>Care begins with being <em>understood.</em></>}
          delay={150}
          animateBy="words"
          direction="top"
        />
        <p>Patients speak naturally in the language they trust. VaaniDoc turns their words into a structured, clinician-ready intake—privately and locally.</p>
        <div className="landing-actions">
          <button className="btn btn-primary landing-primary" onClick={() => navigateTo('/patient')}>Start patient intake <span>→</span></button>
          <button className="btn landing-secondary" onClick={() => navigateTo('/doctor')}>Open clinician workspace</button>
        </div>
        <div className="hero-proof"><span>✓ Local Ollama AI</span><span>✓ Voice or text</span><span>✓ Session-only data</span></div>
      </section>
      <aside className="hero-visual" aria-label="Clinical intake preview">
        <div className="visual-topline"><span className="pulse-dot"></span> Live clinical intake <span>Private session</span></div>
        <div className="visual-patient"><div className="patient-avatar">A</div><div><strong>Patient narration</strong><p>Hindi · voice transcript</p></div><span className="language-chip">हिंदी</span></div>
        <p className="visual-transcript">“Chest feels heavy and I have been sweating since morning.”</p>
        <div className="visual-result"><div><small>Clinical summary</small><strong>Acute chest discomfort</strong></div><span className="urgency-Emergency">Priority review</span></div>
        <div className="visual-lines"><span></span><span></span><span></span></div>
      </aside>
    </main>

    <section className="trust-strip" aria-label="VaaniDoc capabilities">
      <div><strong>11+</strong><span>Language paths</span></div><div><strong>Local AI</strong><span>Private processing</span></div><div><strong>Session-only</strong><span>Data lifecycle</span></div><div><strong>20 cases</strong><span>Validation suite</span></div>
    </section>

    <section className="landing-section">
      <div className="section-heading"><p className="eyebrow">A shared care flow</p><h2>Built around real clinic moments</h2></div>
      <div className="homepage-grid">
        <button className="feature-card feature-card-button" onClick={() => navigateTo('/patient')}>
          <Icon><span>01</span></Icon><h3>Patient intake</h3><p>Speak or type symptoms in a preferred language, then review the clear summary before sending.</p><b>Begin intake →</b>
        </button>
        <button className="feature-card feature-card-button" onClick={() => navigateTo('/doctor')}>
          <Icon><span>02</span></Icon><h3>Clinician workspace</h3><p>See an urgency-sorted queue with English summaries, follow-up questions, and private session controls.</p><b>Open workspace →</b>
        </button>
        <div className="feature-card">
          <Icon><span>03</span></Icon><h3>Works when networks do not</h3><p>Text-first transport and local fallback rules keep intake moving on unreliable rural connections.</p><b>Offline ready</b>
        </div>
      </div>
    </section>
    <footer className="landing-footer">VaaniDoc supports clinical intake only. A qualified clinician makes every final medical decision.</footer>
  </div>
);
