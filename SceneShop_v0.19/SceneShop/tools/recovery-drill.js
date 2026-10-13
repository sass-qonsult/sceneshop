#!/usr/bin/env node
const { PostgresStateRepository } = require('../server/data/postgres-state');
const { collectRecoveryManifest, PostgresRecoveryRepository, compareRecoveryManifest } = require('../server/operations/recovery-postgres');

function need(name) { const v=process.env[name]; if(!v) throw new Error(`${name} é obrigatório.`); return v; }
async function open(url) { const repo=new PostgresStateRepository({ connectionString:url }); await repo.init(); return repo; }

async function createCheckpoint() {
  const primary=await open(need('DATABASE_URL'));
  try {
    const recovery=new PostgresRecoveryRepository({ store: primary });
    const row=await recovery.createCheckpoint({ metadata:{ createdBy:'tools/recovery-drill.js', purpose:'backup_restore_verification' } });
    console.log(JSON.stringify({ ok:true, mode:'checkpoint', checkpoint:row }, null, 2));
  } finally { await primary.close(); }
}

async function verifyCheckpoint(id) {
  const primary=await open(need('DATABASE_URL'));
  const restored=await open(need('RECOVERY_DATABASE_URL'));
  try {
    const recovery=new PostgresRecoveryRepository({ store: primary });
    const checkpoint=await recovery.get(id);
    if(!checkpoint) throw new Error(`Checkpoint ${id} não encontrado no primário.`);
    const restoredCheckpoint=await restored.readDomain(async c=>{const q=await c.query('SELECT id,manifest FROM sceneshop_recovery_checkpoints WHERE id=$1',[id]);return q.rowCount?q.rows[0]:null;});
    if(!restoredCheckpoint) throw new Error(`Checkpoint ${id} não existe no restore; o backup é anterior ao checkpoint ou a restauração está incompleta.`);
    const actual=await collectRecoveryManifest(restored);
    const comparison=compareRecoveryManifest(checkpoint.manifest, actual);
    const verification={ restoreContainsCheckpoint:true, comparison, restoredManifest:actual, verifiedAt:new Date().toISOString() };
    await recovery.mark(id, comparison.ok?'VERIFIED':'FAILED', verification);
    console.log(JSON.stringify({ ok:comparison.ok, mode:'verify', checkpointId:id, verification }, null, 2));
    if(!comparison.ok) process.exitCode=2;
  } finally { await Promise.allSettled([primary.close(),restored.close()]); }
}

async function main(){
  const arg=process.argv.slice(2).find(x=>x.startsWith('--verify='));
  if(arg) return verifyCheckpoint(arg.slice('--verify='.length));
  if(process.argv.includes('--checkpoint')) return createCheckpoint();
  throw new Error('Use --checkpoint ou --verify=<checkpointId>.');
}
if(require.main===module) main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={ createCheckpoint, verifyCheckpoint };
