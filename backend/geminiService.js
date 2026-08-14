import dotenv from "dotenv";

dotenv.config();

const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
).replace(/\/$/, "");
// llama3.2:3b is the most reliable installed option for a modest clinic PC.
// Set OLLAMA_MODEL=gemma3:4b on a machine with enough RAM for richer multilingual output.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
console.log(`Local Ollama clinical analysis enabled (model: ${OLLAMA_MODEL}).`);

// Define response schema for structured output
const intakeSchema = {
  type: "OBJECT",
  properties: {
    patientName: { type: "STRING" },
    age: { type: "STRING" },
    gender: { type: "STRING" },
    languageSpoken: { type: "STRING" },
    originalSymptomsText: { type: "STRING" },
    translatedSymptomsText: { type: "STRING" },
    chiefComplaint: { type: "STRING" },
    clinicalSummary: { type: "STRING" },
    duration: { type: "STRING" },
    severity: {
      type: "STRING",
      description: "Severity level of symptoms: Low, Medium, High, or Severe",
    },
    associatedSymptoms: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "List of other symptoms mentioned",
    },
    symptomCategories: {
      type: "ARRAY",
      items: { type: "STRING" },
      description:
        "Clinical domains, e.g., Cardiovascular, Respiratory, Gastrointestinal, Neurological, Musculoskeletal, etc.",
    },
    urgencyClassification: {
      type: "STRING",
      description: "Urgency category: Low, Medium, High, or Emergency",
    },
    urgencyReason: {
      type: "STRING",
      description: "Brief justification for the urgency classification",
    },
    suggestedSpecialist: {
      type: "STRING",
      description:
        "Recommended medical department or specialist, e.g., General Physician, Cardiologist, Pulmonologist, etc.",
    },
    smartQuestions: {
      type: "ARRAY",
      items: { type: "STRING" },
      description:
        "3 specific clinical diagnostic follow-up questions for the doctor to ask the patient next, based on their symptoms.",
    },
    treatmentDraft: {
      type: "STRING",
      description:
        "A draft clinical care plan detailing rest, fluid guidelines, precautions, and standard safety-net instructions (emergency thresholds). Do not specify Rx medications.",
    },
    redFlags: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Only warning signs supported by the patient's reported symptoms; empty when none are detected.",
    },
    patientFriendlySummary: {
      type: "STRING",
      description:
        "A simple, empathetic explanation of the triage results, written directly in the patient's languageSpoken (e.g. Hindi, Tamil, Bengali) using simple layperson terms.",
    },
  },
  required: [
    "patientName",
    "age",
    "gender",
    "languageSpoken",
    "originalSymptomsText",
    "translatedSymptomsText",
    "chiefComplaint",
    "clinicalSummary",
    "duration",
    "severity",
    "associatedSymptoms",
    "symptomCategories",
    "urgencyClassification",
    "urgencyReason",
    "suggestedSpecialist",
    "smartQuestions",
    "treatmentDraft",
    "redFlags",
    "patientFriendlySummary",
  ],
};

// Mock generator for development & offline/fallback scenario
const FAST_PATH_KEYWORDS = [
  "fever",
  "bukhhar",
  "buxar",
  "ज्वर",
  "बुखार",
  "ताप",
  "ज्वर",
  "cough",
  "khansi",
  "खाँसी",
  "खांसी",
  "কাশি",
  "దగ్గు",
  "இருமல்",
  "pain",
  "dard",
  "दर्द",
  "வலி",
  "నొప్పి",
  "ব্যথা",
  "दुखणे",
  "breath",
  "saans",
  "सांस",
  "শ্বাস",
  "శ్వాస",
  "மூச்சு",
  "vomit",
  "ulti",
  "उल्टी",
  "வாந்தி",
  "వాంతులు",
  "বমি",
  "diarrhea",
  "dast",
  "दस्त",
  "வயிற்றுப்போக்கு",
  "విరేచనాలు",
  "rash",
  "khujli",
  "खुजली",
  "அரிப்பு",
  "దురద",
  "চুলকানি",
  "headache",
  "sir dard",
  "सिर दर्द",
  "தலைவலி",
  "తలనొప్పి",
  "fracture",
  "broken",
  "टूटा",
  "முறிவு",
  "విరిగిన",
  "ভাঙা",
  "stroke",
  "lacwa",
  "लकवा",
  "பக்கவாதம்",
  "పక్షవాతం",
  "weakness",
  "kamjori",
  "कमजोरी",
  "பலவீனம்",
  "బలహీనత",
  "injury",
  "knee",
  "joint",
  "hurt",
  "chot",
  "चोट",
  "காயம்",
  "గాయం",
  "আঘাত",
  "bleeding",
  "raktasrava",
  "रक्तस्त्राव",
  "இரத்தம்",
  "రక్తస్రావం",
  "dizziness",
  "chakkar",
  "चक्कर",
  "தலைசுற்றல்",
  "తలనొప్పి",
  "nausea",
  "ghabrahat",
  "मतली",
  "உணர்வு",
  "వికారం",
  "swelling",
  "swell",
  "सूजन",
  "வீக்கம்",
  "వాపు",
  "ফোলা",
];

