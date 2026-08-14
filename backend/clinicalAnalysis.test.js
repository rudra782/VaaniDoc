import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSymptoms } from "./geminiService.js";

const cases = [
  ["cardiac", "I have severe chest pressure and pain going to my left arm.", "Cardiovascular", /arm|chest/i],
  ["respiratory", "I have cough, fever and shortness of breath for 3 days.", "Respiratory", /breath|cough/i],
  ["gastrointestinal", "I have stomach pain and vomited 4 times today.", "Gastrointestinal", /vomit|fluid|hydrat/i],
  ["dermatology", "I have itchy red rash on my arms for two days.", "Dermatological", /rash|skin|irritant/i],
  ["musculoskeletal", "I hurt my knee while playing football.", "Musculoskeletal", /knee|injury|weight/i],
];

test("offline analysis produces patient-specific Copilot content", async () => {
  const results = [];
  for (const [name, narration, category, expectedText] of cases) {
    const analysis = await analyzeSymptoms(narration, "English", {});
    assert.ok(analysis.symptomCategories.includes(category), `${name} category`);
    assert.equal(analysis.smartQuestions.length, 3, `${name} questions`);
    assert.match(
      `${analysis.clinicalSummary} ${analysis.smartQuestions.join(" ")} ${analysis.treatmentDraft}`,
      expectedText,
      `${name} content`,
    );
    assert.ok(Array.isArray(analysis.redFlags), `${name} red flags`);
    results.push(analysis.clinicalSummary);
  }
  assert.equal(new Set(results).size, cases.length, "every assessment is distinct");
});
