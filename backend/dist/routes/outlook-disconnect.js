"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outlookDisconnectHandler = outlookDisconnectHandler;
const supabase_1 = require("../lib/supabase");
async function outlookDisconnectHandler(_req, res) {
    const db = (0, supabase_1.supabaseAdmin)();
    await db.from("outlook_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    res.json({ success: true });
}
