import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, X, Search, Inbox, LoaderCircle, Check, CalendarDays } from 'lucide-react';

export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null); const titleId=useId();
  useEffect(()=>{const el=ref.current!;const previous=document.body.style.overflow;document.body.style.overflow='hidden';el.showModal();return()=>{el.close();document.body.style.overflow=previous;};},[]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target!==e.currentTarget)return;const bounds=e.currentTarget.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)onClose();}} className="modal"><header><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header><div className="modal-body">{children}</div></dialog>;
}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'good'|'warn'|'bad'}) {return <span className={`badge ${tone}`}><span className="badge-dot" aria-hidden="true"/>{children}</span>;}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}) {return <div className="empty"><div className="empty-icon"><Inbox size={26}/></div><h2>{title}</h2><p>{description}</p>{action}</div>;}
export function DataNote({children}:{children:ReactNode}) {return <details className="data-note"><summary>Data availability <ChevronDown size={16}/></summary><div>{children}</div></details>;}
export function Identity({name,subtitle}:{name:string;subtitle?:string}) {return <div className="identity"><span className="avatar" aria-hidden="true">{name.split(' ').slice(0,2).map(s=>s[0]).join('').toUpperCase()}</span><div><strong>{name}</strong>{subtitle&&<small>{subtitle}</small>}</div></div>;}
export function LoadingPanel() {return <section className="loading-panel" role="status" aria-label="Loading club data"><LoaderCircle size={26} className="spin"/><h2>Loading club data</h2><p>Getting the latest records from HRD.</p></section>;}
export function DataTable({headers,rows,searchable=true,empty='No records match these filters.'}:{headers:string[];rows:{key:string;search:string;cells:ReactNode[]}[];searchable?:boolean;empty?:string}) {
  const [query,setQuery]=useState(''); const [page,setPage]=useState(0); const [size,setSize]=useState(20);
  const filtered=useMemo(()=>rows.filter(r=>r.search.toLowerCase().includes(query.trim().toLowerCase())),[rows,query]);
  const pages=Math.max(1,Math.ceil(filtered.length/size)); const current=Math.min(page,pages-1); const start=current*size;
  return <section className="table-section"><div className="table-tools">{searchable&&<label className="search"><Search size={17}/><input aria-label="Search records" placeholder="Search records…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>{query&&<button className="icon-button" aria-label="Clear search" onClick={()=>{setQuery('');setPage(0);}}><X size={16}/></button>}</label>}<span>{filtered.length.toLocaleString()} {filtered.length===1?'record':'records'}</span></div>
    <div className="table-scroll"><table><thead><tr>{headers.map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.slice(start,start+size).map(row=><tr key={row.key}>{row.cells.map((cell,i)=><td key={i}><span className="mobile-cell-label" aria-hidden="true">{headers[i]}</span><div className="cell-content">{cell}</div></td>)}</tr>)}</tbody></table></div>
    {!filtered.length&&<div className="table-empty"><Search size={24}/><p>{empty}</p>{query&&<button onClick={()=>setQuery('')}>Clear search</button>}</div>}
    <footer className="pagination"><span>{filtered.length?`${start+1}–${Math.min(start+size,filtered.length)} of ${filtered.length}`:'0 records'}</span><div className="page-controls"><label>Rows<Select label="Rows per page" value={String(size)} options={[10,20,50].map(n=>({value:String(n),label:String(n)}))} onChange={v=>{setSize(Number(v));setPage(0);}}/></label><span>Page {current+1} of {pages}</span><button className="icon-button" aria-label="Previous page" disabled={!current} onClick={()=>setPage(current-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next page" disabled={current>=pages-1} onClick={()=>setPage(current+1)}><ChevronRight size={18}/></button></div></footer>
  </section>;
}
export const text=(value:unknown,fallback='Unavailable')=>typeof value==='string'||typeof value==='number'?String(value):fallback;
export const quantity=(value:unknown)=>typeof value==='number'?value.toLocaleString('en-IN',{maximumFractionDigits:2}):'Unavailable';
export function date(value:unknown,withTime=false):string {if(typeof value!=='string')return 'Not yet';const d=new Date(value);return Number.isNaN(d.getTime())?'Unavailable':new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(d);}
// Menus open as top-layer popovers, so modals and scrolling tables never clip them; scrolling the page closes them.
function usePopover(onOpen:()=>void) {
  const trigger=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);const [open,setOpen]=useState(false);const opened=useRef(onOpen);opened.current=onOpen;
  useEffect(()=>{const el=panel.current!;
    const before=(e:Event)=>{
      if((e as ToggleEvent).newState!=='open'){if(el.contains(document.activeElement))trigger.current?.focus();return;}
      const r=trigger.current!.getBoundingClientRect();const below=innerHeight-r.bottom>=300||innerHeight-r.bottom>r.top;
      Object.assign(el.style,{left:`${r.left}px`,minWidth:`${r.width}px`,top:below?`${r.bottom+4}px`:'auto',bottom:below?'auto':`${innerHeight-r.top+4}px`});
    };
    const toggle=(e:Event)=>{const isOpen=(e as ToggleEvent).newState==='open';setOpen(isOpen);if(!isOpen)return;
      const over=el.getBoundingClientRect().right-(innerWidth-8);if(over>0)el.style.left=`${Math.max(8,parseFloat(el.style.left)-over)}px`;opened.current();};
    el.addEventListener('beforetoggle',before);el.addEventListener('toggle',toggle);
    return()=>{el.removeEventListener('beforetoggle',before);el.removeEventListener('toggle',toggle);};},[]);
  useEffect(()=>{if(!open)return;const close=(e:Event)=>{if(!panel.current?.contains(e.target as Node))panel.current?.hidePopover();};
    addEventListener('scroll',close,true);addEventListener('resize',close);return()=>{removeEventListener('scroll',close,true);removeEventListener('resize',close);};},[open]);
  return {trigger,panel,open};
}
export type Option={value:string;label:string};
export function Select({value,options,onChange,label,className=''}:{value:string;options:Option[];onChange:(value:string)=>void;label:string;className?:string}) {
  const id=useId();const [active,setActive]=useState(0);const selected=Math.max(0,options.findIndex(o=>o.value===value));
  const {trigger,panel,open}=usePopover(()=>{setActive(selected);panel.current!.focus();});
  useEffect(()=>{if(open)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'});},[id,open,active]);
  const choose=(i:number)=>{onChange(options[i].value);panel.current!.hidePopover();};
  const key=(e:React.KeyboardEvent)=>{
    const last=options.length-1;const move:Record<string,number>={ArrowDown:Math.min(last,active+1),ArrowUp:Math.max(0,active-1),Home:0,End:last,PageDown:Math.min(last,active+10),PageUp:Math.max(0,active-10)};
    if(e.key in move){e.preventDefault();setActive(move[e.key]);}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(active);}
    else if(e.key==='Tab')panel.current!.hidePopover();
    else if(e.key.length===1){const starts=(o:Option)=>o.label.toLowerCase().startsWith(e.key.toLowerCase());const next=options.findIndex((o,i)=>i>active&&starts(o));const found=next<0?options.findIndex(starts):next;if(found>=0)setActive(found);}
  };
  return <><button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} popoverTarget={id} data-value={value} className={`select-trigger ${className}`} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();panel.current!.showPopover();}}}><span>{options[selected]?.label}</span><ChevronDown size={16} aria-hidden="true"/></button>
    {/* preventDefault stops a wrapping <label> from re-clicking the trigger. */}
    <div ref={panel} id={id} popover="auto" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={open?`${id}-${active}`:undefined} className="menu" onKeyDown={key} onClick={e=>e.preventDefault()}>{options.map((o,i)=><div key={o.value} id={`${id}-${i}`} role="option" aria-selected={i===selected} data-active={i===active} className="option" onClick={()=>choose(i)} onPointerMove={()=>setActive(i)}><span>{o.label}</span>{i===selected&&<Check size={15} aria-hidden="true"/>}</div>)}</div></>;
}
const DAY=86400000;
const isoDay=(t:number)=>new Date(t).toISOString().slice(0,10);
const utcDay=(value:string)=>Date.parse(`${value}T00:00:00Z`);
const addMonths=(value:string,months:number)=>{const d=new Date(utcDay(value));const y=d.getUTCFullYear(),m=d.getUTCMonth()+months;return isoDay(Date.UTC(y,m,Math.min(d.getUTCDate(),new Date(Date.UTC(y,m+1,0)).getUTCDate())));};
const longDay=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'});
const monthTitle=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'long',year:'numeric'});
const shortDay=new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'});
// Dates are plain YYYY-MM-DD strings, handled in UTC like the rest of HRD's date filters.
export function DatePicker({value,onChange,label}:{value:string;onChange:(value:string)=>void;label:string}) {
  const id=useId();const [focus,setFocus]=useState(value||isoDay(Date.now()));const moveFocus=useRef(false);
  const {trigger,panel,open}=usePopover(()=>{moveFocus.current=true;setFocus(value||isoDay(Date.now()));});
  useEffect(()=>{if(open&&moveFocus.current){moveFocus.current=false;panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();}},[open,focus,panel]);
  const f=new Date(utcDay(focus));const first=Date.UTC(f.getUTCFullYear(),f.getUTCMonth(),1);const start=first-((new Date(first).getUTCDay()+6)%7)*DAY;
  const days=Array.from({length:42},(_,i)=>isoDay(start+i*DAY));const today=isoDay(Date.now());
  const key=(e:React.KeyboardEvent)=>{const t=utcDay(focus);const next:Record<string,string>={ArrowLeft:isoDay(t-DAY),ArrowRight:isoDay(t+DAY),ArrowUp:isoDay(t-7*DAY),ArrowDown:isoDay(t+7*DAY),PageUp:addMonths(focus,-1),PageDown:addMonths(focus,1)};
    if(!next[e.key])return;e.preventDefault();moveFocus.current=true;setFocus(next[e.key]);};
  const display=value?shortDay.format(utcDay(value)):'Choose date';
  return <><button ref={trigger} type="button" aria-label={`${label}, ${display}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} data-value={value} className="select-trigger"><span>{display}</span><CalendarDays size={16} aria-hidden="true"/></button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`Choose ${label.toLowerCase()} date`} className="menu calendar" onClick={e=>e.preventDefault()}>
      <header><button type="button" className="icon-button" aria-label="Previous month" onClick={()=>setFocus(addMonths(focus,-1))}><ChevronLeft size={18}/></button><strong aria-live="polite">{monthTitle.format(first)}</strong><button type="button" className="icon-button" aria-label="Next month" onClick={()=>setFocus(addMonths(focus,1))}><ChevronRight size={18}/></button></header>
      <div className="calendar-grid" onKeyDown={key}>{['Mo','Tu','We','Th','Fr','Sa','Su'].map(d=><span key={d} aria-hidden="true">{d}</span>)}
        {days.map(d=><button key={d} type="button" data-day={d} tabIndex={d===focus?0:-1} aria-label={longDay.format(utcDay(d))} aria-pressed={d===value} aria-current={d===today?'date':undefined} className={d.slice(0,7)===focus.slice(0,7)?'':'outside'} onClick={()=>{onChange(d);panel.current!.hidePopover();}}>{Number(d.slice(8))}</button>)}</div>
    </div></>;
}
