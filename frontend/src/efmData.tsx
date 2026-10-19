import { useEffect,useMemo,useState } from 'react';
import { ArrowDown,ArrowUp,ChevronLeft,ChevronRight,Database,Search,X,LoaderCircle } from 'lucide-react';
import type { SourceRecord } from '../../shared/types';
import { api } from './api';
import { Badge,Empty,Modal,date } from './components';

// Browser for HRD's full mirror of EFM's read-only export: every table EFM shares, paged on the server.
interface Dataset {dataset:string;total:number;fields:string[];state:string;synced_at:string|null;checked_at:string}
interface Page {total:number;fields:string[];rows:{id:string;data:Record<string,unknown>;syncedAt:string}[]}
const PAGE=50;const DEFAULT_COLUMNS=12;
export const friendly=(name:string)=>name==='id'?'EFM ID':name.replace(/(.)Id$/,'$1').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const stateText:Record<string,string>={ok:'Imported',denied:'Access denied by EFM',error:'Import failed; previous rows kept',credential_required:'Replace the EFM credential'};
// Names first, then people/horse links and dates; bookkeeping columns last.
function orderFields(fields:string[]) {
  const rank=(f:string)=>/^(name|fullName|title|itemName|medicineName)$/.test(f)?0:/^(horseId|employeeId|staffId|jamedarId|jamiedarId|instructorId|groomId|farrierId)$/.test(f)?1:/date|time|At$/i.test(f)&&!/^(createdAt|updatedAt)$/.test(f)?2:f==='id'?5:/^(createdAt|updatedAt)$/.test(f)?4:3;
  return [...fields].sort((a,b)=>rank(a)-rank(b));
}
function Value({field,value,names,full=false}:{field:string;value:unknown;names:Map<string,string>;full?:boolean}) {
  if(value===null||value===undefined||value==='')return <span className="muted">—</span>;
  if(typeof value==='boolean')return <>{value?'Yes':'No'}</>;
  if(Array.isArray(value))return value.length?<span title={value.join(', ')}>{value.slice(0,3).map(v=>typeof v==='string'&&/^https:\/\//.test(v)?'link':String(v)).join(', ')}{value.length>3?` +${value.length-3}`:''}</span>:<span className="muted">None</span>;
  if(typeof value==='object')return <code className="json-cell" title={JSON.stringify(value)}>{JSON.stringify(value).slice(0,80)}</code>;
  const text=String(value);
  if(/Id$/.test(field)&&names.has(text))return <><span>{names.get(text)}</span><small>{text}</small></>;
  if(/^\d{4}-\d{2}-\d{2}T/.test(text))return <>{date(text,!text.includes('T00:00:00.000Z'))}</>;
  if(/^https:\/\/\S+$/.test(text)){try{const u=new URL(text);if(!u.username&&!u.password)return <a href={u.href} target="_blank" rel="noreferrer">Open</a>;}catch{/* plain text below */}}
  if(full||text.length<=120)return <span className="pre-wrap">{text}</span>;
  return <span title={text}>{`${text.slice(0,120)}…`}</span>;
}

export function EfmData({clubId,records}:{clubId:string;records:SourceRecord[]}) {
  const [datasets,setDatasets]=useState<Dataset[]|null>(null);const [error,setError]=useState('');const [filter,setFilter]=useState('');
  const [selected,setSelected]=useState('');const [page,setPage]=useState<Page|null>(null);const [loading,setLoading]=useState(false);
  const [search,setSearch]=useState('');const [query,setQuery]=useState('');const [skip,setSkip]=useState(0);
  const [sort,setSort]=useState<{field:string;dir:'asc'|'desc'}|null>(null);const [allColumns,setAllColumns]=useState(false);const [detail,setDetail]=useState<Page['rows'][number]|null>(null);
  // EFM IDs for horses and staff resolve to names from the club's mirrored records.
  const names=useMemo(()=>new Map(records.filter(r=>r.clubId===clubId&&(r.type==='horse'||r.type==='employee')).map(r=>[r.sourceId,String(r.data.name??r.data.fullName??r.sourceId)])),[records,clubId]);
  useEffect(()=>{let live=true;setDatasets(null);setError('');setSelected('');
    api<Dataset[]>(`efm-data?clubId=${encodeURIComponent(clubId)}`).then(list=>{if(!live)return;setDatasets(list);const first=list.find(d=>d.total>0)||list[0];if(first)setSelected(first.dataset);}).catch(e=>live&&setError(e.message));
    return()=>{live=false;};},[clubId]);
  useEffect(()=>{const t=setTimeout(()=>{setQuery(search);setSkip(0);},300);return()=>clearTimeout(t);},[search]);
  useEffect(()=>{setSkip(0);setSort(null);setSearch('');setQuery('');setAllColumns(false);},[selected]);
  useEffect(()=>{
    if(!selected)return;let live=true;setLoading(true);
    const params=new URLSearchParams({clubId,dataset:selected,skip:String(skip),take:String(PAGE),search:query,...(sort?{sort:sort.field,dir:sort.dir}:{})});
    api<Page>(`efm-data/rows?${params}`).then(p=>{if(live){setPage(p);setError('');}}).catch(e=>live&&setError(e.message)).finally(()=>live&&setLoading(false));
    return()=>{live=false;};
  },[clubId,selected,skip,query,sort]);
  if(error&&!datasets)return <Empty title="EFM data could not load" description={error}/>;
  if(!datasets)return <section className="loading-panel" role="status"><LoaderCircle size={26} className="spin"/><h2>Loading EFM datasets</h2></section>;
  if(!datasets.length)return <Empty title="No EFM export imported yet" description="HRD mirrors every EFM table once EFM has the read-only export deployed. Then run Sync & reconcile on the Clubs page."/>;
  const visible=datasets.filter(d=>friendly(d.dataset).toLowerCase().includes(filter.trim().toLowerCase()));
  const meta=datasets.find(d=>d.dataset===selected);
  const fields=orderFields(page?.fields||meta?.fields||[]);const columns=allColumns?fields:fields.slice(0,DEFAULT_COLUMNS);
  const total=page?.total??0;const rowsTotal=datasets.reduce((n,d)=>n+d.total,0);
  return <div className="efm-data">
    <aside className="efm-datasets" aria-label="EFM datasets">
      <label className="search"><Search size={16}/><input aria-label="Find a dataset" placeholder={`Find in ${datasets.length} datasets…`} value={filter} onChange={e=>setFilter(e.target.value)}/></label>
      <select className="efm-dataset-select" aria-label="Dataset" value={selected} onChange={e=>setSelected(e.target.value)}>{datasets.map(d=><option key={d.dataset} value={d.dataset}>{friendly(d.dataset)} ({d.total.toLocaleString()})</option>)}</select>
      <nav>{visible.map(d=><button key={d.dataset} aria-current={d.dataset===selected?'true':undefined} onClick={()=>setSelected(d.dataset)}><span>{friendly(d.dataset)}</span><small className={d.state==='ok'?'':'error'}>{d.state==='ok'?d.total.toLocaleString():'!'}</small></button>)}</nav>
      <p className="muted">{rowsTotal.toLocaleString()} rows across {datasets.length} EFM tables</p>
    </aside>
    <section className="efm-table-panel">
      <header><div><h2><Database size={19}/> {friendly(selected)}</h2><p>{meta?<>{meta.total.toLocaleString()} rows · {meta.state==='ok'?`refreshed ${date(meta.synced_at,true)}`:<Badge tone="bad">{stateText[meta.state]||meta.state}</Badge>}</>:''}</p></div>
        {fields.length>DEFAULT_COLUMNS&&<button onClick={()=>setAllColumns(v=>!v)}>{allColumns?`Show ${DEFAULT_COLUMNS} columns`:`Show all ${fields.length} columns`}</button>}</header>
      <div className="table-tools"><label className="search"><Search size={17}/><input aria-label="Search EFM rows" placeholder="Search every column…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="icon-button" aria-label="Clear row search" onClick={()=>setSearch('')}><X size={16}/></button>}</label><span>{loading?'Loading…':`${total.toLocaleString()} ${total===1?'row':'rows'}`}</span></div>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="table-scroll"><table className="efm-table"><thead><tr>{columns.map(f=><th key={f} scope="col" aria-sort={sort?.field===f?(sort.dir==='asc'?'ascending':'descending'):undefined}><button className="sort-button" onClick={()=>{setSort(s=>s?.field===f?(s.dir==='asc'?{field:f,dir:'desc'}:null):{field:f,dir:'asc'});setSkip(0);}}>{friendly(f)}{sort?.field===f&&(sort.dir==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>)}</button></th>)}</tr></thead>
        <tbody>{page?.rows.map(row=><tr key={row.id} className="clickable" tabIndex={0} onClick={()=>setDetail(row)} onKeyDown={e=>{if(e.key==='Enter')setDetail(row);}}>{columns.map(f=><td key={f}><span className="mobile-cell-label" aria-hidden="true">{friendly(f)}</span><div className="cell-content"><Value field={f} value={row.data[f]} names={names}/></div></td>)}</tr>)}</tbody></table></div>
      {page&&!page.rows.length&&<div className="table-empty"><Search size={24}/><p>{query?'No rows match this search.':'This EFM table has no rows.'}</p></div>}
      <footer className="pagination"><span>{total?`${skip+1}–${Math.min(skip+PAGE,total)} of ${total.toLocaleString()}`:'0 rows'}</span><div className="page-controls"><span>Page {Math.floor(skip/PAGE)+1} of {Math.max(1,Math.ceil(total/PAGE))}</span><button className="icon-button" aria-label="Previous EFM page" disabled={!skip||loading} onClick={()=>setSkip(Math.max(0,skip-PAGE))}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next EFM page" disabled={skip+PAGE>=total||loading} onClick={()=>setSkip(skip+PAGE)}><ChevronRight size={18}/></button></div></footer>
    </section>
    {detail&&<Modal title={`${friendly(selected)} · ${String(detail.data.name??detail.data.fullName??detail.data.title??detail.id)}`} onClose={()=>setDetail(null)}><div className="horse-profile"><dl>{fields.map(f=><div key={f}><dt>{friendly(f)}</dt><dd>{typeof detail.data[f]==='object'&&detail.data[f]!==null?<code className="json-cell">{JSON.stringify(detail.data[f],null,1)}</code>:<Value field={f} value={detail.data[f]} names={names} full/>}</dd></div>)}</dl><small>Mirrored {date(detail.syncedAt,true)} · EFM ID {detail.id}</small></div></Modal>}
  </div>;
}
