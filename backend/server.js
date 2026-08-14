import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  analyzeSymptoms,
  calculateExtractionConfidence,
  resolveSuggestedSpecialist,
} from "./geminiService.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"],
  }),
);

app.use(express.json());

// In-Memory volatile storage for clinical intake sessions
const activeSessions = new Map();

// HTTP server and WebSocket setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const isRealPatientIntake = (session = {}) => {
  const text =
    session.originalSymptomsText ||
    session.translatedSymptomsText ||
    session.chiefComplaint ||
    session.chief_complaint ||
    "";

  return (
    Boolean(text.trim()) ||
    (session.patientName && session.patientName !== "Anonymous")
  );
};

// WebSocket Connection Handler
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  // Keep the websocket contract identical to GET /api/active-sessions. Some
  // sessions (notably restored/offline sessions) are stored in the portable
  // snake_case shape and need mapping before the dashboard can consume them.
  socket.emit(
    "sessions-update",
    Array.from(activeSessions.values())
      .filter(isRealPatientIntake)
      .map(mapIntakeSession),
  );

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Helper: Map and extend session structure to satisfy both specs (snake_case) and UI (camelCase)
function mapIntakeSession(session) {
  const language = session.languageSpoken || session.language || "English";
  const translated_text =
    session.translatedSymptomsText ||
    session.translated_text ||
    session.originalSymptomsText ||
    "";

  let symptoms = [];
  if (Array.isArray(session.symptoms)) {
    symptoms = session.symptoms;
  } else if (Array.isArray(session.associatedSymptoms)) {
    symptoms = session.associatedSymptoms.map((name) => ({
      name,
      duration: session.duration || "Not specified",
      severity: (session.severity || "moderate").toLowerCase(),
    }));
  }

  if (
    symptoms.length === 0 &&
    (session.chiefComplaint || session.chief_complaint)
  ) {
    symptoms.push({
      name: session.chiefComplaint || session.chief_complaint,
      duration: session.duration || "Not specified",
      severity: (session.severity || "moderate").toLowerCase(),
    });
  }

  const chief_complaint =
    session.chiefComplaint ||
    session.chief_complaint ||
    (symptoms[0] ? symptoms[0].name : "General consultation");
  const symptomCategories = Array.isArray(session.symptomCategories)
    ? session.symptomCategories
    : Array.isArray(session.symptom_categories)
      ? session.symptom_categories
      : session.possible_category
        ? [session.possible_category]
        : ["General Medicine"];
  const possible_category = session.possible_category || symptomCategories[0];

  let urgency = (
    session.urgencyClassification ||
    session.urgency ||
    "Low"
  ).toLowerCase();

  // Deterministic safety check for emergency red flags (Section 13)
  const red_flags = Array.isArray(session.redFlags)
    ? [...session.redFlags]
    : Array.isArray(session.red_flags)
      ? [...session.red_flags]
      : Array.isArray(session.data?.red_flags)
        ? [...session.data.red_flags]
        : [];
  const suggestedSpecialist = resolveSuggestedSpecialist(
    {
      ...session,
      symptomCategories,
      possible_category,
      urgencyClassification: urgency,
    },
    session.originalSymptomsText || translated_text,
  );

  const confidence =
    typeof session.confidence === "number"
      ? session.confidence
      : calculateExtractionConfidence(
          session.originalSymptomsText ||
            session.translatedSymptomsText ||
            session.chiefComplaint ||
            "",
          session,
        );

        const smartQuestions =
        session.smartQuestions ??
        session.smart_questions ??
        session.data?.smart_questions;
      
      const treatmentDraft =
        session.treatmentDraft ??
        session.treatment_draft ??
        session.data?.treatment_draft;
      
      const patientFriendlySummary =
        session.patientFriendlySummary ??
        session.patient_friendly_summary ??
        session.data?.patient_friendly_summary;

  const clinicalSummary =
    session.clinicalSummary ?? session.clinical_summary ?? session.data?.clinical_summary;
  const urgencyReason =
    session.urgencyReason ?? session.urgency_reason ?? session.data?.urgency_reason;
  const copilotFields = {
    possibleCauses: session.possibleCauses ?? session.data?.possible_causes ?? [],
    missingInformation: session.missingInformation ?? session.data?.missing_information ?? [],
    recommendedNextSteps: session.recommendedNextSteps ?? session.data?.recommended_next_steps ?? [],
    selfCareGuidance: session.selfCareGuidance ?? session.data?.self_care_guidance ?? [],
    precautions: session.precautions ?? session.data?.precautions ?? [],
    medicationConsiderations: session.medicationConsiderations ?? session.data?.medication_considerations ?? [],
    medicationSafetySummary: session.medicationSafetySummary ?? session.data?.medication_safety_summary,
    followUpGuidance: session.followUpGuidance ?? session.data?.follow_up_guidance ?? [],
  };

  const data = {
    language,
    translated_text,
    chief_complaint,
    symptoms,
    possible_category,
    suggested_specialist: suggestedSpecialist,
    red_flags,
    urgency: urgency.toUpperCase(),
    confidence,
    smart_questions: smartQuestions,
    treatment_draft: treatmentDraft,
    patient_friendly_summary: patientFriendlySummary,
    clinical_summary: clinicalSummary,
    symptom_categories: symptomCategories,
    urgency_reason: urgencyReason,
    possible_causes: copilotFields.possibleCauses,
    missing_information: copilotFields.missingInformation,
    recommended_next_steps: copilotFields.recommendedNextSteps,
    self_care_guidance: copilotFields.selfCareGuidance,
    precautions: copilotFields.precautions,
    medication_considerations: copilotFields.medicationConsiderations,
    medication_safety_summary: copilotFields.medicationSafetySummary,
    follow_up_guidance: copilotFields.followUpGuidance,
  };

  return {
    ...session,
    language,
    translated_text,
    chief_complaint,
    symptoms,
    possible_category,
    suggested_specialist: suggestedSpecialist,
    red_flags,
    urgency: urgency.toUpperCase(),
    confidence,

    // UI compatibility properties
    languageSpoken: language,
    translatedSymptomsText: translated_text,
    chiefComplaint: chief_complaint,
    symptomCategories,
    suggestedSpecialist,
    associatedSymptoms: symptoms.map((s) => s.name),
    urgencyClassification:
      urgency.toUpperCase() === "EMERGENCY"
        ? "Emergency"
        : urgency.toUpperCase() === "HIGH"
          ? "High"
          : urgency.toUpperCase() === "MEDIUM"
            ? "Medium"
            : "Low",

    smartQuestions,
    treatmentDraft,
    patientFriendlySummary,
    clinicalSummary,
    urgencyReason,
    redFlags: red_flags,
    ...copilotFields,

    success: true,
    data,
  };
}

