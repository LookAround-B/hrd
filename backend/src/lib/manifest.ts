import { z } from 'zod';

const route=z.object({path:z.string().startsWith('/api/').max(300),methods:z.array(z.string().max(20)).min(1).max(10),safe:z.boolean(),reason:z.string().max(1000),
  type:z.enum(['employee','horse','careTeam','health','medicine','feedInventory','consumption','grocery','feedPlan','groceryUsage','horseProfile','farrier','inspection','accident']).optional()});
export const integrationManifest=z.object({version:z.literal(1),readOnly:z.literal(true),routes:z.array(route).max(1000)});
