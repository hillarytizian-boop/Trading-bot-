const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // or SERVICE_ROLE_KEY for admin

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
