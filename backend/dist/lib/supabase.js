"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdmin = supabaseAdmin;
const supabase_js_1 = require("@supabase/supabase-js");
function supabaseAdmin() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return (0, supabase_js_1.createClient)(url, key, { auth: { persistSession: false } });
}