function shouldUseFastLocalPath(text = "") {
  const lowerText = String(text || "").toLowerCase();
  if (!lowerText.trim()) return false;

  const hasClinicalKeyword = FAST_PATH_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  );
  const wordCount = lowerText.trim().split(/\s+/).length;

  return hasClinicalKeyword || wordCount <= 20;
}

const GENERIC_SPECIALISTS = new Set([
  "",
  "general consultation",
  "general physician",
  "general practitioner",
  "general medicine",
  "not specified",
  "unknown",
]);

export function resolveSuggestedSpecialist(analysis = {}, symptomText = "") {
  const urgency = String(
    analysis.urgencyClassification ?? analysis.urgency ?? "",
  ).toLowerCase();
  if (urgency === "emergency") return "Emergency Medicine";

  const supplied = String(
    analysis.suggestedSpecialist ?? analysis.suggested_specialist ?? "",
  ).trim();
  if (supplied && !GENERIC_SPECIALISTS.has(supplied.toLowerCase())) {
    return supplied;
  }

  const categories = Array.isArray(analysis.symptomCategories)
    ? analysis.symptomCategories
    : Array.isArray(analysis.symptom_categories)
      ? analysis.symptom_categories
      : [analysis.possible_category];
  const routingText = [
    symptomText,
    analysis.chiefComplaint,
    analysis.chief_complaint,
    analysis.translatedSymptomsText,
    ...categories,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const routes = [
    [/chest|cardiac|cardiovascular|heart|सीना|छाती/, "Cardiology"],
    [/breath|dyspnea|respirat|pulmon|asthma|सांस/, "Pulmonology"],
    [
      /stroke|seizure|neurolog|paralysis|severe headache|sudden weakness|one-sided weakness|लकवा/,
      "Neurology",
    ],
    [
      /abdom|stomach|gastro|vomit|diarrh|पेट|उल्टी|दस्त/,
      "Gastroenterology",
    ],
    [/skin|dermat|rash|itch|खुजली/, "Dermatology"],
    [/bone|joint|knee|musculoskel|orthop|fracture|injury/, "Orthopedics"],
    [/eye|ophthalm|vision/, "Ophthalmology"],
    [/\bent\b|ear|nose|throat|otolaryng/, "ENT / Otolaryngology"],
    [/kidney|renal|nephro/, "Nephrology"],
    [/urinary|urine|bladder|urolog/, "Urology"],
  ];
  return (
    routes.find(([pattern]) => pattern.test(routingText))?.[1] ||
    "General Medicine"
  );
}

function getQuickLocalAnalysis(text, language, patientDetails) {
  const lowerText = text.toLowerCase();

  if (!lowerText.trim()) {
    return {
      patientName: patientDetails.name || "Anonymous",
      age: patientDetails.age || "Unknown",
      gender: patientDetails.gender || "Unknown",
      languageSpoken: language,
      originalSymptomsText: text,
      translatedSymptomsText: text,
      chiefComplaint: "General consultation",
      clinicalSummary:
        "Minimal symptom detail supplied. Clinical review recommended.",
      duration: "Not specified",
      severity: "Medium",
      associatedSymptoms: [],
      symptomCategories: ["General Medicine"],
      urgencyClassification: "Medium",
      urgencyReason:
        "The symptom description is brief and needs clinician review.",
      suggestedSpecialist: "General Physician",
      smartQuestions: [
        "When did the symptoms begin?",
        "Have you had similar symptoms before?",
        "Does anything make this better or worse?",
      ],
      treatmentDraft:
        "Rest, stay hydrated, and seek prompt clinical review if symptoms worsen.",
      patientFriendlySummary:
        "Please rest and drink fluids while a clinician reviews your symptoms.",
      confidence: 0.58,
    };
  }

  const hasClinicalSignal = FAST_PATH_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  );

  if (!hasClinicalSignal) {
    return getQuickLocalAnalysis("", language, patientDetails);
  }

  const defaultResult = getMockAnalysis(text, language, patientDetails);
  return {
    ...defaultResult,
    confidence: calculateExtractionConfidence(text, defaultResult),
  };
}

