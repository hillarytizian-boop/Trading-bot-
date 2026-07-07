import { createClient } from '@supabase/supabase-js';

// Hardcoded values from your Supabase project
const supabaseUrl = 'https://uopplshaxbilbyrceddk.supabase.co';
const supabaseKey = 'sb_publishable_It_2Zqmb_a98MLuMRJCIlg_Z9bJ8oB2';

export const supabase = createClient(supabaseUrl, supabaseKey);
