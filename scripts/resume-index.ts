import "dotenv/config";

const args = process.argv.slice(2);
const normalizedArgs: string[] = [];

for (const arg of args) {
  if (arg === "--concurrnecy-3") {
    normalizedArgs.push("--concurrency", "3");
    continue;
  }

  normalizedArgs.push(arg);
}

process.argv = [process.argv[0], process.argv[1], ...normalizedArgs];

void import("./resume-reindex.ts");