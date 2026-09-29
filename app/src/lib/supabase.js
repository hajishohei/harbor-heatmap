import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://didhhgjaxdnwtwnbrrkk.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_5eAOWsn3yXNPPYZWtRldTg_vNnVWzoQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hm-auth' },
});

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}
