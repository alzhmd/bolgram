import type { FastifyInstance } from 'fastify';

const octet = () => Math.floor(Math.random() * 254) + 1;

/**
 * Signs up through the real two-step flow: the first submit texts a code (returned as dev_code
 * outside production) and the same form sent again with that code creates the account.
 * Each sign-up comes from its own random private address so the per-IP code cap never trips.
 */
export async function signup(app: FastifyInstance, payload: Record<string, unknown>) {
  const remoteAddress = `10.${octet()}.${octet()}.${octet()}`;
  const url = '/api/v2/auth/register';
  const first = await app.inject({ method: 'POST', url, payload, remoteAddress });
  if (first.statusCode !== 202) return first;
  const { dev_code } = JSON.parse(first.body);
  return app.inject({ method: 'POST', url, payload: { ...payload, code: dev_code }, remoteAddress });
}
