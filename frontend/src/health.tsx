import { useMemo,useState } from 'react';
import { ArrowUpRight,Search,X,Stethoscope,ChevronDown } from 'lucide-react';
import type { SourceRecord } from '../../shared/types';
import { Badge,DataTable,DataNote,Empty,Identity,Select,date,text,quantity } from './components';
import { careIntervals,careMatchers,guide,vitals,type CareCategory,type Priority } from './healthGuide';

export const careCategories=Object.keys(careIntervals) as CareCategory[];
export type CareState='overdue'|'soon'|'ok'|'none';
export interface CareItem {category:CareCategory;state:CareState;last?:string;due?:string;days?:number;source?:CareSource;estimated:boolean}
const DAY=86400000;const SOON_DAYS=14;
const validDate=(value:unknown)=>typeof value==='string'&&!Number.isNaN(new Date(value).getTime())?value:undefined;
// A record belongs to one category: its type decides first; generic types (Treatment, Other…) fall back to the description.
export function careCategory(record:SourceRecord):CareCategory|undefined {
  const type=text(record.data.recordType,'');const description=text(record.data.description,'');
  return careCategories.find(c=>careMatchers[c].test(type))||careCategories.find(c=>careMatchers[c].test(description));
}
export type CareSource='Health record'|'Farrier shoeing'|'Medicine log';
export interface CareEvent {category:CareCategory;date:string;nextDue?:string;source:CareSource}
// Care evidence from every EFM source: health records, farrier shoeing (with EFM's own next-due date), and
// approved or pending medicine logs whose medicine or diagnosis names a vaccine or dewormer.
export function careEvents(records:SourceRecord[]):CareEvent[] {
  const events:CareEvent[]=[];
  for(const r of records) {
    if(r.type==='health'){const category=careCategory(r);const d=validDate(r.data.date);if(category&&d)events.push({category,date:d,nextDue:validDate(r.data.nextDueDate),source:'Health record'});}
    if(r.type==='farrier'){const d=validDate(r.data.shoeingDate);if(d)events.push({category:'Farrier',date:d,nextDue:validDate(r.data.nextDueDate),source:'Farrier shoeing'});}
    if(r.type==='medicine'&&!/reject|declin/i.test(text(r.data.approvalStatus,''))){
      const d=validDate(r.data.timeAdministered);const name=`${text(r.data.medicineName,'')} ${text(r.data.diagnosis,'')}`;
      const category=(['Vaccination','Deworming'] as CareCategory[]).find(c=>careMatchers[c].test(name));
      if(category&&d)events.push({category,date:d,source:'Medicine log'});
    }
  }return events;
}
export function careStatus(events:CareEvent[],now=Date.now()):CareItem[] {
  return careCategories.map(category=>{
    const latest=events.filter(e=>e.category===category).sort((a,b)=>b.date.localeCompare(a.date))[0];
    if(!latest)return {category,state:'none',estimated:false};
    const last=latest.date;const recordedDue=latest.nextDue;
    const due=recordedDue||new Date(new Date(last).getTime()+careIntervals[category].days*DAY).toISOString();
    const days=Math.ceil((new Date(due).getTime()-now)/DAY);
    return {category,last,due,days,source:latest.source,estimated:!recordedDue,state:days<0?'overdue':days<=SOON_DAYS?'soon':'ok'};
  });
}
const tones:Record<CareState,'bad'|'warn'|'good'|'neutral'>={overdue:'bad',soon:'warn',ok:'good',none:'neutral'};
export function careLabel(item:CareItem) {
  if(item.state==='none')return 'Not recorded';
  const days=Math.abs(item.days??0);const unit=days===1?'day':'days';
  if(item.state==='overdue')return `Overdue ${days} ${unit}`;
  if(item.state==='soon')return days===0?'Due today':`Due in ${days} ${unit}`;
  return `Due ${date(item.due)}`;
}
export function CareCell({item}:{item:CareItem}) {
  return <><Badge tone={tones[item.state]}>{careLabel(item)}</Badge><small>{item.last?`Last ${date(item.last)} · ${item.source}${item.estimated?' · estimated due':''}`:'No EFM record'}</small></>;
}
export const stableLabel=(horse:SourceRecord)=>typeof horse.data.stableNumber==='string'&&horse.data.stableNumber?`Stable ${horse.data.stableNumber}`:typeof horse.data.location==='string'&&horse.data.location?horse.data.location:'No stable number';
// Horses that have left the club no longer need scheduled care.
const inactiveHorse=/sold|deceased|dead|died|transferred|left/i;

