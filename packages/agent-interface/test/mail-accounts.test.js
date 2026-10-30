import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {mailSourceId,requestMailAccounts} from '../src/mail-accounts.js';
const exec=promisify(execFile);const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const env={...process.env,KOBAN_CONFIG:'none',KOBAN_API_TOKEN:'',KOBAN_BASE_URL:'http://127.0.0.1:1'};
test('mail profile identities are provider scoped and reject path traversal',()=>{
 assert.equal(mailSourceId('gmail','personal'),'source_gmail__personal');
 assert.equal(mailSourceId('outlook','personal'),'source_outlook_email__personal');
 assert.equal(mailSourceId('icloud','personal'),'source_icloud_mail__personal');
 assert.throws(()=>mailSourceId('gmail','../work'));assert.throws(()=>mailSourceId('amazon','work'));
});
test('account transport does not echo passwords even if backend returns one',async()=>{
 const account=await requestMailAccounts({baseUrl:'http://127.0.0.1:3007'},{account:{provider:'icloud',profile:'p',email:'p@example.test',app_password:'fixture-secret'},fetchImpl:async(_url,opts)=>{
  assert.equal(JSON.parse(opts.body).app_password,'fixture-secret');assert.equal(opts.redirect,'error');return Response.json({id:'source_icloud_mail__p',provider:'icloud',profile:'p',email:'p@example.test',appPassword:'fixture-secret'});
 }});assert.equal(account.id,'source_icloud_mail__p');assert.equal(JSON.stringify(account).includes('fixture-secret'),false);
});
test('iCloud profile dry run needs no backend or password file',async()=>{
 const r=await exec(process.execPath,[cli,'connectors','add','icloud','--profile','personal','--email','p@icloud.com','--password-file','/nonexistent','--dry-run','--json'],{env});
 assert.deepEqual(JSON.parse(r.stdout).executed,[]);
});
test('profile flag routes sync to its exact source ID',async()=>{
 let observed;const server=http.createServer((req,res)=>{observed=req.url;res.setHeader('content-type','application/json');res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await exec(process.execPath,[cli,'sources','sync','gmail','--profile','work','--json'],{env:{...env,KOBAN_BASE_URL:`http://127.0.0.1:${server.address().port}`}});assert.equal(observed,'/api/v1/sources/source_gmail__work/sync-runs');}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
