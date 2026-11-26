const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture(){
  const nodes=new Map(),calls={sign:[],rpc:[],queries:[],upload:[]};
  function element(){
    const classes=new Set();
    const el={value:'',innerHTML:'',textContent:'',dataset:{},files:[],disabled:false,open:false,children:[],
      classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x)}},
      addEventListener(){},querySelectorAll(){return []},querySelector(){return this.child??=(element())},closest(){return null},reset(){},focus(){},
      appendChild(node){this.children.push(node)},setAttribute(key,value){this[key]=value},removeAttribute(key){delete this[key]},close(){this.open=false},showModal(){this.open=true}};
    return el;
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
  let queryResult={data:[],error:null};
  const sb={auth:{signOut:async()=>({error:null}),signInWithPassword:async()=>({error:null})},
    rpc:async(name,payload)=>{calls.rpc.push({name,payload});return {error:null}},
    storage:{from:()=>({createSignedUrl:async(path)=>{calls.sign.push(path);return {data:{signedUrl:'https://storage.test/'+path},error:null}},upload:async(path,file,options)=>{calls.upload.push({path,file,options});return {error:null}}})},
    from(table){calls.queries.push(table);const q={};for(const method of ['select','eq','order','limit','maybeSingle','single','upsert','insert','update'])q[method]=()=>q;q.then=(resolve,reject)=>Promise.resolve(typeof queryResult==='function'?queryResult(table):queryResult).then(resolve,reject);return q}
  };
  const context={window:{supabaseClient:sb},document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){},createElement:element},
    console,Intl,Date,setTimeout,clearTimeout,setInterval(){},URL,Image:class{},confirm:()=>true};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('runtime.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'),context);
  const run=code=>vm.runInContext(code,context);
  run("session={user:{id:'user-a'}};profile={role:'admin',active:true};authReady=true");
  return {run,node,calls,sb,context,setQuery(result){queryResult=result}};
}

