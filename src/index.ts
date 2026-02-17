import "dotenv/config";
// import { config } from "./config";
// import dotenv from "dotenv";
// dotenv.config();


// // the rest of your imports can stay

// console.log("DATABASE_URL =", process.env.DATABASE_URL);
import { createServer } from "./server";
import { testConnection } from "./lib/core/db";

async function main() {
  console.log("Supabase connected:", await testConnection());
}

main();

const port = Number(process.env.PORT || 4000);

createServer()
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
