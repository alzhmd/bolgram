import { dbService } from '../database.js';

export interface MerchantEntity {
  id: string;
  business_name: string;
  email: string;
  phone?: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING' | 'PAYMENT_REQUIRED';
  plan?: string;
  payment_status?: string;
  payment_note?: string;
  webhook_url?: string | null;
  redirect_url?: string | null;
  password_hash?: string | null;
  brand_slug?: string | null;
  custom_domain?: string | null;
  has_custom_domain?: boolean | number;
  brand_logo_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export class MerchantRepository {
  public static async findById(id: string): Promise<MerchantEntity | null> {

    // Fallback to local SQLite store
    const local = dbService.getMerchantById(id);
    if (local) {
      return {
        id: local.id,
        business_name: local.name,
        email: (local as any).email || 'merchant@example.com',
        phone: (local as any).phone || null,
        status: ((local as any).status as any) || 'ACTIVE',
        plan: (local as any).plan || 'FREE',
        payment_status: (local as any).payment_status || 'FREE',
        payment_note: (local as any).payment_note || null,
        webhook_url: local.webhook_url,
        password_hash: (local as any).password_hash || null,
        brand_slug: (local as any).brand_slug || null,
        custom_domain: (local as any).custom_domain || null,
        has_custom_domain: (local as any).has_custom_domain || 0,
        brand_logo_url: (local as any).brand_logo_url || null,
      };
    }
    return null;
  }


  public static async create(params: {
    id?: string;
    business_name: string;
    email: string;
    phone?: string;
    password_hash?: string;
    webhook_url?: string;
    redirect_url?: string;
  }): Promise<MerchantEntity> {

    // Local SQLite fallback
    const id = params.id || 'm_' + Math.random().toString(36).substring(2, 10);
    const merchant = {
      id,
      business_name: params.business_name,
      email: params.email,
      phone: params.phone || null,
      password_hash: params.password_hash || null,
      status: 'ACTIVE' as const,
      webhook_url: params.webhook_url || null,
      redirect_url: params.redirect_url || null,
    };
    try {
      dbService.insertMerchant({
        id,
        name: params.business_name,
        api_key: 'live_sk_' + Math.random().toString(36).substring(2, 14),
        email: params.email,
        phone: params.phone || '',
        password_hash: params.password_hash || '',
        status: 'ACTIVE',
      });
    } catch (e: any) {
      console.warn('[MerchantRepository] SQLite insert notice:', e?.message);
    }
    return merchant;
  }



}
