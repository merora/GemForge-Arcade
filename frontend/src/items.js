// ข้อมูลแสดงผล — บนเชนเก็บแค่ตัวเลข {itemType, rarity, serial, baseTier, armorTier, swordTier}
// ชื่อต้องตรงกับ ItemNFT.sol (_itemName / _creatureName)

export const NONE = 255;
export const TYPE = { SWORD: 0, ARMOR: 1, PET: 2, CREATURE: 3 };

export const RARITY = [
  { name: "Common", th: "ธรรมดา" },
  { name: "Rare", th: "หายาก" },
  { name: "Epic", th: "มหากาพย์" },
  { name: "Legendary", th: "ตำนาน" },
  { name: "Mythic", th: "เทพนิยาย" },
];

const NAMES = [
  ["ดาบไม้", "ดาบเหล็ก", "ดาบเพลิง", "ดาบสุริยัน"],
  ["เกราะหนัง", "เกราะโซ่", "เกราะมังกร", "เกราะนิรันดร์"],
  ["ลูกไก่", "หมาป่า", "กริฟฟิน", "ฟีนิกซ์"],
];

const PET_EMOJI = ["🐥", "🐺", "🦅", "🔥"];
const CREATURE_EMOJI = ["🐓", "🐺", "🦅", "🔥"];
const BASE_POWER = [10, 25, 60, 150];

export const itemName = (itemType, rarity) => NAMES[itemType][rarity];

export function creatureName(b, a, s) {
  if (b === 1 && a === NONE && s === 1) return "หมาป่าคาบดาบเหล็ก";
  if (b === 1 && a === NONE && s === 2) return "หมาป่าเขี้ยวอัคคี";
  if (b === 2 && a === 1 && s === NONE) return "กริฟฟินหุ้มเกราะโซ่";
  if (b === 2 && a === 2 && s === NONE) return "กริฟฟินเกราะเกล็ดมังกร";
  if (b === 3 && a === NONE && s === 3) return "ฟีนิกซ์สุริยันนิรันดร์";
  const emperor = b === 0 && a === 3;
  let n = b === 0 ? (emperor ? "พ่อไก่จักรพรรดิ" : "พ่อไก่") : itemName(TYPE.PET, b);
  if (a !== NONE) n += (emperor ? "" : "ใส่") + itemName(TYPE.ARMOR, a);
  if (s !== NONE) n += "ถือ" + itemName(TYPE.SWORD, s);
  return n;
}

export function displayName(it) {
  return it.itemType === TYPE.CREATURE ? creatureName(it.baseTier, it.armorTier, it.swordTier) : itemName(it.itemType, it.rarity);
}

export function emojiOf(it) {
  if (it.itemType === TYPE.SWORD) return "⚔️";
  if (it.itemType === TYPE.ARMOR) return "🛡️";
  if (it.itemType === TYPE.PET) return PET_EMOJI[it.rarity];
  return CREATURE_EMOJI[it.baseTier];
}

/** พลัง = สัตว์ตั้งต้น + 1.5×เกราะ + 1.5×ดาบ (ปัดลง) — ตรงกับทุกแถวพ่อไก่ใน CSV */
export function powerOf(it) {
  if (it.itemType !== TYPE.CREATURE) return BASE_POWER[it.rarity];
  const a = it.armorTier === NONE ? 0 : BASE_POWER[it.armorTier];
  const s = it.swordTier === NONE ? 0 : BASE_POWER[it.swordTier];
  return Math.floor((2 * BASE_POWER[it.baseTier] + 3 * a + 3 * s) / 2);
}

export const isCreatureLike = (it) => it.itemType === TYPE.PET || it.itemType === TYPE.CREATURE;
export const isGear = (it) => it.itemType === TYPE.SWORD || it.itemType === TYPE.ARMOR;

// อัตราตามสัญญา (ใช้แสดงผลเท่านั้น — ค่าจริงอยู่บนเชน)
export const DROP_RATES = [70, 25, 5, 0];
export const CRAFT_RATES = [80, 50, 20];

// สมุดสูตรลับ (แสดงผลเท่านั้น — สัญญาตรวจจากตาราง recipeRate บนเชน)
export const RECIPE_BOOK = [
  { from: "🐥 ลูกไก่ + 🛡️ เกราะ", to: "🐓 พ่อไก่ใส่เกราะ", rate: "หนัง 90 · โซ่ 70 · มังกร 45 · นิรันดร์ 25%" },
  { from: "🐓 พ่อไก่ใส่เกราะ + ⚔️ ดาบ", to: "🐓 พ่อไก่ถือดาบ", rate: "ไม้ 90 · เหล็ก 75 · เพลิง 50 · สุริยัน 25%" },
  { from: "🐓 พ่อไก่ + 🛡️ เกราะที่ดีกว่า", to: "อัปเกราะทับ (ดาบคงเดิม)", rate: "โซ่ 75 · มังกร 45 · นิรันดร์ 20%" },
  { from: "🐓 พ่อไก่ + ⚔️ ดาบที่ดีกว่า", to: "อัปดาบทับ (เกราะคงเดิม)", rate: "เหล็ก 75 · เพลิง 50 · สุริยัน 25%" },
  { from: "🐺 หมาป่า + ⚔️ ดาบเหล็ก / เพลิง", to: "🐺 หมาป่าคาบดาบเหล็ก / เขี้ยวอัคคี", rate: "75 / 45%" },
  { from: "🦅 กริฟฟิน + 🛡️ เกราะโซ่ / มังกร", to: "🦅 กริฟฟินหุ้มเกราะโซ่ / เกราะเกล็ดมังกร", rate: "60 / 35%" },
  { from: "🔥 ฟีนิกซ์ + ⚔️ ดาบสุริยัน", to: "🔥 ฟีนิกซ์สุริยันนิรันดร์ (Mythic)", rate: "20%" },
];