type View='Care schedule'|'Records & treatments'|'Care guide';
type StateFilter='all'|'attention'|'overdue'|'soon'|'none';
export function Health({records,clubName,onHorse}:{records:SourceRecord[];clubName:(id:string)=>string;onHorse:(horse:SourceRecord)=>void}) {
  const [view,setView]=useState<View>('Care schedule');const [state,setState]=useState<StateFilter>('all');const [category,setCategory]=useState<CareCategory|'all'>('all');
  const horses=useMemo(()=>records.filter(r=>r.type==='horse'&&!inactiveHorse.test(text(r.data.status,''))),[records]);
  const horseOf=useMemo(()=>{const map=new Map(records.filter(r=>r.type==='horse').map(r=>[`${r.clubId}:${r.sourceId}`,r]));return (r:SourceRecord)=>map.get(`${r.clubId}:${r.data.horseId}`);},[records]);
  const schedule=useMemo(()=>{
    const byHorse=new Map<string,SourceRecord[]>();
    for(const r of records.filter(r=>r.type==='health'||r.type==='farrier'||r.type==='medicine')){const key=`${r.clubId}:${r.data.horseId}`;const list=byHorse.get(key);if(list)list.push(r);else byHorse.set(key,[r]);}
    return horses.map(horse=>({horse,items:careStatus(careEvents(byHorse.get(`${horse.clubId}:${horse.sourceId}`)||[]))}));
  },[records,horses]);
  const pending=records.filter(r=>r.type==='medicine'&&/pending|awaiting/i.test(text(r.data.approvalStatus,'')));
  const items=schedule.flatMap(s=>s.items);
  const needing=(c:CareCategory)=>schedule.filter(s=>s.items.some(i=>i.category===c&&(i.state==='overdue'||i.state==='soon'))).length;
  const showCare=(c:CareCategory)=>{setCategory(c);setState('attention');setView('Care schedule');};
  const matches=(i:CareItem)=>(category==='all'||i.category===category)&&(state==='all'||(state==='attention'?i.state==='overdue'||i.state==='soon':i.state===state));
  const visibleCategories=category==='all'?careCategories:[category];
  const rows=schedule.filter(s=>s.items.some(matches)).map(({horse,items})=>{
    const next=items.filter(i=>i.days!==undefined&&i.state!=='ok').sort((a,b)=>a.days!-b.days!)[0];
    return {key:horse.id,search:text(horse.data.name)+text(horse.data.stableNumber,'')+clubName(horse.clubId),cells:[
      <Identity name={text(horse.data.name)} subtitle={`${stableLabel(horse)} · ${clubName(horse.clubId)}`}/>,
      ...visibleCategories.map(c=><CareCell item={items.find(i=>i.category===c)!}/>),
      next?<><strong className="care-next">{next.category}</strong><small>{careLabel(next)}</small></>:items.every(i=>i.state==='none')?'No care recorded in EFM':'Up to date',
      <button className="subtle" onClick={()=>onHorse(horse)}>View <ArrowUpRight size={15}/></button>]};
  });
  if(!horses.length)return <Empty title="No horses to monitor yet" description="Health monitoring starts after a sync imports horses and health records from EFM." action={<button onClick={()=>setView('Care guide')}>Open the care guide</button>}/>;
  return <>
    <div className="summary-strip health-strip">
      <div><span>Horses overdue</span><strong className={schedule.some(s=>s.items.some(i=>i.state==='overdue'))?'alert':''}>{schedule.filter(s=>s.items.some(i=>i.state==='overdue')).length}<small> / {horses.length}</small></strong></div>
      <div><span>Care due in {SOON_DAYS} days</span><strong>{items.filter(i=>i.state==='soon').length}</strong></div>
      <div><span>Open inspection issues</span><strong>{records.filter(r=>r.type==='inspection'&&!/resolved|closed/i.test(text(r.data.status,''))).length}</strong></div>
      <div><span>Treatments awaiting approval</span><strong>{pending.length}</strong></div>
    </div>
    <div className="segmented" role="group" aria-label="Health view">{(['Care schedule','Records & treatments','Care guide'] as View[]).map(v=><button key={v} aria-pressed={v===view} onClick={()=>setView(v)}>{v}</button>)}</div>
    {view==='Care schedule'&&<>
      <DataNote>Due dates use EFM’s recorded next-due date. When none is recorded, HRD estimates it from the last record and the club’s default interval: {careCategories.map(c=>`${c} ${careIntervals[c].days} days`).join(', ')}. Sources: EFM health records (grouped by type, then description), farrier shoeing records with EFM’s next-due date, and medicine logs whose medicine or diagnosis names a vaccine or dewormer (rejected logs are ignored). Farrier shoeing needs the EFM integration update; until then it shows as unavailable in Sync history.</DataNote>
      <div className="care-filters"><label>Status<Select label="Status" value={state} onChange={v=>setState(v as StateFilter)} options={[{value:'all',label:'All horses'},{value:'attention',label:'Needs attention'},{value:'overdue',label:'Overdue'},{value:'soon',label:`Due within ${SOON_DAYS} days`},{value:'none',label:'Not recorded'}]}/></label><label>Care<Select label="Care" value={category} onChange={v=>setCategory(v as CareCategory|'all')} options={[{value:'all',label:'All care'},...careCategories.map(c=>({value:c,label:c}))]}/></label>{(state!=='all'||category!=='all')&&<button className="subtle" onClick={()=>{setState('all');setCategory('all');}}><X size={15}/> Clear filters</button>}</div>
      <DataTable empty="No horses match these care filters." headers={['Horse',...visibleCategories,'Next action','Details']} rows={rows}/>
    </>}
    {view==='Records & treatments'&&<Records records={records} horseOf={horseOf} clubName={clubName}/>}
    {view==='Care guide'&&<Guide needing={needing} onCare={showCare}/>}
  </>;
}