function getMockAnalysis(text, language, patientDetails) {
  const lowerText = text.toLowerCase();

  let translatedText = `Patient reports: "${text}" in ${language}.`;
  let chiefComplaint = "General consultation";
  let duration = "Unknown";
  let severity = "Medium";
  let urgency = "Medium";
  let reason = "Further examination required.";
  let specialist = "General Physician";
  let categories = ["General Medicine"];
  let associated = [];
  let questions = [
    "When did this start?",
    "Have you had similar symptoms in the past?",
    "Does anything make it better or worse?",
  ];
  let treatment =
    "Ensure adequate rest and oral rehydration. Monitor vitals and consult a general practitioner if symptoms persist.";
  let patientSummary = language.startsWith("Hindi")
    ? "कृपया आराम करें और पर्याप्त पानी पीएं। यदि लक्षण बने रहते हैं तो डॉक्टर से संपर्क करें।"
    : "Please rest and drink plenty of fluids. Consult a medical professional if your symptoms worsen.";
  let redFlags = [];

  // Very basic heuristic for standard symptoms in Hindi/English
  if (
    lowerText.includes("chest") ||
    lowerText.includes("सीना") ||
    (lowerText.includes("दर्द") &&
      (lowerText.includes("छाती") || lowerText.includes("दिल")))
  ) {
    translatedText = text;
    chiefComplaint = "Chest Pain / Suspected Cardiac Event";
    duration = extractDuration(text);
    severity = "Severe";
    urgency = "Emergency";
    reason =
      "Acute chest pain with radiation risks cardiac arrest or myocardial infarction.";
    specialist = "Cardiologist";
    categories = ["Cardiovascular"];
    associated = [lowerText.includes("arm") ? "Pain radiating to arm" : null, lowerText.includes("sweat") ? "Sweating" : null, lowerText.includes("breath") ? "Shortness of breath" : null].filter(Boolean);
    redFlags = ["Chest pressure or pain spreading to the arm, jaw, neck, or back"];
    if (/sweat|faint|breath/.test(lowerText)) redFlags.push("Chest discomfort with sweating, faintness, or severe breathing difficulty");
    questions = [
      "Does the chest pain radiate to your neck, back, or jaw?",
      "Are you experiencing any difficulty breathing or cold sweating?",
      "Do you have a history of heart conditions or high blood pressure?",
    ];
    treatment =
      "Keep the patient at rest and arrange immediate emergency evaluation and transport. Do not allow the patient to drive; escalate at once if pain persists, breathing worsens, or consciousness changes.";
    patientSummary = language.startsWith("Hindi")
      ? "आपातकालीन स्थिति: तुरंत आराम करें और बिना देर किए नजदीकी अस्पताल के आपातकालीन विभाग में जाएं।"
      : "Emergency warning: Please rest immediately and proceed to the nearest emergency department without delay.";
  } else if (
    lowerText.includes("cough") || lowerText.includes("breath") || lowerText.includes("खांसी") || lowerText.includes("सांस")
  ) {
    translatedText = text;
    chiefComplaint = "Cough / Breathing Symptoms";
    duration = extractDuration(text);
    severity = lowerText.includes("shortness") || lowerText.includes("difficulty") ? "High" : "Medium";
    urgency = severity === "High" ? "High" : "Medium";
    reason = "Cough with reported breathing symptoms needs prompt respiratory assessment.";
    specialist = "Pulmonology";
    categories = ["Respiratory", ...(lowerText.includes("fever") ? ["Infectious Diseases"] : [])];
    associated = [lowerText.includes("fever") ? "Fever" : null, lowerText.includes("shortness") ? "Shortness of breath" : null].filter(Boolean);
    questions = ["Is the cough dry, or are you bringing up phlegm or blood?", "Are you short of breath at rest, unable to speak full sentences, or having chest pain?", "What was the highest temperature, and have symptoms worsened over the last day?"];
    treatment = "Rest, take frequent fluids if able, and avoid smoke or strenuous activity while awaiting clinical review. Seek urgent care now if breathing is difficult at rest, lips appear blue, confusion develops, or symptoms rapidly worsen.";
    redFlags = lowerText.includes("shortness") || lowerText.includes("difficulty breathing") ? ["Shortness of breath that is severe, occurs at rest, or prevents full sentences"] : [];
  } else if (
    lowerText.includes("fever") ||
    lowerText.includes("बुखार") ||
    lowerText.includes("कफ") ||
    lowerText.includes("खांसी") ||
    lowerText.includes("weakness")
  ) {
    translatedText = "I have a high fever and a cough for the last three days.";
    chiefComplaint = "Fever and Cough";
    duration = "3 days";
    severity = "Medium";
    urgency = "Medium";
    reason = "Persistent fever and cough requires respiratory evaluation.";
    specialist = "General Physician / Pulmonologist";
    categories = ["Respiratory", "Infectious Diseases"];
    associated = ["Body ache", "Weakness"];
    questions = [
      "Is the cough dry or productive of phlegm?",
      "Are you experiencing any shortness of breath or chest discomfort when coughing?",
      "Have you noticed daily fluctuations in your body temperature?",
    ];
    treatment = "Rest and take frequent fluids if able. Arrange clinical review if fever persists or weakness worsens; seek urgent care for confusion, fainting, breathing difficulty, or inability to drink.";
    questions = ["What was the highest measured temperature and when did the fever start?", "Can you drink and pass urine normally, or are you unusually drowsy or weak?", "Are there localizing symptoms such as cough, pain, rash, vomiting, or urinary burning?"];
    patientSummary = language.startsWith("Hindi")
      ? "आपको बुखार और खांसी है। पर्याप्त आराम करें, गुनगुना पानी पिएं और जरूरत पड़ने पर डॉक्टर से संपर्क करें।"
      : "You have a fever and cough. Take plenty of rest, stay hydrated, and consult a doctor if symptoms persist.";
    if (!lowerText.includes("cough") && !lowerText.includes("खांसी")) {
      chiefComplaint = "Fever and general symptoms";
      specialist = "General Medicine";
      categories = ["General Medicine"];
      associated = lowerText.includes("weakness") ? ["Weakness"] : [];
    }
  } else if (
    lowerText.includes("stomach") ||
    lowerText.includes("पेट") ||
    lowerText.includes("दस्त") ||
    lowerText.includes("vomit") ||
    lowerText.includes("उल्टी")
  ) {
    translatedText = text;
    chiefComplaint = "Abdominal Pain and Vomiting";
    duration = extractDuration(text);
    severity = "High";
    urgency = "High";
    reason =
      "Severe abdominal pain with recurrent vomiting risks dehydration and requires acute care.";
    specialist = "Gastroenterologist";
    categories = ["Gastrointestinal"];
    associated = ["Nausea", "Dehydration risk"];
    redFlags = ["Repeated vomiting with inability to keep fluids down or markedly reduced urination", "Blood in vomit or stool, fainting, or severe/worsening abdominal pain"];
    questions = [
      "Where exactly is the pain located in your abdomen?",
      "Are you able to keep any fluids or water down?",
      "Have you observed any fever, diarrhea, or blood in your stool or vomit?",
    ];
    treatment = "Take frequent small sips of oral rehydration fluid if tolerated and rest. Seek prompt assessment if vomiting continues; seek urgent care for inability to retain fluids, very little urine, fainting, blood, or severe worsening pain.";
    patientSummary = language.startsWith("Hindi")
      ? "पेट दर्द और उल्टी के कारण ओ.आर.एस. का घोल धीरे-धीरे पीते रहें। आराम करें और जल्द ही चिकित्सक को दिखाएं।"
      : "Drink ORS solution slowly to stay hydrated. Rest and consult a physician soon.";
  } else if (/headache|stroke|paralysis|speech|one-sided|weakness/.test(lowerText)) {
    translatedText = text; chiefComplaint = "Headache / Neurological Symptoms"; duration = extractDuration(text); severity = /stroke|paralysis|speech|one-sided/.test(lowerText) ? "Severe" : "Medium"; urgency = severity === "Severe" ? "Emergency" : "Medium"; reason = severity === "Severe" ? "Possible sudden focal neurological deficit requires emergency evaluation." : "Headache requires assessment for severity and neurological warning signs."; specialist = severity === "Severe" ? "Emergency Medicine" : "Neurology"; categories = ["Neurological"]; associated = /weakness/.test(lowerText) ? ["Weakness"] : []; questions = ["Did the headache begin suddenly, and is it the worst headache you have experienced?", "Is there new weakness, facial droop, speech difficulty, confusion, seizure, or vision loss?", "Have you had fever, neck stiffness, head injury, or repeated vomiting?"]; treatment = "Rest in a safe quiet place while arranging clinical review. Call emergency services immediately for sudden weakness, facial droop, speech difficulty, seizure, confusion, collapse, or an abrupt severe headache."; redFlags = /stroke|paralysis|speech|one-sided/.test(lowerText) ? ["New weakness or paralysis, facial droop, or speech difficulty consistent with a stroke warning"] : [];
  } else if (/rash|itch|itchy|खुजली/.test(lowerText)) {
    translatedText = text; chiefComplaint = "Itchy Rash"; duration = extractDuration(text); severity = "Low"; urgency = "Low"; reason = "Localized itchy rash without a reported systemic warning sign is suitable for routine skin assessment."; specialist = "Dermatology"; categories = ["Dermatological"]; associated = ["Itching", "Redness"]; questions = ["Did you use a new soap, medicine, food, plant, or other product before the rash began?", "Is the rash spreading, blistering, painful, warm, or associated with fever?", "Is there swelling of the lips or tongue, wheezing, or difficulty breathing?"]; treatment = "Avoid suspected new irritants, scratching, and fragranced products; keep the skin clean and cool pending clinical review. Seek emergency help for facial or tongue swelling, wheezing, breathing difficulty, widespread blistering, or faintness."; redFlags = [];
  } else if (/knee|joint|injury|hurt|football|fracture|swelling/.test(lowerText)) {
    translatedText = text; chiefComplaint = "Knee / Musculoskeletal Injury"; duration = extractDuration(text); severity = "Medium"; urgency = "Medium"; reason = "An acute joint injury needs examination for stability, circulation, and ability to bear weight."; specialist = "Orthopedics"; categories = ["Musculoskeletal"]; associated = lowerText.includes("swelling") ? ["Swelling"] : []; questions = ["How did the injury happen—twist, direct impact, fall, or collision—and did you hear a pop?", "Can you bear weight and bend or straighten the knee?", "Is there marked swelling, deformity, numbness, or a cold or pale foot?"]; treatment = "Stop sports, protect the knee, rest it, use a wrapped cool pack briefly, and elevate it while awaiting assessment. Seek urgent care for deformity, inability to bear weight, rapidly increasing swelling, numbness, or a cold or pale foot."; redFlags = [];
  }

  const mockResult = {
    patientName: patientDetails.name || "Anonymous",
    age: patientDetails.age || "Unknown",
    gender: patientDetails.gender || "Unknown",
    languageSpoken: language,
    originalSymptomsText: text,
    translatedSymptomsText: translatedText,
    chiefComplaint: chiefComplaint,
    clinicalSummary: `Patient presents with ${chiefComplaint.toLowerCase()} of duration ${duration}. Translated statement: ${translatedText}`,
    duration: duration,
    severity: severity,
    associatedSymptoms: associated,
    symptomCategories: categories,
    urgencyClassification: urgency,
    urgencyReason: reason,
    suggestedSpecialist: specialist,
    smartQuestions: questions,
    treatmentDraft: treatment,
    redFlags,
    patientFriendlySummary: patientSummary,
  };

  mockResult.suggestedSpecialist = resolveSuggestedSpecialist(mockResult, text);
  if (mockResult.chiefComplaint === "General consultation") {
    const categoryBySpecialist = {
      Pulmonology: "Respiratory",
      Neurology: "Neurological",
      Gastroenterology: "Gastrointestinal",
      Dermatology: "Dermatological",
      Orthopedics: "Musculoskeletal",
      Ophthalmology: "Ophthalmological",
      "ENT / Otolaryngology": "ENT",
      Nephrology: "Renal",
      Urology: "Urinary",
    };
    const routedCategory = categoryBySpecialist[mockResult.suggestedSpecialist];
    if (routedCategory) {
      mockResult.symptomCategories = [routedCategory];
      mockResult.chiefComplaint = `Reported ${routedCategory} symptoms`;
      mockResult.clinicalSummary = `Patient reports symptoms requiring ${routedCategory.toLowerCase()} evaluation. Narrative: ${text}`;
    }
  }

  return {
    ...mockResult,
    confidence: calculateExtractionConfidence(text, mockResult),
  };
}

