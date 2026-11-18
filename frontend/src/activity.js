// แปลง Transaction Receipt จริง → ข้อความสั้นสำหรับ Blockchain Activity Log
// อ่านจาก event ใน receipt เท่านั้น (GEM Transfer, NFT Transfer, Revealed, Sold, Listed) — ไม่เดาตัวเลขเอง

import { ZeroAddress, formatEther } from "ethers";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// ทศนิยมสูงสุด 4 ตำแหน่ง: ให้ยอดผู้ขาย + ค่าธรรมเนียมบวกกันได้ราคาพอดี (เช่น 31.635 + 1.665 = 33.3)
const fmtGem = (v) => Number(formatEther(v)).toLocaleString("th-TH", { maximumFractionDigits: 4 });

/**
 * @param rc   Transaction Receipt จาก tx.wait()
 * @param me   address ของผู้เล่น
 * @param contracts { gem, item, game, market } (ethers Contract — ใช้ address + interface)
 * @param nameOf    แปลง address → ชื่อที่อ่านง่าย เช่น "1P" (ไม่รู้จัก = address แบบย่อ)
 * @returns { parts: [{text, tone}], revealed, parties }
 *          revealed = args ของ event Revealed (ถ้ามี) · parties = "2P → 1P" สำหรับการซื้อขาย
 */
export function summarizeReceipt(rc, me, contracts, nameOf = short) {
  const mine = me.toLowerCase();
  const byAddr = {};
  for (const [name, ct] of Object.entries(contracts)) if (ct) byAddr[String(ct.target).toLowerCase()] = name;
  const marketAddr = contracts.market ? String(contracts.market.target).toLowerCase() : null;

  let delta = 0n; // GEM ของผู้เล่นที่เปลี่ยนไป
  let burned = 0n; // GEM ที่ถูกเผา (โอนไป address 0)
  const nft = [];
  const gemMoves = []; // การโอน GEM ทุกรายการใน receipt
  let revealed = null;
  let sold = null;
  let listed = null;

  for (const log of rc.logs) {
    const name = byAddr[log.address.toLowerCase()];
    if (!name) continue;
    let ev = null;
    try {
      ev = contracts[name].interface.parseLog(log);
    } catch {
      ev = null;
    }
    if (!ev) continue;

    if (name === "gem" && ev.name === "Transfer") {
      gemMoves.push({ from: ev.args.from.toLowerCase(), to: ev.args.to.toLowerCase(), value: ev.args.value });
      if (ev.args.to.toLowerCase() === mine) delta += ev.args.value;
      if (ev.args.from.toLowerCase() === mine) delta -= ev.args.value;
      if (ev.args.to === ZeroAddress) burned += ev.args.value;
    } else if (name === "item" && ev.name === "Transfer") {
      const id = ev.args.tokenId.toString();
      const to = ev.args.to.toLowerCase();
      if (ev.args.from === ZeroAddress) nft.push(`MINT NFT #${id}`);
      else if (ev.args.to === ZeroAddress) nft.push(`BURN NFT #${id}`);
      else if (to === marketAddr) nft.push(`NFT #${id} → ร้านค้า`);
      else nft.push(`NFT #${id} → กระเป๋า ${nameOf(ev.args.to)}`);
    } else if (ev.name === "Revealed") revealed = ev.args;
    else if (ev.name === "Sold") sold = ev.args;
    else if (ev.name === "Listed") listed = ev.args;
  }

  // ---- ซื้อขายในร้านค้า: สรุปเงินทั้งฝั่งผู้ซื้อและผู้ขายในบรรทัดเดียว (จากการโอน GEM จริงใน receipt) ----
  if (sold) {
    const buyer = sold.buyer.toLowerCase();
    const seller = sold.seller.toLowerCase();
    const received = gemMoves.filter((m) => m.from === buyer && m.to === seller).reduce((s, m) => s + m.value, 0n);
    const pct = sold.price > 0n ? Number((burned * 10000n) / sold.price) / 100 : 0;
    const parts = [
      { text: `จ่าย ${fmtGem(sold.price)} GEM`, tone: "minus" },
      { text: `(${nameOf(sold.seller)} รับ +${fmtGem(received)} GEM`, tone: "plus" },
      { text: `| Burned ${pct}%: ${fmtGem(burned)} GEM)`, tone: "burn" },
      { text: "|", tone: "sep" },
      ...nft.map((n) => ({ text: n, tone: "" })),
    ];
    return { parts, revealed, parties: `${nameOf(sold.buyer)} → ${nameOf(sold.seller)}` };
  }

  const parts = [];
  if (delta > 0n) parts.push({ text: `+${fmtGem(delta)} GEM`, tone: "plus" });
  if (delta < 0n) {
    const allBurned = burned === -delta;
    parts.push({ text: `-${fmtGem(-delta)} GEM${allBurned ? " (เผาทิ้ง)" : ""}`, tone: "minus" });
    if (burned > 0n && !allBurned) parts.push({ text: `Burned ${sold ? "5% Fee " : ""}(${fmtGem(burned)} GEM)`, tone: "burn" });
  } else if (burned > 0n) {
    parts.push({ text: `Burned ${fmtGem(burned)} GEM`, tone: "burn" });
  }
  if (listed) parts.push({ text: `ราคา ${fmtGem(listed.price)} GEM`, tone: "" });
  for (const n of nft) parts.push({ text: n, tone: n.startsWith("BURN") ? "burn" : "" });

  return { parts, revealed, parties: null };
}