test('historial sin firmas ni imágenes; comprobante solo al pulsar',async()=>{
  const f=fixture();f.run("activePage='historial';cuts=[{id:'c',created_at:'2026-11-04T20:00:00Z',receipt_path:'a.jpg',price:20}]");
  await f.run('renderHistory()');assert.equal(f.calls.sign.length,0);
  assert.match(f.node('historyBody').children[0].querySelector().innerHTML,/Ver comprobante/);
  assert.doesNotMatch(f.node('historyBody').children[0].innerHTML,/<img/);
  const button={dataset:{receiptPath:'a.jpg'},disabled:false};f.context.click={target:{closest:()=>button}};
  await f.run('viewReceipt(click)');assert.equal(f.calls.sign.length,1);assert.equal(f.node('qrDialog').open,true);
});
test('firmas concurrentes y repetidas se comparten; vencimiento genera nueva firma',async()=>{
  const f=fixture();await f.run("Promise.all([signedUrl('a'),signedUrl('a')])");await f.run("signedUrl('a')");assert.equal(f.calls.sign.length,1);
  f.run("signedUrls.get('user-a:a').expiresAt=0");await f.run("signedUrl('a')");assert.equal(f.calls.sign.length,2);
});
test('error de firma no queda cacheado',async()=>{
  const f=fixture();f.sb.storage.from=()=>({createSignedUrl:async()=>({error:new Error('denied')})});
  await assert.rejects(f.run("signedUrl('a')"),/denied/);assert.equal(f.run('signedUrls.size'),0);
});
test('cierre de sesión limpia firmas, imágenes y datos',async()=>{
  const f=fixture();await f.run("signedUrl('a')");await f.run('logout()');
  assert.equal(f.run('signedUrls.size'),0);assert.equal(f.run('session'),null);assert.equal(f.run('cuts.length'),0);assert.equal(f.node('largeQr').src,undefined);
});
test('renovación y eventos repetidos del mismo usuario no recargan',async()=>{
  const f=fixture();f.run('loadAll=async()=>{throw Error("No debe recargar")}');await f.run("handleSession({user:{id:'user-a'},access_token:'new'})");assert.equal(f.calls.queries.length,0);
});
test('inicialización y cambio de usuario realizan una sola carga por usuario',async()=>{
  const f=fixture();f.run('authReady=false;globalThis.loads=0;enter=async()=>{loads++;profile={role:"admin"}}');
  await f.run("Promise.all([handleSession({user:{id:'user-a'}}),handleSession({user:{id:'user-a'}})])");assert.equal(f.run('loads'),1);
  await f.run("signedUrl('a')");await f.run("handleSession({user:{id:'user-b'}})");assert.equal(f.run('loads'),2);assert.equal(f.run('signedUrls.size'),0);
});
test('una respuesta de cortes de otro usuario nunca se aplica',async()=>{
  const f=fixture();let resolve;f.setQuery(()=>new Promise(r=>resolve=r));const pending=f.run('loadCuts()');await new Promise(setImmediate);
  await f.run('handleSession(null)');resolve({data:[{id:'private'}],error:null});await assert.rejects(pending,/sesión cambió/);assert.equal(f.run('cuts.length'),0);
});
test('lecturas simultáneas se comparten y se rechazan las invalidadas',async()=>{
  const f=fixture();await f.run('Promise.all([loadCuts(),loadCuts()])');assert.equal(f.calls.queries.length,1);
  let resolve;f.setQuery(()=>new Promise(r=>resolve=r));const pending=f.run('loadCuts()');await new Promise(setImmediate);
  f.run("invalidateRead('cuts')");resolve({data:[{id:'obsolete'}],error:null});await assert.rejects(pending);assert.equal(f.run('cuts.length'),0);
});
test('pantallas ocultas no consultan liquidaciones ni renderizan historial',async()=>{
  const f=fixture();await f.run('renderHistory();renderLiquidations()');assert.equal(f.calls.queries.length,0);assert.equal(f.node('historyBody').children.length,0);
});
test('QR solo al abrir; firmas compartidas entre secciones y cambio de ruta',async()=>{
  const f=fixture();f.run("settings.qr_path='config/yape.png';settings.nps_qr_path='config/nps.png'");await f.run('renderVisibleQrs()');assert.equal(f.calls.sign.length,0);
  f.run("activePage='corte'");await f.run('renderVisibleQrs()');assert.equal(f.calls.sign.length,2);
  f.run("activePage='ajustes'");await f.run('renderVisibleQrs()');assert.equal(f.calls.sign.length,2);
  f.run("settings.qr_path='config/new.png'");await f.run('renderVisibleQrs()');assert.equal(f.calls.sign.length,3);
});
test('registro de servicios conserva importes y evita doble RPC',async()=>{
  const f=fixture();f.node('cutBarber').value='barber';f.node('cutPrice').value='35';f.node('cutPayment').value='yape';
  f.run("selectedCutServices=[{id:'cut',price:25},{id:'beard',price:10}]");f.context.submit={preventDefault(){},target:{reset(){}}};
  await f.run('Promise.all([registerCut(submit),registerCut(submit)])');
  assert.equal(f.calls.rpc.length,1);assert.equal(f.calls.rpc[0].payload.p_total,35);assert.equal(f.calls.rpc[0].payload.p_items.length,2);assert.equal(f.calls.sign.length,0);
});
test('pago usa selectores dentro de su tarjeta y evita doble envío',async()=>{
  const f=fixture();const card={querySelector:s=>({value:s.includes('method')?'yape':' nota '})};
  const button={dataset:{payout:'barber',start:'2026-11-04',end:'2026-11-04'},closest:()=>card};
  f.context.click={target:{closest:s=>s==='[data-payout]'?button:null}};
  await f.run('Promise.all([registerPayout(click),registerPayout(click)])');assert.equal(f.calls.rpc.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.rpc[0])),{name:'barberia_registrar_liquidacion',payload:{p_barber_id:'barber',p_start_date:'2026-11-04',p_end_date:'2026-11-04',p_payment_method:'yape',p_note:'nota'}});
});
test('fallo RPC libera bloqueo para reintentar',async()=>{
  const f=fixture();let calls=0;f.sb.auth.signInWithPassword=async()=>{calls++;throw Error('offline')};f.context.submit={preventDefault(){},target:{}};
  await f.run('login(submit)');await f.run('login(submit)');assert.equal(calls,2);assert.equal(f.run('submitting.size'),0);
});
test('validación de tamaño y formato; QR y HEIC se conservan',async()=>{
  const f=fixture();f.context.file={name:'x.exe',size:30,type:'application/octet-stream'};await assert.rejects(f.run('prepareImage(file)'));
  f.context.file={name:'x.jpg',size:13*1024*1024,type:'image/jpeg'};await assert.rejects(f.run('prepareImage(file)'),/12 MB/);
  f.context.file={name:'x.heic',size:5000,type:'image/heic'};const result=await f.run('prepareImage(file)');assert.equal(result.blob,f.context.file);assert.equal(result.ext,'heic');
});

