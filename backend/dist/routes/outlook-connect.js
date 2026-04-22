"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outlookConnectHandler = outlookConnectHandler;
const graph_1 = require("../lib/graph");
function outlookConnectHandler(req, res) {
    const base = process.env.APP_URL ?? "http://localhost:5173";
    const redirectUri = `${process.env.APP_URL ?? "http://localhost:4000"}/api/outlook/callback`;
    const url = (0, graph_1.getAuthUrl)(redirectUri);
    res.redirect(url);
}
