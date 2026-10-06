import { getSupabaseClient, isSupabaseConfigured } from '../supabase.js';
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
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const targetId = isUuid ? id : '00000000-0000-0000-0000-000000000101';

      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (!error && data) {
        const local = dbService.getMerchantById(id);
        return {
          ...data,
          id: id,
          brand_slug: (data as any).brand_slug || (local as any)?.brand_slug || null,
          custom_domain: (data as any).custom_domain || (local as any)?.custom_domain || null,
          has_custom_domain: (data as any).has_custom_domain !== undefined ? (data as any).has_custom_domain : ((local as any)?.has_custom_domain || 0),
          brand_logo_url: (data as any).brand_logo_url || (local as any)?.brand_logo_url || null,
        } as MerchantEntity;
      }
    }

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

  public static async findByEmail(email: string): Promise<MerchantEntity | null> {
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (!error && data) {
        return data as MerchantEntity;
      }
    }

    // Local SQLite fallback
    const local = dbService.getMerchantByEmail(email) || dbService.getAdminMerchants().find(
      (m: any) => m.email === email || m.id === email || m.name?.toLowerCase() === email.toLowerCase()
    );
    if (local) {
      return {
        id: local.id,
        business_name: (local as any).business_name || local.name,
        email: local.email || email,
        phone: local.phone || null,
        status: (local.status as any) || 'ACTIVE',
        plan: local.plan || 'FREE',
        payment_status: local.payment_status || 'FREE',
        payment_note: local.payment_note || null,
        webhook_url: local.webhook_url,
        password_hash: (local as any).password_hash || null,
      };
    }

    // Check demo accounts
    if (email === 'demo@syncpaybd.site' || email === 'merchant@example.com') {
      return {
        id: '00000000-0000-0000-0000-000000000101',
        business_name: 'Demo Merchant Store',
        email,
        status: 'ACTIVE',
        plan: 'PRO',
        payment_status: 'PAID',
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
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      try {
        const payload: any = {
          business_name: params.business_name,
          email: params.email,
          phone: params.phone || null,
          password_hash: params.password_hash || null,
          webhook_url: params.webhook_url || null,
          redirect_url: params.redirect_url || null,
          status: 'ACTIVE',
        };
        if (params.id) payload.id = params.id;

        const { data, error } = await supabase
          .from('merchants')
          .insert(payload)
          .select()
          .single();

        if (!error && data) {
          try {
            dbService.insertMerchant({
              id: data.id,
              name: params.business_name,
              api_key: 'live_sk_' + Math.random().toString(36).substring(2, 14),
              email: params.email,
              phone: params.phone,
              password_hash: params.password_hash,
              status: 'ACTIVE',
            });
          } catch {}
          return data as MerchantEntity;
        }
      } catch {}
    }

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

  public static async findBySlug(slug: string): Promise<MerchantEntity | null> {
    if (!slug) return null;
    const cleanSlug = slug.toLowerCase().trim();

    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('brand_slug', cleanSlug)
        .maybeSingle();

      if (!error && data) {
        return data as MerchantEntity;
      }
    }

    const local = dbService.getMerchantBySlug(cleanSlug);
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

  public static async findByDomain(domain: string): Promise<MerchantEntity | null> {
    if (!domain) return null;
    const cleanDomain = domain.toLowerCase().trim().replace(/:\d+$/, '');

    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('custom_domain', cleanDomain)
        .maybeSingle();

      if (!error && data) {
        return data as MerchantEntity;
      }
    }

    const local = dbService.getMerchantByDomain(cleanDomain);
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

  public static async updateBranding(
    id: string,
    params: {
      brand_slug?: string;
      custom_domain?: string;
      has_custom_domain?: number;
      brand_logo_url?: string;
    }
  ): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const payload: any = { updated_at: new Date().toISOString() };
      if (params.brand_slug !== undefined) payload.brand_slug = params.brand_slug ? params.brand_slug.toLowerCase().trim() : null;
      if (params.custom_domain !== undefined) payload.custom_domain = params.custom_domain ? params.custom_domain.toLowerCase().trim() : null;
      if (params.has_custom_domain !== undefined) payload.has_custom_domain = Boolean(params.has_custom_domain);
      if (params.brand_logo_url !== undefined) payload.brand_logo_url = params.brand_logo_url ? params.brand_logo_url.trim() : null;

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const targetId = isUuid ? id : '00000000-0000-0000-0000-000000000101';

      const { error } = await supabase.from('merchants').update(payload).eq('id', targetId);
      if (error) {
        console.error('Failed to update Supabase merchant branding:', error);
      }
    }

    // Update local SQLite store
    dbService.updateMerchantBranding(id, params);
    return true;
  }
}
