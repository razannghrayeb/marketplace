import { createServer } from "./server";
const port = Number(process.env.PORT || 4000);
createServer().then(app => app.listen(port, () => {
console.log(`api listening on :${port}`);
})).catch(err => {
console.error("fatal boot error", err);
process.exit(1);
});