test('optimiza fotos nuevas y mantiene QR y PNG sin pérdida',async()=>{
  const f=fixture();let drawn=0;
  f.context.URL={createObjectURL:()=> 'blob:test',revokeObjectURL(){}};
  f.context.Image=class{naturalWidth=4000;naturalHeight=3000;set src(value){queueMicrotask(()=>this.onload())}};
  f.context.document.createElement=()=>({getContext:()=>({fillRect(){},drawImage(){drawn++}}),toBlob:cb=>cb({size:400000,type:'image/jpeg'})});
  f.context.file={name:'photo.jpg',type:'image/jpeg',size:3000000};
  let result=await f.run('prepareImage(file)');assert.equal(result.blob.size,400000);assert.equal(drawn,1);
  result=await f.run('prepareImage(file,{qr:true})');assert.equal(result.blob,f.context.file);assert.equal(drawn,1);
  f.context.file={name:'receipt.png',type:'image/png',size:2000000};result=await f.run('prepareImage(file)');assert.equal(result.blob,f.context.file);
});

test('liquidaciones comparten consultas y se invalidan al cambiar de período',async()=>{
  const f=fixture();f.run("activePage='liquidaciones'");
  await f.run('Promise.all([renderLiquidations(),renderLiquidations()])');assert.equal(f.calls.queries.length,2);
  assert.equal(f.run('payrollDirty'),false);
  f.run("payrollRevision++;payrollDirty=true");await f.run('renderLiquidations()');assert.equal(f.calls.queries.length,4);
});

test('init recibe getSession y evento inicial sin duplicar carga',async()=>{
  const f=fixture();let callback;
  f.sb.auth.onAuthStateChange=cb=>{callback=cb};
  f.sb.auth.getSession=async()=>{callback('INITIAL_SESSION',{user:{id:'user-a'}});return {data:{session:{user:{id:'user-a'}}}}};
  f.run('authReady=false;globalThis.loads=0;enter=async()=>{loads++;profile={role:"admin"}}');
  await f.run('init()');await f.run('authLoading');assert.equal(f.run('loads'),1);
  callback('TOKEN_REFRESHED',{user:{id:'user-a'}});await f.run('authLoading');assert.equal(f.run('loads'),1);
});

test('firma pendiente tras cerrar sesión no revive caché ni muestra imagen',async()=>{
  const f=fixture();let resolve;f.sb.storage.from=()=>({createSignedUrl:()=>new Promise(r=>resolve=r)});
  const pending=f.run("openStoredImage('a','receipt')");await new Promise(setImmediate);await f.run('handleSession(null)');
  resolve({data:{signedUrl:'https://storage.test/private'}});await assert.rejects(pending);assert.equal(f.run('signedUrls.size'),0);assert.equal(f.node('qrDialog').open,false);assert.equal(f.node('largeQr').src,undefined);
});
