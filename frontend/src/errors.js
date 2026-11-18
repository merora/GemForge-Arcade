// แปลง error จาก MetaMask / สัญญา ให้เป็นข้อความภาษาไทยที่ผู้เล่นเข้าใจ

const MESSAGES = {
  FaucetOnCooldown: ([availableAt]) =>
    `Faucet ยังไม่พร้อม — กดได้อีกครั้ง ${new Date(Number(availableAt) * 1000).toLocaleString("th-TH")}`,
  ERC20InsufficientBalance: () => "GEM ไม่พอ — กด Faucet เพื่อรับ GEM ก่อน",
  ERC20InsufficientAllowance: () => "ยังไม่ได้อนุญาต (approve) ให้เกมใช้ GEM",
  AlreadyPending: () => "มีคำขอค้างอยู่ — กด “เปิดผล” ก่อน",
  NothingPending: () => "ไม่มีคำขอให้เปิดผล",
  TooEarly: () => "ต้องรอให้ผ่านไปอีก 1 บล็อกก่อนเปิดผล",
  SameToken: () => "เลือกไอเทมชิ้นเดียวกันสองครั้งไม่ได้",
  NotYourItem: ([id]) => `ไอเทม token #${id} ไม่ใช่ของคุณ`,
  RarityMismatch: () => "ไอเทมทั้งสองชิ้นต้องมีระดับ (rarity) เท่ากัน",
  MaxRarity: () => "Legendary เป็นระดับสูงสุดแล้ว ผสมต่อไม่ได้",
  NotMinter: () => "สัญญายังไม่ได้ตั้งค่า minter — ต้องเรียก ItemNFT.setMinter(GachaGame) ก่อน",
  NotTokenOwner: () => "ไม่ใช่เจ้าของไอเทมนี้",
  ERC721NonexistentToken: () => "ไม่พบไอเทมนี้ (อาจถูกเผาไปแล้ว)",
  ERC721IncorrectOwner: () => "ไม่ใช่เจ้าของไอเทมนี้",
  ERC721InsufficientApproval: () => "ยังไม่ได้อนุญาตให้ร้านค้าย้ายไอเทม",
  ItemLocked: () => "ไอเทมนี้ถูกล็อกระหว่างรอเปิดผล — เปิดผลก่อน",
  CreatureNotCraftable: () => "สัตว์สวมอุปกรณ์ใช้ผสมปกติไม่ได้",
  NotACreature: () => "ช่องแรกต้องเป็นสัตว์เลี้ยงหรือสัตว์สวมอุปกรณ์",
  NotGear: () => "ช่องที่สองต้องเป็นดาบหรือเกราะ",
  NotAnUpgrade: ([current, offered]) =>
    `อุปกรณ์ต้องดีกว่าของเดิม (ตอนนี้ระดับ ${Number(current)}, ที่เลือกระดับ ${Number(offered)})`,
  NoRecipe: () => "ไม่มีสูตรลับสำหรับคู่นี้ — ดูสมุดสูตรด้านล่าง",
  PriceOutOfRange: () => "ราคาต้องมากกว่า 0",
  NotListed: () => "รายการนี้ไม่ได้วางขายแล้ว",
  NotSeller: () => "ยกเลิกได้เฉพาะผู้ขาย",
  CannotBuyOwn: () => "ซื้อของตัวเองไม่ได้",
};

// ethers ไม่ได้ถอด custom error ให้ทุกกรณี (เช่นตอน estimateGas) → ถอดเองจาก revert data
function decodeRevert(e, interfaces) {
  if (e?.revert?.name) return e.revert;
  const candidates = [e?.data, e?.info?.error?.data, e?.info?.error?.data?.data, e?.error?.data];
  const data = candidates.find((d) => typeof d === "string" && d.startsWith("0x") && d.length >= 10);
  if (!data) return null;
  for (const iface of interfaces) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return { name: parsed.name, args: parsed.args };
    } catch {
      // ลอง interface ถัดไป
    }
  }
  return null;
}

/**
 * @param e          error ที่ได้จาก ethers / MetaMask
 * @param interfaces contract.interface ที่ใช้ถอดชื่อ custom error
 */
export function explainError(e, interfaces = []) {
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) {
    return "คุณยกเลิกธุรกรรมใน MetaMask";
  }
  if (e?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(e?.message ?? "")) {
    return "ETH ไม่พอจ่ายค่า gas — ขอ Sepolia ETH ฟรีจาก faucet ก่อน";
  }
  if (e?.info?.error?.code === -32002) {
    return "มีหน้าต่าง MetaMask ค้างอยู่ — เปิด MetaMask แล้วกดยืนยันหรือยกเลิกก่อน";
  }
  const revert = decodeRevert(e, interfaces);
  if (revert && MESSAGES[revert.name]) return MESSAGES[revert.name](revert.args ?? []);
  if (revert) return `ธุรกรรมถูกปฏิเสธ: ${revert.name}`;
  return e?.shortMessage || e?.message || String(e);
}
