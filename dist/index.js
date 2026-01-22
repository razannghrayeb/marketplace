"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// the rest of your imports can stay
console.log("DATABASE_URL =", process.env.DATABASE_URL);
const server_js_1 = require("./server.js");
const db_js_1 = require("./lib/core/db.js");
async function main() {
    console.log("Supabase connected:", await (0, db_js_1.testConnection)());
}
main();
const port = Number(process.env.PORT || 4000);
(0, server_js_1.createServer)()
    .then((app) => {
    const server = app.listen(port, () => {
        console.log(`api listening on :${port}`);
    });
    // Keep the server alive
    process.on("SIGINT", () => {
        console.log("Shutting down...");
        server.close(() => process.exit(0));
    });
})
    .catch((err) => {
    console.error("fatal boot error", err);
    process.exit(1);
});
