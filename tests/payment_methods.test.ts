import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../src/db/database';

describe('Payment Methods Suite: Zero-Prefill & Dynamic Merchant Control', () => {
  const db = new DatabaseService(':memory:');
  const merchantId = 'm_demo_101';

  it('should start with 0 payment channels by default (clean slate on initial state)', () => {
    const allMethods = db.getPaymentMethods(merchantId, false) as any[];
    assert.equal(
      allMethods.length,
      0,
      'Merchant should start with 0 payment channels until explicitly added'
    );
  });

  it('should dynamically add payment channels when added by the merchant', () => {
    const bkash = db.upsertPaymentMethod({
      merchant_id: merchantId,
      provider_type: 'bkash',
      title: 'bKash',
      badge: 'MFS',
      account_number: '01580397069',
      is_active: 1,
    }) as any;

    assert.ok(bkash && bkash.id, 'Payment channel must be created with ID');
    const methodsAfterOne = db.getPaymentMethods(merchantId, false) as any[];
    assert.equal(methodsAfterOne.length, 1, 'Exactly 1 payment method should exist');
    assert.equal(methodsAfterOne[0].provider_type, 'bkash');
  });

  it('should toggle payment method active status dynamically', () => {
    const methods = db.getPaymentMethods(merchantId, false) as any[];
    const channel = methods[0];
    assert.ok(channel, 'Channel must exist');

    // Toggle to inactive
    db.togglePaymentMethod(channel.id, merchantId, false);
    const activeListOff = db.getPaymentMethods(merchantId, true) as any[];
    assert.equal(activeListOff.length, 0, 'Inactive channel must not be returned in checkout active list');

    // Toggle back to active
    db.togglePaymentMethod(channel.id, merchantId, true);
    const activeListOn = db.getPaymentMethods(merchantId, true) as any[];
    assert.equal(activeListOn.length, 1, 'Channel should return to active list');
  });

  it('should support saving and retrieving custom qr_code_url on payment channels', () => {
    const testQrData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const method = db.upsertPaymentMethod({
      merchant_id: merchantId,
      provider_type: 'nagad',
      title: 'Nagad Store',
      account_number: '01712345678',
      qr_code_url: testQrData,
      is_active: 1,
    }) as any;

    assert.ok(method, 'Nagad channel should be created');
    assert.equal(method.qr_code_url, testQrData, 'qr_code_url must match uploaded test QR data');

    // Update with clear/remove QR
    const updated = db.upsertPaymentMethod({
      id: method.id,
      merchant_id: merchantId,
      provider_type: 'nagad',
      title: 'Nagad Store',
      account_number: '01712345678',
      qr_code_url: '',
    }) as any;

    assert.equal(updated.qr_code_url, null, 'qr_code_url should be null when cleared');
  });

  it('should delete payment method and remove it from merchant list', () => {
    const methods = db.getPaymentMethods(merchantId, false) as any[];
    for (const m of methods) {
      db.deletePaymentMethod(m.id, merchantId);
    }

    const remaining = db.getPaymentMethods(merchantId, false) as any[];
    assert.equal(remaining.length, 0, 'All payment methods should be deleted');
  });

  it('should guarantee a new merchant account is 100% fresh with 0 channels and isolated from others', () => {
    const freshMerchantId = 'm_fresh_' + Date.now();
    // Verify fresh merchant starts with 0 channels
    const initialMethods = db.getPaymentMethods(freshMerchantId, false) as any[];
    assert.equal(initialMethods.length, 0, 'New merchant must start with 0 payment channels');

    // Populate a channel for demo merchant
    db.upsertPaymentMethod({
      merchant_id: merchantId,
      provider_type: 'bkash',
      title: 'Demo bKash',
      account_number: '01900000000',
      is_active: 1,
    });

    // Fresh merchant must still have 0 channels (no cross-talk or leakage)
    const methodsAfterOtherAdded = db.getPaymentMethods(freshMerchantId, false) as any[];
    assert.equal(methodsAfterOtherAdded.length, 0, 'Fresh merchant must not see another merchant channels');

    // Clean up
    const demoMethods = db.getPaymentMethods(merchantId, false) as any[];
    for (const m of demoMethods) {
      db.deletePaymentMethod(m.id, merchantId);
    }
  });

  it('should generate and support deterministic 17-digit merchant identifiers (11 digits phone + 6 digits YYMMDD)', () => {
    const phone = '01755123456';
    const cleanPhone = phone.replace(/\D/g, '').slice(-11).padStart(11, '0');
    const d = new Date();
    const dateStr = String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const id17 = cleanPhone + dateStr;

    assert.equal(id17.length, 17, 'Identifier must be strictly 17 digits');
    assert.match(id17, /^\d{17}$/, 'Identifier must be strictly numeric digits');

    // Test inserting and querying channels with 17-digit ID
    db.upsertPaymentMethod({
      merchant_id: id17,
      provider_type: 'nagad',
      title: 'Nagad 17D',
      account_number: phone,
      is_active: 1,
    });

    const methods = db.getPaymentMethods(id17, false) as any[];
    assert.equal(methods.length, 1, 'Should find channel for 17-digit merchant ID');
    assert.equal(methods[0].merchant_id, id17, 'Channel merchant_id must match 17-digit ID');

    // Clean up
    db.deletePaymentMethod(methods[0].id, id17);
    const afterDelete = db.getPaymentMethods(id17, false) as any[];
    assert.equal(afterDelete.length, 0, 'Should delete channel for 17-digit merchant ID');
  });

  it('should guarantee zero pre-seeded devices and completely clean device slate', () => {
    const devices = db.getAllDevices(merchantId);
    assert.equal(devices.length, 0, 'Merchant should start with 0 devices, no fake pre-seeded phones');

    const devPhone = db.getDeviceByToken('dev_phone_1');
    assert.equal(devPhone, undefined, 'dev_phone_1 must be completely purged');

    const devToken = db.getDeviceByToken('token_phone_primary');
    assert.equal(devToken, undefined, 'token_phone_primary must be completely purged');
  });
});
