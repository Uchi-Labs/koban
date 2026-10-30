import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {readShopCookieFile,readShopCookieFromChrome,requestShopSession} from '../src/shop-session.js';

test('Shop session export filters out unrelated cookies and never returns their values',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'koban-shop-'));
 try{
  const file=path.join(root,'cookies.json');
  await writeFile(file,JSON.stringify([{domain:'.shop.app',name:'session',value:'shop-test-value'},{domain:'elsewhere.example',name:'secret',value:'unrelated-test-value'}]));
  assert.equal(await readShopCookieFile(file),'session=shop-test-value');
  await writeFile(file,'Cookie: session=shop-test-value\n');assert.equal(await readShopCookieFile(file),'session=shop-test-value');
  await writeFile(file,'session=value\r\nInjected: value');await assert.rejects(readShopCookieFile(file),{code:'USAGE_ERROR'});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Shop session transport sends secrets only in the authenticated body and returns whitelisted status',async()=>{
 const token='backend-test-token';const cookie='session=shop-test-value';let called=0;
 const result=await requestShopSession({baseUrl:'http://127.0.0.1:3007',token},{cookie,fetchImpl:async(url,opts)=>{
  called++;assert.equal(url.pathname,'/api/v1/sources/source_shop_orders/session');assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');assert.equal(opts.headers.authorization,`Bearer ${token}`);assert.deepEqual(JSON.parse(opts.body),{cookie});
  return Response.json({configured:true,live_access:'not_checked',cookie,token});
 }});
 assert.equal(called,1);assert.deepEqual(result,{configured:true,live_access:'not_checked'});
});

test('Shop session transport does not leak upstream errors or retry failed writes',async()=>{
 let calls=0;
 await assert.rejects(requestShopSession({baseUrl:'http://127.0.0.1:3007'},{cookie:'session=secret',fetchImpl:async()=>{calls++;throw new Error('secret');}}),e=>{assert.equal(e.code,'SHOP_SESSION_ERROR');assert.doesNotMatch(e.message,/session=secret/);return true;});
 assert.equal(calls,1);
});

test('Chrome session import builds the Cookie header and explains missing tools or sessions',async()=>{
 const run=async(binary,args)=>{assert.equal(binary,'pycookiecheat');assert.deepEqual(args,['https://shop.app']);return {stdout:JSON.stringify({_shop_app_essential:'a',_shop_app_session:'b'})};};
 assert.equal(await readShopCookieFromChrome({run}),'_shop_app_essential=a; _shop_app_session=b');
 await assert.rejects(readShopCookieFromChrome({run:async()=>{throw Object.assign(new Error('spawn'),{code:'ENOENT'});}}),/needs pycookiecheat/);
 await assert.rejects(readShopCookieFromChrome({run:async()=>({stdout:'{}'})}),/no shop.app cookies/);
});
