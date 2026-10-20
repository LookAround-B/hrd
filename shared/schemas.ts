import { z } from 'zod';

// No eval-based fast path: the website's Content-Security-Policy blocks eval.
z.config({ jitless: true });

// Every HRD API request, validated by one table: the API enforces it and the website checks it
// before sending. Schemas are strict, so unknown fields are rejected instead of silently ignored.

const text=(label:string,min:number,max:number)=>z.string().trim()
  .min(min,min<=1?`Enter the ${label}.`:`Enter at least ${min} characters for the ${label}.`)
  .max(max,`Keep the ${label} under ${max+1} characters.`);
const notes=z.string().trim().max(1000,'Keep notes under 1001 characters.').default('');
const credentialToken=z.string().trim().min(20,'Paste the full EFM key or token (at least 20 characters).').max(10000,'The EFM key or token is too long.')
  .regex(/^[A-Za-z0-9._~-]+$/,'The EFM key or token contains characters that are not allowed.');
const uuid=z.uuid('Choose a valid club.');
const isoDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Use a full date (YYYY-MM-DD).');

export const empty=z.strictObject({});
export const googleLogin=z.strictObject({credential:z.string().min(1,'Google sign-in did not return a credential.').max(10000)});
export const demoLogin=z.strictObject({phone:text('phone number',1,40),code:text('access code',1,200)});
export const clubCreate=z.strictObject({
  name:text('club name',1,150),brief:z.string().trim().max(1000,'Keep the brief under 1001 characters.').default(''),
  baseUrl:z.string().trim().min(1,'Enter the EFM website URL.').max(300,'The EFM website URL is too long.'),
  token:credentialToken,authorisation:text('authorisation reference',5,1000),issuer:text('issuer',2,150),
  termsConfirmed:z.literal(true,'Confirm the club approved this integration.'),scopeNotes:notes,rateLimitNotes:notes,
});
export const credentialReplace=z.strictObject({token:credentialToken,issuer:text('issuer',2,150),authorisation:text('authorisation reference',5,1000),scopeNotes:notes,rateLimitNotes:notes});
export const activate=z.strictObject({reconciled:z.literal(true,'Confirm the reconciliation before activating.')});
export const clubQuery=z.strictObject({clubId:uuid});
export const feedPlansQuery=z.strictObject({clubId:uuid,horseId:z.string().min(1).max(100)});
export const consumptionQuery=z.strictObject({from:isoDay,to:isoDay}).refine(q=>q.from<=q.to,{message:'The end date must be on or after the start date.',path:['to']});
export const efmRowsQuery=z.strictObject({
  clubId:uuid,dataset:z.string().regex(/^[A-Z][A-Za-z0-9]{0,63}$/,'Choose a valid EFM table.'),
  skip:z.coerce.number().int().min(0).max(1000000).default(0),take:z.coerce.number().int().min(1).max(200).default(50),
  search:z.string().max(200,'Keep the search under 201 characters.').default(''),sort:z.string().regex(/^[A-Za-z0-9_]{1,100}$/).optional(),
  dir:z.enum(['asc','desc']).default('asc'),filters:z.string().max(4000).default('{}'),
});
// Exact-match column filters inside efmRowsQuery.filters, e.g. {"horseId":"…"}.
export const efmRowFilters=z.record(z.string().max(100),z.string().max(200));

type Route={method:'GET'|'POST';path:string|RegExp;query?:z.ZodType;body?:z.ZodType};
const routes:Route[]=[
  {method:'GET',path:'health'},{method:'GET',path:'config'},{method:'GET',path:'auth/session'},{method:'GET',path:'dashboard'},{method:'GET',path:'audit'},
  {method:'POST',path:'auth/google',body:googleLogin},{method:'POST',path:'auth/demo',body:demoLogin},{method:'POST',path:'auth/logout',body:empty},
  {method:'GET',path:'feed-plans',query:feedPlansQuery},{method:'GET',path:'consumption',query:consumptionQuery},
  {method:'GET',path:'efm-data',query:clubQuery},{method:'GET',path:'efm-data/rows',query:efmRowsQuery},
  {method:'POST',path:'clubs',body:clubCreate},
  {method:'GET',path:/^clubs\/[^/]+\/status$/},
  {method:'POST',path:/^clubs\/[^/]+\/(test|sync|disconnect)$/,body:empty},
  {method:'POST',path:/^clubs\/[^/]+\/credential$/,body:credentialReplace},
  {method:'POST',path:/^clubs\/[^/]+\/activate$/,body:activate},
];
export function findRoute(path:string):Route|undefined {return routes.find(r=>typeof r.path==='string'?r.path===path:r.path.test(path));}
// Parses one request against its route. Returns undefined for unknown paths; throws z.ZodError on bad input.
// The method is checked by the caller (405), so only the matching schemas run here.
export function validateRequest(path:string,query:Record<string,unknown>,body:unknown) {
  const route=findRoute(path);if(!route) return undefined;
  return {query:(route.query??empty).parse(query) as Record<string,unknown>,body:route.method==='POST'?(route.body??empty).parse(body??{}) as Record<string,unknown>:undefined};
}

const labels:Record<string,string>={name:'Club name',brief:'Club brief',baseUrl:'EFM website URL',token:'EFM key or token',issuer:'Issued by',
  authorisation:'Authorisation reference',termsConfirmed:'Club approval',scopeNotes:'Scopes',rateLimitNotes:'Rate limits',phone:'Phone number',code:'Access code',from:'From',to:'To',search:'Search'};
// First problem as one readable sentence, e.g. "Issued by: Enter at least 2 characters for the issuer."
export function issueMessage(error:z.ZodError):string {
  const issue=error.issues[0];if(!issue) return 'Check the form and try again.';
  const field=issue.path.map(String).join('.');
  return field?`${labels[field]??field}: ${issue.message}`:issue.message;
}