function Records({records,horseOf,clubName}:{records:SourceRecord[];horseOf:(r:SourceRecord)=>SourceRecord|undefined;clubName:(id:string)=>string}) {
  const of=(type:string,key:string)=>records.filter(r=>r.type===type).sort((a,b)=>text(b.data[key],'').localeCompare(text(a.data[key],'')));
  const horse=(r:SourceRecord)=>text(horseOf(r)?.data.name,'No horse');const person=(v:unknown)=>text((v as Record<string,unknown>|undefined)?.fullName);
  const search=(r:SourceRecord)=>JSON.stringify(r.data)+horse(r)+clubName(r.clubId);
  const yesNo=(v:unknown)=>v===true?'Yes':v===false?'No':'Unavailable';
  const pendingEfm='Not imported yet. This dataset needs the EFM integration update; Sync history shows it as access denied until then.';
  const [section,setSection]=useState('Treatments');
  const sections:Record<string,number>={Treatments:of('medicine','timeAdministered').length,'Farrier shoeing':of('farrier','shoeingDate').length,Inspections:of('inspection','createdAt').length,'Accident reports':of('accident','accidentDate').length,'Health records':of('health','date').length};
  return <>
    <div className="segmented compact records-switch" role="group" aria-label="Record type">{Object.entries(sections).map(([name,count])=><button key={name} aria-pressed={name===section} onClick={()=>setSection(name)}>{name} <small className="count">{count.toLocaleString()}</small></button>)}</div>
    {section==='Treatments'&&<DataTable headers={['Horse','Medicine / diagnosis','Quantity','Administered','Legs','Logged by','Approval','Notes']} rows={of('medicine','timeAdministered').map(r=>({key:r.id,search:search(r),cells:[<>{horse(r)}<small>{clubName(r.clubId)}</small></>,<><strong>{text(r.data.medicineName)}</strong><small>{text(r.data.diagnosis,'No diagnosis recorded')}</small></>,`${quantity(r.data.quantity)} ${text(r.data.unit,'')}`,date(r.data.timeAdministered,true),text(r.data.legs,'—'),person(r.data.jamedar),<><Badge tone={approvalTone(r.data.approvalStatus)}>{text(r.data.approvalStatus)}</Badge><small>{r.data.approvedBy?`${person(r.data.approvedBy)} · ${date(r.data.approvalDate)}`:text(r.data.rejectionReason,'')}</small></>,<>{text(r.data.notes,'—')}{photoLinks(r.data.photoUrls)}</>]}))}/>}
    {section==='Farrier shoeing'&&<DataTable empty={pendingEfm} headers={['Horse','Shoeing date','Next due','Legs','Shoes changed','Farrier','Stock (client / school)','Notes']} rows={of('farrier','shoeingDate').map(r=>({key:r.id,search:search(r),cells:[<>{horse(r)}<small>{clubName(r.clubId)}</small></>,date(r.data.shoeingDate),date(r.data.nextDueDate),text(r.data.numberOfLegs),yesNo(r.data.shoeChanged),person(r.data.farrier),`${text(r.data.clientBought,'0')} / ${text(r.data.schoolStock,'0')}`,text(r.data.notes,'—')]}))}/>}
    {section==='Inspections'&&<DataTable empty={pendingEfm} headers={['Issue','Horse','Round / location','Severity','Status','Reported by','Date','Resolution']} rows={of('inspection','createdAt').map(r=>({key:r.id,search:search(r),cells:[<><strong>{text(r.data.issueType,'Inspection')}</strong><small>{text(r.data.description)}</small>{photoLinks(r.data.images)}</>,horse(r),<>{text(r.data.round)}<small>{[r.data.location,r.data.area].filter(v=>typeof v==='string'&&v).join(' · ')||'—'}</small></>,<Badge tone={/critical|high/i.test(text(r.data.severityLevel,''))?'bad':/medium/i.test(text(r.data.severityLevel,''))?'warn':'neutral'}>{text(r.data.severityLevel)}</Badge>,<Badge tone={/resolved|closed/i.test(text(r.data.status,''))?'good':'warn'}>{text(r.data.status)}</Badge>,person(r.data.jamedar),date(r.data.inspectedAt??r.data.createdAt,true),<>{text(r.data.resolutionNotes,'—')}<small>{r.data.resolvedAt?`${person(r.data.resolvedBy)} · ${date(r.data.resolvedAt)}`:''}</small></>]}))}/>}
    {section==='Accident reports'&&<DataTable empty={pendingEfm} headers={['Date','Horse','Location','Rider','Activity','Rider injured','Horse injured','Vet attention','Details']} rows={of('accident','accidentDate').map(r=>({key:r.id,search:search(r),cells:[<>{date(r.data.accidentDate)}<small>{text(r.data.accidentTime,'')}</small></>,horse(r),text(r.data.accidentLocation),<>{text(r.data.personName)}<small>{text(r.data.riderGrouping,'')}</small></>,<>{text(r.data.activityType)}<small>{text(r.data.fallType,'')}</small></>,yesNo(r.data.riderInjured),yesNo(r.data.horseInjured),yesNo(r.data.vetAttentionGiven),<>{text(r.data.accidentDetails)}<small>Reported by {person(r.data.instructor)}</small></>]}))}/>}
    {section==='Health records'&&<DataTable empty="EFM has no health records for the selected club. Vaccination and deworming are also read from medicine logs." headers={['Horse','Record','Care group','Date','Description','Next due','Club']} rows={of('health','date').map(r=>({key:r.id,search:search(r),cells:[horse(r),text(r.data.recordType),careCategory(r)||'Other',date(r.data.date),text(r.data.description),r.data.nextDueDate?date(r.data.nextDueDate):'Not recorded',clubName(r.clubId)]}))}/>}
  </>;
}
const approvalTone=(v:unknown)=>/approved/i.test(text(v,''))?'good':/reject|declin/i.test(text(v,''))?'bad':/pending|awaiting/i.test(text(v,''))?'warn':'neutral';
// Only plain HTTPS links render; anything else stays out of the page.
export function photoLinks(value:unknown) {
  const urls=Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[];
  const safe=urls.flatMap(raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?[u.href]:[];}catch{return [];}});
  return safe.length?<span className="photo-links">{safe.map((href,i)=><a key={href} href={href} target="_blank" rel="noreferrer">Photo {i+1}</a>)}</span>:null;
}

