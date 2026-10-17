import { useEffect,useId,useState,type FormEvent } from 'react';
import type { Club,SourceRecord,SyncRun } from '../../shared/types';
import { api } from './api';
import { Badge,DataTable,Modal,date,text,quantity } from './components';
export function ClubForm({club,onClose,onSaved}:{club?:Club;onClose:()=>void;onSaved:(id:string,message:string)=>Promise<void>}) {
  const [busy,setBusy]=useState(false);const [testing,setTesting]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);setBusy(true);setError('');
    const body:Record<string,unknown>=Object.fromEntries(data.entries());body.termsConfirmed=data.get('termsConfirmed')==='on';
    try{
      const saved=await api<{id?:string}>(club?`clubs/${club.id}/credential`:'clubs',body);
      const id=club?.id||saved.id!;form.reset();setTesting(true);
      let message='Connection saved and verified. Review API Routes, run a reconciliation sync, then activate.';
      try{await api(`clubs/${id}/test`,{});}catch(e){message=`Connection saved, but verification did not complete: ${(e as Error).message} Use Test connection to retry.`;}
      await onSaved(id,message);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);setTesting(false);}
  }
  return <Modal title={club?`Replace token · ${club.name}`:'Connect a club'} onClose={()=>!busy&&onClose()}><form className="club-form" onSubmit={submit} autoComplete="off">
    {!club&&<><h3 className="form-section-title">Club details</h3><label>Club name<input name="name" required maxLength={150} placeholder="Club name"/></label><label>Club brief<textarea name="brief" maxLength={1000} placeholder="A short description of the club"/></label><h3 className="form-section-title">EFM connection</h3><label>EFM website URL<input name="baseUrl" type="url" required placeholder="https://efm.example.com"/><small>Use the approved EFM website address, without a path.</small></label></>}
    <label>EFM integration key or access token<input type="password" name="token" autoComplete="new-password" required minLength={20} maxLength={10000} spellCheck={false} placeholder="Paste your efm_live_ key or existing access token"/><small>Integration keys stay valid until revoked. Stored encrypted and masked after saving. Do not paste credentials into chat or email.</small></label>
    <label>Scopes granted by EFM<textarea name="scopeNotes" maxLength={1000} defaultValue={club?.scopeNotes} placeholder="Read-only datasets approved by the EFM administrator"/></label><label>EFM rate limits<textarea name="rateLimitNotes" maxLength={1000} defaultValue={club?.rateLimitNotes} placeholder="Record administrator-provided limits, or leave blank if not provided"/></label>
    <h3 className="form-section-title">Club authorisation</h3><div className="form-row"><label>Issued by<input name="issuer" required minLength={2} maxLength={150} defaultValue={club?.issuer} placeholder="EFM account owner / administrator"/></label><label>Authorisation reference<input name="authorisation" required minLength={5} maxLength={1000} defaultValue={club?.authorisation} placeholder="Written approval reference"/></label></div>
    {!club&&<label className="checkbox"><input type="checkbox" name="termsConfirmed" required/>The club has approved this integration in writing and its EFM terms permit this use.</label>}
    <p className="notice">HRD uses existing EFM access only. No EFM configuration or permissions will be changed.</p>{error&&<p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{testing?'Testing connection…':busy?'Saving…':club?'Replace token':'Save connection'}</button></div>
  </form></Modal>;
}
const datasetNames:Record<string,string>={connection:'EFM connection',employee:'Employees',horse:'Horses',careTeam:'Care team',health:'Health',medicine:'Treatment',feedInventory:'Feed stock',consumption:'Consumption',grocery:'Groceries',feedPlan:'Feed plans',groceryUsage:'Grocery usage'};
const syncStates:Record<string,string>={running:'In progress',success:'Complete',limited:'Complete with unavailable datasets',partial:'Incomplete — previous data retained',error:'Failed — previous data retained'};
function datasetResult(value:string) {
  if(value.startsWith('ok:'))return `${value.slice(3)} records imported`;
  return ({denied:'Access denied by EFM',credential_required:'Replace the EFM credential',paused:'Paused after a credential failure',error:'Import failed; previous data retained'} as Record<string,string>)[value]||value;
}
export function SyncHistory({club,onClose}:{club:Club;onClose:()=>void}) {
  const [runs,setRuns]=useState<SyncRun[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let live=true;setLoading(true);setError('');
    api<SyncRun[]>(`clubs/${club.id}/status`).then(result=>{if(live)setRuns(result);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[club.id,attempt]);
  return <Modal title={`Sync history · ${club.name}`} onClose={onClose}>
    <p className="dialog-copy">Review each dataset before activation. Failed imports retain their previous cached records. Times are shown in Asia/Kolkata.</p>
    <div className="dialog-actions"><button disabled={loading} onClick={()=>setAttempt(v=>v+1)}>{loading?'Loading…':'Refresh history'}</button></div>
    {error&&<p className="dialog-copy error" role="alert">{error}</p>}
    {!loading&&!error&&!runs.length&&<p className="dialog-copy">No syncs recorded yet. Run Sync & reconcile from the club card.</p>}
    {runs.map((run,index)=><section className="sync-run" key={`${run.started_at}:${index}`}>
      <header><h3>{date(run.started_at,true)}</h3><Badge tone={run.state==='success'?'good':run.state==='error'||run.state==='partial'?'bad':'warn'}>{syncStates[run.state]}</Badge></header>
      <p className="muted">{run.finished_at?`Finished ${date(run.finished_at,true)}`:'No completion recorded yet. Refresh to check progress.'}</p>
      <DataTable searchable={false} headers={['Dataset','Result']} empty="Waiting for dataset results." rows={Object.entries(run.datasets).map(([name,result])=>({key:name,search:name,cells:[datasetNames[name]||name,datasetResult(result)]}))}/>
    </section>)}
  </Modal>;
}
export function EmployeeDetails({employee,records,clubName,onClose}:{employee:SourceRecord;records:SourceRecord[];clubName:string;onClose:()=>void}) {
  const d=employee.data;const supervisor=d.supervisor as Record<string,unknown>|undefined;
  const assignments=records.filter(r=>r.clubId===employee.clubId&&r.type==='careTeam'&&r.data.staffId===employee.sourceId);
  return <Modal title={`${text(d.fullName)} · ${clubName}`} onClose={onClose}><div className="horse-profile">
    <Badge>{text(d.employmentStatus)}</Badge><dl>{[['Role','designation'],['Department','department'],['Email','email'],['Phone','phoneNumber'],['Shift','shiftTiming']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{text(d[key])}</dd></div>)}
      <div><dt>Supervisor</dt><dd>{text(supervisor?.fullName)}</dd></div><div><dt>EFM approval</dt><dd>{d.isApproved===true?'Approved':d.isApproved===false?'Pending approval':'Unavailable'}</dd></div>
      <div><dt>Joining date</dt><dd>Unavailable</dd></div><div><dt>Club</dt><dd>{clubName}</dd></div><div><dt>EFM employee ID</dt><dd>{employee.sourceId}</dd></div>
    </dl><small>Profile synced {date(employee.syncedAt,true)}</small>
    <h3>Horse assignments</h3><DataTable headers={['Horse','Role','Assigned','Status']} rows={assignments.map(r=>({key:r.id,search:JSON.stringify(r.data),cells:[text(records.find(h=>h.clubId===employee.clubId&&h.type==='horse'&&h.sourceId===r.data.horseId)?.data.name),text(r.data.role),date(r.data.assignedDate),r.data.isActive===true?'Active':r.data.isActive===false?'Inactive':'Unavailable']}))}/>
  </div></Modal>;
}
export function Activation({club,onClose,onActivate,errorMessage=''}:{errorMessage?:string;club:Club;onClose:()=>void;onActivate:()=>Promise<boolean>}) {
  const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Modal title={`Activate ${club.name}`} onClose={()=>!busy&&onClose()}><div className="dialog-copy"><p>Check these imported counts and feed totals against EFM before enabling scheduled updates.</p><div className="reconcile-counts"><strong>{club.employeeCount} employees</strong><strong>{club.horseCount} horses</strong></div><p>Last successful available-data sync: {date(club.lastSuccessAt,true)}</p><label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reconciled the counts and feed totals, and reviewed unavailable datasets.</label><p className="muted">Activation requires a successful sync within the last 15 minutes and access to employees and horses.</p>{(errorMessage||error)&&<p className="error" role="alert">{errorMessage||error}</p>}</div><div className="dialog-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button disabled={!confirmed||busy} className="primary" onClick={async()=>{setBusy(true);try{setError('');if(!await onActivate())setError('Activation could not complete. Run a fresh reconciliation sync, review access, and try again.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'Activating…':'Activate scheduled sync'}</button></div></Modal>;
}
function documentLinks(value:unknown) {
  if(typeof value!=='string'||!value)return 'Unavailable';
  let items:unknown[];try{const parsed=JSON.parse(value);items=Array.isArray(parsed)?parsed:[parsed];}catch{items=[value];}
  return items.map((item,i)=>{const raw=typeof item==='string'?item:typeof item==='object'&&item?String((item as Record<string,unknown>).url||''):'';
    try{const url=new URL(raw);if(url.protocol==='https:'&&!url.username&&!url.password)return <a key={i} href={url.href} target="_blank" rel="noreferrer">Document {i+1}</a>;}catch{/* Unavailable references remain text, never executable markup. */}return <span key={i}>Document reference unavailable</span>;});
}
export function HorseDetails({horse,records,clubName,onClose}:{horse:SourceRecord;records:SourceRecord[];clubName:string;onClose:()=>void}) {
  const detailId=useId();const detailTabs=['Profile','Care team','Health','Treatment','Feed','Training','Owner','Stable','Documents'];
  const [tab,setTab]=useState('Profile');const related=(type:string)=>records.filter(r=>r.type===type&&r.data.horseId===horse.sourceId);const d=horse.data;
  const health=related('health');const extra=health.find(r=>typeof r.data.horse==='object'&&r.data.horse)?.data.horse as Record<string,unknown>|undefined;
  const profile={...extra,...d};const feeds=related('consumption').filter(r=>r.data.kind==='horse'&&Number(r.data.quantity)>0);
  const unit=(feed:unknown)=>text(records.find(r=>r.type==='feedInventory'&&r.data.feedType===feed)?.data.unit);
  const plans=related('feedPlan');
  const feedFields=['sports','balance','growth','oats','barley','soya','linseed','bran','salt','dcp','epsom','riceBranOil','heylage','lucerne','electrolyte','diggyMax','coolMix'];
  return <Modal title={`${text(d.name)} · ${clubName}`} onClose={onClose}><div className="detail-tabs" role="tablist" aria-label="Horse information">{detailTabs.map((name,index)=><button key={name} id={`${detailId}-tab-${index}`} role="tab" aria-controls={`${detailId}-panel`} aria-selected={name===tab} tabIndex={name===tab?0:-1} onClick={()=>setTab(name)} onKeyDown={event=>{const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(!direction&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?detailTabs.length-1:(index+direction+detailTabs.length)%detailTabs.length;setTab(detailTabs[next]);document.getElementById(`${detailId}-tab-${next}`)?.focus();}}>{name}</button>)}</div><div id={`${detailId}-panel`} role="tabpanel" aria-labelledby={`${detailId}-tab-${detailTabs.indexOf(tab)}`}>
    {tab==='Profile'&&<div className="horse-profile"><Badge>{text(d.status)}</Badge><dl>{[['Breed','breed'],['Sex','gender'],['Date of birth','dateOfBirth'],['Age','age'],['Colour','color'],['Height','height'],['Stable number','stableNumber'],['Owner','ownerName'],['Owner contact','ownerContact'],['Discipline','discipline'],['Passport number','passportNumber']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{key==='dateOfBirth'?(profile[key]?date(profile[key]):'Unavailable'):text(profile[key])}</dd></div>)}</dl><p className="notice">Training history and fields not exposed by the existing approved APIs are unavailable.</p><small>Profile synced {date(horse.syncedAt,true)}</small></div>}
    {tab==='Care team'&&<DataTable headers={['Employee','Role','Assignment','Status']} rows={related('careTeam').map(r=>({key:r.id,search:JSON.stringify(r.data),cells:[text((r.data.staff as Record<string,unknown>|undefined)?.fullName),text(r.data.role),date(r.data.assignedDate),r.data.isActive===true?'Active':r.data.isActive===false?'Inactive':'Unavailable']}))}/>}
    {tab==='Health'&&<DataTable headers={['Record','Date','Description','Next due','Synced']} rows={health.map(r=>({key:r.id,search:JSON.stringify(r.data),cells:[text(r.data.recordType),date(r.data.date),text(r.data.description),date(r.data.nextDueDate),date(r.syncedAt,true)]}))}/>}
    {tab==='Treatment'&&<DataTable headers={['Medicine','Quantity','Administered','Approval','Synced']} rows={related('medicine').map(r=>({key:r.id,search:JSON.stringify(r.data),cells:[text(r.data.medicineName),`${quantity(r.data.quantity)} ${text(r.data.unit)}`,date(r.data.timeAdministered,true),text(r.data.approvalStatus),date(r.syncedAt,true)]}))}/>}
    {tab==='Feed'&&<><h3>Recorded feed plans</h3><p className="notice detail-notice">Plan quantities are EFM's recorded values. They are separate from consumption totals.</p><DataTable headers={['Recorded date','Menu / period','Feed quantities','Notes','Synced']} rows={plans.map(r=>({key:r.id,search:JSON.stringify(r.data),cells:[date(r.data.date),<>{text(r.data.temporaryMenuName)}<small>{r.data.menuStartAt?`${date(r.data.menuStartAt,true)} – ${date(r.data.menuEndAt,true)}`:'No temporary menu period'}</small></>,feedFields.filter(f=>typeof r.data[f]==='number').map(f=><small key={f}>{f}: {quantity(r.data[f])} {unit(f)==='Unavailable'?'':unit(f)}</small>),text(r.data.notes),date(r.syncedAt,true)]}))}/><h3>Recorded consumption</h3><p className="muted">Totals from 1 January 2000 through the latest sync.</p><DataTable headers={['Feed','Total consumed','Unit','Synced']} rows={feeds.map(r=>({key:r.id,search:text(r.data.feedType),cells:[text(r.data.feedType),quantity(r.data.quantity),unit(r.data.feedType),date(r.syncedAt,true)]}))}/></>}
    {tab==='Training'&&<div className="horse-profile"><dl><div><dt>Training level</dt><dd>{text(profile.trainingLevel)}</dd></div><div><dt>Discipline</dt><dd>{text(profile.discipline)}</dd></div><div><dt>Workload limit</dt><dd>{text(profile.workloadLimit)}</dd></div></dl><p className="notice">EFM exposes the current training profile. A dated training-session history is not available.</p></div>}
    {tab==='Owner'&&<div className="horse-profile"><dl><div><dt>Owner</dt><dd>{text(profile.ownerName)}</dd></div><div><dt>Owner contact</dt><dd>{text(profile.ownerContact)}</dd></div></dl></div>}
    {tab==='Stable'&&<div className="horse-profile"><dl><div><dt>Stable number</dt><dd>{text(profile.stableNumber)}</dd></div><div><dt>Location</dt><dd>{text(profile.location)}</dd></div><div><dt>Club</dt><dd>{clubName}</dd></div></dl></div>}
    {tab==='Documents'&&<DataTable headers={['Health record','Date','Document references']} rows={health.map(r=>({key:r.id,search:text(r.data.recordType),cells:[text(r.data.recordType),date(r.data.date),<div className="document-links">{documentLinks(r.data.documents)}</div>]}))}/>}
  </div></Modal>;
}