function extractDuration(text) {
  return String(text).match(/(?:for|since)\s+([^,.]+)/i)?.[1]?.trim() || "Not specified";
}

export function calculateExtractionConfidence(text, analysis = {}) {
  const rawText = String(text || "").trim();
  const lowerText = rawText.toLowerCase();

  if (!rawText) return 0.38;

  let score = 0.42;

  const strongSignals = [
    "chest pain",
    "shortness of breath",
    "breathlessness",
    "difficulty breathing",
    "fever",
    "cough",
    "abdominal pain",
    "vomiting",
    "diarrhea",
    "rash",
    "headache",
    "bleeding",
    "dizziness",
    "swelling",
    "burning",
    "seizure",
    "stroke",
    "injury",
    "fracture",
    "weakness",
    "nausea",
    "sore throat",
  ];

  const matchedSignals = strongSignals.filter((signal) =>
    lowerText.includes(signal),
  ).length;
  score += Math.min(matchedSignals * 0.09, 0.27);

  if (
    analysis.chiefComplaint &&
    analysis.chiefComplaint !== "General consultation"
  ) {
    score += 0.12;
  }

  if (
    Array.isArray(analysis.associatedSymptoms) &&
    analysis.associatedSymptoms.length > 0
  ) {
    score += Math.min(analysis.associatedSymptoms.length * 0.03, 0.12);
  }

  if (
    analysis.duration &&
    !["unknown", "not specified"].includes(
      String(analysis.duration).trim().toLowerCase(),
    )
  ) {
    score += 0.08;
  }

  if (
    analysis.severity &&
    ["Low", "Medium", "High", "Severe"].includes(analysis.severity)
  ) {
    score += 0.06;
  }

  if (
    analysis.urgencyClassification &&
    ["Low", "Medium", "High", "Emergency"].includes(
      analysis.urgencyClassification,
    )
  ) {
    score += 0.06;
  }

  if (
    Array.isArray(analysis.symptomCategories) &&
    analysis.symptomCategories.length > 0
  ) {
    score += 0.05;
  }

  const vaguePatterns = [
    "not feeling well",
    "feeling unwell",
    "not good",
    "issue",
    "problem",
    "something wrong",
  ];
  const isVague =
    vaguePatterns.some((pattern) => lowerText.includes(pattern)) ||
    rawText.split(/\s+/).length < 6;
  if (isVague) {
    score -= 0.18;
  }

  if (rawText.length > 120) {
    score += 0.04;
  }

  if (
    analysis.urgencyClassification === "Emergency" ||
    lowerText.includes("chest pain") ||
    lowerText.includes("difficulty breathing")
  ) {
    score += 0.05;
  }

  return Number(Math.max(0.32, Math.min(0.97, score)).toFixed(2));
}

