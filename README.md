# VaaniDoc

> Multilingual, privacy-first AI health intake for rural and semi-urban clinics in India.

VaaniDoc lets patients describe symptoms by voice or text in their preferred Indian language. It converts that narration into a structured English clinical intake for the doctor, including symptom categories, urgency classification, suggested follow-up questions, and a clinician-ready summary.

## Why VaaniDoc

Rural clinics lose meaningful consultation time to paperwork while many patients face language and literacy barriers. VaaniDoc creates a shared patient-to-clinician workflow that is designed for low connectivity, private sessions, and multilingual communication.

## Highlights

- Voice and typed symptom intake
- Support for Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Kannada, Malayalam, Punjabi, Odia, Hinglish, and English
- Local Ollama LLM analysis—patient narration stays on the clinic computer
- Offline rules-engine fallback when the network or local model is unavailable
- Real-time clinician queue with urgency-first triage
- Session-only patient data lifecycle and explicit “End & delete” flow
- Text-first transport for low-bandwidth settings
- 20 multilingual validation cases and a visual validation dashboard

## Architecture

```text
Patient terminal (React + Vite)
  ├─ Voice / text narration
  ├─ Offline symptom rules
  └─ Session-scoped draft storage
          │
          ▼
Node.js / Express API + Socket.IO
  ├─ In-memory active clinical sessions
  └─ Local Ollama clinical extraction
          │
          ▼
Clinician workspace (React)
  └─ Live, urgency-sorted structured intake queue
```

## Run locally

### Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com/) installed locally
- An installed Ollama model. This project defaults to `llama3.2:3b`.

### 1. Start Ollama

```powershell
ollama serve
```

If Ollama is already running, leave it running and continue.

### 2. Start the backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm start
```

### 3. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open the local Vite address shown in the terminal. The landing page links to the patient portal, clinician workspace, and validation dashboard.

## AI provider configuration

Render cannot reach an Ollama process running on a user's computer. Configure a hosted Gemini provider in the **backend** Render environment (never in Vite/frontend variables):

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=gemini-2.0-flash
```

For local Ollama development, select it explicitly in `backend/.env`:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
```

`gemma3:4b` can be selected on machines with enough available memory:

```env
OLLAMA_MODEL=gemma3:4b
```

If neither hosted Gemini nor an explicit Ollama URL is configured, the backend reports and uses its conservative generic extractor rather than a canned clinical scenario.

## Validation

With the backend running:

```powershell
cd validation
node validate.js
```

The suite runs 20 multilingual cases. Validation calls do not enter the live clinician queue.

## Privacy and clinical safety

- Active sessions live only in backend memory.
- Offline drafts use browser `sessionStorage`, not durable local storage.
- Ending a patient session removes its temporary data.
- VaaniDoc supports intake and triage assistance only; it does not diagnose or replace a qualified clinician.

## Project structure

```text
backend/       Express API, Socket.IO, and local Ollama integration
frontend/      React/Vite patient portal, landing page, and clinician workspace
validation/    20 multilingual test cases and CLI validation runner
```

## Hackathon judging alignment

| Requirement | Implementation |
| --- | --- |
| Indian language coverage | 11+ selectable language paths, multilingual local LLM prompt, Hinglish support |
| Low connectivity | Text-first requests, low-bandwidth mode, and offline rules engine |
| Privacy-first | Local Ollama processing, in-memory sessions, session-only drafts |
| Accuracy validation | 20 case validation suite and dashboard |

---

Built for better conversations between patients and clinicians.
