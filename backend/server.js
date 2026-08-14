import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeSymptoms } from "./geminiService.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE"]
}));

app.use(express.json());

// In-Memory volatile storage for clinical intake sessions
const activeSessions = new Map();

// HTTP server and WebSocket setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// WebSocket Connection Handler
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  // Keep the websocket contract identical to GET /api/active-sessions. Some
  // sessions (notably restored/offline sessions) are stored in the portable
  // snake_case shape and need mapping before the dashboard can consume them.
  socket.emit("sessions-update", Array.from(activeSessions.values()).map(mapIntakeSession));

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Helper: Map and extend session structure to satisfy both specs (snake_case) and UI (camelCase)
function mapIntakeSession(session) {
  const language = session.languageSpoken || session.language || "English";
  const translated_text = session.translatedSymptomsText || session.translated_text || session.originalSymptomsText || "";
  
  let symptoms = [];
  if (Array.isArray(session.symptoms)) {
    symptoms = session.symptoms;
  } else if (Array.isArray(session.associatedSymptoms)) {
    symptoms = session.associatedSymptoms.map(name => ({
      name,
      duration: session.duration || "Not specified",
      severity: (session.severity || "moderate").toLowerCase()
    }));
  }

  if (symptoms.length === 0 && (session.chiefComplaint || session.chief_complaint)) {
    symptoms.push({
      name: session.chiefComplaint || session.chief_complaint,
      duration: session.duration || "Not specified",
      severity: (session.severity || "moderate").toLowerCase()
    });
  }

  const chief_complaint = session.chiefComplaint || session.chief_complaint || (symptoms[0] ? symptoms[0].name : "General consultation");
  const possible_category = Array.isArray(session.symptomCategories) ? session.symptomCategories[0] : (session.possible_category || "General Medicine");
  
  let urgency = (session.urgencyClassification || session.urgency || "Low").toLowerCase();
  
  // Deterministic safety check for emergency red flags (Section 13)
  const red_flags = [];
  const lowercaseText = (session.originalSymptomsText || "").toLowerCase();
  
  if (lowercaseText.includes("breath") || lowercaseText.includes("सांस") || lowercaseText.includes("மூச்சு") || lowercaseText.includes("శ్యాస") || lowercaseText.includes("শ্বাস")) {
    red_flags.push("Difficulty breathing / Respiratory distress");
    urgency = "high";
  }
  if (lowercaseText.includes("chest pain") || lowercaseText.includes("सीना दर्द") || lowercaseText.includes("நெஞ்சு வலி") || lowercaseText.includes("గుండె నొప్పి") || lowercaseText.includes("বুকে ব্যথা")) {
    red_flags.push("Severe chest pain / Suspected cardiac event");
    urgency = "emergency";
  }
  if (lowercaseText.includes("stroke") || lowercaseText.includes("paralysis") || lowercaseText.includes("लकवा") || lowercaseText.includes("பக்கவாதம்") || lowercaseText.includes("పక్షవాతం")) {
    red_flags.push("Sudden severe neurological symptoms / Stroke");
    urgency = "emergency";
  }

  const confidence = session.confidence || 0.94;

  // These are generated values, so mapping must preserve absence rather than
  // manufacturing content that looks like an AI result.
  const smartQuestions = session.smartQuestions ?? session.smart_questions ?? session.data?.smart_questions;
  const treatmentDraft = session.treatmentDraft ?? session.treatment_draft ?? session.data?.treatment_draft;
  const patientFriendlySummary = session.patientFriendlySummary ?? session.patient_friendly_summary ?? session.data?.patient_friendly_summary;

  const data = {
    language,
    translated_text,
    chief_complaint,
    symptoms,
    possible_category,
    red_flags,
    urgency: urgency.toUpperCase(),
    confidence,
    smart_questions: smartQuestions,
    treatment_draft: treatmentDraft,
    patient_friendly_summary: patientFriendlySummary
  };

  return {
    ...session,
    language,
    translated_text,
    chief_complaint,
    symptoms,
    possible_category,
    red_flags,
    urgency: urgency.toUpperCase(),
    confidence,
    
    // UI compatibility properties
    languageSpoken: language,
    translatedSymptomsText: translated_text,
    chiefComplaint: chief_complaint,
    symptomCategories: Array.isArray(session.symptomCategories) ? session.symptomCategories : [possible_category],
    associatedSymptoms: symptoms.map(s => s.name),
    urgencyClassification: urgency.toUpperCase() === "EMERGENCY" ? "Emergency" : urgency.toUpperCase() === "HIGH" ? "High" : urgency.toUpperCase() === "MEDIUM" ? "Medium" : "Low",
    
    smartQuestions,
    treatmentDraft,
    patientFriendlySummary,
    
    success: true,
    data
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
    patientName: "Anonymous",
    age: "Unknown",
    gender: "Unknown",
    languageSpoken: "English"
  };
  activeSessions.set(sessionId, initialSession);
  console.log(`Clinical session started: ${sessionId}`);
  return res.status(200).json({ success: true, sessionId, data: initialSession });
});

