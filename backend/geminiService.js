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
  return SYMPTOM_PATTERNS.filter(([, pattern]) => {
    const match = text.match(pattern);
    if (!match || match.index == null) return false;
    const prefix = text.slice(Math.max(0, match.index - 18), match.index);
    const line = text.slice(text.lastIndexOf("\n", match.index) + 1, text.indexOf("\n", match.index) < 0 ? text.length : text.indexOf("\n", match.index));
    return !/\b(?:no|not|denies|without)\s*$/i.test(prefix) && !/:\s*(?:no|none|denied|absent)\b/i.test(line);
  }).map(([name]) => name);
}

export function detectExplicitRedFlags(text = "") {
  const flags = [];
  const rules = [
    [/\b(?:unable to breathe|severe (?:difficulty breathing|shortness of breath)|cannot breathe)\b/i, "Severe breathing difficulty"],
    [/\b(?:unconscious|unresponsive|lost consciousness)\b/i, "Loss of consciousness"],
    [/\b(?:seizure|convulsion)\b/i, "Seizure"],
    [/\b(?:heavy bleeding|bleeding heavily|major bleeding|severe blood loss)\b/i, "Major bleeding"],
    [/\b(?:blood in (?:my |the )?vomit|vomit(?:ed|ing)? blood|bloody vomit|haematemesis|hematemesis)\b/i, "Blood in vomit"],
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

function suggestedExamFor(category) {
  return ({
    Gastrointestinal: ["Record relevant vital signs", "Focused abdominal examination", "Assess hydration status"],
    Respiratory: ["Record respiratory rate and oxygen saturation", "Assess breathing effort", "Focused chest examination"],
    Neurological: ["Record relevant vital signs", "Focused neurological examination", "Assess gait, speech, strength, and vision as indicated"],
    Musculoskeletal: ["Inspect the affected area", "Assess tenderness, movement, function, and neurovascular status as indicated"],
  })[category] || ["Record relevant vital signs", "Perform a focused examination guided by the complaint"];
}

function warningSignsFor(category) {
  return ({
    Gastrointestinal: ["Severe or rapidly worsening pain", "Blood in vomit or stool", "Inability to keep fluids down", "Fainting or new confusion"],
    Respiratory: ["New severe breathing difficulty", "Blue lips or face", "Chest pain, fainting, or new confusion"],
    Neurological: ["New one-sided weakness", "New speech or vision change", "Seizure or loss of consciousness"],
    Musculoskeletal: ["New numbness, weakness, loss of circulation, or inability to use the limb", "Rapidly increasing swelling or uncontrolled pain"],
  })[category] || ["A severe or rapidly worsening symptom", "Fainting, new confusion, or difficulty breathing"];
}

function missingClinicalInformation(duration, severity, patientDetails = {}) {
  return [
    duration === "Not specified" && "Symptom onset and duration",
    severity === "Not specified" && "Symptom severity and effect on normal activities",
    "Exact location, pattern, triggers, and relieving factors",
    "Associated symptoms and relevant warning signs",
    !patientDetails.age && "Age",
    patientDetails.pregnancyStatus == null && "Pregnancy status, when relevant",
    !patientDetails.allergies && "Medication and other allergies",
    !patientDetails.currentMedications && "Current medications and possible interactions",
    !patientDetails.chronicDiseases && "Relevant chronic diseases",
    !patientDetails.kidneyLiverDisease && "Kidney or liver disease history",
  ].filter(Boolean);
}

function genericSupport(category, emergency) {
  if (emergency) return {
    next: ["Arrange immediate emergency assessment based on the explicitly reported warning sign.", "Confirm vital signs and perform a focused clinician examination without delaying escalation."],
    selfCare: ["Keep the patient safe and at rest while emergency care is arranged."],
    precautions: ["Do not drive or remain alone while awaiting urgent assessment.", "Do not delay emergency care to try home treatment."],
    followUp: ["Follow the emergency team's discharge and reassessment plan after acute evaluation."],
  };
  const focus = ({
    Gastrointestinal: "abdominal location, tenderness, meals, bowel and urinary features",
    Respiratory: "breathing effort, oxygenation if available, and cough characteristics",
    Neurological: "neurological function, gait, vision, speech, and symptom onset",
    Dermatological: "distribution and appearance of the affected skin",
    Musculoskeletal: "movement, tenderness, function, and any injury mechanism",
    Urinary: "hydration, urine pattern, abdominal or flank tenderness",
    Ophthalmological: "visual acuity, eye pain, discharge, and injury or chemical exposure",
    ENT: "the affected ear, hearing, discharge, and surrounding tenderness",
  })[category] || "the reported symptom and relevant vital signs";
  const support = ({
    Gastrointestinal: "Take fluids normally if comfortable and note whether meals or bowel movements change the symptom.",
    Respiratory: "Rest, avoid smoke or fumes, and monitor whether breathing or cough worsens.",
    Neurological: "Rest in a safe place and avoid driving while dizziness, weakness, or balance symptoms are present.",
    Dermatological: "Avoid scratching and any newly introduced skin product until the area is reviewed.",
    Musculoskeletal: "Reduce activities that worsen the pain and support the affected area comfortably.",
    Urinary: "Maintain normal hydration unless a clinician has restricted fluids, and note urine frequency or appearance.",
    Ophthalmological: "Avoid rubbing the eye or using another person's eye drops.",
    ENT: "Keep the ear dry and do not insert objects or unreviewed drops into it.",
  })[category] || "Rest as needed and monitor how the reported symptom changes.";
  return {
    next: [`Complete the missing history, then perform a focused examination of ${focus}.`, "Consider investigations only if the completed history or examination identifies a clinical indication."],
    selfCare: [support],
    precautions: ["Do not start unreviewed medication while allergy, interaction, pregnancy, kidney, and liver safety information is incomplete.", "Seek earlier review if the symptom becomes severe or a new warning sign appears."],
    followUp: ["Arrange clinician follow-up after the missing history is obtained; timing should be brought forward if symptoms persist or worsen."],
  };
}

export function createConservativeFallback(text, language = "English", patientDetails = {}) {
  const category = inferBroadCategory(text);
  const duration = extractDuration(text);
  const explicitSeverity = extractExplicitSeverity(text);
  const redFlags = detectExplicitRedFlags(text);
  const urgency = redFlags.length ? "Emergency" : explicitSeverity === "Severe" ? "High" : "Low";
  const complaint = complaintFor(text, category);
  const symptoms = extractExplicitSymptoms(text).filter((item) => item.toLowerCase() !== complaint.toLowerCase() && item !== "Pain");
  const missing = missingClinicalInformation(duration, explicitSeverity, patientDetails);
  const support = genericSupport(category, urgency === "Emergency");
  return {
    patientName: patientDetails.name || "Anonymous", age: patientDetails.age || "Unknown", gender: patientDetails.gender || "Unknown",
    languageSpoken: language, originalSymptomsText: text, translatedSymptomsText: text,
    chiefComplaint: complaint,
    clinicalSummary: `Patient reported: ${text.trim().replace(/[.!]+$/, "")}. ${missing.length ? "Important clinical details remain unknown and require clarification." : "No additional findings are inferred."}`,
    duration, severity: explicitSeverity, associatedSymptoms: symptoms, symptomCategories: [category],
    urgencyClassification: urgency,
    urgencyReason: redFlags.length ? `Emergency warning evidence reported: ${redFlags.join("; ")}.` : explicitSeverity === "Severe" ? "Severe symptoms were explicitly reported and need prompt assessment." : "No emergency warning evidence or severe intensity was stated; missing details require follow-up.",
    possibleCauses: [{ name: `${category === "General/nonspecific" ? "Broad" : category} causes requiring further history`, reasoning: `The reported complaint fits this broad clinical area, but the narration does not contain enough evidence to identify a specific cause. Possible triggers cannot be determined from the current information.`, confidence: "low" }],
    missingInformation: missing,
    suggestedSpecialist: inferRoutingFromCategory(category, urgency), smartQuestions: genericQuestions(category),
    recommendedNextSteps: support.next,
    selfCareGuidance: support.selfCare,
    precautions: support.precautions,
    medicationConsiderations: [],
    medicationSafetySummary: "Medication cannot yet be responsibly suggested because key clinical and medication-safety information is missing.",
    followUpGuidance: support.followUp,
    suggestedExamination: suggestedExamFor(category),
    possibleInvestigations: [],
    warningSignsToWatchFor: warningSignsFor(category).filter((warning) => !redFlags.some((flag) => warning.toLowerCase().includes(flag.toLowerCase()))),
    treatmentDraft: redFlags.length ? "Arrange immediate emergency assessment. Keep the patient safe while awaiting emergency care; further treatment requires clinician evaluation." : "Further clinician assessment is needed before a treatment plan can be drafted. Until reviewed, avoid activities that worsen the reported symptom and seek urgent help if a new severe warning sign develops.",
    redFlags,
    patientFriendlySummary: redFlags.length ? `You reported: ${text.trim()} This includes a warning sign that needs immediate emergency assessment.` : `You reported: ${text.trim()} A clinician should ask for the missing details before recommending treatment.`,
    analysisProvider: "generic-fallback",
  };
}

const SYSTEM_PROMPT = `You are VaaniDoc, a supervised clinical intake assistant. Return only JSON with these exact keys: translatedSymptomsText, chiefComplaint, clinicalSummary, duration, severity, associatedSymptoms, symptomCategories, urgencyClassification, urgencyReason, suggestedSpecialist, possibleCauses, missingInformation, smartQuestions, recommendedNextSteps, suggestedExamination, possibleInvestigations, selfCareGuidance, precautions, medicationConsiderations, medicationSafetySummary, followUpGuidance, treatmentDraft, redFlags, warningSignsToWatchFor, patientFriendlySummary.

Use only facts stated or clearly implied by the patient's narration.
Do not add symptoms, duration, severity, associated findings, or red flags that were not mentioned.
If information is missing, mark it unknown/not specified and ask about it in smartQuestions.

possibleCauses is an array of {name, reasoning, confidence}, with confidence low, moderate, or higher. These are differential considerations, never confirmed diagnoses; every reason must identify the narration evidence and uncertainty. If triggers are not narrated, explicitly say they cannot be determined. missingInformation, recommendedNextSteps, selfCareGuidance, precautions, and followUpGuidance are arrays of strings. medicationConsiderations is an array of {nameOrClass, purpose, conditionsForUse, safetyNotes}. Leave it empty unless age, pregnancy status, allergies, current medicines/interactions, chronic disease, kidney/liver safety, severity, and red flags have been adequately considered. medicationSafetySummary must explain why options are or are not responsible for clinician review. Never provide prescription-only dosing, antibiotics without evidence, controlled drugs, or definitive instructions. State missing medication-safety facts in missingInformation and confirm them in next steps.

Do not diagnose or prescribe. redFlags lists only warning signs actually present, never hypothetical risks. Questions may ask about absent information. Use Low, Medium, High, or Emergency for urgency; a symptom name alone is not an emergency. Treatment is conservative decision support and must say assessment is needed when detail is insufficient. Make advice specific to the current narration rather than using a universal self-care block.`;

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
  const strings = (value, fallbackValue) => Array.isArray(value) ? value.slice(0, 8).map(String) : fallbackValue;
  const possibleCauses = Array.isArray(result.possibleCauses) ? result.possibleCauses.slice(0, 5).filter((cause) => cause && cause.name && cause.reasoning).map((cause) => ({ name: String(cause.name), reasoning: String(cause.reasoning), confidence: ["low", "moderate", "higher"].includes(String(cause.confidence).toLowerCase()) ? String(cause.confidence).toLowerCase() : "low" })) : fallback.possibleCauses;
  const hasMedicationSafetyContext = !fallback.missingInformation.some((item) => /age|pregnan|allerg|medication|interaction|chronic|kidney|liver/i.test(item));
  return { ...fallback, ...result,
    patientName: fallback.patientName, age: fallback.age, gender: fallback.gender, languageSpoken: fallback.languageSpoken, originalSymptomsText: fallback.originalSymptomsText,
    duration: fallback.duration, severity: fallback.severity,
    associatedSymptoms: fallback.associatedSymptoms, redFlags: fallback.redFlags,
    urgencyClassification: fallback.urgencyClassification,
    possibleCauses,
    missingInformation: [...new Set([...fallback.missingInformation, ...strings(result.missingInformation, [])])],
    smartQuestions: Array.isArray(result.smartQuestions) && result.smartQuestions.length >= 3 ? result.smartQuestions.slice(0, 3).map(String) : fallback.smartQuestions,
    recommendedNextSteps: strings(result.recommendedNextSteps, fallback.recommendedNextSteps),
    selfCareGuidance: strings(result.selfCareGuidance, fallback.selfCareGuidance),
    precautions: strings(result.precautions, fallback.precautions),
    medicationConsiderations: hasMedicationSafetyContext && Array.isArray(result.medicationConsiderations) ? result.medicationConsiderations.slice(0, 4) : [],
    medicationSafetySummary: hasMedicationSafetyContext ? String(result.medicationSafetySummary || fallback.medicationSafetySummary) : fallback.medicationSafetySummary,
    followUpGuidance: strings(result.followUpGuidance, fallback.followUpGuidance),
    suggestedExamination: strings(result.suggestedExamination, fallback.suggestedExamination),
    warningSignsToWatchFor: strings(result.warningSignsToWatchFor, fallback.warningSignsToWatchFor),
    possibleInvestigations: Array.isArray(result.possibleInvestigations) ? result.possibleInvestigations.slice(0, 5).filter((item) => item?.name && item?.reason).map((item) => ({ name: String(item.name), reason: String(item.reason), priority: ["optional", "consider", "recommended"].includes(item.priority) ? item.priority : "consider" })) : fallback.possibleInvestigations,
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

const answerText = (answers = []) => answers.filter((item) => item?.question && item?.answer?.trim()).map((item) => `${item.question}: ${item.answer.trim()}`).join("\n");

export function calculateConsultationCompleteness(session = {}) {
  const answers = answerText(session.consultationAnswers).toLowerCase();
  const source = `${session.originalSymptomsText || ""}\n${answers}\n${session.clinicianNotes || ""}\n${session.examinationNotes || ""}`.toLowerCase();
  const vitals = session.vitals || {};
  const dimensions = [
    [Boolean(session.chiefComplaint && !/reported symptom|general consultation/i.test(session.chiefComplaint)), "Chief complaint"],
    [session.duration && session.duration !== "Not specified" || /\b(duration|start|onset|how long)\b[^\n:]*:\s*\S+/i.test(answers), "Duration/onset"],
    [session.severity && session.severity !== "Not specified" || /\b(severe|severity|pain score|\d+\s*\/\s*10)\b/i.test(source), "Severity and functional impact"],
    [/\b(location|where|upper|lower|left|right|central|after food|after meal|when walking)\b/i.test(source), "Exact location or clinical context"],
    [/(associated|other symptoms|vomit|fever|nausea|breath|weakness|denies|\bno\b)/i.test(answers), "Associated symptoms"],
    [/(red flag|warning|blood|faint|confusion|seizure|breathing|weakness|speech)/i.test(answers) || (session.redFlags?.length || 0) > 0, "Relevant red flags assessed"],
    [/(history|previous|chronic|surgery|pregnan|similar episode)/i.test(source), "Relevant medical history"],
    [/(medication|medicine|allerg)/i.test(source), "Medication and allergy history"],
    [(session.smartQuestions?.length || 0) > 0 && session.smartQuestions.every((q) => session.consultationAnswers?.some((a) => a.question === q && a.answer?.trim())), "Current guided questions answered"],
    [Object.values(vitals).some((value) => String(value || "").trim()), "Clinically relevant vital signs"],
  ];
  const achieved = dimensions.filter(([known]) => known).length;
  return { consultationCompleteness: Math.round(achieved / dimensions.length * 100), completenessMissingItems: dimensions.filter(([known]) => !known).map(([, label]) => label) };
}

export async function reanalyzeConsultation(session, updates = {}) {
  const consultationAnswers = Array.isArray(updates.consultationAnswers) ? updates.consultationAnswers.filter((item) => item?.question && typeof item.answer === "string") : session.consultationAnswers || [];
  const clinicianNotes = String(updates.clinicianNotes ?? session.clinicianNotes ?? "");
  const vitals = updates.vitals && typeof updates.vitals === "object" ? updates.vitals : session.vitals || {};
  const examinationNotes = String(updates.examinationNotes ?? session.examinationNotes ?? "");
  const demographics = { name: session.patientName, age: session.age, gender: session.gender, allergies: session.allergies, currentMedications: session.currentMedications, chronicDiseases: session.chronicDiseases };
  const context = `PATIENT ORIGINAL NARRATION\n${session.originalSymptomsText}\n\nCLINICIAN-COLLECTED FOLLOW-UP ANSWERS\n${answerText(consultationAnswers) || "Unknown"}\n\nVITALS\n${JSON.stringify(vitals)}\n\nEXAMINATION NOTES\n${examinationNotes || "Unknown"}\n\nADDITIONAL CLINICIAN NOTES\n${clinicianNotes || "Unknown"}\n\nDEMOGRAPHICS\n${JSON.stringify(demographics)}\n\nUse each clinician-recorded answer as evidence equal to the original narration. A negative answer means the finding is absent. Never invent a missing finding.`;
  const analysis = await analyzeSymptoms(context, session.languageSpoken || "English", demographics);
  const answersText = answerText(consultationAnswers);
  const durationAnswer = answersText.match(/(?:when|start|duration|how long)[^:]*:\s*([^\n]+)/i)?.[1];
  const severityAnswer = answersText.match(/(?:severity|severe|pain)[^:]*:\s*([^\n]*(?:\d+\s*\/\s*10|mild|moderate|severe)[^\n]*)/i)?.[1];
  if (durationAnswer) analysis.duration = durationAnswer;
  if (severityAnswer) analysis.severity = severityAnswer;
  const answeredTopics = {
    duration: Boolean(durationAnswer), severity: Boolean(severityAnswer), location: /(where|location)[^:]*:\s*\S+/i.test(answersText),
    associated: /(vomit|fever|nausea|other symptom|associated)[^:]*:\s*\S+/i.test(answersText), allergies: /allerg[^:]*:\s*\S+/i.test(answersText), medications: /medicat|medicine[^:]*:\s*\S+/i.test(answersText),
  };
  analysis.missingInformation = (analysis.missingInformation || []).filter((item) => !(
    answeredTopics.duration && /duration|onset/i.test(item) || answeredTopics.severity && /severity|activities/i.test(item) || answeredTopics.location && /location|pattern|trigger|relieving/i.test(item) || answeredTopics.associated && /associated|warning/i.test(item) || answeredTopics.allergies && /allerg/i.test(item) || answeredTopics.medications && /current medication|interaction/i.test(item)
  ));
  analysis.smartQuestions = (analysis.smartQuestions || []).filter((question) => !consultationAnswers.some((item) => item.answer?.trim() && item.question === question));
  if (analysis.symptomCategories?.[0] === "Gastrointestinal" && /(upper abdomen|after (?:food|meal))/i.test(answersText + clinicianNotes)) {
    analysis.possibleCauses = [{ name: "Upper gastrointestinal causes", reasoning: "Upper abdominal location and worsening after food were clinician-recorded; examination and fuller history are still required to distinguish among causes.", confidence: "low" }, ...(analysis.possibleCauses || [])].slice(0, 5);
    analysis.possibleInvestigations = [{ name: "Targeted testing after examination", reason: "The upper abdominal and meal-related pattern may justify targeted testing only if the focused examination or remaining history identifies an indication.", priority: "consider" }];
  }
  const updated = { ...session, ...analysis, originalSymptomsText: session.originalSymptomsText, consultationAnswers, clinicianNotes, vitals, examinationNotes };
  return { ...updated, ...calculateConsultationCompleteness(updated), analysisVersion: (Number(session.analysisVersion) || 1) + 1, lastAnalyzedAt: new Date().toISOString(), isConsultationFinalized: false, assessmentStage: "Updated after Consultation" };
}

export function resolveSuggestedSpecialist(analysis = {}, symptomText = "") {
  const category = analysis.symptomCategories?.[0] || inferBroadCategory(symptomText);
  return inferRoutingFromCategory(category, analysis.urgencyClassification);
}

export function calculateExtractionConfidence(text, analysis = {}) {
  const known = [analysis.duration !== "Not specified", analysis.severity !== "Not specified", (analysis.associatedSymptoms?.length || 0) > 0].filter(Boolean).length;
  return Number(Math.min(0.9, 0.45 + known * 0.12 + Math.min(String(text).split(/\s+/).length, 20) * 0.01).toFixed(2));
}
