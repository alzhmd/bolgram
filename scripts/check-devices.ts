import { DeviceRepository } from '../src/db/repositories/device.repository.js';
import { dbService } from '../src/db/database.js';

async function main() {
  const merchantId = '00000000-0000-0000-0000-000000000101';
  console.log("Listing devices for merchant:", merchantId);
  const devices = await DeviceRepository.listByMerchant(merchantId);
  console.log("Found devices count:", devices.length);
  for (const d of devices) {
    console.log(`- ID: ${d.id}`);
    console.log(`  Name: ${d.device_name}`);
    console.log(`  Model: ${d.device_model}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Last Seen: ${d.last_seen_at}`);
  }
}

main().catch(console.error);
