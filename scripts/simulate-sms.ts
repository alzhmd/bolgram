/**
 * CLI Tool to simulate an incoming bKash / Nagad SMS to PayFlow Server
 * Usage: npm run simulate
 */

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';
const DEVICE_TOKEN = 'token_phone_primary';

async function sendSimulatedSms() {
  const args = process.argv.slice(2);
  const provider = (args[0] || 'bKash').toLowerCase();
  const amount = parseFloat(args[1] || '1250');
  const sender = args[2] || '01712998877';
  const trxId = args[3] || 'TRX' + Math.random().toString(36).substring(2, 8).toUpperCase();

  let rawSms = '';
  let senderAddress = '';

  if (provider === 'nagad') {
    senderAddress = '16167';
    rawSms = `Received Amount: Tk ${amount.toFixed(2)} from ${sender}. TxnID: ${trxId}. Balance: Tk 18,900.00`;
  } else if (provider === 'rocket') {
    senderAddress = '16216';
    rawSms = `Tk ${amount.toFixed(2)} received from ${sender}. TxnId: ${trxId}. Balance: Tk 6,400.00`;
  } else {
    senderAddress = 'bKash';
    rawSms = `You have received Tk ${amount.toFixed(2)} from ${sender}. Fee Tk 0.00. Balance Tk 14,350.00. TrxID ${trxId} at ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
  }

  console.log(`\n📲 [SIMULATOR] Sending SMS to PayFlow Engine (${SERVER_URL})...`);
  console.log(`----------------------------------------------------------------`);
  console.log(`Provider: ${provider.toUpperCase()}`);
  console.log(`Amount:   Tk ${amount.toFixed(2)}`);
  console.log(`Sender:   ${sender}`);
  console.log(`TrxID:    ${trxId}`);
  console.log(`SMS:      "${rawSms}"\n`);

  try {
    const res = await fetch(`${SERVER_URL}/api/v1/device/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_token: DEVICE_TOKEN,
        sender: senderAddress,
        raw_sms: rawSms,
      }),
    });

    const data = await res.json();
    console.log(`📥 Server Response (${res.status}):`);
    console.log(JSON.stringify(data, null, 2));

    if (res.ok) {
      console.log(`\n✅ Transaction ready for checkout verification with TrxID: ${trxId}`);
    }
  } catch (err: any) {
    console.error(`❌ Connection failed: Make sure server is running on ${SERVER_URL}`);
  }
}

sendSimulatedSms();
