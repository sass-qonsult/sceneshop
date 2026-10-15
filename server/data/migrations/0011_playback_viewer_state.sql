-- SceneShop v0.9 alpha.8: viewer commerce state is per device, never global.
-- PlaybackSession keeps the shared Playback Head. Browse Head belongs to each
-- viewer and may diverge while the primary video keeps playing.

CREATE TABLE IF NOT EXISTS sceneshop_playback_viewers (
  session_id TEXT NOT NULL REFERENCES sceneshop_playback_sessions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'LIVE' CHECK (state IN ('LIVE','BROWSING')),
  browse_position NUMERIC(14,3),
  browse_scene_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_sceneshop_playback_viewers_session_state
  ON sceneshop_playback_viewers(session_id, state, updated_at DESC);

COMMENT ON COLUMN sceneshop_playback_sessions.state IS
  'Compatibility field. Viewer LIVE/BROWSING authority is sceneshop_playback_viewers.state.';
COMMENT ON COLUMN sceneshop_playback_sessions.browse_position IS
  'Compatibility field. Browse Head authority is per viewer in sceneshop_playback_viewers.';
COMMENT ON COLUMN sceneshop_playback_sessions.browse_scene_id IS
  'Compatibility field. Browse scene authority is per viewer in sceneshop_playback_viewers.';