const priorities:{value:Priority|'all';label:string}[]=[{value:'all',label:'All'},{value:'critical',label:'Emergency'},{value:'important',label:'Important'},{value:'routine',label:'Routine'}];
function Guide({needing,onCare}:{needing:(c:CareCategory)=>number;onCare:(c:CareCategory)=>void}) {
  const [query,setQuery]=useState('');const [priority,setPriority]=useState<Priority|'all'>('all');const [category,setCategory]=useState('all');const [expanded,setExpanded]=useState(false);
  const categories=[...new Set(guide.map(t=>t.category))];
  const q=query.trim().toLowerCase();
  const topics=guide.filter(t=>(priority==='all'||t.priority===priority)&&(category==='all'||t.category===category)&&(!q||[t.title,t.category,t.signs,t.callVet,t.prevention||'',...t.actions,...t.resources].join(' ').toLowerCase().includes(q)));
  return <>
    <p className="notice">General reference for HRD teams. It does not replace advice from the club’s veterinarian. In an emergency, call the vet first.</p>
    <section className="vitals" aria-labelledby="vitals-title"><h2 id="vitals-title"><Stethoscope size={19}/> Normal vital signs · adult horse at rest</h2><dl>{vitals.map(v=><div key={v.label}><dt>{v.label}</dt><dd><strong>{v.normal}</strong><small>Call the vet: {v.alert}</small></dd></div>)}</dl></section>
    <div className="guide-tools"><label className="search"><Search size={17}/><input aria-label="Search care guide" placeholder="Search signs, conditions or care…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="icon-button" aria-label="Clear guide search" onClick={()=>setQuery('')}><X size={16}/></button>}</label>
      <div className="segmented compact" role="group" aria-label="Priority">{priorities.map(p=><button key={p.value} aria-pressed={p.value===priority} onClick={()=>setPriority(p.value)}>{p.label}</button>)}</div>
      <Select label="Guide category" value={category} onChange={setCategory} options={[{value:'all',label:'All topics'},...categories.map(c=>({value:c,label:c}))]}/>
      <button onClick={()=>setExpanded(v=>!v)}>{expanded?'Collapse all':'Expand all'}</button><span>Total topics: {guide.length} · Showing: {topics.length}</span></div>
    {!topics.length?<div className="table-empty"><Search size={24}/><p>No topics match. Try another word, such as “fever” or “lameness”.</p></div>:
    <div className="guide-grid">{topics.map(t=>{const count=t.care?needing(t.care):0;return <details key={t.id} className={`guide-card ${t.priority}`} open={expanded||!!q}>
      <summary><span className="priority-tag">{priorities.find(p=>p.value===t.priority)!.label}</span><strong>{t.title}</strong><small>{t.category}</small><ChevronDown size={17}/></summary>
      <div className="guide-body">
        <h3>Signs to watch</h3><p>{t.signs}</p>
        <h3>What to do</h3><ol>{t.actions.map(a=><li key={a}>{a}</li>)}</ol>
        <h3>When to call the vet</h3><p className="call-vet">{t.callVet}</p>
        {t.prevention&&<><h3>Prevention</h3><p>{t.prevention}</p></>}
        <h3>Resources</h3><ul className="guide-resources">{t.resources.map(r=><li key={r}>{r}</li>)}</ul>
        {t.care&&<div className="guide-link"><span>{t.care} · every {careIntervals[t.care].days} days by default. {careIntervals[t.care].note}.</span>{count>0?<button onClick={()=>onCare(t.care!)}>{count} {count===1?'horse needs':'horses need'} {t.care.toLowerCase()} <ArrowUpRight size={15}/></button>:<span className="muted">No horses due within {SOON_DAYS} days</span>}</div>}
      </div></details>;})}</div>}
  </>;
}
