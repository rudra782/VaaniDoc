import dotenv from "dotenv";

dotenv.config();

const PROVIDER = (process.env.AI_PROVIDER || "auto").toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL?.replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

const CATEGORY_PATTERNS = [
  ["Cardiovascular", /\b(chest|heart|palpitation)/i],
  ["Respiratory", /\b(cough|breath|breathing|wheez)/i],
  ["Gastrointestinal", /\b(stomach|abdom|vomit|nausea|diarrh|constipat)/i],
  ["Neurological", /\b(headache|dizz|seizure|weakness|slurred speech|paralysis)/i],
  ["Dermatological", /\b(rash|itch|skin|hives)/i],
  ["Musculoskeletal", /\b(back|leg|knee|joint|muscle|bone|hurt|injur|sprain)/i],
  ["Urinary", /\b(urinat|urine|bladder|burning.*(?:pee|urin)|pain.*(?:pee|urin))/i],
  ["Ophthalmological", /\b(eye|vision)/i],
  ["ENT", /\b(ear|hearing|nose|throat)/i],
];

const SYMPTOM_PATTERNS = [
  ["Cough", /\bcough(?:ing)?\b/i], ["Fever", /\bfever(?:ish)?\b/i],
  ["Vomiting", /\bvomit(?:ed|ing|s)?\b/i], ["Nausea", /\bnausea(?:ted)?\b/i],
  ["Diarrhea", /\bdiarrh(?:ea|oea)\b/i], ["Dizziness", /\b(?:dizz(?:y|iness)|lightheaded)\b/i],
  ["Itching", /\bitch(?:ing|y)?\b/i], ["Rash", /\brash\b/i],
  ["Weakness", /\bweakness\b/i], ["Slurred speech", /\bslurred speech\b/i],
  ["Shortness of breath", /\b(?:shortness of breath|difficulty breathing|unable to breathe|breathless)\b/i],
  ["Bleeding", /\b(?:bleeding|blood loss|bleeding heavily|heavy bleeding)\b/i],
  ["Seizure", /\bseizure|convulsion\b/i], ["Pain", /\b(?:pain|hurts?|ache)\b/i],
  ["Eye redness", /\b(?:red eye|eye is red)\b/i],
];

export function extractDuration(text = "") {
  return text.match(/\b(?:for|since)\s+((?:about\s+)?(?:\d+|a|an|one|two|three|four|five|six|seven|few|several)\s*(?:minutes?|hours?|days?|weeks?|months?|years?)|(?:today|yesterday|last night|this morning))\b/i)?.[1] || "Not specified";
}

export function extractExplicitSeverity(text = "") {
  const match = text.match(/\b(unbearable|excruciating|severe|moderate|mild)\b/i)?.[1]?.toLowerCase();
  return ({ unbearable: "Severe", excruciating: "Severe", severe: "Severe", moderate: "Medium", mild: "Low" })[match] || "Not specified";
}

