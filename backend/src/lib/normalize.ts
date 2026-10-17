import type { EntityType, JsonRecord } from '../../../shared/types';
export type Normalized = { sourceId: string; data: JsonRecord };
export const feedColumns=['sports','balance','growth','oats','barley','soya','linseed','bran','salt','dcp','epsom','riceBranOil','heylage','lucerne','electrolyte','diggyMax','coolMix'];
const fields: Record<Exclude<EntityType,'consumption'>,string[]> = {
  employee:['id','fullName','email','designation','department','phoneNumber','employmentStatus','profileImage','shiftTiming','isApproved'],
  horse:['id','name','gender','dateOfBirth','breed','color','height','age','stableNumber','profileImage','status','discipline','trainingLevel','workloadLimit','location','ownerName','ownerContact','privateEntryAt','privateExitAt','passportNumber','supervisorId'],
  careTeam:['id','horseId','staffId','role','isActive','assignedDate'],
  health:['id','horseId','recordType','description','date','nextDueDate','documents'],
  medicine:['id','horseId','medicineName','quantity','unit','timeAdministered','approvalStatus','notes'],
  feedInventory:['id','feedType','month','year','unitsBrought','openingStock','totalUsed','unitsLeft','unit','purchaseDate','expiryDate','nextOrderDate','vendorName','notes'],
  grocery:['id','name','quantity','unit','purchaseDate','expiryDate','description'],
  feedPlan:['id','horseId','date','notes','temporaryMenuName','menuStartAt','menuEndAt',...feedColumns],
  groceryUsage:['id','itemKey','itemName','category','unit','month','year','openingStock','purchaseStock','monthlyBalance','remarks','w1Received','w1Used','w2Received','w2Used','w3Received','w3Used','w4Received','w4Used']
};
export function object(value: unknown): JsonRecord {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid EFM object');
  return value as JsonRecord;
}
export function pick(value: unknown,allowed: string[]): JsonRecord {
  const source=object(value); const output:JsonRecord={};
  for(const key of allowed) { const v=source[key];
    if(v===null||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&v.length<=20000)) output[key]=v;
  }return output;
}
export function normalize(type: Exclude<EntityType,'consumption'>,records: unknown[]): Normalized[] {
  return records.map(raw=>{
    const row=object(raw); if(typeof row.id!=='string'||!row.id||row.id.length>100) throw new Error('EFM record has no valid ID');
    const data=pick(row,fields[type]);
    if(type==='health'&&row.horse) data.horse=pick(row.horse,fields.horse);
    if(type==='careTeam') { if(row.staff) data.staff=pick(row.staff,['id','fullName','designation']); if(row.horse) data.horse=pick(row.horse,['id','name','status']); }
    if(type==='employee'&&row.supervisor) data.supervisor=pick(row.supervisor,['id','fullName','designation']);
    return {sourceId:row.id,data};
  });
}
export function normalizeConsumption(body: unknown): Normalized[] {
  const root=object(body);const data=object(root.data);const result:Normalized[]=[];
  const sourceTypes=Array.isArray(data.feedTypes)?data.feedTypes.filter((v):v is string=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v)):[];
  const allowedFeeds=[...new Set([...feedColumns,...sourceTypes])];
  const perHorse=object(data.horseConsumption);const daily=object(data.dailyBreakdown);
  for(const [horseId,raw] of Object.entries(perHorse)) {
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(horseId)) throw new Error('Invalid consumption horse ID');
    const row=object(raw); const feeds=object(row.feeds);
    for(const feedType of allowedFeeds) if(typeof feeds[feedType]==='number'&&Number.isFinite(feeds[feedType])) {
      result.push({sourceId:`horse:${horseId}:${feedType}`,data:{kind:'horse',horseId,horseName:typeof row.horseName==='string'?row.horseName:null,feedType,quantity:feeds[feedType]}});
    }
  }
  for(const [date,raw] of Object.entries(daily)) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid consumption date');
    const row=object(raw);
    for(const feedType of allowedFeeds) if(typeof row[feedType]==='number'&&Number.isFinite(row[feedType])) result.push({sourceId:`day:${date}:${feedType}`,data:{kind:'day',date,feedType,quantity:row[feedType]}});
  }return result;
}
export function arrayResponse(body: unknown): unknown[] {
  if(Array.isArray(body)) return body;
  const row=object(body); if(Array.isArray(row.data)) return row.data;
  throw new Error('EFM did not return a record array');
}
