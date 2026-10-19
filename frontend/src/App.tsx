import { useCallback,useEffect,useRef,useState } from 'react';
import { Wheat,Users,Building2,GitBranch,Route,RefreshCw,Plus,LogOut,ArrowUpRight,ShieldCheck,Menu,X,Activity,HeartPulse,Database } from 'lucide-react';
import type { Club,Dashboard,SessionUser,SourceRecord } from '../../shared/types';
import { api,ApiError,setSession } from './api';
import { Badge,DataTable,DataNote,Empty,Identity,LoadingPanel,Modal,date,text,quantity } from './components';
import { ClubForm,HorseDetails,EmployeeDetails,SyncHistory,Activation } from './forms';
import { EntityMap } from './map';
import { Health } from './health';
import { EfmData } from './efmData';

type Tab='Food'|'Employees'|'Clubs'|'Horses'|'Health'|'Entity Map'|'EFM Data'|'API Routes';
const tabs:{name:Tab;icon:typeof Wheat;description:string}[]=[
  {name:'Food',icon:Wheat,description:'Feed, groceries and recorded consumption.'},
  {name:'Employees',icon:Users,description:'The people keeping each club moving.'},
  {name:'Clubs',icon:Building2,description:'Connections, credentials and data freshness.'},
  {name:'Horses',icon:Activity,description:'Profiles, care assignments and health records.'},
  {name:'Health',icon:HeartPulse,description:'Care due dates, treatments and the HRD care guide.'},
  {name:'Entity Map',icon:GitBranch,description:'Explore the relationships inside a club.'},
  {name:'EFM Data',icon:Database,description:'Every table EFM shares with HRD, searchable and sortable.'},
  {name:'API Routes',icon:Route,description:'Available routes and the health of your connections.'}
];
declare global {interface Window {google?:{accounts:{id:{initialize:(options:{client_id:string;callback:(response:{credential:string})=>void})=>void;renderButton:(element:HTMLElement,options:Record<string,unknown>)=>void;disableAutoSelect:()=>void}}};}}
function SignIn({onLogin}:{onLogin:(user:SessionUser)=>void}) {
  const [error,setError]=useState('');const [ready,setReady]=useState<boolean|null>(null);const [demo,setDemo]=useState(false);
  const [phone,setPhone]=useState('');const [code,setCode]=useState('');const [busy,setBusy]=useState(false);
  const demoSignIn=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');
    try{onLogin(await api<SessionUser>('auth/demo',{phone,code}));}catch(err){setError((err as Error).message);}finally{setBusy(false);}};
  useEffect(()=>{
    let live=true;let script:HTMLScriptElement|undefined;
    api<{googleClientId:string|null;authReady:boolean;demoLogin?:boolean}>('config').then(config=>{
      if(!live)return;setReady(config.authReady);setDemo(!!config.demoLogin);
      if(!config.authReady||!config.googleClientId)return;
      const render=()=>{if(!live)return;const el=document.getElementById('google-sign-in');if(!el||!window.google)return;
        window.google.accounts.id.initialize({client_id:config.googleClientId!,callback:response=>{api<SessionUser>('auth/google',{credential:response.credential}).then(onLogin).catch(e=>setError(e.message));}});
        window.google.accounts.id.renderButton(el,{theme:'outline',size:'large',width:Math.min(360,el.parentElement?.clientWidth||300),text:'signin_with',shape:'rectangular'});
      };
      if(window.google)render();else{script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=render;script.onerror=()=>live&&setError('Google sign-in could not load. Check your connection and reload.');document.head.append(script);}
    }).catch(e=>live&&setError(e.message));
    return()=>{live=false;script?.remove();};
  },[onLogin]);
  return <main className="login"><section className="login-intro"><span className="confidential"><ShieldCheck size={16}/> Internal access only</span><h1>Every club.<br/>One clear view.</h1><p>Horse Real-Time Data brings your club’s people, horses and inventory together.</p><div className="login-foot">HRD <span>LookAround</span></div></section><section className="login-form"><div><h2>Sign in to HRD</h2><p>Use your approved administrator Google account.</p><div id="google-sign-in"/>{demo&&<form className="demo-login" onSubmit={demoSignIn}><p className="muted">Temporary demo access</p><label>Phone number<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} required/></label><label>Access code<input type="password" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} required/></label><button className="primary" type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>}{ready===false&&!demo&&<div className="notice">Administrator sign-in is awaiting setup. Contact the HRD administrator.</div>}{ready===null&&!error&&<p className="muted">Checking sign-in availability…</p>}{error&&<p role="alert" className="error">{error}</p>}<div className="login-note"><ShieldCheck size={20}/><p>Club access stays private. EFM credentials are held securely by HRD and never appear in dashboard data.</p></div></div></section></main>;
}
const emptyDashboard:Dashboard={clubs:[],records:[],checks:[],catalog:[]};
export default function App() {
  const [session,setUser]=useState<SessionUser|null>(null);const [loading,setLoading]=useState(true);const [data,setData]=useState<Dashboard>(emptyDashboard);
  const [tab,setTab]=useState<Tab>('Clubs');const [clubId,setClubId]=useState('all');const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState<string|null>(null);const [mobile,setMobile]=useState(false);
  const [refreshFailed,setRefreshFailed]=useState(false);const [dataLoading,setDataLoading]=useState(true);const [dataLoaded,setDataLoaded]=useState(false);const [smallScreen,setSmallScreen]=useState(()=>window.matchMedia('(max-width: 760px)').matches);const menuRef=useRef<HTMLButtonElement>(null);const navigationRef=useRef<HTMLElement>(null);
  const closeNavigation=()=>{setMobile(false);requestAnimationFrame(()=>menuRef.current?.focus());};
  useEffect(()=>{const media=window.matchMedia('(max-width: 760px)');const change=()=>{setSmallScreen(media.matches);if(!media.matches)setMobile(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    if(!mobile)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const buttons=()=>Array.from(navigationRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);
    const frame=requestAnimationFrame(()=>buttons()[0]?.focus());
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setMobile(false);requestAnimationFrame(()=>menuRef.current?.focus());}
      if(event.key==='Tab'){const controls=buttons();const first=controls[0];const last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown',keydown);
    return()=>{cancelAnimationFrame(frame);document.body.style.overflow=previous;window.removeEventListener('keydown',keydown);};
  },[mobile]);
  const [modal,setModalState]=useState<{type:'add'|'token'|'horse'|'activate'|'disconnect'|'audit'|'employee'|'syncHistory';club?:Club;horse?:SourceRecord;employee?:SourceRecord}|null>(null);
  const [modalError,setModalError]=useState('');
  const setModal=(next:typeof modal)=>{setModalError('');setModalState(next);};
  const login=useCallback((user:SessionUser)=>{setDataLoading(true);setSession(user);setUser(user);},[]);
  const refresh=useCallback(async()=>{
    setDataLoading(true);try{setData(await api<Dashboard>('dashboard'));setDataLoaded(true);setRefreshFailed(false);setError('');}catch(e){if(e instanceof ApiError&&e.status===401){setSession(null);setUser(null);setData(emptyDashboard);setDataLoaded(false);setDataLoading(true);}else{setRefreshFailed(true);setError((e as Error).message);}}finally{setDataLoading(false);}
  },[]);
  useEffect(()=>{api<SessionUser>('auth/session').then(login).catch(e=>{if(!(e instanceof ApiError&&e.status===401))setError(e.message);}).finally(()=>setLoading(false));},[login]);
  useEffect(()=>{if(!session)return;void refresh();const timer=setInterval(()=>void refresh(),60000);return()=>clearInterval(timer);},[session,refresh]);
  async function action(club:Club,kind:string,body:unknown={}) {
    setBusy(`${club.id}:${kind}`);setError('');setModalError('');setMessage('');
    try{const result=await api<{state?:string;message?:string;datasets?:Record<string,string>}>(`clubs/${club.id}/${kind}`,body);
      setMessage(result.message||(kind==='sync'?`Sync ${result.state?.replaceAll('_',' ')}. ${Object.entries(result.datasets||{}).map(([key,v])=>`${({employee:'Employees',horse:'Horses',careTeam:'Care team',health:'Health',medicine:'Treatment',feedInventory:'Feed stock',grocery:'Groceries',consumption:'Consumption',feedPlan:'Feed plans',groceryUsage:'Grocery usage',horseProfile:'Horse profiles',farrier:'Farrier shoeing',inspection:'Inspections',accident:'Accident reports',efmExport:'Full EFM export'} as Record<string,string>)[key]||key}: ${v.replaceAll('_',' ')}`).join('; ')}`:`${kind==='activate'?'Club activated':kind==='disconnect'?'Club disconnected':'Action completed'}.`));await refresh();return true;
    }catch(e){setError((e as Error).message);setModalError((e as Error).message);return false;}finally{setBusy(null);}
  }
  if(loading)return <main className="boot"><RefreshCw className="spin" size={25}/>Opening HRD…</main>;
  if(!session)return <><SignIn onLogin={login}/>{error&&<div className="global-error" role="alert">{error}</div>}</>;
  const clubs=data.clubs.filter(c=>clubId==='all'||c.id===clubId);const selected=data.clubs.find(c=>c.id===clubId);
  const records=data.records.filter(r=>clubId==='all'||r.clubId===clubId);
  const clubName=(id:string)=>data.clubs.find(c=>c.id===id)?.name||'Unknown club';
  const config=tabs.find(t=>t.name===tab)!;
  const stale=clubs.filter(c=>c.status!=='disconnected'&&c.stale);
  const count=(type:string)=>records.filter(r=>r.type===type).length;
  return <div className="app-shell"><aside ref={navigationRef} id="main-navigation" inert={smallScreen&&!mobile} className={`sidebar ${mobile?'open':''}`}><header><div className="wordmark">HRD<span>Horse Real-Time Data</span></div><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={closeNavigation}><X size={20}/></button></header><nav aria-label="Main navigation">{tabs.map(({name,icon:Icon})=><button key={name} aria-current={name===tab?'page':undefined} className={name===tab?'active':''} onClick={()=>{setTab(name);if(smallScreen)closeNavigation();}}><Icon size={20}/>{name}</button>)}</nav><div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={18}/><span>Confidential<br/><small>Admin access only</small></span></div><p>{session.email}</p><button onClick={async()=>{try{await api('auth/logout',{});window.google?.accounts.id.disableAutoSelect();setSession(null);setUser(null);setData(emptyDashboard);setDataLoaded(false);setDataLoading(true);}catch(e){setError((e as Error).message);}}}><LogOut size={17}/> Sign out</button></div></aside>
    <button className={`nav-backdrop ${mobile?'visible':''}`} tabIndex={-1} aria-label="Close navigation overlay" onClick={closeNavigation}/><main className="workspace" inert={smallScreen&&mobile}><div className="topbar"><button ref={menuRef} className="icon-button mobile-menu" aria-expanded={mobile} aria-controls="main-navigation" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={22}/></button><span className="breadcrumb">HRD <span>/</span> Club operations</span><div><span className={`sync-dot ${stale.length?'stale':''}`}/><span className="sync-label">{dataLoading?'Refreshing data…':!dataLoaded?'Connection unavailable':refreshFailed?'Refresh failed':stale.length?'Refresh needed':clubs.some(c=>c.status==='active')?'Sync every 5 min':'Awaiting activation'}</span><button className="icon-button" disabled={dataLoading} onClick={()=>void refresh()} aria-label="Refresh dashboard"><RefreshCw className={dataLoading?'spin':''} size={17}/></button></div></div>
      <header className="page-header"><div><h1>{tab}</h1><p>{config.description}</p></div><div className="header-controls"><label className="club-select">Club<select aria-label="Club" value={clubId} onChange={e=>setClubId(e.target.value)}><option value="all">All clubs</option>{data.clubs.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{tab==='Clubs'&&<button className="primary" onClick={()=>setModal({type:'add'})}><Plus size={17}/> Add club</button>}</div></header>
      {error&&<div className="banner error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={17}/></button></div>}
      {message&&<div className="banner" role="status">{message}<button aria-label="Dismiss message" onClick={()=>setMessage('')}><X size={17}/></button></div>}
      {stale.length>0&&<div className="freshness">{stale.length} {stale.length===1?'club needs':'clubs need'} a fresh sync. Cached records remain visible; check each dataset’s timestamp.</div>}
      {dataLoaded&&<div className="summary-strip"><div><span>Connected clubs</span><strong>{clubs.filter(c=>c.status==='active').length}<small> / {clubs.length}</small></strong></div><div><span>Employees</span><strong>{count('employee')}</strong></div><div><span>Horses</span><strong>{count('horse')}</strong></div><div><span>Last successful sync</span><strong className="summary-date">{date(clubs.map(c=>c.lastSuccessAt).filter((v):v is string=>!!v).sort().at(-1),true)}</strong><small>Asia/Kolkata</small></div></div>}
      {!dataLoaded?(dataLoading?<LoadingPanel/>:<Empty title="Club data could not load" description="HRD could not retrieve dashboard records. Check the connection and try again." action={<button onClick={()=>void refresh()}><RefreshCw size={17}/> Try again</button>}/>):!data.clubs.length&&tab!=='API Routes'?<Empty title="Connect your first club" description="Add an approved EFM connection, review the imported counts, then activate its scheduled sync." action={<button className="primary" onClick={()=>setModal({type:'add'})}><Plus size={17}/> Add club</button>}/>:<>
      {tab==='Clubs'&&<><div className="onboarding-guide"><span>Connection checklist</span><ol><li>Test access</li><li>Sync & reconcile</li><li>Activate updates</li></ol></div><section className="clubs-grid">{clubs.map(club=><article className="club-card" key={club.id}><div className="club-heading"><Building2 size={23}/><Badge tone={club.status==='active'&&!club.stale?'good':club.status==='credential_required'?'bad':'warn'}>{club.status.replaceAll('_',' ')}</Badge></div><h2>{club.name}</h2><p>{club.brief||'No club brief provided.'}</p><div className="club-counts"><div><strong>{club.employeeCount}</strong><span>Employees</span></div><div><strong>{club.horseCount}</strong><span>Horses</span></div></div><dl><div><dt>EFM website</dt><dd>{club.baseUrl}</dd></div><div><dt>EFM credential</dt><dd>{club.credentialMask}</dd></div><div><dt>Credential expires</dt><dd>{club.credentialExpiresAt?date(club.credentialExpiresAt,true):'No recorded expiry'}</dd></div><div><dt>Declared scopes</dt><dd>{club.scopeNotes||'Not provided by EFM administrator'}</dd></div><div><dt>Rate limits</dt><dd>{club.rateLimitNotes||'Not provided by EFM administrator'}</dd></div><div><dt>Last full available sync</dt><dd>{date(club.lastSuccessAt,true)}</dd></div></dl><p className="authorisation">Issued by {club.issuer} · {date(club.collectedAt)}<br/>{club.authorisation}</p><div className="club-actions"><button disabled={!!busy||club.status==='disconnected'} onClick={()=>void action(club,'test')}>{busy===`${club.id}:test`?'Testing…':'Test connection'}</button><button disabled={!!busy||club.status==='disconnected'} onClick={()=>void action(club,'sync')}><RefreshCw size={15}/> {busy===`${club.id}:sync`?'Syncing…':'Sync & reconcile'}</button><button onClick={()=>setModal({type:'syncHistory',club})}>Sync history</button><button disabled={!!busy} onClick={()=>setModal({type:'token',club})}>Replace token</button>{club.status==='pending'&&<button className="primary" disabled={!!busy} onClick={()=>setModal({type:'activate',club})}>Activate</button>}{club.status!=='disconnected'&&<button className="subtle danger" disabled={!!busy} onClick={()=>setModal({type:'disconnect',club})}>Disconnect</button>}</div></article>)}</section></>}
      {tab==='Employees'&&<><DataNote>Joining dates are unavailable in the existing EFM API. Account creation dates are not used as joining dates.</DataNote><DataTable headers={['Employee','Role / department','Contact','Club','Joining date','Status','Synced','Details']} rows={records.filter(r=>r.type==='employee').map(r=>({key:r.id,search:JSON.stringify(r.data)+clubName(r.clubId),cells:[<Identity name={text(r.data.fullName)}/>,<>{text(r.data.designation)}<small>{text(r.data.department)}</small></>,<>{text(r.data.email)}<small>{text(r.data.phoneNumber)}</small></>,clubName(r.clubId),'Unavailable',<Badge>{text(r.data.employmentStatus)}</Badge>,date(r.syncedAt,true),<button className="subtle" onClick={()=>setModal({type:'employee',employee:r})}>View <ArrowUpRight size={15}/></button>]}))}/></>}
      {tab==='Horses'&&<><DataNote>Horse details include recorded feed plans, health and training profiles. Dated training history and fields not exposed by EFM remain unavailable.</DataNote><DataTable headers={['Horse','Breed / sex','Stable','Owner','Club','Status','Details']} rows={records.filter(r=>r.type==='horse').map(r=>({key:r.id,search:JSON.stringify(r.data)+clubName(r.clubId),cells:[<Identity name={text(r.data.name)}/>,<>{text(r.data.breed)}<small>{text(r.data.gender)}</small></>,text(r.data.stableNumber,text(r.data.location,'Not recorded')),<>{text(r.data.ownerName,'Not recorded')}<small>{text(r.data.ownerContact,'')}</small></>,clubName(r.clubId),<Badge>{text(r.data.status)}</Badge>,<button className="subtle" onClick={()=>setModal({type:'horse',horse:r})}>View <ArrowUpRight size={15}/></button>]}))}/></>}
      {tab==='Health'&&<Health records={records} clubName={clubName} onHorse={horse=>setModal({type:'horse',horse})}/>}
      {tab==='Food'&&<Food records={records} clubName={clubName}/>}
      {tab==='Entity Map'&&(selected?<EntityMap key={selected.id} club={selected} records={records}/>:<Empty title="Choose a club to explore" description="Each entity map shows one club’s recorded people, horses and feed relationships." action={<div className="map-clubs">{data.clubs.map(c=><button key={c.id} onClick={()=>setClubId(c.id)}>{c.name}</button>)}</div>}/>)}
      {tab==='EFM Data'&&(selected?<EfmData key={selected.id} clubId={selected.id} records={data.records}/>:<Empty title="Choose a club to browse" description="EFM data is mirrored per club. Pick the club whose EFM tables you want to explore." action={<div className="map-clubs">{data.clubs.map(c=><button key={c.id} onClick={()=>setClubId(c.id)}>{c.name}</button>)}</div>}/>)}
      {tab==='API Routes'&&<><DataNote>Only reviewed read routes receive live checks. EFM routes that write data when read, and all unreviewed routes, are excluded from requests.</DataNote><DataTable headers={['Route','Methods','HRD access','Last check','Response','Latency']} rows={(clubs.length?clubs.flatMap(club=>(club.routeCatalog||data.catalog).map(route=>({club,route}))):data.catalog.map(route=>({club:undefined,route}))).map(({club,route})=>{
        const checks=data.checks.filter(c=>c.clubId===club?.id&&(c.route===route.path||(route.path==='/api/employees/[id]'&&/^\/api\/employees\/[^/]+$/.test(c.route))));const check=checks.sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0];
        return {key:`${club?.id||'catalog'}:${route.path}`,search:route.path+route.reason+(club?.name||''),cells:[<><strong className="route-path">{route.path}</strong><small>{club?.name||'Route catalog'} · {route.reason}</small></>,route.methods.join(', '),<Badge tone={route.safe?'neutral':'warn'}>{route.safe?(check?.state.replaceAll('_',' ')||'Not tested'):'Excluded'}</Badge>,date(check?.checkedAt,true),check?.status||'Not tested',check?`${check.latencyMs} ms`:'—']};
      })}/></>}
      </>}
      <footer className="workspace-footer"><span>EFM data is read only. Unsupported fields stay unavailable.</span><button className="subtle" onClick={()=>setModal({type:'audit'})}>Activity log</button></footer>
    </main>
    {modal&&(modal.type==='add'||modal.type==='token')&&<ClubForm club={modal.club} onClose={()=>setModal(null)} onSaved={async(id,message)=>{setModal(null);setTab('Clubs');setClubId(id);await refresh();setMessage(message);}}/>}
    {modal?.type==='employee'&&modal.employee&&<EmployeeDetails employee={modal.employee} records={data.records} clubName={clubName(modal.employee.clubId)} onClose={()=>setModal(null)}/>}
    {modal?.type==='syncHistory'&&modal.club&&<SyncHistory club={modal.club} onClose={()=>setModal(null)}/>}
    {modal?.type==='horse'&&modal.horse&&<HorseDetails horse={modal.horse} records={data.records.filter(r=>r.clubId===modal.horse!.clubId)} clubName={clubName(modal.horse.clubId)} onClose={()=>setModal(null)}/>}
    {modal?.type==='activate'&&modal.club&&<Activation errorMessage={modalError} club={modal.club} onClose={()=>setModal(null)} onActivate={async()=>{const success=await action(modal.club!,'activate',{reconciled:true});if(success)setModal(null);return success;}}/>}
    {modal?.type==='disconnect'&&modal.club&&<Modal title={`Disconnect ${modal.club.name}?`} onClose={()=>!busy&&setModal(null)}><p className="dialog-copy">Scheduled sync will stop and HRD will delete the stored access token immediately. Cached personal data will be purged within 30 days.</p>{modalError&&<p className="dialog-copy error" role="alert">{modalError}</p>}<div className="dialog-actions"><button disabled={!!busy} onClick={()=>setModal(null)}>Cancel</button><button className="primary" disabled={!!busy} onClick={async()=>{if(await action(modal.club!,'disconnect'))setModal(null);}}>{busy?'Disconnecting…':'Disconnect club'}</button></div></Modal>}
    {modal?.type==='audit'&&<AuditLog onClose={()=>setModal(null)}/>}
  </div>;
}
function Food({records,clubName}:{records:SourceRecord[];clubName:(id:string)=>string}) {
  const today=new Date().toISOString().slice(0,10);
  // Default to the last 30 days, widened back to the latest month EFM has feed figures or daily consumption for,
  // so a club that hasn't recorded food recently still opens on its most recent data instead of an empty range.
  const [from,setFrom]=useState(()=>{
    const recent=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const latest=records.reduce((max,r)=>{
      const d=r.type==='feedInventory'?`${r.data.year}-${String(r.data.month).padStart(2,'0')}-01`:r.type==='consumption'&&r.data.kind==='day'?text(r.data.date).slice(0,7)+'-01':'';
      return /^\d{4}-\d{2}-01$/.test(d)&&d>max?d:max;
    },'');
    return latest&&latest<recent?latest:recent;
  });const [to,setTo]=useState(today);
  const invalid=!from||!to||from>to;const inventories=records.filter(r=>r.type==='feedInventory');
  const unit=(club:string,feed:unknown)=>text(inventories.find(r=>r.clubId===club&&r.data.feedType===feed)?.data.unit);
  const consumption=records.filter(r=>r.type==='consumption'&&r.data.kind==='day'&&text(r.data.date)>=from&&text(r.data.date)<=to);
  const total=new Map<string,{club:string;feed:string;quantity:number}>();for(const r of consumption){const key=`${r.clubId}:${r.data.feedType}`;const row=total.get(key)||{club:r.clubId,feed:text(r.data.feedType),quantity:0};row.quantity+=Number(r.data.quantity)||0;total.set(key,row);}
  const rows=records.filter(r=>{
    if(r.type==='feedInventory'){const month=`${r.data.year}-${String(r.data.month).padStart(2,'0')}`;return month>=from.slice(0,7)&&month<=to.slice(0,7);}
    if(r.type==='grocery'){const d=typeof r.data.purchaseDate==='string'?r.data.purchaseDate.slice(0,10):null;return !d||(d>=from&&d<=to);}return false;
  });
  return <><div className="date-filters"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} required/></label><span>EFM consumption uses source UTC dates.</span></div>{invalid?<p className="error" role="alert">Choose both dates. The end date must be on or after the start date.</p>:<><DataNote>Feed balances, additions and total usage are monthly source figures, including when you select part of a month. Grocery usage is shown separately as recorded monthly tracker figures; groceries without a purchase date remain visible.</DataNote><DataTable headers={['Food item','Source period','Club','Stock / balance','Added','Total used','Synced']} rows={rows.map(r=>({key:r.id,search:JSON.stringify(r.data)+clubName(r.clubId),cells:[<><strong>{text(r.type==='feedInventory'?r.data.feedType:r.data.name)}</strong><small>{r.type==='feedInventory'?'Horse feed':'Groceries'}</small></>,r.type==='feedInventory'?`${r.data.month}/${r.data.year} · monthly`:date(r.data.purchaseDate),clubName(r.clubId),`${quantity(r.type==='feedInventory'?r.data.unitsLeft:r.data.quantity)} ${text(r.data.unit)}`,r.type==='feedInventory'?`${quantity(r.data.unitsBrought)} ${text(r.data.unit)} / month`:'Unavailable',r.type==='feedInventory'?`${quantity(r.data.totalUsed)} ${text(r.data.unit)} / month`:'Unavailable',date(r.syncedAt,true)]}))}/><h2 className="subheading">Feed consumed in selected dates</h2><DataTable headers={['Feed','Club','Recorded consumption','Unit']} rows={[...total.entries()].map(([key,r])=>({key,search:r.feed+clubName(r.club),cells:[r.feed,clubName(r.club),quantity(r.quantity),unit(r.club,r.feed)]}))}/><GroceryUsage records={records.filter(r=>r.type==='groceryUsage'&&`${r.data.year}-${String(r.data.month).padStart(2,'0')}`>=from.slice(0,7)&&`${r.data.year}-${String(r.data.month).padStart(2,'0')}`<=to.slice(0,7))} clubName={clubName}/></>}</>;
}
function GroceryUsage({records,clubName}:{records:SourceRecord[];clubName:(id:string)=>string}) {
  const total=(r:SourceRecord,suffix:string)=>{
    const values=[1,2,3,4].map(week=>r.data[`w${week}${suffix}`]);
    return values.every((v):v is number=>typeof v==='number')?values.reduce((sum,value)=>sum+value,0):null;
  };
  const amount=(r:SourceRecord,value:unknown)=>`${quantity(value)} ${typeof r.data.unit==='string'?r.data.unit:''}`;
  return <><h2 className="subheading">Recorded grocery usage · monthly</h2><p className="notice">Weekly source entries are summed for their month. Partial-month date selections show the full recorded month; purchases and receipts are separate source figures.</p><DataTable headers={['Grocery','Month','Club','Opening','Purchased','Received','Used','Balance','Synced']} rows={records.map(r=>({key:r.id,search:JSON.stringify(r.data)+clubName(r.clubId),cells:[<><strong>{text(r.data.itemName)}</strong><small>{text(r.data.category)}</small></>,`${r.data.month}/${r.data.year} · monthly`,clubName(r.clubId),amount(r,r.data.openingStock),amount(r,r.data.purchaseStock),amount(r,total(r,'Received')),amount(r,total(r,'Used')),amount(r,r.data.monthlyBalance),date(r.syncedAt,true)]}))}/></>;
}
function AuditLog({onClose}:{onClose:()=>void}) {
  const [rows,setRows]=useState<Record<string,unknown>[]>([]);const [pending,setPending]=useState(true);const [error,setError]=useState('');useEffect(()=>{api<Record<string,unknown>[]>('audit').then(setRows).catch(e=>setError(e.message)).finally(()=>setPending(false));},[]);
  return <Modal title="Activity log" onClose={onClose}>{error&&<p role="alert" className="error">{error}</p>}<DataTable empty={pending?'Loading activity…':error?'Activity could not be loaded.':'No activity recorded yet.'} headers={['Time','Administrator','Action']} rows={rows.map((r,i)=>({key:String(i),search:JSON.stringify(r),cells:[date(r.created_at,true),text(r.actor),text(r.action).replaceAll('_',' ')]}))}/><p className="dialog-copy muted">The latest 100 events. Audit records are retained for 90 days.</p></Modal>;
}
