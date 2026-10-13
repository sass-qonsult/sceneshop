#!/usr/bin/env node
'use strict';
const path=require('node:path');const {execFileSync}=require('node:child_process');const {buildRcManifest}=require('./v019-rc-manifest');
const DEFAULT_BRANCH='release/v0.19';const DEFAULT_TAG='v0.19.0-rc.1';
function git(root,args,{allowFailure=false}={}){try{return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch(e){if(allowFailure)return null;throw new Error(String(e.stderr||e.message).trim());}}
function resolveRef(root,ref){return git(root,['rev-parse','--verify',ref],{allowFailure:true});}
function buildPromotionPlan({rootDir,manifest,branch=DEFAULT_BRANCH,tag=DEFAULT_TAG}={}){
 const blockers=[...(manifest.blockers||[])];const head=manifest.gitCommit;
 if(manifest.eligible!==true)blockers.push('v0.19 RC manifest is not eligible');
 if(manifest.candidateVersion!=='0.19.0-rc.1')blockers.push(`package version must be 0.19.0-rc.1, found ${manifest.candidateVersion}`);
 const branchCommit=resolveRef(rootDir,`refs/heads/${branch}`);const tagCommit=resolveRef(rootDir,`refs/tags/${tag}^{}`);
 if(branchCommit&&branchCommit!==head)blockers.push(`${branch} already points to ${branchCommit}, expected ${head}`);
 if(tagCommit&&tagCommit!==head)blockers.push(`${tag} already points to ${tagCommit}, expected ${head}`);
 return{schemaVersion:1,release:'SceneShop v0.19 RC promotion',gitCommit:head,candidateVersion:manifest.candidateVersion,branch,tag,branchState:branchCommit?(branchCommit===head?'ALREADY_AT_HEAD':'CONFLICT'):'CREATE',tagState:tagCommit?(tagCommit===head?'ALREADY_AT_HEAD':'CONFLICT'):'CREATE',eligible:blockers.length===0,blockers};
}
function applyPromotion(root,plan){if(!plan.eligible)throw new Error(`promotion blocked: ${plan.blockers.join('; ')}`);if(plan.branchState==='CREATE')git(root,['branch',plan.branch,plan.gitCommit]);if(plan.tagState==='CREATE')git(root,['tag','-a',plan.tag,plan.gitCommit,'-m','SceneShop v0.19.0-rc.1 — Release Candidate']);return{branchCommit:resolveRef(root,`refs/heads/${plan.branch}`),tagCommit:resolveRef(root,`refs/tags/${plan.tag}^{}`)};}
async function main(){const root=path.join(__dirname,'..');const apply=process.argv.includes('--apply');const manifest=await buildRcManifest({rootDir:root});const plan=buildPromotionPlan({rootDir:root,manifest});if(!apply||!plan.eligible){process.stdout.write(JSON.stringify({mode:apply?'apply':'dry-run',...plan},null,2)+'\n');if(!plan.eligible)process.exitCode=2;return;}const applied=applyPromotion(root,plan);const result={mode:'apply',...plan,applied};if(applied.branchCommit!==plan.gitCommit||applied.tagCommit!==plan.gitCommit){result.eligible=false;result.blockers=[...result.blockers,'post-promotion ref verification failed'];process.exitCode=3;}process.stdout.write(JSON.stringify(result,null,2)+'\n');}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={DEFAULT_BRANCH,DEFAULT_TAG,resolveRef,buildPromotionPlan,applyPromotion};
