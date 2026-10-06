import type { FastifyInstance } from 'fastify';
import sales from './sales.routes.js';
import links from './links.routes.js';
import billing from './billing.routes.js';
import devices from './devices.routes.js';
import integrations from './integrations.routes.js';
import people from './people.routes.js';
import community from './community.routes.js';
import owner from './owner.routes.js';

/** Feature plugins registered inside v2Routes (they inherit its auth hooks). */
export const V2_FEATURES: ((app: FastifyInstance) => Promise<void>)[] = [sales, links, billing, devices, integrations, people, community, owner];
