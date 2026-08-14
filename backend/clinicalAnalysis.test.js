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
  }
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
