// Explicit maintenance command: reads EFM source; writes only the HRD catalog.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const source = resolve(process.argv[2] || '../Stable/backend/src/pages/api');
const safe = new Map([
  ['/api/auth/me', undefined], ['/api/employees','employee'], ['/api/employees/[id]','employee'],
  ['/api/horses','horse'], ['/api/horse-care-team','careTeam'], ['/api/health-records','health'],
  ['/api/medicine-logs','medicine'], ['/api/feed-inventory','feedInventory'],
  ['/api/feed-inventory/consumption-report','consumption'], ['/api/groceries-inventory','grocery'],
  ['/api/integrations/horse-feed-plans','feedPlan'], ['/api/integrations/grocery-usage','groceryUsage'],
  ['/api/integrations/manifest',undefined], ['/api/integrations/horse-profiles','horseProfile'],
  ['/api/farrier-shoeing','farrier'], ['/api/inspections','inspection'], ['/api/accident-reports','accident']
]);
const sideEffects = new Map([
  ['/api/integrations/token','Reviewed credential exchange only; never mirrored or probed as a data route.'],
  ['/api/horse-feeds','Read can create expired-menu notifications.'],
  ['/api/horse-feeds/summary','Read can create expired-menu notifications.'],
  ['/api/grocery-tracker','Read can create missing monthly tracker rows.'],
  ['/api/stock-tracker','Read can create missing monthly tracker rows.'],
  ['/api/horses/[id]','Supports updates only; no read method.']
]);
async function walk(dir) {
  const rows=[];
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const path=resolve(dir,entry.name);
    if(entry.isDirectory()) rows.push(...await walk(path));
    else if(entry.name.endsWith('.ts')) {
      const text=await readFile(path,'utf8');
      const route='/api/'+relative(source,path).replaceAll('\\','/').replace(/\/index\.ts$/, '').replace(/\.ts$/,'');
      const methods=[...new Set([...text.matchAll(/(?:case\s+|req\.method\s*[!=]==?\s*)['"](GET|POST|PUT|PATCH|DELETE|OPTIONS)['"]/g)].map(m=>m[1]))].sort();
      rows.push({path:route,methods:methods.length?methods:['See source'],safe:safe.has(route),reason:sideEffects.get(route)||(safe.has(route)?'Reviewed GET access only.':'Not reviewed for HRD; never requested.'),...(safe.get(route)?{type:safe.get(route)}:{})});
    }
  }return rows;
}
const rows=(await walk(source)).sort((a,b)=>a.path.localeCompare(b.path));
await writeFile(new URL('../shared/route-catalog.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
console.log(`Wrote ${rows.length} route definitions to HRD. EFM was read only.`);
