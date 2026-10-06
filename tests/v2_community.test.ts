import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes, issueToken } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { events } from '../src/services/events.js';
import { CryptoUtil } from '../src/utils/crypto.js';
import { isValidNationalCode, isValidCompanyId } from '../src/routes/v2/community.routes.js';

const d = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');

describe('Community (support, review, trust)', () => {
  let app: FastifyInstance;
  const stamp = Date.now() % 1e7;
  let A: any, B: any, authA: any, authB: any, authViewer: any, owner: any;
  const req = (method: string, url: string, payload?: any, headers: any = {}) => app.inject({ method: method as any, url, payload, headers });
  const json = (r: any) => JSON.parse(r.body);

  before(async () => {
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    const reg = async (h: string, mob: string) => {
      const r = await req('POST', '/api/v2/auth/register', { handle: h, mobile: mob, password: 'Strong-pass-77', terms: true });
      assert.strictEqual(r.statusCode, 201, r.body);
      return json(r);
    };
    const a = await reg(`coma${stamp}`, `0915${String(stamp).padStart(7, '0')}`);
    const b = await reg(`comb${stamp}`, `0914${String(stamp).padStart(7, '0')}`);
    A = a.merchant; B = b.merchant;
    authA = { authorization: `Bearer ${a.token}` };
    authB = { authorization: `Bearer ${b.token}` };
    d().prepare(`UPDATE merchants SET name = ? WHERE id = ?`).run('فروشگاه آلفا', A.id);
    d().prepare(`INSERT INTO team_members (id, merchant_id, name, mobile, role, status, token_version, created_at) VALUES (?, ?, 'ناظر', '09120000001', 'viewer', 'active', 0, ?)`).run('tm_c' + stamp, A.id, Date.now());
    authViewer = { authorization: `Bearer ${issueToken(d().prepare('SELECT * FROM merchants WHERE id = ?').get(A.id), false, { id: 'tm_c' + stamp, token_version: 0 })}` };
    owner = { authorization: `Bearer ${CryptoUtil.signJwt({ id: 'admin', email: 'admin@test.ir', role: 'admin' }, undefined, 1)}` };
  });
  after(async () => app.close());

  test('validators: national code and company id', () => {
    for (const ok of ['0013542419', '0499370899', '۰۰۱۳۵۴۲۴۱۹']) assert.ok(isValidNationalCode(ok), ok);
    for (const bad of ['1234567890', '0013542418', '1111111111', '12345', 'abcdefghij', '']) assert.ok(!isValidNationalCode(bad), bad);
    for (const ok of ['10380284790', '14003778990']) assert.ok(isValidCompanyId(ok), ok);
    for (const bad of ['10380284791', '11111111111', '1038028479', '']) assert.ok(!isValidCompanyId(bad), bad);
  });

  test('ticket lifecycle: create with attachments, owner reply, event, reply, close, reopen', async () => {
    const replied: any[] = [];
    events.on('ticket.replied', (p) => replied.push(p));
    const bad = await req('POST', '/api/v2/support/tickets', { subject: 'x', body: '' }, authA);
    assert.strictEqual(bad.statusCode, 422);
    assert.ok(json(bad).errors.subject && json(bad).errors.body);
    const badAtt = await req('POST', '/api/v2/support/tickets', { subject: 'مشکل پرداخت', body: 'سلام', attachments: [{ name: 'a.svg', data_url: 'data:image/svg+xml;base64,PHN2Zy8+' }] }, authA);
    assert.strictEqual(badAtt.statusCode, 422);
    const tooMany = await req('POST', '/api/v2/support/tickets', { subject: 'مشکل پرداخت', body: 'سلام', attachments: [PNG, PNG, PNG, PNG] }, authA);
    assert.strictEqual(tooMany.statusCode, 422);

    const c = await req('POST', '/api/v2/support/tickets', { subject: 'مشکل پرداخت', category: 'payment', priority: 'high', body: 'واریزی من ثبت نشده', attachments: [{ name: 'رسید.png', data_url: PNG }, { name: 'doc.pdf', data_url: PDF }] }, authA);
    assert.strictEqual(c.statusCode, 201, c.body);
    const created = json(c);
    const id = created.ticket.id;
    assert.strictEqual(created.ticket.status, 'open');
    assert.strictEqual(created.messages[0].attachments.length, 2);
    const att = created.messages[0].attachments[0];

    const dl = await req('GET', `/api/v2/support/tickets/${id}/attachments/${att.file}`, undefined, authA);
    assert.strictEqual(dl.statusCode, 200);
    assert.strictEqual(dl.headers['content-type'], 'image/png');
    assert.strictEqual((await req('GET', `/api/v2/support/tickets/${id}/attachments/${att.file}`)).statusCode, 401);

    // owner side
    const stats0 = json(await req('GET', '/api/owner/tickets/stats', undefined, owner));
    assert.ok(stats0.open >= 1);
    const list = json(await req('GET', `/api/owner/tickets?status=open&q=${encodeURIComponent(`coma${stamp}`)}`, undefined, owner));
    assert.strictEqual(list.total, 1);
    assert.strictEqual(list.data[0].store.handle, `coma${stamp}`);
    assert.ok(list.data[0].waiting_seconds >= 0);
    assert.strictEqual((await req('GET', '/api/owner/tickets', undefined, authA)).statusCode, 401);
    const ownerAtt = await req('GET', `/api/owner/tickets/${id}/attachments/${att.file}`, undefined, owner);
    assert.strictEqual(ownerAtt.statusCode, 200);

    const rep = await req('POST', `/api/owner/tickets/${id}/reply`, { body: 'بررسی شد، واریزی شما تأیید شد.' }, owner);
    assert.strictEqual(rep.statusCode, 201, rep.body);
    assert.strictEqual(json(rep).ticket.status, 'answered');
    await events.settle();
    assert.deepStrictEqual(replied.map((r) => [r.merchantId, r.ticketId]), [[A.id, id]]);
    const stats1 = json(await req('GET', '/api/owner/tickets/stats', undefined, owner));
    assert.ok(stats1.avg_first_response_seconds !== null && stats1.avg_first_response_seconds >= 0);

    // merchant sees unread, opening the thread clears it
    const l1 = json(await req('GET', '/api/v2/support/tickets', undefined, authA));
    assert.strictEqual(l1.data[0].unread, true);
    assert.strictEqual(json(await req('GET', '/api/v2/support/summary', undefined, authA)).unread, 1);
    const got = json(await req('GET', `/api/v2/support/tickets/${id}`, undefined, authA));
    assert.strictEqual(got.messages.length, 2);
    assert.strictEqual(got.messages[1].author_kind, 'admin');
    assert.strictEqual(json(await req('GET', '/api/v2/support/tickets?status=answered', undefined, authA)).data[0].unread, false);

    const r2 = await req('POST', `/api/v2/support/tickets/${id}/reply`, { body: 'ممنون' }, authA);
    assert.strictEqual(json(r2).ticket.status, 'open');
    assert.strictEqual((await req('POST', `/api/v2/support/tickets/${id}/close`, {}, authA)).statusCode, 200);
    assert.strictEqual((await req('POST', `/api/v2/support/tickets/${id}/reply`, { body: 'سلام' }, authA)).statusCode, 409);
    assert.strictEqual(json(await req('POST', `/api/v2/support/tickets/${id}/reopen`, {}, authA)).ticket.status, 'open');

    const pat = await req('PATCH', `/api/owner/tickets/${id}`, { status: 'waiting', priority: 'urgent' }, owner);
    assert.strictEqual(json(pat).ticket.priority, 'urgent');
    assert.strictEqual((await req('PATCH', `/api/owner/tickets/${id}`, { status: 'weird' }, owner)).statusCode, 422);
  });

  test('ticket scoping and permissions', async () => {
    const c = json(await req('POST', '/api/v2/support/tickets', { subject: 'تیکت خصوصی', body: 'متن' }, authA));
    const id = c.ticket.id;
    assert.strictEqual((await req('GET', `/api/v2/support/tickets/${id}`, undefined, authB)).statusCode, 404);
    assert.strictEqual((await req('POST', `/api/v2/support/tickets/${id}/reply`, { body: 'سلام' }, authB)).statusCode, 404);
    assert.strictEqual((await req('POST', `/api/v2/support/tickets/${id}/close`, {}, authB)).statusCode, 404);
    assert.strictEqual(json(await req('GET', '/api/v2/support/tickets', undefined, authB)).total, 0);
    // viewer role has no support:use / review:write / trust:manage
    assert.strictEqual((await req('GET', '/api/v2/support/tickets', undefined, authViewer)).statusCode, 403);
    assert.strictEqual((await req('PUT', '/api/v2/review', { rating: 5, text: 'خیلی عالی بود' }, authViewer)).statusCode, 403);
    assert.strictEqual((await req('GET', '/api/v2/trust', undefined, authViewer)).statusCode, 403);
  });

  test('review: validation, upsert, moderation, owner reply, public list', async () => {
    assert.strictEqual(json(await req('GET', '/api/v2/review', undefined, authA)).review, null);
    const bad = await req('PUT', '/api/v2/review', { rating: 7, text: 'کوتاه' }, authA);
    assert.strictEqual(bad.statusCode, 422);
    assert.ok(json(bad).errors.rating && json(bad).errors.text);
    assert.strictEqual(json(await req('GET', '/api/pub/reviews')).data.length, 0);

    const put = json(await req('PUT', '/api/v2/review', { rating: 4, text: 'سرویس خوب و پشتیبانی سریع' }, authA));
    assert.strictEqual(put.review.status, 'pending');
    const again = json(await req('PUT', '/api/v2/review', { rating: 5, text: 'سرویس عالی و پشتیبانی سریع' }, authA));
    assert.strictEqual(again.review.rating, 5);
    assert.strictEqual((d().prepare('SELECT COUNT(*) c FROM store_reviews WHERE merchant_id = ?').get(A.id) as any).c, 1);
    assert.strictEqual(json(await req('GET', '/api/pub/reviews')).data.length, 0, 'pending is not public');

    const ownerList = json(await req('GET', '/api/owner/reviews?status=pending', undefined, owner));
    assert.ok(ownerList.data.some((r: any) => r.id === A.id));
    const mod = await req('PATCH', `/api/owner/reviews/${A.id}`, { status: 'approved', reply: 'ممنون از شما' }, owner);
    assert.strictEqual(mod.statusCode, 200, mod.body);
    const pub = json(await req('GET', '/api/pub/reviews'));
    assert.strictEqual(pub.data.length, 1);
    assert.strictEqual(pub.data[0].name, 'فروشگاه آلفا');
    assert.strictEqual(pub.data[0].reply, 'ممنون از شما');
    assert.strictEqual(pub.summary.count, 1);
    assert.ok(!('merchant_id' in pub.data[0]));

    // opt out of name -> masked handle; editing sends it back to moderation
    const out = json(await req('PUT', '/api/v2/review', { rating: 5, text: 'سرویس عالی و پشتیبانی سریع', show_name: false }, authA));
    assert.strictEqual(out.review.status, 'pending');
    await req('PATCH', `/api/owner/reviews/${A.id}`, { status: 'approved' }, owner);
    const masked = json(await req('GET', '/api/pub/reviews')).data[0].name;
    assert.ok(masked.includes('***') && !masked.includes(`coma${stamp}`));
    await req('PATCH', `/api/owner/reviews/${A.id}`, { status: 'hidden' }, owner);
    assert.strictEqual(json(await req('GET', '/api/pub/reviews')).data.length, 0);
    assert.strictEqual((await req('PATCH', `/api/owner/reviews/${A.id}`, { status: 'nope' }, owner)).statusCode, 422);
  });

  test('trust: validation, documents, submit, decide, public JSON and badge', async () => {
    const handle = `coma${stamp}`;
    // not verified yet: neutral badge + unverified JSON
    const pre = await req('GET', `/api/pub/trust/${handle}/badge.svg`);
    assert.strictEqual(pre.statusCode, 200);
    assert.match(pre.headers['content-type'] as string, /image\/svg\+xml/);
    assert.match(pre.body, /تأیید نشده/);
    assert.strictEqual(json(await req('GET', `/api/pub/trust/${handle}`)).verified, false);

    assert.strictEqual(json(await req('GET', '/api/v2/trust', undefined, authA)).status, 'none');
    const badSave = await req('PUT', '/api/v2/trust', { business_type: 'individual', national_code: '1234567890', website: 'javascript:alert(1)' }, authA);
    assert.strictEqual(badSave.statusCode, 422);
    assert.ok(json(badSave).errors.national_code && json(badSave).errors.website);

    const early = await req('POST', '/api/v2/trust/submit', {}, authA);
    assert.strictEqual(early.statusCode, 422);

    const save = await req('PUT', '/api/v2/trust', {
      business_type: 'company', business_name: 'فروشگاه آلفا', owner_name: 'علی رضایی', national_code: '۰۰۱۳۵۴۲۴۱۹',
      company_national_id: '10380284790', website: 'alpha.ir', instagram: '@Alpha_Shop', phone: '09151234567', address: 'تهران، خیابان ولیعصر، پلاک ۱۰',
    }, authA);
    assert.strictEqual(save.statusCode, 200, save.body);
    assert.strictEqual(json(save).request.website, 'https://alpha.ir');
    assert.strictEqual(json(save).request.instagram, 'alpha_shop');

    const noDocs = await req('POST', '/api/v2/trust/submit', {}, authA);
    assert.strictEqual(noDocs.statusCode, 422);
    assert.ok(json(noDocs).errors.documents);
    const badDoc = await req('POST', '/api/v2/trust/documents', { kind: 'national_card', data_url: 'data:text/html;base64,PGI+' }, authA);
    assert.strictEqual(badDoc.statusCode, 422);
    const up = await req('POST', '/api/v2/trust/documents', { kind: 'national_card', data_url: PNG, name: 'card.png' }, authA);
    assert.strictEqual(up.statusCode, 201, up.body);
    assert.strictEqual((await req('POST', '/api/v2/trust/submit', {}, authA)).statusCode, 422, 'company needs license too');
    await req('POST', '/api/v2/trust/documents', { kind: 'business_license', data_url: PDF }, authA);
    const sub = await req('POST', '/api/v2/trust/submit', {}, authA);
    assert.strictEqual(sub.statusCode, 200, sub.body);
    assert.strictEqual(json(sub).status, 'pending');
    assert.strictEqual((await req('PUT', '/api/v2/trust', { business_name: 'تغییر' }, authA)).statusCode, 409, 'locked while pending');
    assert.strictEqual(json(await req('GET', '/api/v2/trust', undefined, authA)).embed, null);

    // owner
    const list = json(await req('GET', '/api/owner/trust?status=pending', undefined, owner));
    assert.ok(list.data.some((r: any) => r.merchant_id === A.id));
    const det = json(await req('GET', `/api/owner/trust/${A.id}`, undefined, owner));
    assert.strictEqual(det.request.documents.length, 2);
    const docRes = await req('GET', det.request.documents[0].url, undefined, owner);
    assert.strictEqual(docRes.statusCode, 200);
    assert.strictEqual((await req('GET', det.request.documents[0].url, undefined, authA)).statusCode, 401);
    assert.strictEqual((await req('POST', `/api/owner/trust/${A.id}/decide`, { approved: false }, owner)).statusCode, 422, 'rejection needs a reason');

    const decided: any[] = [];
    events.on('trust.decided', (p) => decided.push(p));
    const rej = await req('POST', `/api/owner/trust/${A.id}/decide`, { approved: false, note: 'تصویر کارت ملی خوانا نیست' }, owner);
    assert.strictEqual(json(rej).request.status, 'rejected');
    assert.strictEqual(json(await req('GET', '/api/v2/trust', undefined, authA)).request.note, 'تصویر کارت ملی خوانا نیست');
    assert.strictEqual(json(await req('GET', `/api/pub/trust/${handle}`)).verified, false);
    assert.strictEqual((await req('POST', '/api/v2/trust/submit', {}, authA)).statusCode, 200, 'resubmit after rejection');

    const ok = await req('POST', `/api/owner/trust/${A.id}/decide`, { approved: true, note: 'تأیید شد' }, owner);
    assert.strictEqual(ok.statusCode, 200, ok.body);
    await events.settle();
    assert.deepStrictEqual(decided.map((x) => x.approved), [false, true]);
    assert.ok((d().prepare(`SELECT COUNT(*) c FROM audit_log WHERE merchant_id = ? AND action = 'trust.approved'`).get(A.id) as any).c >= 1);

    const mine = json(await req('GET', '/api/v2/trust', undefined, authA));
    assert.strictEqual(mine.status, 'approved');
    assert.match(mine.embed.html, new RegExp(`/trust/${handle}"`));
    assert.match(mine.embed.html, new RegExp(`/api/pub/trust/${handle}/badge\\.svg`));
    assert.match(mine.embed.html, /alt="نماد اعتماد بولگرام"/);

    const pubJson = json(await req('GET', `/api/pub/trust/${handle}`));
    assert.strictEqual(pubJson.verified, true);
    assert.strictEqual(pubJson.website, 'https://alpha.ir');
    assert.match(pubJson.verified_at_fa, /^\d{4}\/\d{2}\/\d{2}$/);
    assert.ok(!('national_code' in pubJson));
    const svg = await req('GET', `/api/pub/trust/${handle}/badge.svg`);
    assert.match(svg.headers['content-type'] as string, /image\/svg\+xml/);
    assert.match(svg.headers['cache-control'] as string, /max-age/);
    assert.match(svg.body, /نماد اعتماد بولگرام/);
    assert.doesNotMatch(svg.body, /تأیید نشده/);
    assert.match((await req('GET', `/trust/${handle}`)).headers['content-type'] as string, /text\/html/);
    // other store untouched
    assert.strictEqual(json(await req('GET', '/api/v2/trust', undefined, authB)).status, 'none');
  });
});
