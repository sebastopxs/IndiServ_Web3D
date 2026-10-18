import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://pvrfnvrxaxulcxacdino.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_G7D4dhh3Q2LWzgRnzRRa9A_4ngZ5FiW'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