// Route: Start Session (Section 27)
app.post("/api/session/start", (req, res) => {
  // Generate random clinic consult ID in format VD-XXXX (Section 17)
  const sessionId = `VD-${Math.floor(1000 + Math.random() * 9000)}`;
  const initialSession = {
    sessionId,
    timestamp: new Date().toISOString(),
    isOfflineGenerated: false,
    originalSymptomsText: "",
    patientName: "",
    age: "",
    gender: "",
    languageSpoken: "English",
  };
  console.log(`Clinical session started: ${sessionId}`);
  return res
    .status(200)
    .json({ success: true, sessionId, data: initialSession });
});

// Route: Get Session by ID (Section 27)
app.get("/api/session/:id", (req, res) => {
  const { id } = req.params;
  if (activeSessions.has(id)) {
    return res
      .status(200)
      .json({ success: true, data: mapIntakeSession(activeSessions.get(id)) });
  }
  return res.status(404).json({ success: false, error: "Session not found." });
});

// Route: End Session (Section 27 & 18)
app.post("/api/session/:id/end", (req, res) => {
  const { id } = req.params;
  if (activeSessions.has(id)) {
    activeSessions.delete(id);
    console.log(`Clinical session ended & deleted: ${id}`);

    // Broadcast updated queue
    io.emit(
      "sessions-update",
      Array.from(activeSessions.values()).map(mapIntakeSession),
    );
    return res
      .status(200)
      .json({ success: true, message: "Temporary patient data deleted." });
  }
  return res
    .status(404)
    .json({ success: false, error: "Session not found or already deleted." });
});

// Route: Mock transcribe (Section 27)
app.post("/api/transcribe", (req, res) => {
  const { language } = req.body;
  // Echo a placeholder phrase in the correct voice transcription scope
  return res.status(200).json({
    success: true,
    text: "Intake transcription simulated successfully.",
  });
});

// Route: Fetch validation test cases (Section 20 & 21)
app.get("/api/validation/test-cases", (req, res) => {
  try {
    const testCasesPath = path.join(__dirname, "../validation/testCases.json");
    const testCases = JSON.parse(fs.readFileSync(testCasesPath, "utf-8"));
    return res.status(200).json(testCases);
  } catch (error) {
    console.error("Failed to read test cases:", error);
    return res.status(500).json({ error: "Failed to read test cases." });
  }
});

