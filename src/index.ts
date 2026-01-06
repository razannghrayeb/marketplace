import { createServer } from "./server";

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