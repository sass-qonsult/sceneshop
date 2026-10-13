#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {collectPreflight}=require('./release-preflight');
const {buildReleaseContractReport}=require('./v019-release-contract');
const {validateCommon,validateBuildEvidence,validateSigningEvidence,loadQaEvidence,latestMatching,readJson}=require('./v018-production-beta-manifest');
function git(root,args){return execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}
function clean(root){return git(root,['status','--porcelain'])==='';}
async function buildRcManifest({rootDir=path.join(__dirname,'..'),artifactsDir=path.join(rootDir,'artifacts')}={}){
  const pkg=JSON.parse(fs.readFileSync(path.join(rootDir,'package.json'),'utf8'));
  const matrix=JSON.parse(fs.readFileSync(path.join(rootDir,'docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json'),'utf8'));
  const commit=git(rootDir,['rev-parse','HEAD']);
  const preflight=await collectPreflight({rootDir}); const contract=await buildReleaseContractReport({rootDir});
  const foundation=latestMatching(path.join(artifactsDir,'foundation-gate'),n=>n.startsWith('foundation-evidence-')&&n.endsWith('.json'));
  const recovery=latestMatching(path.join(artifactsDir,'recovery-gate'),n=>n.startsWith('recovery-evidence-')&&n.endsWith('.json'));
  const schemaPath=path.join(artifactsDir,'rc-gate','schema-compatibility.json');
  const foundationCheck=validateCommon(foundation?.data,{gitCommit:commit,packageVersion:pkg.version,gateIncludes:'foundation'});
  const recoveryCheck=validateCommon(recovery?.data,{gitCommit:commit,packageVersion:pkg.version,gateIncludes:'recovery'});
  const schemaEvidence=fs.existsSync(schemaPath)?readJson(schemaPath):null;
  const schemaReasons=[]; if(!schemaEvidence) schemaReasons.push('missing evidence'); else {if(schemaEvidence.ok!==true)schemaReasons.push('schema evidence did not report ok=true');if(schemaEvidence.gitCommit!==commit)schemaReasons.push(`gitCommit mismatch: ${schemaEvidence.gitCommit||'missing'} != ${commit}`);if(schemaEvidence.packageVersion!==pkg.version)schemaReasons.push(`packageVersion mismatch: ${schemaEvidence.packageVersion||'missing'} != ${pkg.version}`);if(schemaEvidence.live?.ok!==true)schemaReasons.push('live schema verification required');if(schemaEvidence.static?.rollback?.compatible!==true)schemaReasons.push('rollback compatibility required');}
  const builds={}; for(const platform of ['desktop','android','ios']){const f=path.join(artifactsDir,'native-build',`${platform}.json`);builds[platform]=validateBuildEvidence(fs.existsSync(f)?readJson(f):null,{platform,gitCommit:commit,packageVersion:pkg.version});}
  const signedBuilds={}; for(const platform of ['android','ios']){const f=path.join(artifactsDir,'native-build',`${platform}-signed.json`);signedBuilds[platform]=validateBuildEvidence(fs.existsSync(f)?readJson(f):null,{platform,gitCommit:commit,packageVersion:pkg.version,requireSigned:true});}
  const signingPath=path.join(artifactsDir,'native-signing','report.json'); const signing=validateSigningEvidence(fs.existsSync(signingPath)?readJson(signingPath):null,{gitCommit:commit,packageVersion:pkg.version});
  const qa=loadQaEvidence(path.join(artifactsDir,'app-qa','executions'),matrix,{gitCommit:commit,packageVersion:pkg.version});
  const blockers=[];
  if(pkg.version!=='0.19.0-rc.1') blockers.push(`package version must be 0.19.0-rc.1, found ${pkg.version}`);
  if(!preflight.lockfile.ok) blockers.push('strict dependency lock invalid'); if(!preflight.productionDependencies.ok) blockers.push('production dependencies incomplete');
  if(!contract.ok) blockers.push(`release contract invalid: ${contract.reasons.join('; ')}`);
  if(!foundationCheck.ok) blockers.push(`foundation evidence invalid: ${foundationCheck.reasons.join('; ')}`);
  if(!recoveryCheck.ok) blockers.push(`recovery evidence invalid: ${recoveryCheck.reasons.join('; ')}`);
  if(schemaReasons.length) blockers.push(`schema compatibility evidence invalid: ${schemaReasons.join('; ')}`);
  for(const p of ['desktop','android','ios']) if(!builds[p].ok) blockers.push(`${p} build evidence invalid: ${builds[p].reasons.join('; ')}`);
  if(!qa.ok) blockers.push(`QA evidence incomplete: missing=[${qa.missing.join(',')}], invalid=[${qa.invalid.join(',')}]`);
  if(!signing.ok) blockers.push(`production signing invalid: ${signing.reasons.join('; ')}`);
  for(const p of ['android','ios']) if(!signedBuilds[p].ok) blockers.push(`signed ${p} build invalid: ${signedBuilds[p].reasons.join('; ')}`);
  if(!clean(rootDir)) blockers.push('git worktree is not clean');
  return {schemaVersion:1,release:'SceneShop v0.19 Release Candidate',candidateVersion:pkg.version,gitCommit:commit,generatedAt:new Date().toISOString(),eligible:blockers.length===0,blockers,source:{migrationCount:preflight.migrations.count,latestMigration:preflight.migrations.latest,nodeEngine:preflight.lockfile.nodeEngine.declared},gates:{contract,foundation:foundationCheck,recovery:recoveryCheck,schemaCompatibility:{ok:schemaReasons.length===0,reasons:schemaReasons,evidence:schemaEvidence},builds,qa,productionSigning:signing,signedBuilds}};
}
async function main(){const root=path.join(__dirname,'..');const requireEligible=process.argv.includes('--require-eligible');const outArg=process.argv.find(x=>x.startsWith('--out='));const m=await buildRcManifest({rootDir:root});const text=JSON.stringify(m,null,2)+'\n';if(outArg){const p=path.resolve(root,outArg.slice(6));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}process.stdout.write(text);if(requireEligible&&!m.eligible)process.exitCode=2;}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={buildRcManifest};
