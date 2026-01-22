"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAnon = exports.supabaseAdmin = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
// For server-side use (scraper, cron, ingestion)
exports.supabaseAdmin = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// For client-side use (frontend)
exports.supabaseAnon = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
