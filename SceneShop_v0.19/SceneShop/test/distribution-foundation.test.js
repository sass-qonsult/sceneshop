const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "../server/data/migrations/0009_distribution_commerce_sync_foundation.sql"), "utf8");
const viewerSql = fs.readFileSync(path.join(__dirname, "../server/data/migrations/0011_playback_viewer_state.sql"), "utf8");

test("distribution foundation: três modos oficiais são constraints do schema", () => {
  for (const mode of ["PARTNER_NATIVE", "COMPANION", "EMBEDDED"]) assert.match(sql, new RegExp(mode));
});

test("distribution foundation: Playback Head é compartilhado e Browse Head é por viewer", () => {
  assert.match(sql, /playback_position/i);
  assert.match(viewerSql, /sceneshop_playback_viewers/i);
  assert.match(viewerSql, /PRIMARY KEY \(session_id, device_id\)/i);
  assert.match(viewerSql, /browse_position/i);
  assert.match(viewerSql, /state IN \('LIVE','BROWSING'\)/);
});

test("distribution foundation: timeline incorpora política de spoilers", () => {
  for (const policy of ["PAST_ONLY", "PAST_AND_CURRENT", "FULL"]) assert.match(sql, new RegExp(policy));
});

test("distribution foundation: commerce destination é independente do player", () => {
  assert.match(sql, /sceneshop_commerce_providers/);
  assert.match(sql, /sceneshop_external_offers/);
  assert.match(sql, /sceneshop_offer_routing_policies/);
});

test("distribution foundation: fingerprint armazena metadado temporal e não mídia bruta", () => {
  assert.match(sql, /fingerprint_hash/);
  assert.match(sql, /start_seconds/);
  assert.match(sql, /end_seconds/);
  assert.doesNotMatch(sql, /audio_blob|video_blob|media_blob/i);
});
