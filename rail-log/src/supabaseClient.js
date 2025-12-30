import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://prwoszrfsisxaseausud.supabase.co' // SupabaseのSettings > APIで確認
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByd29zenJmc2lzeGFzZWF1c3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwOTkyMDIsImV4cCI6MjA4MjY3NTIwMn0.9fw6198IAIyku5XDKhiQFGPxUpX20RHwpwMM0T-R118' // 同上

export const supabase = createClient(supabaseUrl, supabaseAnonKey)