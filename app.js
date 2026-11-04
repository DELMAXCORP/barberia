const sb = window.supabaseClient;
const $ = id => document.getElementById(id);
let session=null, profile=null, settings={name:'BARBERÍA',yape_number:'',yape_name:'',qr_path:null};
let barbers=[], admins=[], services=[], cuts=[];
let selectedCutServices=[];
const SHOP_TIME_ZONE='America/Lima';
const shopDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:SHOP_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
function shopDate(value=new Date()){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  const parts=Object.fromEntries(shopDateFormatter.formatToParts(date).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
const today=()=>shopDate();
let displayedDay=today();
function refreshBusinessDay(){
  const next=today();
  if(next===displayedDay)return;
  const previous=displayedDay;displayedDay=next;
  if(!profile)return;
  for(const id of ['filterDate','liquidDate'])if($(id).value===previous)$(id).value=next;
  $('todayLabel').textContent=new Date().toLocaleDateString('es-PE',{timeZone:SHOP_TIME_ZONE,weekday:'long',year:'numeric',month:'long',day:'numeric'});
  invalidateViews();renderDashboard();renderHistory();renderLiquidations();
}
const shopDateTime=value=>new Date(value).toLocaleString('es-PE',{timeZone:SHOP_TIME_ZONE});
const money=n=>`S/ ${Number(n||0).toFixed(2)}`;
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2500)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
async function init(){
  setInterval(refreshBusinessDay,1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshBusinessDay()});
  let authEventSeen=false;
  sb.auth.onAuthStateChange((event,s)=>{authEventSeen=true;handleSession(s)});
  sb.auth.getSession().then(({data,error})=>{if(error){toast(error.message);return}if(!authEventSeen)handleSession(data.session)}).catch(error=>toast(error.message));
  $('loginForm').addEventListener('submit',login); $('logoutBtn').addEventListener('click',logout); $('mobileLogout').addEventListener('click',logout);
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.go)));
  $('cutBarber').addEventListener('change',updateEarnings); $('cutService').addEventListener('change',updatePrice); $('cutPayment').addEventListener('change',()=>{}); $('cutForm').addEventListener('submit',registerCut);
  ['cutReceiptCamera','cutReceiptGallery'].forEach(id=>$(id).addEventListener('change',()=>{const other=id==='cutReceiptCamera'?'cutReceiptGallery':'cutReceiptCamera';if($(id).files[0])$(other).value='';$('receiptSelectedName').textContent=$(id).files[0]?.name||''}));
  $('addCutService').addEventListener('click',addCutService); $('selectedServices').addEventListener('click',e=>{const button=e.target.closest('[data-remove-service]');if(button){selectedCutServices.splice(Number(button.dataset.removeService),1);renderSelectedServices(true)}}); $('cutPrice').addEventListener('input',updateEarnings);
  $('closeQr').addEventListener('click',()=>$('qrDialog').close()); $('qrDialog').addEventListener('click',e=>{if(e.target===$('qrDialog'))$('qrDialog').close()});
  $('historyBody').addEventListener('click',viewReceipt);
  $('historyBody').addEventListener('click',undoCut);
  $('refreshHistoryBtn').addEventListener('click',refreshHistory);
  $('allHistoryBtn').addEventListener('click',()=>{['filterDate','filterBarber','filterPayment'].forEach(id=>$(id).value='');renderHistory()});
  $('barberForm').addEventListener('submit',saveBarber); $('serviceForm').addEventListener('submit',saveService); $('serviceCancel').addEventListener('click',resetServiceForm); $('settingsForm').addEventListener('submit',saveSettings);
  $('exportBtn').addEventListener('click',exportExcel); ['filterDate','filterBarber','filterPayment'].forEach(id=>$(id).addEventListener('change',renderHistory)); $('filterDate').value=''; $('liquidDate').value=today(); $('liquidDate').addEventListener('change',()=>{payrollRevision++;payrollDirty=true;renderLiquidations()}); $('liquidations').addEventListener('click',registerPayout); $('liquidations').addEventListener('change',updatePayFrequency);
}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
async function login(e){e.preventDefault();const {error}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error)toast(error.message)}
async function enter(s){const epoch=sessionEpoch;session=s;await loadAll();assertCurrent(epoch);$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');showPage(activePage)}
function isAdmin(){return profile?.role==='admin'}
function canManageServices(){return ['admin','recepcionista'].includes(profile?.role)}
function canRegisterCuts(){return ['admin','recepcionista'].includes(profile?.role)}
function canManagePayroll(){return ['admin','recepcionista'].includes(profile?.role)}
function trackedBarbers(){return isAdmin()||profile?.role==='recepcionista'?[...barbers,...admins]:barbers}
async function loadAll(){const epoch=sessionEpoch;
  const p=await sb.from('barberia_usuarios').select('*').eq('id',session.user.id).maybeSingle();assertCurrent(epoch); if(p.error) throw p.error; profile=p.data;
  if(!profile){toast('Tu usuario existe en Auth pero aún no tiene perfil en barberia_usuarios.');return}
  document.querySelectorAll('.admin-only').forEach(x=>x.classList.toggle('hidden',!isAdmin()));
  document.querySelectorAll('.services-access').forEach(x=>x.classList.toggle('hidden',!canManageServices()));
  document.querySelectorAll('.register-only').forEach(x=>x.classList.toggle('hidden',!canRegisterCuts()));
  document.querySelectorAll('.payroll-access').forEach(x=>x.classList.toggle('hidden',!canManagePayroll()));
  $('statCommissions').closest('.stat').classList.toggle('hidden',profile.role==='recepcionista');
  $('exportBtn').classList.toggle('hidden',!isAdmin());
  $('filterBarber').classList.toggle('hidden',!isAdmin());
  $('profileMini').innerHTML=`<div class="profile-name"><strong>${esc(profile.name||session.user.email)}</strong><small>${esc(profile.role)}</small></div>`;
  $('roleBadge').textContent=profile.role==='admin'?'ADMINISTRADOR':profile.role==='recepcionista'?'RECEPCIÓN':'BARBERO'; $('todayLabel').textContent=new Date().toLocaleDateString('es-PE',{timeZone:SHOP_TIME_ZONE,weekday:'long',year:'numeric',month:'long',day:'numeric'});$('welcomeName').textContent=`Hola, ${profile.name||'bienvenido'}`;
  await Promise.all([loadSettings(),loadBarbers(),loadServices(),loadCuts()]);assertCurrent(epoch); invalidateViews();renderDashboard(); renderHistory(); renderLiquidations();
}
async function loadSettings(){const epoch=sessionEpoch,readVersion=readVersions.get('settings')||0;const {data,error}=await sb.from('barberia_config').select('*').limit(1).maybeSingle();assertRead(epoch,'settings',readVersion);if(error)throw error;if(data)settings=data;$('yapeNumber').textContent=settings.yape_number||'Configura tu número';$('yapeName').textContent=settings.yape_name?`Titular: ${settings.yape_name}`:'';await renderVisibleQrs()}
async function loadBarbers(){const epoch=sessionEpoch,readVersion=readVersions.get('barbers')||0;const {data,error}=await sb.from('barberia_usuarios').select('*').eq('role','barbero').eq('active',true).order('name');assertRead(epoch,'barbers',readVersion);if(error)throw error;barbers=data||[];if(isAdmin()||profile?.role==='recepcionista'){const result=await sb.from('barberia_usuarios').select('*').eq('role','admin').eq('active',true).order('name');assertRead(epoch,'barbers',readVersion);if(result.error)throw result.error;admins=result.data||[]}else admins=[];fillBarberSelects();renderBarbers()}
async function loadServices(){const epoch=sessionEpoch,readVersion=readVersions.get('services')||0;const {data,error}=await sb.from('barberia_servicios').select('*').order('name');assertRead(epoch,'services',readVersion);if(error)throw error;services=data||[];fillServices();renderServices()}
async function loadCuts(){const epoch=sessionEpoch,readVersion=readVersions.get('cuts')||0;let q=sb.from('barberia_cortes').select('*, barber:barberia_usuarios!barber_id(name), service:barberia_servicios!service_id(name)').order('created_at',{ascending:false});const {data,error}=await q.limit(1000);assertCurrent(epoch);assertRead(epoch,'cuts',readVersion);if(error)throw error;cuts=data||[]}
function fillBarberSelects(){$('filterBarber').innerHTML='<option value="">Todos los barberos</option>'+barbers.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');$('filterBarber').classList.toggle('hidden',!isAdmin());const eligible=[...barbers,...(canRegisterCuts()?admins:[])];$('cutBarber').innerHTML='<option value="">Selecciona quién realizó el servicio</option>'+eligible.map(b=>`<option value="${b.id}">${esc(b.name)}${b.role==='admin'?' (administrador)':''}</option>`).join('')}
function fillServices(){$('cutService').innerHTML=services.filter(s=>s.active).map(s=>`<option value="${s.id}" data-price="${s.price}">${esc(s.name)} — ${money(s.price)}</option>`).join('')||'<option value="">No hay servicios activos</option>';updatePrice()}
function serviceGoesToBarber(service){return /barba|ceja/i.test(service?.name||'')}
function addCutService(){const service=services.find(s=>s.id===$('cutService').value);if(!service)return;if(selectedCutServices.some(s=>s.id===service.id))return toast('Ese servicio ya está agregado');selectedCutServices.push(service);renderSelectedServices(true)}
function renderSelectedServices(resetTotal=false){$('selectedServices').innerHTML=selectedCutServices.map((s,i)=>`<span class="selected-service">${esc(s.name)} · ${money(s.price)} <button type="button" data-remove-service="${i}" aria-label="Quitar ${esc(s.name)}">×</button></span>`).join('')||'<small>Agrega uno o varios servicios.</small>';if(resetTotal)$('cutPrice').value=selectedCutServices.reduce((sum,s)=>sum+Number(s.price),0).toFixed(2);updateEarnings()}
function updatePrice(){updateEarnings()}
function updateEarnings(){
  const total=Number($('cutPrice').value||0),attendant=[...barbers,...admins].find(b=>b.id===$('cutBarber').value),shopOnly=attendant?.earnings_to_shop===true;
  const baseTotal=selectedCutServices.reduce((sum,s)=>sum+Number(s.price),0),defaultPct=Number(attendant?.commission_percent??50);
  const barberPct=shopOnly?0:baseTotal?selectedCutServices.reduce((sum,s)=>sum+Number(s.price)*(serviceGoesToBarber(s)?100:defaultPct),0)/baseTotal:0;
  $('cutCommission').value=shopOnly?'0%':selectedCutServices.some(serviceGoesToBarber)?barberPct.toFixed(0)+'% aprox.':defaultPct+'%';
  const earn=Math.round(total*barberPct)/100;
  $('cutBarberEarn').value=money(earn);$('cutShopEarn').value=money(total-earn);
}
async function registerCut(e){const epoch=sessionEpoch;e.preventDefault();if(!canRegisterCuts())return toast('Solo recepción o administración puede registrar servicios');const barberId=$('cutBarber').value,total=Number($('cutPrice').value);if(!barberId)return toast('Selecciona quién realizó el servicio');if(!profile?.active)return toast('No se encontró tu perfil activo');if(!selectedCutServices.length)return toast('Agrega al menos un servicio');if(!Number.isFinite(total)||total<0)return toast('Ingresa un total válido');let receipt_path=null;const original=$('cutReceiptCamera').files[0]||$('cutReceiptGallery').files[0];const prepared=original?await prepareImage(original):null;assertCurrent(epoch);const file=prepared?.blob;if(file){const validTypes=['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];if(file.type&&!validTypes.includes(file.type.toLowerCase()))return toast('El comprobante debe ser una imagen JPG, PNG, WEBP o HEIC');const mime=prepared.mime,knownExt={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif'},ext=knownExt[mime.toLowerCase()]||(file.name.split('.').pop()||'jpg').toLowerCase(),path=`${session.user.id}/${Date.now()}.${ext}`;const up=await sb.storage.from('barberia-comprobantes').upload(path,file,{upsert:false,contentType:mime});assertCurrent(epoch);if(up.error){toast(`No se pudo subir el comprobante: ${up.error.message}`);return}receipt_path=path}const {error}=await sb.rpc('barberia_registrar_servicios', {p_barber_id:barberId,p_items:selectedCutServices.map(s=>({service_id:s.id,price:s.price})),p_total:total,p_payment_method:$('cutPayment').value,p_receipt_path:receipt_path,p_observations:$('cutObservations').value.trim()||null});assertCurrent(epoch);if(error){toast(error.message);return}toast('Servicios registrados');e.target.reset();$('receiptSelectedName').textContent='';selectedCutServices=[];renderSelectedServices();$('cutPayment').value='yape';invalidateRead('cuts');invalidateViews();try{await loadCuts();assertCurrent(epoch)}catch(error){if(error.stale)throw error;toast('Servicios registrados. No se pudo actualizar la vista; pulsa Actualizar en Historial.');return}invalidateViews();renderDashboard();renderHistory();renderLiquidations();updatePrice()}
function renderDashboard(){const d=today(),day=cuts.filter(c=>shopDate(c.created_at)===d);const dayCuts=day.filter(c=>!serviceGoesToBarber(c.service));$('statCuts').textContent=dayCuts.length;$('statSales').textContent=money(day.reduce((a,c)=>a+Number(c.price),0));$('statShop').textContent=money(day.reduce((a,c)=>a+Number(c.shop_amount),0));$('statCommissions').textContent=money(day.filter(c=>isAdmin()||c.barber_id===session?.user?.id).reduce((a,c)=>a+Number(c.barber_amount),0));const counts=trackedBarbers().map(b=>({b,n:dayCuts.filter(c=>c.barber_id===b.id).length}));const max=Math.max(1,...counts.map(x=>x.n));$('activityTitle').textContent=isAdmin()||profile?.role==='recepcionista'?'Cortes por barbero':'Mi actividad';$('commissionLabel').textContent=isAdmin()?'COMISIONES DEL EQUIPO':'MIS COMISIONES';$('barberStats').innerHTML=counts.length?counts.map(x=>`<div class="barber-row"><div class="barber-line"><span>${esc(x.b.name)}</span><strong>${x.n} cortes</strong></div><div class="bar"><i style="width:${x.n/max*100}%"></i></div></div>`).join(''):'<p>Sin actividad registrada hoy.</p>'}
function receiptLink(path){return path?`<button type="button" data-receipt-path="${esc(path)}">Ver comprobante</button>`:'?'}
// Agrupa solo timestamps completos de la misma transaccion y datos de pago.
function groupHistoryRows(rows){
  const groups=new Map();
  for(const c of rows){
    const key=c.created_at?JSON.stringify([c.created_at,c.barber_id,c.payment_method,c.receipt_path||null,c.observations||null]):c.id||c;
    if(!groups.has(key))groups.set(key,{...c,items:[],price:0,barber_amount:0,shop_amount:0});
    const group=groups.get(key);
    group.items.push(c);
    for(const field of ['price','barber_amount','shop_amount'])group[field]+=Math.round(Number(c[field]||0)*100);
  }
  return [...groups.values()].map(group=>({...group,price:group.price/100,barber_amount:group.barber_amount/100,shop_amount:group.shop_amount/100}));
}
let historyRenderVersion=0;
let historyLoadVersion=0;
async function refreshHistory(){
  if(!isPageVisible('historial')){historyDirty=true;return}
  const epoch=sessionEpoch;
  const version=++historyLoadVersion;
  $('historyBody').innerHTML='<tr><td colspan="10">Cargando servicios...</td></tr>';
  try{await loadCuts();assertCurrent(epoch);if(version!==historyLoadVersion||!isPageVisible('historial'))return;renderDashboard();await renderHistory()}
  catch(error){if(error.stale||epoch!==sessionEpoch||version!==historyLoadVersion||!isPageVisible('historial'))return;console.error(error);$('historyBody').innerHTML=`<tr><td colspan="10">No se pudo cargar el historial: ${esc(error.message||'Error de conexión')}. Vuelve a pulsar Actualizar.</td></tr>`;}
}

let undoCutPending=false;
async function undoCut(e){const epoch=sessionEpoch;
  const button=e.target.closest('[data-undo-cut]');
  if(!button||undoCutPending)return;
  if(!canRegisterCuts()||!profile?.active)return toast('No tienes permiso para deshacer servicios');
  const operation=groupHistoryRows(cuts).find(c=>c.items.some(item=>item.id===button.dataset.undoCut));
  if(!operation)return toast('La operación ya no está disponible. Actualiza el historial.');
  if(!confirm(`¿Deshacer esta operación de ${operation.barber?.name||'servicios'} por ${money(operation.price)}?\n\nSe eliminarán todos sus servicios (${operation.items.length}) y se descontarán de las ventas y comisiones. Después podrás registrarlos correctamente.`))return;
  undoCutPending=true;button.disabled=true;
  try{
    const ids=operation.items.map(item=>item.id);
    const {error}=await sb.rpc('barberia_deshacer_servicios',{p_ids:ids});assertCurrent(epoch);
    if(error)throw error;
    invalidateRead('cuts');cuts=cuts.filter(c=>!ids.includes(c.id));
    invalidateViews();renderDashboard();await renderHistory();assertCurrent(epoch);payrollDirty=true;payrollRevision++;await renderLiquidations();assertCurrent(epoch);
    toast('Operación deshecha. Puedes registrar los servicios corregidos.');
  }catch(error){if(epoch===sessionEpoch&&!error.stale)toast(error.message||'No se pudo deshacer la operación');}
  finally{undoCutPending=false;button.disabled=false;document.querySelectorAll('[data-undo-cut]').forEach(b=>b.disabled=false);}
}
async function renderHistory(){if(!isPageVisible('historial')){historyDirty=true;return}historyDirty=false;const version=++historyRenderVersion;const date=$('filterDate').value,bid=isAdmin()?$('filterBarber').value:'',pay=$('filterPayment').value;let rows=(isAdmin()||profile?.role==='recepcionista')?cuts:cuts.filter(c=>c.barber_id===session?.user?.id);if(date)rows=rows.filter(c=>shopDate(c.created_at)===date);if(bid)rows=rows.filter(c=>c.barber_id===bid);if(pay)rows=rows.filter(c=>c.payment_method===pay);$('historyActions').classList.toggle('hidden',!canRegisterCuts());$('historyBody').innerHTML=rows.length?'':`<tr><td colspan="10">${date||bid||pay?'No hay servicios con estos filtros. Pulsa Ver todos para quitar los filtros.':'No hay servicios registrados para tu usuario.'}</td></tr>`;for(const c of groupHistoryRows(rows)){if(version!==historyRenderVersion)return;const tr=document.createElement('tr');tr.innerHTML=`<td>${shopDateTime(c.created_at)}</td><td>${esc(c.barber?.name)}</td><td>${c.items.map(item=>`<div class="history-service"><span>${esc(item.service?.name)}</span><strong>${money(item.price)}</strong></div>`).join('')}</td><td>${money(c.price)}</td><td>${money(c.barber_amount)}</td><td>${money(c.shop_amount)}</td><td><span class="pill">${esc(c.payment_method)}</span></td><td>${esc(c.observations||'')}</td><td class="receipt-cell">...</td>${canRegisterCuts()?`<td><button type="button" data-undo-cut="${esc(c.items[0].id)}" ${undoCutPending?'disabled':''}>Deshacer</button></td>`:''}`;$('historyBody').appendChild(tr);tr.querySelector('.receipt-cell').innerHTML=receiptLink(c.receipt_path)}}
function renderBarbers(){$('barbersBody').innerHTML=barbers.map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.email||'-')}</td><td>${b.commission_percent}%</td><td>${b.pay_frequency==='semanal'?'Semanal':'Diario'}</td><td><span class="pill">Activo</span></td></tr>`).join('')}
async function saveBarber(e){const epoch=sessionEpoch;e.preventDefault();const {error}=await sb.from('barberia_usuarios').upsert({id:$('barberUserId').value.trim(),name:$('barberName').value.trim(),commission_percent:Number($('barberCommission').value),pay_frequency:$('barberPayFrequency').value,role:'barbero',email:null},{onConflict:'id'});assertCurrent(epoch);if(error)toast(error.message);else{toast('Barbero guardado');e.target.reset();(invalidateRead('barbers'),await loadBarbers());assertCurrent(epoch);renderDashboard()}}
function renderServices(){$('servicesBody').innerHTML=services.map(s=>`<tr><td>${esc(s.name)}</td><td>${money(s.price)}</td><td><span class="pill">${s.active?'Activo':'Inactivo'}</span></td><td><button onclick="editService('${s.id}')">Editar</button> <button onclick="toggleService('${s.id}',${s.active})">${s.active?'Desactivar':'Activar'}</button></td></tr>`).join('')}
window.editService=(id)=>{if(!canManageServices())return toast('No tienes permiso para administrar servicios');const s=services.find(x=>x.id===id);if(!s)return;$('serviceId').value=s.id;$('serviceName').value=s.name;$('servicePrice').value=s.price;$('serviceSubmit').textContent='Guardar cambios';$('serviceCancel').classList.remove('hidden');$('serviceName').focus()}
function resetServiceForm(){$('serviceForm').reset();$('serviceId').value='';$('serviceSubmit').textContent='Agregar servicio';$('serviceCancel').classList.add('hidden')}
async function saveService(e){const epoch=sessionEpoch;e.preventDefault();if(!canManageServices())return toast('No tienes permiso para administrar servicios');const id=$('serviceId').value,payload={name:$('serviceName').value.trim(),price:Number($('servicePrice').value)};const {error}=id?await sb.from('barberia_servicios').update(payload).eq('id',id):await sb.from('barberia_servicios').insert({...payload,active:true});assertCurrent(epoch);if(error)toast(error.message);else{toast(id?'Servicio actualizado':'Servicio agregado');resetServiceForm();(invalidateRead('services'),await loadServices())}}
window.toggleService=async(id,active)=>{const epoch=sessionEpoch;if(!canManageServices())return toast('No tienes permiso para administrar servicios');const {error}=await sb.from('barberia_servicios').update({active:!active}).eq('id',id);assertCurrent(epoch);if(error)toast(error.message);else (invalidateRead('services'),await loadServices())}
function dateOnly(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}
function paymentPeriod(barber,date){if(barber.pay_frequency!=='semanal')return {start:date,end:date};const selected=new Date(`${date}T12:00:00`),start=new Date(selected);start.setDate(selected.getDate()-(selected.getDay()+6)%7);const end=new Date(start);end.setDate(start.getDate()+6);return {start:dateOnly(start),end:dateOnly(end)}}
async function renderLiquidations(){if(!isPageVisible('liquidaciones')||!canManagePayroll()){payrollDirty=true;return}const revision=payrollRevision;const epoch=sessionEpoch;const d=$('liquidDate').value||today();try{const {data:paid,error}=await sb.from('barberia_liquidaciones').select('barber_id,start_date,end_date').eq('status','pagado');assertCurrent(epoch);if(error)throw error;if(!isPageVisible('liquidaciones')||revision!==payrollRevision)return;const payments=paid||[];$('liquidations').innerHTML=barbers.map(b=>{const period=paymentPeriod(b,d),rows=cuts.filter(c=>c.barber_id===b.id&&shopDate(c.created_at)>=period.start&&shopDate(c.created_at)<=period.end),sales=rows.reduce((a,c)=>a+Number(c.price),0),earn=rows.reduce((a,c)=>a+Number(c.barber_amount),0),isPaid=payments.some(p=>p.barber_id===b.id&&p.start_date===period.start&&p.end_date===period.end);return `<div class="liquid-card"><strong>${esc(b.name)}</strong> <label class="pill">Frecuencia <select data-frequency="${b.id}" aria-label="Frecuencia de pago de ${esc(b.name)}"><option value="diario" ${b.pay_frequency==='diario'?'selected':''}>Diaria</option><option value="semanal" ${b.pay_frequency==='semanal'?'selected':''}>Semanal</option></select></label><span class="pill">${period.start}${period.end!==period.start?` al ${period.end}`:''}</span><div class="liquid-meta"><div><small>Servicios</small><b>${rows.length}</b></div><div><small>Ventas</small><b>${money(sales)}</b></div><div><small>A pagar</small><b>${money(earn)}</b></div></div>${isPaid?'<p class="pill">Período pagado</p>':`<div class="inline-form"><select data-payment-method="${b.id}"><option value="efectivo">Efectivo</option><option value="yape">Yape</option><option value="plin">Plin</option><option value="transferencia">Transferencia</option></select><input data-payment-note="${b.id}" placeholder="Nota opcional"><button class="primary" data-payout="${b.id}" data-start="${period.start}" data-end="${period.end}">Registrar pago</button></div>`}</div>`}).join('')||'<p>No hay barberos activos.</p>';await loadPayoutHistory(revision);assertCurrent(epoch);if(revision===payrollRevision){payrollDirty=false;payrollLoadedAt=Date.now()}}catch(e){if(e.stale||epoch!==sessionEpoch||!isPageVisible('liquidaciones'))return;console.error(e);$('liquidations').innerHTML='<p>No se pudieron cargar las liquidaciones. Vuelve a abrir esta sección para reintentar.</p>';toast(e.message||'Error al cargar liquidaciones')}}
async function updatePayFrequency(e){const epoch=sessionEpoch;const select=e.target.closest('[data-frequency]');if(!select||!canManagePayroll())return;select.disabled=true;const {error}=await sb.rpc('barberia_actualizar_frecuencia_pago',{p_barber_id:select.dataset.frequency,p_pay_frequency:select.value});assertCurrent(epoch);if(error){toast(error.message);(invalidateRead('barbers'),await loadBarbers())}else{toast('Frecuencia de pago actualizada');assertCurrent(epoch);(invalidateRead('barbers'),await loadBarbers())}payrollDirty=true;assertCurrent(epoch);payrollRevision++;await renderLiquidations()}
async function registerPayout(e){const epoch=sessionEpoch;const button=e.target.closest('[data-payout]');if(!button||!canManagePayroll())return;const card=button.closest('.liquid-card'),id=button.dataset.payout,{error}=await sb.rpc('barberia_registrar_liquidacion',{p_barber_id:id,p_start_date:button.dataset.start,p_end_date:button.dataset.end,p_payment_method:card.querySelector('[data-payment-method]').value,p_note:card.querySelector('[data-payment-note]').value.trim()});assertCurrent(epoch);if(error){toast(error.message);return}toast('Pago registrado');payrollDirty=true;payrollRevision++;await renderLiquidations()}
async function loadPayoutHistory(revision=payrollRevision){const epoch=sessionEpoch;const {data,error}=await sb.from('barberia_liquidaciones').select('*, barber:barberia_usuarios!barber_id(name)').order('paid_at',{ascending:false}).limit(100);assertCurrent(epoch);if(error)throw error;if(!isPageVisible('liquidaciones')||revision!==payrollRevision)return;$('payoutHistory').innerHTML=`<table><thead><tr><th>Barbero</th><th>Período</th><th>Monto</th><th>Método</th><th>Fecha de pago</th><th>Nota</th></tr></thead><tbody>${(data||[]).map(p=>`<tr><td>${esc(p.barber?.name)}</td><td>${p.start_date}${p.end_date!==p.start_date?` al ${p.end_date}`:''}</td><td>${money(p.amount)}</td><td>${esc(p.payment_method)}</td><td>${shopDateTime(p.paid_at)}</td><td>${esc(p.note||'')}</td></tr>`).join('')}</tbody></table>`}
async function saveSettings(e){const epoch=sessionEpoch;e.preventDefault();let qr_path=settings.qr_path,nps_qr_path=settings.nps_qr_path;for(const [input,key,folder] of [['settingQr','qr_path','yape'],['settingNpsQr','nps_qr_path','nps']]){const original=$(input).files[0];if(!original)continue;const prepared=await prepareImage(original,{qr:true});assertCurrent(epoch);const file=prepared.blob,ext=prepared.ext,path=`config/${folder}-${Date.now()}.${ext}`;const up=await sb.storage.from('barberia-comprobantes').upload(path,file,{contentType:prepared.mime});assertCurrent(epoch);if(up.error){toast(up.error.message);return}if(key==='qr_path')qr_path=path;else nps_qr_path=path}const payload={id:settings.id||1,name:$('settingName').value.trim(),yape_number:$('settingYape').value.trim(),yape_name:$('settingYapeName').value.trim(),qr_path,nps_qr_path};const {data,error}=await sb.from('barberia_config').upsert(payload).select().single();assertCurrent(epoch);if(error)toast(error.message);else{settings=data;$('settingQr').value='';$('settingNpsQr').value='';toast('Configuración guardada');(invalidateRead('settings'),await loadSettings())}}
async function exportExcel(){if(!isAdmin())return toast('Solo los administradores pueden descargar el historial');const date=$('filterDate').value,bid=$('filterBarber').value,pay=$('filterPayment').value;let rows=cuts;if(date)rows=rows.filter(c=>shopDate(c.created_at)===date);if(bid)rows=rows.filter(c=>c.barber_id===bid);if(pay)rows=rows.filter(c=>c.payment_method===pay);const data=groupHistoryRows(rows).map(c=>({Fecha:shopDateTime(c.created_at),Barbero:c.barber?.name||'',Servicios:c.items.map(item=>`${item.service?.name||'Servicio'}: ${money(item.price)}`).join(' + '),Precio:Number(c.price),Comision:c.items.map(item=>`${item.service?.name||'Servicio'}: ${item.commission_percent}%`).join('; '),Barbero_Gana:Number(c.barber_amount),Barberia_Gana:Number(c.shop_amount),Pago:c.payment_method,Observaciones:c.observations||'',Comprobante:c.receipt_path?'Sí':'No'}));const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Cortes');XLSX.writeFile(wb,`barberia-cortes-${date||'todos'}.xlsx`)}
function showPage(page){if(page==='servicios'&&!canManageServices()){toast('Solo recepci?n o administraci?n puede administrar servicios');page='dashboard'}if(page==='corte'&&!canRegisterCuts()){toast('Solo recepción o administración puede registrar servicios');page='dashboard'}if(['barberos','ajustes'].includes(page)&&!isAdmin()){toast('Solo administración puede acceder a esta sección');page='dashboard'}if(page==='liquidaciones'&&!canManagePayroll()){toast('Solo recepción o administración puede acceder a liquidaciones');page='dashboard'}document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));$('page-'+page).classList.remove('hidden');document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.page===page));const titles={dashboard:'Inicio',corte:'Registrar servicio',historial:'Historial',barberos:'Barberos',servicios:'Servicios',liquidaciones:'Liquidaciones',ajustes:'Configuración'};$('pageTitle').textContent=titles[page]||'Inicio';activePage=page;if(page==='historial'&&historyDirty)renderHistory();if(page==='liquidaciones'&&(payrollDirty||Date.now()-payrollLoadedAt>60000))renderLiquidations();if(page==='corte'||page==='ajustes')renderVisibleQrs();if(page==='ajustes'){ $('settingName').value=settings.name||'';$('settingYape').value=settings.yape_number||'';$('settingYapeName').value=settings.yape_name||''}}

window.toggleService=protectAction('toggleService',window.toggleService);
loadCuts=shareRead('cuts',loadCuts);
loadSettings=shareRead('settings',loadSettings);
loadBarbers=shareRead('barbers',loadBarbers);
loadServices=shareRead('services',loadServices);
renderLiquidations=sharePayroll(renderLiquidations);
logout=protectAction('logout',logout);
login=protectAction('login',login);
registerCut=protectAction('registerCut',registerCut);
saveBarber=protectAction('saveBarber',saveBarber);
saveService=protectAction('saveService',saveService);
saveSettings=protectAction('saveSettings',saveSettings);
registerPayout=protectAction('registerPayout',registerPayout);
updatePayFrequency=protectAction('updatePayFrequency',updatePayFrequency);
document.addEventListener('DOMContentLoaded',init);
