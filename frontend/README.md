# VaaniDoc

Privacy-first multilingual clinical intake for rural and semi-urban clinics in India. Patients speak or type in their preferred language; clinicians receive a structured English intake with symptom categories, safety triage, and follow-up questions.

## Why it is demo-ready

- 11 Indian language options plus auto-detect and Hinglish support
- Voice and typed intake with a local, on-device fallback when connectivity drops
- Live clinician queue over Socket.IO, sorted by urgency
- Explicit session lifecycle: the clinician can end a visit and remove its server record immediately
- Offline drafts use `sessionStorage`, not persistent browser storage; closing the session/browser removes them
- A 20-case multilingual validation dashboard and CLI runner

## Run locally

1. In `backend`, configure `AI_PROVIDER=gemini` and a server-side `GEMINI_API_KEY` for hosted analysis (or explicitly configure Ollama locally), then run `npm start`. Without a provider, the conservative generic extractor is used.
2. In `frontend`, run `npm run dev`.
3. Open the Vite URL. Use `/patient` for the patient terminal, `/doctor` for the clinician queue, and `/validation` for the quality dashboard.

## Verification

Run `npm run build` in this folder to type-check and produce the production bundle. With the backend running, run `node validate.js` from `../validation` to execute the 20 test cases; validation requests are deliberately excluded from the live patient queue.

## Clinical safety note

VaaniDoc is an intake and triage-assistance tool, not a diagnostic system. Urgency labels and generated notes must be reviewed by a qualified clinician.
