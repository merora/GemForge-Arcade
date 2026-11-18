// npm run demo — เปิดทุกอย่างในคำสั่งเดียว:
//   1) เชนจำลอง Hardhat (http://127.0.0.1:8545)  2) deploy สัญญา  3) หน้าเว็บ (http://localhost:5173)
// กด Ctrl+C เพื่อปิดทั้งหมด (ข้อมูลบนเชนจำลองจะหายไป — เปิดใหม่ครั้งหน้าเริ่มจากศูนย์)

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..");
const children = [];

function run(cmd, args, cwd, name, quiet = false) {
  const p = spawn(cmd, args, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  if (quiet) p.stdout.resume(); // อ่านทิ้ง (log ยาวมาก) แต่ต้องอ่านไม่ให้ buffer เต็ม
  else p.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(p);
  return p;
}

function rpcReady() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: 8545, method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }));
  });
}

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: 8545, method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body).result);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  });
}

/** สัญญาใน deployments.json มีอยู่จริงบนเชนที่เปิดอยู่ไหม (ถ้ามี = มี demo รันอยู่แล้ว ห้าม deploy ทับ) */
async function alreadyDeployed() {
  try {
    const dep = require(path.join(root, "frontend", "src", "deployments.json"))["31337"];
    if (!dep?.item || !dep?.market) return false;
    const [item, market] = await Promise.all([rpc("eth_getCode", [dep.item, "latest"]), rpc("eth_getCode", [dep.market, "latest"])]);
    return item && item !== "0x" && market && market !== "0x";
  } catch {
    return false;
  }
}

async function waitForChain(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await rpcReady()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("เชนจำลองไม่ตอบสนองภายใน 60 วินาที");
}

function shutdown() {
  for (const p of children) {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill("SIGINT");
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

(async () => {
  let reuse = false;
  if (await rpcReady()) {
    reuse = await alreadyDeployed();
    console.log(
      reuse
        ? "พบ demo ที่รันอยู่แล้ว (เชน + สัญญาเดิม) — ใช้ของเดิม ไม่ deploy ทับ"
        : "พบเชนจำลองเปิดอยู่แล้วที่พอร์ต 8545 — ใช้ตัวเดิม"
    );
  } else {
    console.log("▶ เปิดเชนจำลอง Hardhat…");
    run("npx", ["hardhat", "node"], root, "chain", true);
    await waitForChain();
  }

  if (!reuse) {
    console.log("▶ deploy สัญญา…");
    await new Promise((resolve, reject) => {
      const d = run("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], root, "deploy");
      d.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("deploy ไม่สำเร็จ"))));
    });
  }

  console.log("▶ เปิดหน้าเว็บ…");
  const web = run("npm", ["run", "dev"], path.join(root, "frontend"), "web");
  // แสดง URL จริงที่ Vite ใช้ (ถ้า 5173 ไม่ว่าง Vite จะเลื่อนไปพอร์ตถัดไป)
  web.stdout.on("data", (d) => {
    const m = String(d).replace(/\x1b\[[0-9;]*m/g, "").match(/http:\/\/localhost:\d+\//);
    if (m) console.log(`\n✅ พร้อมแล้ว — เปิด ${m[0]}  (Ctrl+C เพื่อปิด)\n`);
  });
})().catch((e) => {
  console.error("❌", e.message);
  shutdown();
});
