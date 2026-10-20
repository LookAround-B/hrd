import { ZodError } from 'zod';
import { issueMessage,validateRequest } from '../../shared/schemas';
import type { SessionUser } from '../../shared/types';
export class ApiError extends Error { constructor(public status:number,message:string) {super(message);} }
let csrf='';
export function setSession(session:SessionUser|null) {csrf=session?.csrf||'';}
export async function api<T>(path:string,body?:unknown):Promise<T> {
  // Same strict schemas as the API: bad input is reported here, before anything is sent.
  const [route,search='']=path.split('?');
  try {validateRequest(route,Object.fromEntries(new URLSearchParams(search)),body);}
  catch(e) {if(e instanceof ZodError) throw new ApiError(400,issueMessage(e));throw e;}
  const res=await fetch(`/api/${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-HRD-CSRF':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try {data=await res.json();}catch {throw new ApiError(res.status,'HRD is not responding. Try again shortly.');}
  if(!res.ok) throw new ApiError(res.status,data.error||'The request could not be completed.');
  return data;
}