// Endpoint to analyze symptoms using Gemini API (Section 10 & 27)
app.post("/api/analyze", async (req, res) => {
  const {
    text,
    language,
    patientDetails,
    sessionId,
    persistSession = true,
  } = req.body;

  if (!text || !language) {
    return res.status(400).json({
      error: "Missing required fields: text and language are mandatory.",
    });
  }

  try {
    const analysis = await analyzeSymptoms(text, language, patientDetails);

    // Use passed session ID or generate one
    const sId = sessionId || `VD-${Math.floor(1000 + Math.random() * 9000)}`;

    const rawSession = {
      sessionId: sId,
      timestamp: new Date().toISOString(),
      isOfflineGenerated: false,
      patientName: patientDetails?.name || "Anonymous",
      age: patientDetails?.age || "Unknown",
      gender: patientDetails?.gender || "Unknown",
      originalSymptomsText: text,
      ...analysis,
    };

    const mappedSession = mapIntakeSession(rawSession);
    if (persistSession) {
      activeSessions.set(sId, mappedSession);
      // Only genuine patient intakes are visible to the attending clinician.
      io.emit(
        "sessions-update",
        Array.from(activeSessions.values())
          .filter(isRealPatientIntake)
          .map(mapIntakeSession),
      );
      io.emit("new-session", mappedSession);
    }

    return res.status(200).json(mappedSession);
  } catch (error) {
    console.error("Error analyzing symptoms:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to analyze symptoms." });
  }
});

// Endpoint to sync offline generated/cached intakes
app.post("/api/sync-offline", async (req, res) => {
  const { localIntake } = req.body;

  if (!localIntake || !localIntake.originalSymptomsText) {
    return res.status(400).json({ error: "Invalid local intake format." });
  }

  try {
    console.log(
      `Syncing offline intake for patient: ${localIntake.patientName || "Anonymous"}`,
    );

    let analysis;
    try {
      analysis = await analyzeSymptoms(
        localIntake.originalSymptomsText,
        localIntake.languageSpoken || localIntake.language,
        {
          name: localIntake.patientName,
          age: localIntake.age,
          gender: localIntake.gender,
        },
      );
    } catch (e) {
      console.warn(
        "Could not upgrade offline intake using Gemini, using local fallback details:",
        e,
      );
      analysis = localIntake;
    }

    const sId =
      localIntake.sessionId || `VD-${Math.floor(1000 + Math.random() * 9000)}`;
    const rawSession = {
      ...localIntake,
      ...analysis,
      sessionId: sId,
      isOfflineGenerated: false,
      timestamp: localIntake.timestamp || new Date().toISOString(),
    };

    const mappedSession = mapIntakeSession(rawSession);
    activeSessions.set(sId, mappedSession);

    io.emit(
      "sessions-update",
      Array.from(activeSessions.values())
        .filter(isRealPatientIntake)
        .map(mapIntakeSession),
    );
    io.emit("new-session", mappedSession);

    return res.status(200).json(mappedSession);
  } catch (error) {
    console.error("Error syncing offline intake:", error);
    return res.status(500).json({ error: "Failed to sync offline intake." });
  }
});

// Endpoint to fetch all active sessions for the doctor dashboard
app.get("/api/active-sessions", (req, res) => {
  const sessions = Array.from(activeSessions.values())
    .filter(isRealPatientIntake)
    .map((s) => mapIntakeSession(s));
  return res.status(200).json(sessions);
});

// Endpoint to dismiss/clear a patient session (Privacy constraint)
app.post("/api/clear-session", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId." });
  }

  if (activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
    console.log(`Session cleared: ${sessionId}`);

    io.emit(
      "sessions-update",
      Array.from(activeSessions.values()).map(mapIntakeSession),
    );
    return res
      .status(200)
      .json({ success: true, message: "Session cleared successfully." });
  }

  return res
    .status(404)
    .json({ error: "Session not found or already cleared." });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    activeSessionsCount: activeSessions.size,
    aiProvider: "Ollama (local)",
  });
});

// Start server. Handle a port conflict gracefully so a clinic operator gets a
// useful recovery instruction instead of an unhandled Node error.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the existing VaaniDoc server, or run this instance with PORT=5001.`,
    );
    process.exitCode = 1;
    return;
  }
  console.error("Unable to start VaaniDoc server:", error);
  process.exitCode = 1;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VaaniDoc Server running on http://localhost:${PORT}`);
});
