import process from 'node:process';

// Automatically load local .env file if available in runtime environment
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // Gracefully continue if .env does not exist
  }
}

export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DB_DRIVER: 'sqlite' | 'supabase';
}

function decodeFallback(b64: string): string {
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const DEFAULT_SUPABASE_URL = '';
const DEFAULT_ANON_KEY = '';
const DEFAULT_SERVICE_KEY = '';

export const env: EnvConfig = {
  NODE_ENV: (process.env.NODE_ENV as any) || 'development',
  PORT: Number(process.env.PORT) || 4000,
  HOST: process.env.HOST || '0.0.0.0',
  SUPABASE_URL: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || DEFAULT_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SERVICE_KEY,
  // Auto-activate Supabase driver whenever credentials are provided in .env
  DB_DRIVER: (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL) && (process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SERVICE_KEY) ? 'supabase' : 'sqlite',
};
