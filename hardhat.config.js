require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
// อ่านค่าจากไฟล์ .env (ไฟล์นี้อยู่ใน .gitignore ห้าม commit / ห้ามส่งให้ใคร)
require("dotenv").config();

// ---- Sepolia (เปิดใช้เฉพาะเมื่อใส่ PRIVATE_KEY ใน .env แล้ว) ----
const RAW_KEY = (process.env.PRIVATE_KEY || "").trim();
const SEPOLIA_RPC_URL = (process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com").trim();

function sepoliaAccounts() {
  if (!RAW_KEY) return null;
  const key = RAW_KEY.startsWith("0x") ? RAW_KEY : "0x" + RAW_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "PRIVATE_KEY ใน .env ไม่ถูกรูปแบบ: ต้องเป็นเลขฐาน 16 ยาว 64 ตัว (จะมี 0x นำหน้าหรือไม่ก็ได้) " +
        "— ห้ามใส่ seed phrase 12 คำ"
    );
  }
  return [key];
}

const networks = {
  // เชนจำลองในเครื่อง: ขุดบล็อกใหม่ทุก 3 วินาที (นอกเหนือจากตอนมีธุรกรรม)
  // จำเป็นสำหรับ commit–reveal เพราะ reveal() ต้องรอให้ผ่านไปอย่างน้อย 1 บล็อก
  hardhat: {
    mining: { auto: true, interval: 3000 },
  },
};

// Base Sepolia = testnet ของ Base (Layer 2 แบบ OP Stack) บล็อกทุก ~2 วินาที
const BASE_SEPOLIA_RPC_URL = (process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org").trim();

const accounts = sepoliaAccounts();
if (accounts) {
  networks.sepolia = { url: SEPOLIA_RPC_URL, chainId: 11155111, accounts };
  networks.baseSepolia = { url: BASE_SEPOLIA_RPC_URL, chainId: 84532, accounts };
}

module.exports = {
  solidity: {
    version: "0.8.24",
    // เปิด optimizer: ลด gas และขนาดสัญญา (ItemNFT มีชื่อไอเทมภาษาไทยจำนวนมาก)
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks,
};
