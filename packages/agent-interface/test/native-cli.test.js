import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {parseGlobalOptions, parseNativeCommand} from '../src/commands.js';
import {runCli} from '../src/cli.js';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const parse=async argv=>parseNativeCommand(parseGlobalOptions(argv).args);
const env={...process.env,KOBAN_CONFIG:'none',KOBAN_API_TOKEN:'',KOBAN_BASE_URL:'http://127.0.0.1:1'};

test('root, resource, command, positional and utility help need no backend',async()=>{
 for(const args of [[],['--help'],['transactions'],['transactions','--help'],['transactions','tag','--help'],['transactions','get','txn_1','--help'],['doctor','--help'],['mcp','--help'],['help','sources','import']]){
  const {stdout}=await exec(process.execPath,[cli,...args],{env});assert.match(stdout,/Usage:/);
 }
 const {stdout}=await exec(process.execPath,[cli,'transactions','list','--help'],{env});
 assert.match(stdout,/actionable/);assert.match(stdout,/--account/);
});
test('native requests parse typed flags, aliases, repeats, boolean false and null',async()=>{
 assert.deepEqual((await parse(['transactions','tag','txn_1','--add','work','--add','trip','--remove','other'])).args,{transaction_id:'txn_1',add:['work','trip'],remove:['other']});
 assert.deepEqual((await parse(['transactions','list','--limit=2','--account','acct_1','--reviewed=false','--min-amount','-10'])).args,{limit:2,account_id:'acct_1',reviewed:false,min_amount:-10});
 assert.equal((await parse(['transactions','update','txn_1','--no-reviewed'])).args.reviewed,false);
 assert.equal((await parse(['categories','update','cat_1','--budget-amount','null'])).args.budget_amount,null);
 assert.equal((await parse(['sources','sync','source_gmail'])).operation,'koban_sync_source');
 assert.equal((await parse(['sources','sync'])).operation,'koban_sync_sources');
});
test('rejects malformed, conflicting and duplicate arguments without changing meaning',async()=>{
 for(const args of [
 ['transactions','list','--limit','oops'],['transactions','list','--made-up','x'],
 ['transactions','list','--reviewed','--no-reviewed'],['transactions','get','txn_1','--transaction-id','txn_2'],
 ['transactions','categorize','txn_1','--notes','hello'],['transactions','categorize','txn_1'],
 ['sources','sync','source_gmail','--source-ids','source_outlook_email'],['tools','--nonsense'],['--version','extra']]){
  await assert.rejects(parse(args),{code:'USAGE_ERROR'});
 }
});
test('literal flag-like input is preserved, including terminator and equals syntax',async()=>{
 assert.equal((await parse(['transactions','context','txn_1','--body','--json'])).args.body,'--json');
 assert.equal((await parse(['transactions','context','txn_1','--body=--help'])).args.body,'--help');
 assert.equal((await parse(['search','--','--json'])).args.query,'--json');
});
test('file and stdin imports preserve filename and binary bytes',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'koban-native-input-'));
 try{
  const file=path.join(dir,'receipt.zip');const bytes=Buffer.from([0,255,1,3]);await writeFile(file,bytes);
  const imported=await parse(['sources','import','source_gmail','--file',file,'--filename','custom.zip','--dry-run']);
  assert.deepEqual(Buffer.from(imported.args.content,'base64'),bytes);assert.equal(imported.args.filename,'custom.zip');assert.equal(imported.args.dry_run,true);
  const input=await parseNativeCommand(['transactions','context','txn_1','--file','-'],{readStdin:async()=>Buffer.from('hello\nworld')});assert.equal(input.args.body,'hello\nworld');
  await assert.rejects(parse(['transactions','context','txn_1','--body','old','--file',file]),{code:'USAGE_ERROR'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('native subprocess sends category and tag HTTP contracts and emits clean JSON',async()=>{
 const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push({method:req.method,path:req.url,body:body?JSON.parse(body):undefined});res.setHeader('content-type','application/json');res.end('{"object":"transaction","id":"txn_1"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  for(const args of [['transactions','categorize','txn_1','--category','cat_food'],['transactions','tag','txn_1','--add','work']]){
   const result=await exec(process.execPath,[cli,...args,'--json'],{cwd:os.tmpdir(),env:{...env,KOBAN_BASE_URL:`http://127.0.0.1:${server.address().port}`}});assert.equal(JSON.parse(result.stdout).id,'txn_1');assert.equal(result.stderr,'');
  }
  assert.deepEqual(requests,[{method:'PATCH',path:'/api/v1/transactions/txn_1',body:{category_id:'cat_food'}},{method:'PATCH',path:'/api/v1/transactions/txn_1/tags',body:{add:['work']}}]);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('terminal rendering is readable and strips terminal controls while JSON preserves data',async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'txn_1',merchant_name:'Store\u001b[31m',amount:-10}],has_more:true,total_count:20}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const output=[];const io={log:x=>output.push(x)};const runtime={stdoutIsTTY:true,env:{...env,KOBAN_BASE_URL:`http://127.0.0.1:${server.address().port}`}};
  await runCli(['transactions','list','--limit','1'],io,runtime);assert.match(output[0],/merchant name/);assert.match(output[0],/1 result\(s\) of 20/);assert.doesNotMatch(output[0],/\u001b/);
  output.length=0;await runCli(['transactions','list','--json'],io,runtime);assert.equal(JSON.parse(output[0]).data[0].merchant_name,'Store\u001b[31m');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('usage failure has exit 2, structured stderr and empty stdout',async()=>{
 await assert.rejects(exec(process.execPath,[cli,'transactions','list','--wat','--json'],{env}),e=>{assert.equal(e.code,2);assert.equal(e.stdout,'');assert.equal(JSON.parse(e.stderr).error.code,'USAGE_ERROR');return true;});
});

test('connector setup help and catalog are available without credentials or a backend',async()=>{
 for(const args of [['connectors','--help'],['connectors','login','gmail','--help'],['sources','login','--help']]){
  const {stdout}=await exec(process.execPath,[cli,...args],{env});assert.match(stdout,/--email/);
 }
 const {stdout}=await exec(process.execPath,[cli,'connectors','list','--json'],{env});
 const listed=JSON.parse(stdout);assert.equal(listed.data.length,7);assert.equal(listed.browser_setup.length,4);
});

test('connector grammar rejects unknown flags, missing source and non-status verification',async()=>{
 for(const args of [['connectors','login'],['connectors','add','gmail','--token','secret'],['connectors','setup','gmail','--verify']]) {
  await assert.rejects(parse(args),{code:'USAGE_ERROR'});
 }
 assert.equal((await parse(['connectors','login','gmail','--email','a@example.test','--dry-run'])).options.email,'a@example.test');
});

test('connector login does not run silently from a noninteractive process',async()=>{
 await assert.rejects(exec(process.execPath,[cli,'connectors','login','outlook','--json'],{env}),e=>{
  assert.equal(e.code,2);assert.match(e.stderr,/interactive terminal/);return true;
 });
});

test('remote backend cannot accidentally receive local connector setup',async()=>{
 await assert.rejects(exec(process.execPath,[cli,'connectors','login','gmail','--email','a@example.test','--dry-run','--json'],{env:{...env,KOBAN_BASE_URL:'https://koban.example.test'}}),e=>{
  assert.equal(e.code,2);assert.match(e.stderr,/backend is remote/);return true;
 });
});

test('an unnamed mail login reuses the profile for that address or names one after it',async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'source_gmail__personal',provider:'gmail',profile:'personal',email:'me@example.test'}]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const localEnv={...env,KOBAN_BASE_URL:`http://127.0.0.1:${server.address().port}`};
 try{
  const known=JSON.parse((await exec(process.execPath,[cli,'connectors','login','gmail','--email','Me@Example.test','--dry-run','--json'],{env:localEnv})).stdout);
  assert.equal(known.profile,'personal');assert.equal(known.id,'source_gmail__personal');
  const fresh=JSON.parse((await exec(process.execPath,[cli,'connectors','login','gmail','--email','rohith@sapiex.ai','--dry-run','--json'],{env:localEnv})).stdout);
  assert.equal(fresh.profile,'rohith-sapiex-ai');assert.deepEqual(fresh.planned,['register_profile','interactive_login']);
 }finally{server.close();}
});

test('bank setup has a safe inspectable browser handoff',async()=>{
 const {stdout}=await exec(process.execPath,[cli,'connectors','add','plaid','--dry-run','--json'],{env});
 const result=JSON.parse(stdout);assert.equal(result.setup,'browser');assert.equal(result.url,'http://127.0.0.1:1/settings');
});