export function extractExplicitSymptoms(text = "") {
  return SYMPTOM_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export function detectExplicitRedFlags(text = "") {
  const flags = [];
  const rules = [
    [/\b(?:unable to breathe|severe (?:difficulty breathing|shortness of breath)|cannot breathe)\b/i, "Severe breathing difficulty"],
    [/\b(?:unconscious|unresponsive|lost consciousness)\b/i, "Loss of consciousness"],
    [/\b(?:seizure|convulsion)\b/i, "Seizure"],
    [/\b(?:heavy bleeding|bleeding heavily|major bleeding|severe blood loss)\b/i, "Major bleeding"],
    [/(?=.*\b(?:weakness|weak)\b)(?=.*\b(?:one-sided|left side|right side)\b)(?=.*\b(?:slurred speech|speech difficulty)\b)/i, "Sudden one-sided weakness with speech difficulty"],
    [/\b(?:vomit\w*|throwing up)\b[^.]*\b(?:cannot|can't|unable to) keep (?:water|fluids?|anything) down\b|\b(?:cannot|can't|unable to) keep (?:water|fluids?|anything) down\b[^.]*\bvomit/i, "Repeated vomiting with inability to retain fluids"],
    [/\bsevere chest (?:pain|pressure)\b[^.]*\b(?:sweat|radiat|left arm|jaw|faint|difficulty breathing)\b/i, "Severe chest symptoms with a high-risk associated feature"],
    [/\b(?:unbearable|excruciating|severe uncontrolled) pain\b/i, "Severe uncontrolled pain"],
  ];
  for (const [pattern, label] of rules) if (pattern.test(text)) flags.push(label);
  return flags;
}

export function inferBroadCategory(text = "") {
  return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || "General/nonspecific";
}

export function inferRoutingFromCategory(category, urgency) {
  if (urgency === "Emergency") return "Emergency Medicine";
  return ({ Cardiovascular: "Cardiology", Respiratory: "Pulmonology", Gastrointestinal: "Gastroenterology", Neurological: "Neurology", Dermatological: "Dermatology", Musculoskeletal: "Orthopedics", Urinary: "Urology", Ophthalmological: "Ophthalmology", ENT: "ENT / Otolaryngology" })[category] || "General Medicine";
}

function complaintFor(text, category) {
  if (/\b(stomach|abdominal?) pain\b/i.test(text)) return "Abdominal pain";
  if (/\bheadache\b/i.test(text)) return "Headache";
  if (/\bear pain\b/i.test(text)) return "Ear pain";
  if (/\bback pain\b/i.test(text)) return "Back pain";
  if (/\bpain.*urin|urin.*pain/i.test(text)) return "Pain with urination";
  const explicit = extractExplicitSymptoms(text).filter((s) => s !== "Pain");
  return explicit[0] || (category === "General/nonspecific" ? "Reported symptom" : `Reported ${category.toLowerCase()} symptom`);
}

function genericQuestions(category) {
  const focus = ({ Gastrointestinal: "Where exactly is the symptom or pain located?", Musculoskeletal: "Where exactly does it hurt, and was there an injury?", Dermatological: "Where is the itching or skin change, and what does it look like?", Neurological: "Is the symptom sudden, and are there any changes in strength, speech, vision, or balance?", Respiratory: "Is breathing affected, and is the cough dry or producing mucus?", Urinary: "Is there burning, blood, fever, or a change in urine frequency?", Ophthalmological: "Is there eye pain, discharge, injury, or any change in vision?", ENT: "Is there discharge, hearing change, fever, or a recent infection?" })[category] || "Where exactly do you feel the symptom?";
  return [focus, "When did it start, and how severe is it?", "Are there any other symptoms or warning signs you have noticed?"];
}

export function createConservativeFallback(text, language = "English", patientDetails = {}) {
  const category = inferBroadCategory(text);
  const duration = extractDuration(text);
  const explicitSeverity = extractExplicitSeverity(text);
  const redFlags = detectExplicitRedFlags(text);
  const urgency = redFlags.length ? "Emergency" : explicitSeverity === "Severe" ? "High" : "Low";
  const complaint = complaintFor(text, category);
  const symptoms = extractExplicitSymptoms(text).filter((item) => item.toLowerCase() !== complaint.toLowerCase() && item !== "Pain");
  const missing = [duration === "Not specified" && "duration", explicitSeverity === "Not specified" && "severity", symptoms.length === 0 && "associated symptoms"].filter(Boolean);
  return {
    patientName: patientDetails.name || "Anonymous", age: patientDetails.age || "Unknown", gender: patientDetails.gender || "Unknown",
    languageSpoken: language, originalSymptomsText: text, translatedSymptomsText: text,
    chiefComplaint: complaint,
    clinicalSummary: `Patient reports ${text.trim().replace(/[.!]+$/, "")}. ${missing.length ? `Additional details about ${missing.join(", ")} are not specified.` : "No additional findings are inferred."}`,
    duration, severity: explicitSeverity, associatedSymptoms: symptoms, symptomCategories: [category],
    urgencyClassification: urgency,
    urgencyReason: redFlags.length ? `Emergency warning evidence reported: ${redFlags.join("; ")}.` : explicitSeverity === "Severe" ? "Severe symptoms were explicitly reported and need prompt assessment." : "No emergency warning evidence or severe intensity was stated; missing details require follow-up.",
    suggestedSpecialist: inferRoutingFromCategory(category, urgency), smartQuestions: genericQuestions(category),
    treatmentDraft: redFlags.length ? "Arrange immediate emergency assessment. Keep the patient safe while awaiting emergency care; further treatment requires clinician evaluation." : "Further clinician assessment is needed before a treatment plan can be drafted. Until reviewed, avoid activities that worsen the reported symptom and seek urgent help if a new severe warning sign develops.",
    redFlags,
    patientFriendlySummary: `You reported: ${text.trim()} A clinician should ask for the missing details before recommending treatment.`,
    analysisProvider: "generic-fallback",
  };
}

const SYSTEM_PROMPT = `You are VaaniDoc, a supervised clinical intake assistant. Return only JSON with these exact keys: translatedSymptomsText, chiefComplaint, clinicalSummary, duration, severity, associatedSymptoms, symptomCategories, urgencyClassification, urgencyReason, suggestedSpecialist, smartQuestions, treatmentDraft, redFlags, patientFriendlySummary.

Use only facts stated or clearly implied by the patient's narration.
Do not add symptoms, duration, severity, associated findings, or red flags that were not mentioned.
If information is missing, mark it unknown/not specified and ask about it in smartQuestions.

Do not diagnose or prescribe. redFlags lists only warning signs actually present, never hypothetical risks. Questions may ask about absent information. Use Low, Medium, High, or Emergency for urgency; a symptom name alone is not an emergency. Treatment is conservative decision support and must say assessment is needed when detail is insufficient.`;

async function callGemini(user) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }) });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const payload = await response.json();
  return JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

