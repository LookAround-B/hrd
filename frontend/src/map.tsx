import { useMemo,useState } from 'react';
import type { Club,SourceRecord } from '../../shared/types';
import { Building2,Users,Activity,Wheat } from 'lucide-react';
import { Select,text } from './components';
type Node={id:string;label:string;detail:string;x:number;y:number;kind:'Club'|'Employee'|'Horse'|'Food'};
export function EntityMap({club,records}:{club:Club;records:SourceRecord[]}) {
  const [focus,setFocus]=useState('all');const [selected,setSelected]=useState<Node|null>(null);
  const graph=useMemo(()=>{
    const allHorses=records.filter(r=>r.type==='horse');const allEmployees=records.filter(r=>r.type==='employee');
    const care=records.filter(r=>r.type==='careTeam'&&r.data.isActive!==false);const consumption=records.filter(r=>r.type==='consumption'&&r.data.kind==='horse'&&Number(r.data.quantity)>0);
    const horses=(focus==='all'?allHorses:allHorses.filter(r=>r.sourceId===focus)).slice(0,12);
    const horseIds=new Set(horses.map(r=>r.sourceId));
    const employees=(focus==='all'?allEmployees:allEmployees.filter(r=>care.some(c=>c.data.staffId===r.sourceId&&horseIds.has(String(c.data.horseId))))).slice(0,12);
    const foodTypes=[...new Set(records.filter(r=>r.type==='feedInventory').map(r=>text(r.data.feedType)))].filter(feed=>focus==='all'||consumption.some(c=>horseIds.has(String(c.data.horseId))&&c.data.feedType===feed)).slice(0,12);
    const nodes:Node[]=[{id:'club',label:club.name,detail:'Club',x:415,y:12,kind:'Club'},...employees.map((r,i)=>({id:`employee:${r.sourceId}`,label:text(r.data.fullName),detail:text(r.data.designation),x:15,y:155+i*80,kind:'Employee' as const})),...horses.map((r,i)=>({id:`horse:${r.sourceId}`,label:text(r.data.name),detail:`Stable ${text(r.data.stableNumber)}`,x:415,y:155+i*80,kind:'Horse' as const})),...foodTypes.map((feed,i)=>({id:`food:${feed}`,label:feed,detail:'Horse feed',x:815,y:155+i*80,kind:'Food' as const}))];
    const visible=new Set(nodes.map(n=>n.id));const edges:[string,string,string][]=[];
    for(const node of nodes.filter(n=>n.kind!=='Club'))edges.push(['club',node.id,'Club membership']);
    for(const row of care){const a=`employee:${row.data.staffId}`;const b=`horse:${row.data.horseId}`;if(visible.has(a)&&visible.has(b))edges.push([a,b,text(row.data.role)]);}
    for(const row of consumption){const a=`horse:${row.data.horseId}`;const b=`food:${row.data.feedType}`;if(visible.has(a)&&visible.has(b))edges.push([a,b,'Recorded consumption']);}
    return {nodes,edges,height:Math.max(440,155+Math.max(employees.length,horses.length,foodTypes.length)*80),allHorses};
  },[club,records,focus]);
  const icons={Club:Building2,Employee:Users,Horse:Activity,Food:Wheat};
  return <section className="entity-section"><div className="map-controls"><label>Focus on horse<Select label="Focus on horse" value={focus} onChange={v=>{setFocus(v);setSelected(null);}} options={[{value:'all',label:'All horses'},...graph.allHorses.map(r=>({value:r.sourceId,label:text(r.data.name)}))]}/></label><p>Care assignments and recorded feed consumption. Up to 12 nodes per group.</p></div><div className="map-scroll"><div className="map-canvas" style={{height:graph.height}}><div className="map-label people-label">Employees</div><div className="map-label horses-label">Horses</div><div className="map-label food-label">Food</div><svg width={1110} height={graph.height} role="img" aria-label={`Relationships in ${club.name}`}>
      {graph.edges.map(([from,to,label],i)=>{const a=graph.nodes.find(n=>n.id===from)!;const b=graph.nodes.find(n=>n.id===to)!;const membership=from==='club';const x1=membership?a.x+140:a.x+280;const y1=membership?a.y+66:a.y+33;const x2=membership?b.x+140:b.x;const y2=membership?b.y:b.y+33;return <path key={`${from}:${to}:${i}`} d={membership?`M${x1},${y1} C${x1},120 ${x2},120 ${x2},${y2}`:`M${x1},${y1} C${x1+60},${y1} ${x2-60},${y2} ${x2},${y2}`} className={membership?'membership-edge':selected&&(selected.id===from||selected.id===to)?'map-edge selected':'map-edge'}><title>{label}</title></path>;})}
    </svg>{graph.nodes.map(node=>{const Icon=icons[node.kind];return <button className={`map-node ${node.kind.toLowerCase()} ${selected?.id===node.id?'selected':''}`} style={{left:node.x,top:node.y}} key={node.id} onClick={()=>setSelected(node)}><Icon size={19}/><span><strong>{node.label}</strong><small>{node.detail}</small></span></button>;})}</div></div>{selected&&<div className="map-selection"><strong>{selected.label}</strong><span>{selected.kind} · {selected.detail}</span><span>{graph.edges.filter(([a,b])=>a===selected.id||b===selected.id).length} visible relationships</span></div>}<div className="notice">The map uses available records. Missing assignments and feed relationships are not inferred. Groceries have no recorded horse relationship.</div></section>;
}