function normalizeAnalysis(result, text, language, patientDetails) {
  const urgency = ["Low", "Medium", "High", "Emergency"].includes(
    result.urgencyClassification,
  )
    ? result.urgencyClassification
    : "Medium";
  const severity = ["Low", "Medium", "High", "Severe"].includes(result.severity)
    ? result.severity
    : "Medium";
  const fallback = getMockAnalysis(text, language, patientDetails);
  const defaultQuestions = fallback.smartQuestions;
  const smartQuestions = Array.isArray(result.smartQuestions)
    ? result.smartQuestions.slice(0, 3).map(String)
    : [];
  while (smartQuestions.length < 3)
    smartQuestions.push(defaultQuestions[smartQuestions.length]);

  const normalized = {
    patientName: patientDetails.name || "Anonymous",
    age: patientDetails.age || "Unknown",
    gender: patientDetails.gender || "Unknown",
    languageSpoken: language,
    originalSymptomsText: text,
    translatedSymptomsText: String(result.translatedSymptomsText || text),
    chiefComplaint: String(result.chiefComplaint || "General consultation"),
    clinicalSummary: String(
      result.clinicalSummary || "Clinical review recommended.",
    ),
    duration: String(result.duration || "Not specified"),
    severity,
    associatedSymptoms: Array.isArray(result.associatedSymptoms)
      ? result.associatedSymptoms.slice(0, 8).map(String)
      : [],
    symptomCategories: Array.isArray(result.symptomCategories)
      ? result.symptomCategories.slice(0, 5).map(String)
      : ["General Medicine"],
    urgencyClassification: urgency,
    urgencyReason: String(
      result.urgencyReason || "Clinical review is recommended.",
    ),
    suggestedSpecialist: resolveSuggestedSpecialist(result, text),
    smartQuestions,
    treatmentDraft: String(
      result.treatmentDraft || fallback.treatmentDraft,
    ),
    redFlags: Array.isArray(result.redFlags) ? result.redFlags.slice(0, 8).map(String) : fallback.redFlags,
    patientFriendlySummary: String(
      result.patientFriendlySummary ||
        "Please consult the clinic team for the next steps.",
    ),
  };

  return {
    ...normalized,
    confidence: calculateExtractionConfidence(text, normalized),
  };
}

