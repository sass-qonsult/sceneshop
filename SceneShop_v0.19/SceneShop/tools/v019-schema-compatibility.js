#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { listMigrationManifest, validateMigrationManifest } = require('../server/data/migration-manifest');

function migrationSetSha256(entries) {
  return crypto.createHash('sha256').update(entries.map((x) => `${x.version}:${x.checksum}`).join('\n')).digest('hex');
}
function git(rootDir,args,{allowFailure=false}={}){try{return execFileSync('git',args,{cwd:rootDir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch(e){if(allowFailure)return null;throw e;}}
async function inspectStaticCompatibility({ rootDir = path.join(__dirname,'..') } = {}) {
  const contract = JSON.parse(fs.readFileSync(path.join(rootDir,'docs/release/V0_19_RELEASE_CONTRACT_R0_1.json'),'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir,'package.json'),'utf8'));
  const entries = await listMigrationManifest(path.join(rootDir,'server/data/migrations'));
  const manifest = validateMigrationManifest(entries);
  const setSha = migrationSetSha256(entries);
  const baseTag = 'v0.18.0-beta.1-rcprep.1';
  const migrationDiff = git(rootDir,['diff','--name-only',`${baseTag}..HEAD`,'--','server/data/migrations'],{allowFailure:true});
  const reasons=[];
  if(pkg.version!==contract.packageVersion) reasons.push(`package version mismatch: ${pkg.version} != ${contract.packageVersion}`);
  if(manifest.count!==contract.database.migrationCount) reasons.push(`migration count mismatch: ${manifest.count} != ${contract.database.migrationCount}`);
  if(manifest.latest!==contract.database.latestMigration) reasons.push(`latest migration mismatch: ${manifest.latest} != ${contract.database.latestMigration}`);
  if(setSha!==contract.database.migrationSetSha256) reasons.push(`migration set sha256 mismatch: ${setSha}`);
  const rollbackCompatible = migrationDiff !== null && migrationDiff.trim()==='' && contract.database.schemaChangesFromV018Beta1===false;
  if(!rollbackCompatible) reasons.push(`rollback compatibility broken: migration changes since ${baseTag}: ${migrationDiff || 'base tag unavailable'}`);
  return {ok:reasons.length===0,reasons,packageVersion:pkg.version,contract,manifest,migrationSetSha256:setSha,rollback:{baseTag,migrationDiff:migrationDiff||'',compatible:rollbackCompatible}};
}
async function inspectLiveDatabase(url,{rootDir=path.join(__dirname,'..')}={}){
  if(!url) return {ok:false,skipped:true,reasons:['database URL missing']};
  let pg; try{pg=require('pg');}catch(e){return {ok:false,skipped:false,reasons:[`pg package unavailable: ${e.message}`]};}
  const staticReport=await inspectStaticCompatibility({rootDir});
  const client=new pg.Client({connectionString:url});
  try{
    await client.connect();
    const result=await client.query('SELECT version, checksum FROM sceneshop_schema_migrations ORDER BY version');
    const expected=await listMigrationManifest(path.join(rootDir,'server/data/migrations'));
    const reasons=[];
    if(result.rows.length!==expected.length) reasons.push(`database migration count ${result.rows.length} != ${expected.length}`);
    for(let i=0;i<expected.length;i++){
      const actual=result.rows[i], exp=expected[i];
      if(!actual){reasons.push(`missing database migration ${exp.version}`);continue;}
      if(actual.version!==exp.version) reasons.push(`migration version mismatch at ${i}: ${actual.version} != ${exp.version}`);
      if(actual.checksum!==exp.checksum) reasons.push(`migration checksum mismatch: ${exp.version}`);
    }
    return {ok:reasons.length===0 && staticReport.ok,skipped:false,reasons,rows:result.rows.length,latest:result.rows.at(-1)?.version||null,staticOk:staticReport.ok};
  } finally { await client.end().catch(()=>{}); }
}
async function buildSchemaCompatibility({rootDir=path.join(__dirname,'..'),live=false,databaseUrl=''}={}){
  const staticReport=await inspectStaticCompatibility({rootDir});
  const liveReport=live?await inspectLiveDatabase(databaseUrl,{rootDir}):{ok:null,skipped:true,reasons:['live check not requested']};
  return {schemaVersion:1,gate:'SceneShop v0.19 schema compatibility',ok:staticReport.ok && (!live || liveReport.ok===true),gitCommit:git(rootDir,['rev-parse','HEAD']),packageVersion:staticReport.packageVersion,generatedAt:new Date().toISOString(),static:staticReport,live:liveReport};
}
async function buildEphemeralLiveCompatibility({rootDir,databaseUrl}){
  if(!databaseUrl) return buildSchemaCompatibility({rootDir,live:true,databaseUrl:''});
  const { PostgresStateRepository }=require('../server/data/postgres-state');
  const { scopedPostgresUrl, dropPostgresSchema }=require('./live-data-plane-validation');
  const schema=`sceneshop_rc19_${process.pid}_${Date.now()}`; const scoped=scopedPostgresUrl(databaseUrl,schema); let repo;
  try{const pg=require('pg');const admin=new pg.Client({connectionString:databaseUrl});await admin.connect();try{await admin.query(`CREATE SCHEMA "${schema}"`);}finally{await admin.end().catch(()=>{});}
    repo=new PostgresStateRepository({connectionString:scoped});await repo.init();await repo.close();repo=null;return await buildSchemaCompatibility({rootDir,live:true,databaseUrl:scoped});}
  finally{if(repo)await repo.close().catch(()=>{});await dropPostgresSchema(databaseUrl,schema).catch(()=>{});}
}
async function main(){
  const rootDir=path.join(__dirname,'..'); const live=process.argv.includes('--live'); const requireLive=process.argv.includes('--require-live'); const ephemeral=process.argv.includes('--ephemeral');
  const databaseUrl=process.env.RC_DATABASE_URL||process.env.LIVE_DATABASE_URL||process.env.DATABASE_URL||''; const report=ephemeral?await buildEphemeralLiveCompatibility({rootDir,databaseUrl}):await buildSchemaCompatibility({rootDir,live:live||requireLive,databaseUrl});
  const outArg=process.argv.find(x=>x.startsWith('--out=')); const text=JSON.stringify(report,null,2)+'\n'; if(outArg){const p=path.resolve(rootDir,outArg.slice(6));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);} process.stdout.write(text);
  if(!report.static.ok || (requireLive && report.live.ok!==true)) process.exitCode=2;
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={migrationSetSha256,inspectStaticCompatibility,inspectLiveDatabase,buildSchemaCompatibility,buildEphemeralLiveCompatibility};
