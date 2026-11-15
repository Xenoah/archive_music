import {run} from './lib.mjs';
const repo=process.env.GITHUB_REPOSITORY||'Xenoah/archive_music';
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error('Invalid repository');
try{run('gh',['auth','status']);}catch{throw new Error('Authenticate GitHub CLI first: gh auth login');}
let existing=false;
try{run('gh',['api',`repos/${repo}/pages`]);existing=true;}catch(e){if(!e.message.includes('404'))throw e;}
console.log(run('gh',['api','--method',existing?'PUT':'POST',`repos/${repo}/pages`,'-f','build_type=workflow']));
console.log(run('gh',['workflow','run','publish.yml','--repo',repo,'--ref','main']));
console.log(`Pages enabled. Watch deployment: gh run list --repo ${repo}`);
