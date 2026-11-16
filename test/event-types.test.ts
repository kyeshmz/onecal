import assert from "node:assert/strict";
import test from "node:test";
import { detectEventType, eventTypeCounts, eventTypeLabel } from "../src/event-types.js";

test("classifies common event kinds", () => {
  assert.equal(detectEventType("AI Hackathon 2026"), "hackathon");
  assert.equal(detectEventType("Manga × AI Conference"), "conference");
  assert.equal(detectEventType("Founders Happy Hour Mixer"), "networking");
  assert.equal(detectEventType("新年会のご案内"), "social");
  assert.equal(detectEventType("Film Screening: Tokyo Story"), "performance");
  assert.equal(detectEventType("Cherry Blossom Festival"), "festival");
  assert.equal(detectEventType("JCCNC Seminar: AI in Japan"), "seminar");
  assert.equal(detectEventType("Product Demo Day"), "pitch");
  assert.equal(detectEventType("AI 101 Workshop"), "workshop");
  assert.equal(detectEventType("Book Club"), "other");
});

test("uses the description when the title has no signal", () => {
  assert.equal(
    detectEventType("Quarterly gathering", "Join our first hackathon and build something."),
    "hackathon",
  );
  assert.equal(
    detectEventType("Community gathering", "A hands-on workshop for beginners."),
    "workshop",
  );
});

test("prefers the title when signals conflict", () => {
  assert.equal(
    detectEventType("AI Conference", "The closing night includes a hackathon."),
    "conference",
  );
});

test("exposes labels and counts", () => {
  assert.equal(eventTypeLabel("hackathon"), "Hackathon");
  assert.deepEqual(eventTypeCounts([{ eventType: "meetup" }, { eventType: "meetup" }, { eventType: "other" }]), [
    { code: "meetup", label: "Meetup", count: 2 },
    { code: "other", label: "Other", count: 1 },
  ]);
});