export async function analyzeSymptoms(text, language, patientDetails = {}) {
  if (!text || text.trim() === "")
    throw new Error("Symptom description cannot be empty.");

  const system = `You are VaaniDoc, a clinical intake and safety-triage assistant for supervised rural clinics in India. You do not diagnose, prescribe medicines, recommend procedures, administer treatments, or invent facts. Translate regional Indian languages and transliterated Hinglish into concise clinical English. Escalate Emergency for time-critical red flags such as chest pain with sweating/radiation, stroke signs, severe breathing difficulty, major bleeding, seizures, or altered consciousness. Return only valid JSON with these exact keys: translatedSymptomsText, chiefComplaint, clinicalSummary, duration, severity, associatedSymptoms, symptomCategories, urgencyClassification, urgencyReason, suggestedSpecialist, smartQuestions, treatmentDraft, redFlags, patientFriendlySummary. Every clinical field must be specific to the supplied narration. redFlags must contain only warning signs supported by the narration (or be empty). suggestedSpecialist is routing guidance, not a diagnosis: choose the most appropriate department from the analyzed symptoms and category, and use Emergency Medicine when red flags require emergency routing. severity must be Low, Medium, High, or Severe. urgencyClassification must be Low, Medium, High, or Emergency. smartQuestions must contain exactly 3 symptom-specific questions. treatmentDraft must only say patient-specific supportive non-pharmacological measures and clear escalation instructions; never name medicines, oxygen, procedures, tests, or definitive treatments.`;
  const user = JSON.stringify({
    patientLanguage: language,
    demographics: {
      age: patientDetails.age || "Unknown",
      gender: patientDetails.gender || "Unknown",
    },
    narration: text,
  });

  if (shouldUseFastLocalPath(text)) {
    return getQuickLocalAnalysis(text, language, patientDetails);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 900 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    clearTimeout(timeout);
    if (!response.ok)
      throw new Error(
        `Ollama returned ${response.status}: ${await response.text()}`,
      );
    const payload = await response.json();
    const parsed = JSON.parse(payload?.message?.content || "{}");
    return normalizeAnalysis(parsed, text, language, patientDetails);
  } catch (error) {
    console.error(
      "Ollama analysis unavailable; using local safety rules:",
      error.message,
    );
    return getMockAnalysis(text, language, patientDetails);
  }
}