// Route: Get Session by ID (Section 27)
app.get("/api/session/:id", (req, res) => {
  const { id } = req.params;
  if (activeSessions.has(id)) {
    return res.status(200).json({ success: true, data: mapIntakeSession(activeSessions.get(id)) });
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
    io.emit("sessions-update", Array.from(activeSessions.values()).map(mapIntakeSession));
    return res.status(200).json({ success: true, message: "Temporary patient data deleted." });
  }
  return res.status(404).json({ success: false, error: "Session not found or already deleted." });
});

// Route: Mock transcribe (Section 27)
app.post("/api/transcribe", (req, res) => {
  const { language } = req.body;
  // Echo a placeholder phrase in the correct voice transcription scope
  return res.status(200).json({ 
    success: true, 
    text: "Intake transcription simulated successfully." 
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
  const { text, language, patientDetails, sessionId, persistSession = true } = req.body;

  if (!text || !language) {
    return res.status(400).json({ error: "Missing required fields: text and language are mandatory." });
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
      ...analysis
    };

    const mappedSession = mapIntakeSession(rawSession);
    if (persistSession) {
      activeSessions.set(sId, mappedSession);
      // Only genuine patient intakes are visible to the attending clinician.
    io.emit("sessions-update", Array.from(activeSessions.values()).map(mapIntakeSession));
      io.emit("new-session", mappedSession);
    }

    return res.status(200).json(mappedSession);
  } catch (error) {
    console.error("Error analyzing symptoms:", error);
    return res.status(500).json({ error: error.message || "Failed to analyze symptoms." });
  }
});

// Endpoint to sync offline generated/cached intakes
app.post("/api/sync-offline", async (req, res) => {
  const { localIntake } = req.body;

  if (!localIntake || !localIntake.originalSymptomsText) {
    return res.status(400).json({ error: "Invalid local intake format." });
  }

  try {
    console.log(`Syncing offline intake for patient: ${localIntake.patientName || "Anonymous"}`);
    
    let analysis;
    try {
      analysis = await analyzeSymptoms(
        localIntake.originalSymptomsText, 
        localIntake.languageSpoken || localIntake.language, 
        {
          name: localIntake.patientName,
          age: localIntake.age,
          gender: localIntake.gender
        }
      );
    } catch (e) {
      console.warn("Could not upgrade offline intake using Gemini, using local fallback details:", e);
      analysis = localIntake;
    }

    const sId = localIntake.sessionId || `VD-${Math.floor(1000 + Math.random() * 9000)}`;
    const rawSession = {
      ...localIntake,
      ...analysis,
      sessionId: sId,
      isOfflineGenerated: false,
      timestamp: localIntake.timestamp || new Date().toISOString()
    };

    const mappedSession = mapIntakeSession(rawSession);
    activeSessions.set(sId, mappedSession);
    
      io.emit("sessions-update", Array.from(activeSessions.values()).map(mapIntakeSession));
    io.emit("new-session", mappedSession);

    return res.status(200).json(mappedSession);
  } catch (error) {
    console.error("Error syncing offline intake:", error);
    return res.status(500).json({ error: "Failed to sync offline intake." });
  }
});

// Endpoint to fetch all active sessions for the doctor dashboard
app.get("/api/active-sessions", (req, res) => {
  const sessions = Array.from(activeSessions.values()).map(s => mapIntakeSession(s));
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
    
    io.emit("sessions-update", Array.from(activeSessions.values()).map(mapIntakeSession));
    return res.status(200).json({ success: true, message: "Session cleared successfully." });
  }

  return res.status(404).json({ error: "Session not found or already cleared." });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", activeSessionsCount: activeSessions.size, aiProvider: "Ollama (local)" });
});

// Start server. Handle a port conflict gracefully so a clinic operator gets a
// useful recovery instruction instead of an unhandled Node error.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing VaaniDoc server, or run this instance with PORT=5001.`);
    process.exitCode = 1;
    return;
  }
  console.error("Unable to start VaaniDoc server:", error);
  process.exitCode = 1;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VaaniDoc Server running on http://localhost:${PORT}`);
});
