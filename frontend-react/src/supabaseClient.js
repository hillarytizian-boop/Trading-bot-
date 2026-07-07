import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uopplshaxbilbyrceddk.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_It_2Zqmb_a98MLuMRJCIlg_Z9bJ8oB2';

export const supabase = createClient(supabaseUrl, supabaseKey);
