class PostgresPlaybackRepository {
  constructor({ store }) { this.store = store; }

  enabled() { return this.store.backendKind() === 'postgres'; }

  async createSession(session) {
    if (!this.enabled()) return null;
    return this.store.writeDomain(async (client) => {
      await client.query(
        `INSERT INTO sceneshop_playback_sessions
          (id,work_id,binding_id,mode,client_surface,state,playback_position,playback_observed_at,
           browse_position,browse_scene_id,sync_confidence,last_sync_at,expires_at,metadata,updated_at)
         VALUES($1,$2,$3,$4,$5,'LIVE',$6,to_timestamp($7/1000.0),$6,NULL,$8,$9,
                now()+interval '4 hours',$10::jsonb,now())
         ON CONFLICT(id) DO UPDATE SET
           work_id=EXCLUDED.work_id,binding_id=EXCLUDED.binding_id,mode=EXCLUDED.mode,
           playback_position=EXCLUDED.playback_position,playback_observed_at=EXCLUDED.playback_observed_at,
           sync_confidence=EXCLUDED.sync_confidence,last_sync_at=EXCLUDED.last_sync_at,
           expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata,updated_at=now()`,
        [session.code, session.workId, session.bindingId || null, session.mode || 'PARTNER_NATIVE',
         'MOBILE_APP', Number(session.playbackPosition ?? session.time ?? 0), Number(session.playbackObservedAt || Date.now()),
         session.syncConfidence == null ? null : Number(session.syncConfidence),
         session.lastSyncAt ? new Date(session.lastSyncAt) : null,
         JSON.stringify({ publicCode: session.code, trackId: session.trackId || null, partnerId: session.partnerId || null })]
      );
      return { id: session.code };
    });
  }

  async checkpoint(session) {
    if (!this.enabled() || !session) return null;
    return this.store.writeDomain(async (client) => {
      await client.query(
        `UPDATE sceneshop_playback_sessions SET
           playback_position=$2, playback_observed_at=to_timestamp($3/1000.0),
           sync_confidence=$4,last_sync_at=$5,expires_at=now()+interval '4 hours',
           metadata=COALESCE(metadata,'{}'::jsonb) || $6::jsonb,updated_at=now()
         WHERE id=$1`,
        [session.code, Number(session.playbackPosition ?? session.time ?? 0), Number(session.playbackObservedAt || Date.now()),
         session.syncConfidence == null ? null : Number(session.syncConfidence),
         session.lastSyncAt ? new Date(session.lastSyncAt) : null,
         JSON.stringify({ trackId: session.trackId || null, partnerId: session.partnerId || null, sceneId: session.sceneId || null })]
      );
      return { id: session.code };
    });
  }

  async recordSync(session, observation = {}) {
    if (!this.enabled() || !session) return null;
    return this.store.writeDomain(async (client) => {
      await client.query(
        `UPDATE sceneshop_playback_sessions SET
           playback_position=$2,playback_observed_at=to_timestamp($3/1000.0),sync_confidence=$4,
           last_sync_at=to_timestamp($5/1000.0),expires_at=now()+interval '4 hours',updated_at=now()
         WHERE id=$1`,
        [session.code, Number(session.playbackPosition ?? session.time ?? 0), Number(session.playbackObservedAt || Date.now()),
         session.syncConfidence == null ? null : Number(session.syncConfidence), Number(session.lastSyncAt || Date.now())]
      );
      await client.query(
        `INSERT INTO sceneshop_sync_observations
          (session_id,source,recognized_sync_id,position_seconds,confidence,fingerprint_id,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [session.code, observation.source || 'COMPANION', observation.recognizedSyncId || null,
         Number(session.playbackPosition ?? session.time ?? 0),
         session.syncConfidence == null ? null : Number(session.syncConfidence), observation.fingerprintId || null,
         JSON.stringify(observation.metadata || {})]
      );
      return { id: session.code };
    });
  }
  async recordViewerState(session, viewer) {
    if (!this.enabled() || !session || !viewer || !viewer.deviceId) return null;
    return this.store.writeDomain(async (client) => {
      await client.query(
        `INSERT INTO sceneshop_playback_viewers
          (session_id,device_id,state,browse_position,browse_scene_id,updated_at)
         VALUES($1,$2,$3,$4,$5,now())
         ON CONFLICT(session_id,device_id) DO UPDATE SET
           state=EXCLUDED.state,browse_position=EXCLUDED.browse_position,
           browse_scene_id=EXCLUDED.browse_scene_id,updated_at=now()`,
        [session.code, viewer.deviceId, viewer.state || 'LIVE',
         Number(viewer.browsePosition ?? session.playbackPosition ?? session.time ?? 0),
         viewer.browseSceneId || null]
      );
      return { sessionId: session.code, deviceId: viewer.deviceId, state: viewer.state || 'LIVE' };
    });
  }

  async getViewerState(sessionId, deviceId) {
    if (!this.enabled() || !sessionId || !deviceId) return null;
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT device_id,state,browse_position,browse_scene_id,updated_at
         FROM sceneshop_playback_viewers WHERE session_id=$1 AND device_id=$2`,
        [sessionId, deviceId]
      );
      if (!r.rowCount) return null;
      const row = r.rows[0];
      return {
        deviceId: row.device_id, state: row.state,
        browsePosition: row.browse_position == null ? null : Number(row.browse_position),
        browseSceneId: row.browse_scene_id || null, updatedAt: row.updated_at,
      };
    });
  }

}

module.exports = { PostgresPlaybackRepository };