async function callOllama(user) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, format: "json", options: { temperature: 0.1 }, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }] }) });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  return JSON.parse((await response.json()).message?.content || "{}");
}

function normalizeAI(result, fallback, provider) {
  return { ...fallback, ...result,
    patientName: fallback.patientName, age: fallback.age, gender: fallback.gender, languageSpoken: fallback.languageSpoken, originalSymptomsText: fallback.originalSymptomsText,
    duration: fallback.duration, severity: fallback.severity,
    associatedSymptoms: fallback.associatedSymptoms, redFlags: fallback.redFlags,
    urgencyClassification: fallback.urgencyClassification,
    smartQuestions: Array.isArray(result.smartQuestions) && result.smartQuestions.length >= 3 ? result.smartQuestions.slice(0, 3).map(String) : fallback.smartQuestions,
    suggestedSpecialist: inferRoutingFromCategory(result.symptomCategories?.[0] || fallback.symptomCategories[0], fallback.urgencyClassification),
    analysisProvider: provider,
  };
}

export async function analyzeSymptoms(text, language, patientDetails = {}) {
  if (!text?.trim()) throw new Error("Symptom description cannot be empty.");
  const fallback = createConservativeFallback(text, language, patientDetails);
  const user = JSON.stringify({ patientLanguage: language, demographics: patientDetails, narration: text });
  try {
    if ((PROVIDER === "auto" || PROVIDER === "gemini") && process.env.GEMINI_API_KEY) return normalizeAI(await callGemini(user), fallback, "gemini");
    if ((PROVIDER === "ollama" || (PROVIDER === "auto" && OLLAMA_BASE_URL)) && OLLAMA_BASE_URL) return normalizeAI(await callOllama(user), fallback, "ollama");
  } catch (error) {
    console.error(`Configured AI provider unavailable; using conservative fallback: ${error.message}`);
  }
  return fallback;
}

export function resolveSuggestedSpecialist(analysis = {}, symptomText = "") {
  const category = analysis.symptomCategories?.[0] || inferBroadCategory(symptomText);
  return inferRoutingFromCategory(category, analysis.urgencyClassification);
}

export function calculateExtractionConfidence(text, analysis = {}) {
  const known = [analysis.duration !== "Not specified", analysis.severity !== "Not specified", (analysis.associatedSymptoms?.length || 0) > 0].filter(Boolean).length;
  return Number(Math.min(0.9, 0.45 + known * 0.12 + Math.min(String(text).split(/\s+/).length, 20) * 0.01).toFixed(2));
}
