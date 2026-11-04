// Estado efímero: no persiste URLs privadas ni datos entre usuarios.
let sessionEpoch=0, activePage='dashboard', authReady=false, authLoading=null;
let historyDirty=true, payrollDirty=true, payrollRevision=0, payrollLoadedAt=0;
const signedUrls=new Map(), requests=new Map(), submitting=new Set();
const readVersions=new Map();
function invalidateRead(key){readVersions.set(key,(readVersions.get(key)||0)+1)}
function assertRead(epoch,key,version){assertCurrent(epoch);if((readVersions.get(key)||0)!==version)throw staleSession()}
function shareRead(key,work){return (...args)=>{
  const epoch=sessionEpoch,version=readVersions.get(key)||0;
  return onceRequest(`read:${key}:${version}`,()=>{assertRead(epoch,key,version);return work(...args)});
}}
function sharePayroll(work){return ()=>{
  if(!isPageVisible('liquidaciones')){payrollDirty=true;return Promise.resolve()}
  const epoch=sessionEpoch;
  return onceRequest('payroll',async()=>{
    assertCurrent(epoch);
    let revision,date;
    do{revision=payrollRevision;date=$('liquidDate').value;await work();assertCurrent(epoch)}
    while(isPageVisible('liquidaciones')&&(revision!==payrollRevision||date!==$('liquidDate').value));
  }).catch(error=>{if(!error.stale)throw error});
}}
const staleSession=()=>Object.assign(new Error('La sesión cambió'),{stale:true});
function assertCurrent(epoch){if(epoch!==sessionEpoch)throw staleSession()}
function onceRequest(key,work){
  const scoped=`${sessionEpoch}:${key}`;
  if(requests.has(scoped))return requests.get(scoped);
  const epoch=sessionEpoch;
  const promise=Promise.resolve().then(()=>{assertCurrent(epoch);return work()}).finally(()=>{if(requests.get(scoped)===promise)requests.delete(scoped)});
  requests.set(scoped,promise);return promise;
}
async function signedUrl(path){
  if(!session?.user?.id)throw new Error('Inicia sesión para ver la imagen');
  const epoch=sessionEpoch, key=`${session.user.id}:${path}`, cached=signedUrls.get(key);
  if(cached&&cached.expiresAt>Date.now())return cached.url;
  return onceRequest(`sign:${path}`,async()=>{
    const started=Date.now();
    const {data,error}=await sb.storage.from('barberia-comprobantes').createSignedUrl(path,3600);
    assertCurrent(epoch);if(error)throw error;
    if(!data?.signedUrl)throw new Error('No se pudo obtener la imagen');
    signedUrls.set(key,{url:data.signedUrl,expiresAt:started+3540000});return data.signedUrl;
  });
}
function clearPrivateState(){
  sessionEpoch++;signedUrls.clear();requests.clear();authLoading=null;authReady=false;
  profile=null;barbers=[];admins=[];services=[];cuts=[];selectedCutServices=[];
  settings={name:'BARBERÍA',yape_number:'',yape_name:'',qr_path:null,nps_qr_path:null};
  historyDirty=true;payrollDirty=true;payrollRevision++;payrollLoadedAt=0;
  $('qrDialog').close();$('largeQr').onerror=null;$('largeQr').removeAttribute('src');
  for(const id of ['historyBody','payoutHistory','liquidations','yapeQr','npsQr','currentQr','currentNpsQr','barbersBody','servicesBody','barberStats','profileMini','selectedServices'])$(id).innerHTML='';
  for(const id of ['cutForm','settingsForm','barberForm','serviceForm'])$(id).reset();
  for(const id of ['filterDate','filterBarber','filterPayment'])$(id).value='';
  for(const id of ['statCuts','statSales','statShop','statCommissions','welcomeName','roleBadge'])$(id).textContent='';
  activePage='dashboard';
  showLogin();
}
function handleSession(next){
  const changed=session?.user?.id!==next?.user?.id;
  if(changed||!next)clearPrivateState();
  session=next;
  if(!next){showLogin();return Promise.resolve()}
  if(authReady||authLoading)return authLoading||Promise.resolve();
  const epoch=sessionEpoch;
  // Ejecutar fuera del callback de Auth evita esperar consultas bajo su bloqueo.
  authLoading=new Promise(resolve=>setTimeout(resolve,0)).then(async()=>{
    assertCurrent(epoch);await enter(next);assertCurrent(epoch);authReady=!!profile;
  }).catch(error=>{if(!error.stale)toast(error.message||'No se pudo cargar la app')})
    .finally(()=>{if(epoch===sessionEpoch)authLoading=null});
  return authLoading;
}
async function logout(){
  const epoch=sessionEpoch;
  const {error}=await sb.auth.signOut();
  if(epoch!==sessionEpoch)return;
  if(error){toast(error.message);return}
  await handleSession(null);
}
function invalidateViews(){historyDirty=true;payrollDirty=true;payrollRevision++}
function isPageVisible(page){return !!session&&activePage===page&&!$('appView').classList.contains('hidden')}
async function openStoredImage(path,label){
  const epoch=sessionEpoch,url=await signedUrl(path);assertCurrent(epoch);
  const image=$('largeQr');image.alt=label;
  image.onerror=()=>{
    if(epoch!==sessionEpoch)return;
    signedUrls.delete(`${session.user.id}:${path}`);
    toast('No se pudo cargar la imagen. Vuelve a abrirla para reintentar.');
  };
  image.src=url;$('qrDialog').setAttribute('aria-label',label);
  if(!$('qrDialog').open)$('qrDialog').showModal();
}
async function viewReceipt(e){
  const button=e.target.closest('[data-receipt-path]');if(!button||button.disabled)return;
  button.disabled=true;const epoch=sessionEpoch;
  try{await openStoredImage(button.dataset.receiptPath,'Comprobante de pago ampliado')}
  catch(error){if(epoch===sessionEpoch&&!error.stale)toast(error.message)}
  finally{button.disabled=false}
}
async function renderVisibleQrs(){
  if(!['corte','ajustes'].includes(activePage)||!session)return;
  const page=activePage,epoch=sessionEpoch;
  for(const [path,id,label] of [[settings.qr_path,page==='corte'?'yapeQr':'currentQr','QR Yape'],[settings.nps_qr_path,page==='corte'?'npsQr':'currentNpsQr','QR de encuesta NPS']]){
    const container=$(id);
    if(!path){container.innerHTML='';delete container.dataset.path;continue}
    if(container.dataset.path===path&&container.querySelector('img'))continue;
    try{
      const url=await signedUrl(path);assertCurrent(epoch);if(activePage!==page)return;
      if(path!==((id==='yapeQr'||id==='currentQr')?settings.qr_path:settings.nps_qr_path))return;
      container.innerHTML=`<button class="qr-trigger" type="button" aria-label="Ampliar ${esc(label)}"><img class="qr-img" src="${esc(url)}" alt="${esc(label)}"><span>Toca para ampliar</span></button>`;
      container.dataset.path=path;
      container.querySelector('button').onclick=()=>openStoredImage(path,label+' ampliado').catch(error=>{if(!error.stale)toast(error.message)});
      container.querySelector('img').onerror=()=>{if(epoch===sessionEpoch){signedUrls.delete(`${session.user.id}:${path}`);container.innerHTML='No se pudo cargar el QR. Vuelve a abrir esta sección.';delete container.dataset.path}};
    }catch(error){if(!error.stale&&epoch===sessionEpoch)toast(error.message)}
  }
}
// Conserva detalle y evita conversiones destructivas de QR o formatos no decodificables.
async function prepareImage(file,{qr=false}={}){
  const allowed=['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  const inferred={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif'};
  const type=file.type?.toLowerCase()||inferred[ext];
  if(!allowed.includes(type))throw new Error('Selecciona una imagen JPG, PNG, WEBP, GIF o HEIC');
  if(!file.size||file.size>12*1024*1024)throw new Error('La imagen debe pesar entre 1 byte y 12 MB');
  let blob=file;
  if(['image/jpeg','image/png','image/webp'].includes(type)){
    const url=URL.createObjectURL(file);let image;
    try{
      image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('La imagen no se puede leer'));img.src=url});
      if(image.naturalWidth*image.naturalHeight>40000000)throw new Error('La imagen es demasiado grande: máximo 40 megapíxeles');
      // Los QR se conservan sin pérdida. Comprobantes: lado mayor 2560px, JPEG 92%.
      if(!qr&&type!=='image/png'&&(Math.max(image.naturalWidth,image.naturalHeight)>2560||file.size>1024*1024)){
        const scale=Math.min(1,2560/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
        const context=canvas.getContext('2d');if(context){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
          const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));if(result&&result.size<file.size)blob=result;}
      }
    }finally{URL.revokeObjectURL(url)}
  }
  const mime=blob===file?type:'image/jpeg';
  return {blob,mime,ext:({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif'})[mime]};
}
function protectAction(name,action){
  return async function(...args){
    const event=args[0];event?.preventDefault?.();
    const key=`${sessionEpoch}:${name}`;if(submitting.has(key))return;
    submitting.add(key);const epoch=sessionEpoch;
    const root=event?.target?.closest?.('form')||event?.target?.closest?.('.inline-form');
    const controls=(root?[...root.querySelectorAll('button,input,select,textarea')]:event?.target?.disabled!==undefined?[event.target]:[]).map(node=>[node,node.disabled]);
    controls.forEach(([node])=>node.disabled=true);
    try{return await action.apply(this,args)}catch(error){if(!error.stale&&epoch===sessionEpoch)toast(error.message||'No se pudo completar la operación')}
    finally{submitting.delete(key);controls.forEach(([node,disabled])=>node.disabled=disabled)}
  };
}
