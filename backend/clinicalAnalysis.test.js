import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSymptoms, createConservativeFallback } from "./geminiService.js";

const vagueCases = [
  ["stomach pain", "Gastrointestinal", ["Vomiting", "Nausea", "Dehydration"]],
  ["headache", "Neurological", ["Weakness", "Slurred speech"]],
  ["my leg hurts", "Musculoskeletal", ["Swelling"]],
  ["itching", "Dermatological", ["Rash", "Redness"]],
  ["feeling dizzy", "Neurological", ["Weakness"]],
  ["pain while urinating", "Urinary", ["Fever", "Blood"]],
  ["my eye is red", "Ophthalmological", ["Discharge", "Vision loss"]],
  ["ear pain", "ENT", ["Fever", "Discharge"]],
  ["back pain", "Musculoskeletal", ["Weakness"]],
  ["cough", "Respiratory", ["Fever", "Shortness of breath"]],
];

test("vague arbitrary inputs remain narration-grounded", () => {
  for (const [narration, category, forbidden] of vagueCases) {
    const result = createConservativeFallback(narration, "English", {});
    assert.deepEqual(result.symptomCategories, [category], narration);
    assert.notEqual(result.urgencyClassification, "Emergency", narration);
    assert.deepEqual(result.redFlags, [], narration);
    const asserted = JSON.stringify(result.associatedSymptoms);
    for (const symptom of forbidden) assert.doesNotMatch(asserted, new RegExp(symptom, "i"), `${narration} must not inject ${symptom}`);
    assert.equal(result.duration, "Not specified");
    assert.equal(result.severity, "Not specified");
    assert.ok(result.possibleCauses.length > 0);
    assert.equal(result.possibleCauses.every((cause) => cause.confidence === "low"), true);
    assert.ok(result.missingInformation.length > 0);
    assert.ok(result.recommendedNextSteps.length > 0);
    assert.ok(result.selfCareGuidance.length > 0);
    assert.ok(result.precautions.length > 0);
    assert.deepEqual(result.medicationConsiderations, []);
    assert.ok(result.followUpGuidance.length > 0);
  }
});

test("blood in vomit changes abdominal triage without inventing other findings", () => {
  const vague = createConservativeFallback("stomach pain", "English", {});
  const urgent = createConservativeFallback("severe stomach pain with blood in vomit", "English", {});
  assert.equal(vague.urgencyClassification, "Low");
  assert.deepEqual(vague.redFlags, []);
  assert.equal(urgent.urgencyClassification, "Emergency");
  assert.deepEqual(urgent.redFlags, ["Blood in vomit"]);
  assert.doesNotMatch(JSON.stringify(urgent.associatedSymptoms), /fever|diarrhea|dehydration/i);
  assert.match(urgent.recommendedNextSteps.join(" "), /immediate emergency/i);
  assert.deepEqual(urgent.medicationConsiderations, []);
  assert.notDeepEqual(vague.selfCareGuidance, urgent.selfCareGuidance);
});

test("explicit details are preserved and evidence escalates urgency", () => {
  const cases = [
    ["severe difficulty breathing", /breathing/i],
    ["sudden weakness on my left side and slurred speech", /weakness.*speech/i],
    ["vomited six times and cannot keep water down", /vomit/i],
  ];
  for (const [narration, evidence] of cases) {
    const result = createConservativeFallback(narration, "English", {});
    assert.equal(result.urgencyClassification, "Emergency", narration);
    assert.ok(result.redFlags.length > 0, narration);
    assert.match(`${result.clinicalSummary} ${result.redFlags.join(" ")}`, evidence);
  }
});

test("analysis uses the conservative fallback when no provider is configured", async () => {
  const first = await analyzeSymptoms("stomach pain", "English", {});
  const second = await analyzeSymptoms("cough", "English", {});
  assert.equal(first.analysisProvider, "generic-fallback");
  assert.equal(first.associatedSymptoms.includes("Vomiting"), false);
  assert.equal(second.associatedSymptoms.includes("Fever"), false);
  assert.notEqual(first.clinicalSummary, second.clinicalSummary);
  assert.notEqual(first.treatmentDraft + first.smartQuestions.join(), second.treatmentDraft + second.smartQuestions.join());
});

test("copilot guidance varies across broad complaint categories", () => {
  const narrations = ["cough", "itching", "my knee hurts", "pain while urinating", "headache"];
  const reports = narrations.map((text) => createConservativeFallback(text, "English", {}));
  assert.equal(new Set(reports.map((item) => item.symptomCategories[0])).size, reports.length);
  assert.equal(new Set(reports.map((item) => item.selfCareGuidance.join(" "))).size, reports.length);
  for (const report of reports) {
    assert.deepEqual(report.medicationConsiderations, []);
    assert.match(report.possibleCauses[0].reasoning, /not contain enough evidence/i);
  }
});
