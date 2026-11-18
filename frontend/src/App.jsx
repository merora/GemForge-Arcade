import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, MaxUint256, formatEther, parseEther } from "ethers";
import deployments from "./deployments.json";
import { GAME_ABI, GEM_ABI, ITEM_ABI, MARKET_ABI } from "./abi.js";
import {
  CRAFT_RATES,
  DROP_RATES,
  NONE,
  RARITY,
  RECIPE_BOOK,
  TYPE,
  displayName,
  emojiOf,
  isCreatureLike,
  isGear,
  itemName,
  powerOf,
} from "./items.js";
import { explainError } from "./errors.js";
import { summarizeReceipt } from "./activity.js";

// เครือข่ายที่รองรับ
//  - local   : เชนจำลอง Hardhat ในเครื่อง โหนดเซ็นธุรกรรมให้ (ไม่ต้องใช้ MetaMask) — ใช้สาธิตสด
//  - sepolia : testnet จริง เซ็นธุรกรรมด้วย MetaMask ตรวจสอบได้บน Etherscan
const NETWORKS = {
  local: {
    label: "LOCAL",
    chainId: 31337,
    rpc: "http://127.0.0.1:8545",
    blockSec: 3,
    explorer: null,
  },
  sepolia: {
    label: "SEPOLIA",
    chainId: 11155111,
    blockSec: 12,
    explorer: "https://sepolia.etherscan.io",
    addParams: {
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    },
  },
};
const PLAYERS = [1, 2, 3]; // (local) บัญชีทดสอบลำดับ 1–3 (ลำดับ 0 = ผู้ deploy)

function loadNetKey() {
  try {
    const v = localStorage.getItem("gemforge.net");
    return NETWORKS[v] ? v : "local";
  } catch {
    return "local";
  }
}

const PULL_COST = parseEther("100");
const CRAFT_COST = parseEther("20");
const FEE_PCT = 5;

const TABS = [
  { id: "gacha", label: "GACHA", th: "ตู้กาชา", color: "red" },
  { id: "forge", label: "FORGE", th: "ผสม", color: "blue" },
  { id: "evolve", label: "EVOLVE", th: "สวมใส่", color: "green" },
  { id: "shop", label: "SHOP", th: "ร้านค้า", color: "yellow" },
];

const KIND_LABEL = { 1: "กาชา", 2: "การผสม", 3: "การสวมใส่" };
const KIND_ACTION = { 1: "OPEN · GACHA", 2: "OPEN · FORGE", 3: "OPEN · EVOLVE" };
const LOG_SIZE = 5;

// สีของแต่ละประเภทธุรกรรมใน Activity Log
const ACTION_COLOR = {
  "INSERT COIN": "yellow",
  "GACHA PULL": "red",
  FORGE: "blue",
  EVOLVE: "green",
  "SHOP LIST": "yellow",
  "SHOP CANCEL": "yellow",
  "SHOP BUY": "yellow",
};

// แคปซูลในตู้กาชา (ตำแหน่ง % และสีตามระดับ)
const CAPSULES = [
  [18, 58, 0], [34, 64, 1], [52, 60, 0], [68, 66, 2], [82, 55, 0], [26, 42, 0],
  [44, 46, 3], [62, 44, 1], [76, 38, 0], [36, 28, 2], [56, 26, 0], [70, 22, 1],
];

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtGem = (v) => Number(formatEther(v)).toLocaleString("th-TH", { maximumFractionDigits: 2 });

function toItem(id, it, locked = false) {
  return {
    id,
    itemType: Number(it.itemType),
    rarity: Number(it.rarity),
    serial: Number(it.serial),
    baseTier: Number(it.baseTier),
    armorTier: Number(it.armorTier),
    swordTier: Number(it.swordTier),
    locked,
  };
}

export default function App() {
  const [netKey, setNetKey] = useState(loadNetKey);
  const NET = NETWORKS[netKey];
  const isWallet = netKey !== "local";
  const [playerIndex, setPlayerIndex] = useState(PLAYERS[0]);
  const [chainError, setChainError] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [gemBal, setGemBal] = useState(0n);
  const [status, setStatus] = useState(0); // 0 ไม่มีคำขอ · 1 รอบล็อก · 2 เปิดได้ · 3 หมดเวลา
  const [pendingKind, setPendingKind] = useState(0);
  const [items, setItems] = useState([]);
  const [listings, setListings] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [tab, setTab] = useState("gacha");
  const [craftSel, setCraftSel] = useState([]);
  const [equipSel, setEquipSel] = useState({ creature: null, gear: null });
  const [equipPlan, setEquipPlan] = useState(null); // { plan } | { error }
  const [sellSel, setSellSel] = useState(null);
  const [sellPrice, setSellPrice] = useState("150");
  const [busy, setBusy] = useState(null); // { label, kind }
  const [notice, setNotice] = useState(null);
  const [result, setResult] = useState(null);
  const [activity, setActivity] = useState([]); // Blockchain Activity Log (ใหม่สุดอยู่บน)
  const [playerNames, setPlayerNames] = useState({}); // address (ตัวเล็ก) → "1P" / "2P" / "3P"
  const [copied, setCopied] = useState(null);

  const dep = deployments[String(NET.chainId)];
  const txUrl = (h) => (NET.explorer ? `${NET.explorer}/tx/${h}` : null);
  const addrUrl = (a) => (NET.explorer ? `${NET.explorer}/address/${a}` : null);

  function changeNet(key) {
    try {
      localStorage.setItem("gemforge.net", key);
    } catch {
      // เบราว์เซอร์ไม่ให้ใช้ storage — ไม่เป็นไร
    }
    setActivity([]);
    setNetKey(key);
  }

  const c = useMemo(() => {
    if (!wallet || !dep) return null;
    return {
      gem: new Contract(dep.gem, GEM_ABI, wallet.signer),
      item: new Contract(dep.item, ITEM_ABI, wallet.signer),
      game: new Contract(dep.game, GAME_ABI, wallet.signer),
      market: dep.market ? new Contract(dep.market, MARKET_ABI, wallet.signer) : null,
    };
  }, [wallet, dep]);

  const why = useCallback(
    (e) =>
      explainError(
        e,
        c ? [c.game.interface, c.gem.interface, c.item.interface, ...(c.market ? [c.market.interface] : [])] : []
      ),
    [c]
  );

  // ---------------------------------------------------------------
  // เชื่อมเชนจำลอง + เลือกผู้เล่น
  // ---------------------------------------------------------------
  // interactive = true เมื่อผู้ใช้กดปุ่ม CONNECT เอง (จึงเปิดหน้าต่าง MetaMask ได้)
  const connect = useCallback(async (interactive = false) => {
    setWallet(null);
    setItems([]);
    setListings([]);
    setGemBal(0n);
    setCraftSel([]);
    setEquipSel({ creature: null, gear: null });
    setSellSel(null);
    setResult(null);
    setNotice(null);

    if (isWallet) {
      // ---------- โหมด testnet: เซ็นด้วย MetaMask ----------
      const eth = window.ethereum;
      if (!eth) {
        setChainError({ kind: "nowallet" });
        return;
      }
      try {
        const method = interactive ? "eth_requestAccounts" : "eth_accounts";
        const accounts = await eth.request({ method });
        if (!accounts.length) {
          setChainError({ kind: "needconnect" });
          return;
        }
        const current = await eth.request({ method: "eth_chainId" });
        if (parseInt(current, 16) !== NET.chainId) {
          if (!interactive) {
            setChainError({ kind: "wrongchain" });
            return;
          }
          try {
            await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NET.addParams.chainId }] });
          } catch (err) {
            if (err?.code !== 4902) throw err;
            await eth.request({ method: "wallet_addEthereumChain", params: [NET.addParams] });
          }
        }
        const provider = new BrowserProvider(eth);
        const signer = await provider.getSigner();
        const account = await signer.getAddress();
        setPlayerNames({ [account.toLowerCase()]: "YOU" });
        setWallet({ provider, signer, account });
        setChainError(null);
      } catch (e) {
        setChainError({ kind: "wallet", text: explainError(e) });
      }
      return;
    }

    // ---------- โหมด local: โหนด Hardhat เซ็นให้ ----------
    try {
      const provider = new JsonRpcProvider(NET.rpc, NET.chainId, { staticNetwork: true });
      await provider.getBlockNumber();
      // ตาราง address → ชื่อผู้เล่น ใช้แปลงผู้ซื้อ/ผู้ขายใน Activity Log
      const names = {};
      for (const [i, p] of PLAYERS.entries()) {
        names[(await (await provider.getSigner(p)).getAddress()).toLowerCase()] = `${i + 1}P`;
      }
      setPlayerNames(names);
      const signer = await provider.getSigner(playerIndex);
      setWallet({ provider, signer, account: await signer.getAddress() });
      setChainError(null);
    } catch {
      setChainError({ kind: "local" });
    }
  }, [playerIndex, isWallet, NET]);

  useEffect(() => {
    connect();
  }, [connect]);

  // MetaMask: เปลี่ยนบัญชีหรือเปลี่ยนเครือข่าย → เชื่อมใหม่
  useEffect(() => {
    const eth = window.ethereum;
    if (!isWallet || !eth?.on) return;
    const again = () => connect();
    eth.on("accountsChanged", again);
    eth.on("chainChanged", again);
    return () => {
      eth.removeListener?.("accountsChanged", again);
      eth.removeListener?.("chainChanged", again);
    };
  }, [isWallet, connect]);

  // ---------------------------------------------------------------
  // อ่านข้อมูลจากเชน (view = ฟรี)
  // ---------------------------------------------------------------
  const refreshLight = useCallback(async () => {
    if (!c) return;
    const me = wallet.account;
    try {
      const [bal, st, p] = await Promise.all([c.gem.balanceOf(me), c.game.revealStatus(me), c.game.pending(me)]);
      setGemBal(bal);
      setStatus(Number(st));
      setPendingKind(Number(p.kind));
    } catch (e) {
      setNotice({
        type: "error",
        text: isWallet
          ? `อ่านข้อมูลจากสัญญาไม่ได้ (${why(e)})`
          : `อ่านข้อมูลจากสัญญาไม่ได้ — ลองรัน npm run demo ใหม่ (${why(e)})`,
      });
    }
  }, [c, wallet, why, isWallet]);

  // ERC-721 ไม่มีฟังก์ชัน "รายการของฉัน" → อ่าน event Transfer ที่ส่งมาหาเรา แล้วเช็กว่ายังเป็นเจ้าของอยู่ไหม
  const loadInventory = useCallback(async () => {
    if (!c) return;
    const me = wallet.account.toLowerCase();
    setLoadingInv(true);
    try {
      const logs = await c.item.queryFilter(c.item.filters.Transfer(null, wallet.account), dep.deployBlock ?? 0);
      const ids = [...new Set(logs.map((l) => l.args.tokenId))];
      const owned = await Promise.all(
        ids.map(async (id) => {
          try {
            if ((await c.item.ownerOf(id)).toLowerCase() !== me) return null;
            const [it, locked] = await Promise.all([c.item.getItem(id), c.item.locked(id)]);
            return toItem(id, it, locked);
          } catch {
            return null;
          }
        })
      );
      const list = owned
        .filter(Boolean)
        .sort((a, b) => b.rarity - a.rarity || a.itemType - b.itemType || (a.id < b.id ? -1 : 1));
      setItems(list);
      const has = (id) => id !== null && list.some((i) => i.id === id);
      setCraftSel((sel) => sel.filter(has));
      setEquipSel((s) => ({ creature: has(s.creature) ? s.creature : null, gear: has(s.gear) ? s.gear : null }));
      setSellSel((s) => (has(s) ? s : null));
    } catch (e) {
      setNotice({ type: "error", text: `โหลดกระเป๋าไม่ได้: ${why(e)}` });
    } finally {
      setLoadingInv(false);
    }
  }, [c, wallet, dep, why]);

  const loadListings = useCallback(async () => {
    if (!c?.market) return;
    try {
      const [ids, sellers, prices] = await c.market.getListings();
      const rows = await Promise.all(
        ids.map(async (id, i) => ({
          item: toItem(id, await c.item.getItem(id)),
          seller: sellers[i],
          price: prices[i],
        }))
      );
      setListings(rows.sort((a, b) => b.item.rarity - a.item.rarity || (a.price < b.price ? -1 : 1)));
    } catch (e) {
      setNotice({ type: "error", text: `โหลดร้านค้าไม่ได้: ${why(e)}` });
    }
  }, [c, why]);

  const refreshAll = useCallback(
    () => Promise.all([refreshLight(), loadInventory(), loadListings()]),
    [refreshLight, loadInventory, loadListings]
  );

  useEffect(() => {
    if (!c) return;
    refreshAll();
    const t = setInterval(refreshLight, isWallet ? 6000 : 3000);
    return () => clearInterval(t);
  }, [c, refreshAll, refreshLight, isWallet]);

  // ดูผลล่วงหน้าของการสวมใส่ (เรียก previewEquip บนเชน — ฟรี)
  useEffect(() => {
    setEquipPlan(null);
    if (!c || equipSel.creature === null || equipSel.gear === null) return;
    let cancelled = false;
    c.game
      .previewEquip(wallet.account, equipSel.creature, equipSel.gear)
      .then((p) => !cancelled && setEquipPlan({ plan: p }))
      .catch((e) => !cancelled && setEquipPlan({ error: why(e) }));
    return () => {
      cancelled = true;
    };
  }, [c, wallet, equipSel, why]);

  // ---------------------------------------------------------------
  // ส่งธุรกรรม
  // ---------------------------------------------------------------
  async function run(label, sendTx, kind = null, action = null) {
    setBusy({ label: `${label} — ${isWallet ? "ยืนยันใน MetaMask…" : "กำลังส่งธุรกรรม"}`, kind });
    setNotice(null);
    try {
      const tx = await sendTx();
      setBusy({ label: `${label} — รอบันทึกลงบล็อก…`, kind });
      const rc = await tx.wait();
      if (action) logReceipt(action, rc).catch(() => {});
      return rc;
    } catch (e) {
      setNotice({ type: "error", text: why(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------------------
  // Blockchain Activity Log — สรุปจาก event ใน Transaction Receipt จริง (ไม่ได้เดาตัวเลขเอง)
  // ---------------------------------------------------------------
  async function logReceipt(action, rc) {
    const nameOf = (a) => {
      const k = a.toLowerCase();
      if (playerNames[k]) return playerNames[k];
      if (dep.market && k === dep.market.toLowerCase()) return "ร้านค้า";
      return short(a);
    };
    const { parts, revealed, parties } = summarizeReceipt(rc, wallet.account, c, nameOf);
    if (action === "APPROVE GEM") parts.push({ text: "อนุญาตให้สัญญาหัก GEM ได้ (allowance)", tone: "" });
    if (action === "APPROVE NFT") parts.push({ text: "อนุญาตให้ร้านค้าย้าย NFT ได้ (setApprovalForAll)", tone: "" });

    if (revealed) {
      const it = toItem(revealed.tokenId, await c.item.getItem(revealed.tokenId));
      const kind = Number(revealed.kind);
      const what = `${displayName(it)} #${it.serial} (${RARITY[it.rarity].name})`;
      if (kind === 1) parts.push({ text: `ได้ ${what}`, tone: "plus" });
      else if (revealed.craftSuccess) parts.push({ text: `สำเร็จ → ${what}`, tone: "plus" });
      else parts.push({ text: kind === 3 ? "ล้มเหลว — อุปกรณ์แตก" : `ล้มเหลว → ${what}`, tone: "burn" });
    }

    const entry = {
      key: `${rc.hash}-${action}`,
      action,
      player: isWallet ? "YOU" : `${PLAYERS.indexOf(playerIndex) + 1}P`,
      block: rc.blockNumber,
      hash: rc.hash,
      gas: rc.gasUsed,
      parties,
      parts,
    };
    setActivity((prev) => [entry, ...prev].slice(0, LOG_SIZE));
  }

  async function copyHash(hash) {
    try {
      await navigator.clipboard.writeText(hash);
    } catch {
      // สำรอง: เบราว์เซอร์ที่ไม่อนุญาต clipboard API
      const ta = document.createElement("textarea");
      ta.value = hash;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(hash);
    setTimeout(() => setCopied((h) => (h === hash ? null : h)), 1500);
  }

  async function ensureGemAllowance(spender, amount) {
    const current = await c.gem.allowance(wallet.account, spender);
    if (current >= amount) return true;
    return !!(await run("อนุญาตให้ใช้ GEM (approve ครั้งเดียว)", () => c.gem.approve(spender, MaxUint256), null, "APPROVE GEM"));
  }

  async function doFaucet() {
    const rc = await run("หยอดเหรียญ +500 GEM", () => c.gem.faucet(), null, "INSERT COIN");
    if (rc) setNotice({ type: "ok", text: "ได้รับ 500 GEM แล้ว", tx: rc.hash });
    await refreshLight();
  }

  async function doPull() {
    if (gemBal < PULL_COST) return setNotice({ type: "error", text: "GEM ไม่พอ — กด INSERT COIN ก่อน" });
    if (!(await ensureGemAllowance(dep.game, PULL_COST))) return;
    const rc = await run("หมุนตู้กาชา (100 GEM)", () => c.game.pull(), "pull", "GACHA PULL");
    if (rc) setNotice({ type: "ok", text: "แคปซูลกำลังตก… รอ 1 บล็อกแล้วกด OPEN!", tx: rc.hash });
    await refreshLight();
  }

  async function doCraft() {
    const [a, b] = craftSel;
    if (gemBal < CRAFT_COST) return setNotice({ type: "error", text: "GEM ไม่พอสำหรับค่าผสม 20 GEM" });
    if (!(await ensureGemAllowance(dep.game, CRAFT_COST))) return;
    const rc = await run("หลอมไอเทม (เผา 2 ชิ้น + 20 GEM)", () => c.game.craft(a, b), "craft", "FORGE");
    if (rc) {
      setCraftSel([]);
      setNotice({ type: "ok", text: "วัตถุดิบถูกเผาแล้ว — รอ 1 บล็อกแล้วกด OPEN!", tx: rc.hash });
    }
    await refreshAll();
  }

  async function doEquip() {
    if (gemBal < CRAFT_COST) return setNotice({ type: "error", text: "GEM ไม่พอสำหรับค่าสวมใส่ 20 GEM" });
    if (!(await ensureGemAllowance(dep.game, CRAFT_COST))) return;
    const { creature, gear } = equipSel;
    const rc = await run("สวมอุปกรณ์ (เผาอุปกรณ์ + 20 GEM)", () => c.game.equip(creature, gear), "equip", "EVOLVE");
    if (rc) {
      setEquipSel({ creature, gear: null });
      setNotice({ type: "ok", text: "อุปกรณ์ถูกใช้แล้ว สัตว์ถูกล็อกไว้ — รอ 1 บล็อกแล้วกด OPEN!", tx: rc.hash });
    }
    await refreshAll();
  }

  async function doReveal() {
    const kind = pendingKind;
    const rc = await run("เปิดผล", () => c.game.reveal(), "reveal", KIND_ACTION[kind] ?? "OPEN");
    if (rc) {
      const ev = rc.logs
        .map((l) => {
          try {
            return c.game.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((x) => x?.name === "Revealed");
      if (ev) {
        const id = ev.args.tokenId;
        setResult({
          kind,
          success: ev.args.craftSuccess,
          expired: ev.args.expired,
          tx: rc.hash,
          item: toItem(id, await c.item.getItem(id)),
        });
      }
    }
    await refreshAll();
  }

  async function doList() {
    let price;
    try {
      price = parseEther(sellPrice || "0");
    } catch {
      return setNotice({ type: "error", text: "ราคาไม่ถูกต้อง" });
    }
    if (price <= 0n) return setNotice({ type: "error", text: "ราคาต้องมากกว่า 0" });
    if (!(await c.item.isApprovedForAll(wallet.account, dep.market))) {
      const ok = await run("อนุญาตให้ร้านค้าย้ายไอเทม (ครั้งเดียว)", () => c.item.setApprovalForAll(dep.market, true), null, "APPROVE NFT");
      if (!ok) return;
    }
    const rc = await run("วางขาย", () => c.market.list(sellSel, price), "shop", "SHOP LIST");
    if (rc) {
      setSellSel(null);
      setNotice({ type: "ok", text: "วางขายแล้ว — ไอเทมถูกฝากไว้ที่ร้านค้า", tx: rc.hash });
    }
    await refreshAll();
  }

  async function doCancel(id) {
    const rc = await run("ยกเลิกการขาย", () => c.market.cancel(id), "shop", "SHOP CANCEL");
    if (rc) setNotice({ type: "ok", text: "ยกเลิกแล้ว — ไอเทมกลับเข้ากระเป๋า", tx: rc.hash });
    await refreshAll();
  }

  async function doBuy(row) {
    if (gemBal < row.price) return setNotice({ type: "error", text: "GEM ไม่พอซื้อชิ้นนี้" });
    if (!(await ensureGemAllowance(dep.market, row.price))) return;
    const rc = await run(`ซื้อ ${displayName(row.item)}`, () => c.market.buy(row.item.id), "shop", "SHOP BUY");
    if (rc) {
      setResult({ kind: "buy", success: true, tx: rc.hash, item: row.item });
    }
    await refreshAll();
  }

  // ---------------------------------------------------------------
  // การเลือกของในกระเป๋า (ขึ้นกับโหมดที่เปิดอยู่)
  // ---------------------------------------------------------------
  const hasPending = status !== 0;
  const disabled = !!busy;

  function pickRule(it) {
    if (it.locked) return { ok: false, why: "ล็อกอยู่" };
    if (tab === "forge") return it.itemType === TYPE.CREATURE ? { ok: false, why: "ผสมไม่ได้" } : { ok: true };
    if (tab === "evolve" || tab === "shop") return { ok: true };
    return { ok: false };
  }

  function onPick(it) {
    if (!pickRule(it).ok || disabled) return;
    if (tab === "forge") {
      setCraftSel((sel) => (sel.includes(it.id) ? sel.filter((x) => x !== it.id) : sel.length < 2 ? [...sel, it.id] : [sel[1], it.id]));
    } else if (tab === "evolve") {
      const key = isCreatureLike(it) ? "creature" : "gear";
      setEquipSel((s) => ({ ...s, [key]: s[key] === it.id ? null : it.id }));
    } else if (tab === "shop") {
      setSellSel((s) => (s === it.id ? null : it.id));
    }
  }

  const isSelected = (id) =>
    (tab === "forge" && craftSel.includes(id)) ||
    (tab === "evolve" && (equipSel.creature === id || equipSel.gear === id)) ||
    (tab === "shop" && sellSel === id);

  const byId = (id) => items.find((i) => i.id === id);

  // ผสม: ตรวจเงื่อนไขฝั่งหน้าเว็บ (สัญญาตรวจซ้ำอีกชั้นเสมอ)
  const craftItems = craftSel.map(byId).filter(Boolean);
  let craftHint = "เลือกไอเทม 2 ชิ้นระดับเดียวกันจากกระเป๋า";
  let canCraft = false;
  if (craftItems.length === 2) {
    const [x, y] = craftItems;
    if (x.rarity !== y.rarity) craftHint = "ต้องเป็นระดับเดียวกัน";
    else if (x.rarity >= 3) craftHint = "Legendary ผสมต่อไม่ได้แล้ว — ลองโหมด EVOLVE";
    else {
      canCraft = true;
      craftHint = `โอกาสสำเร็จ ${CRAFT_RATES[x.rarity]}% → ${RARITY[x.rarity + 1].name}`;
    }
  } else if (craftItems.length === 1) craftHint = "เลือกอีก 1 ชิ้น";

  const creatureItem = equipSel.creature !== null ? byId(equipSel.creature) : null;
  const gearItem = equipSel.gear !== null ? byId(equipSel.gear) : null;
  let evolvePreview = null;
  if (creatureItem && equipPlan?.plan) {
    const p = equipPlan.plan;
    evolvePreview = {
      ...creatureItem,
      itemType: TYPE.CREATURE,
      baseTier: Number(p.baseTier),
      armorTier: Number(p.newArmor),
      swordTier: Number(p.newSword),
      rarity: Number(p.newRarity),
      serial: creatureItem.itemType === TYPE.CREATURE ? creatureItem.serial : "?",
    };
  }

  const sellItem = sellSel !== null ? byId(sellSel) : null;
  const counts = [0, 1, 2, 3, 4].map((r) => items.filter((i) => i.rarity === r).length);
  const me = wallet?.account?.toLowerCase();

  // ---------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------
  return (
    <div className="arcade">
      <div className="cabinet">
        {/* ---------- ป้ายไฟหัวตู้ ---------- */}
        <header className="marquee">
          <div className="marquee-title">
            <span className="pixel neon-title">GEMFORGE</span>
            <span className="pixel neon-sub">★ ARCADE ★</span>
          </div>
          <div className="hud">
            <label className="hud-box">
              <span className="pixel hud-label">NETWORK</span>
              <select value={netKey} onChange={(e) => changeNet(e.target.value)} disabled={disabled}>
                {Object.entries(NETWORKS).map(([k, n]) => (
                  <option key={k} value={k}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            {isWallet ? (
              <div className="hud-box">
                <span className="pixel hud-label">WALLET</span>
                {wallet ? (
                  <a className="pixel hud-addr" href={addrUrl(wallet.account)} target="_blank" rel="noreferrer">
                    {short(wallet.account)}
                  </a>
                ) : (
                  <button className="pixel hud-connect" onClick={() => connect(true)} disabled={disabled}>
                    CONNECT
                  </button>
                )}
              </div>
            ) : (
              <label className="hud-box">
                <span className="pixel hud-label">PLAYER</span>
                <select value={playerIndex} onChange={(e) => setPlayerIndex(Number(e.target.value))} disabled={disabled}>
                  {PLAYERS.map((p, i) => (
                    <option key={p} value={p}>
                      {i + 1}P
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="hud-box credit">
              <span className="pixel hud-label">CREDIT</span>
              <span className="pixel hud-value">{fmtGem(gemBal)}</span>
              <span className="hud-unit">GEM</span>
            </div>
          </div>
        </header>

        <div className="bezel">
          {/* ---------- จอหลัก ---------- */}
          <main className="screen crt">
            {notice && (
              <div className={`notice ${notice.type}`}>
                <span>{notice.text}</span>
                {notice.tx &&
                  (txUrl(notice.tx) ? (
                    <a className="tx" href={txUrl(notice.tx)} target="_blank" rel="noreferrer">
                      tx {short(notice.tx)} ↗
                    </a>
                  ) : (
                    <code className="tx">tx {short(notice.tx)}</code>
                  ))}
                <button className="x" onClick={() => setNotice(null)} aria-label="ปิด">
                  ×
                </button>
              </div>
            )}

            {!wallet && !chainError && <p className="pixel boot blink">LOADING…</p>}

            {chainError?.kind === "local" && (
              <section className="panel warn">
                <h2 className="pixel">NO SIGNAL</h2>
                <p>
                  เชื่อมต่อเชนจำลองไม่ได้ — เปิด terminal ที่โฟลเดอร์ <code>GemForge</code> แล้วรัน{" "}
                  <code>npm run demo</code> (หรือเปลี่ยน NETWORK เป็น SEPOLIA)
                </p>
                <button className="abtn small blue" onClick={() => connect()}>
                  ลองใหม่
                </button>
              </section>
            )}

            {chainError?.kind === "nowallet" && (
              <section className="panel warn">
                <h2 className="pixel">NO WALLET</h2>
                <p>
                  ไม่พบ MetaMask ในเบราว์เซอร์นี้ — ติดตั้ง MetaMask แล้วรีเฟรช หรือเปลี่ยน NETWORK เป็น LOCAL
                </p>
              </section>
            )}

            {chainError && ["needconnect", "wrongchain", "wallet"].includes(chainError.kind) && (
              <section className="panel warn">
                <h2 className="pixel">PRESS START</h2>
                <p>
                  {chainError.kind === "needconnect" && "เชื่อมกระเป๋า MetaMask เพื่อเล่นบน Sepolia testnet"}
                  {chainError.kind === "wrongchain" && "MetaMask อยู่คนละเครือข่าย — กดปุ่มด้านล่างเพื่อสลับไป Sepolia"}
                  {chainError.kind === "wallet" && `เชื่อมกระเป๋าไม่สำเร็จ: ${chainError.text}`}
                </p>
                <button className="abtn small blue" onClick={() => connect(true)}>
                  CONNECT WALLET
                </button>
              </section>
            )}

            {wallet && !dep && (
              <section className="panel warn">
                <h2 className="pixel">NO CARTRIDGE</h2>
                <p>
                  {isWallet ? (
                    <>
                      ยังไม่ได้ deploy สัญญาบน {NET.label} — รัน <code>npm run deploy:sepolia</code> แล้วรีเฟรช
                    </>
                  ) : (
                    <>
                      ยังไม่ได้ deploy สัญญา — รัน <code>npm run demo</code> แล้วรีเฟรชหน้านี้
                    </>
                  )}
                </p>
              </section>
            )}

            {c && (
              <>
                <nav className="modes">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      className={`mode ${t.color} ${tab === t.id ? "on" : ""}`}
                      onClick={() => setTab(t.id)}
                    >
                      <span className="pixel">{t.label}</span>
                      <small>{t.th}</small>
                    </button>
                  ))}
                </nav>

                {/* ---------- แถบรอเปิดผล ---------- */}
                {hasPending && (
                  <section className={`pending s${status}`}>
                    <div>
                      <span className="pixel">{status === 1 ? "PLEASE WAIT" : status === 2 ? "READY!" : "TIME OVER"}</span>
                      <p>
                        {KIND_LABEL[pendingKind]}รอเปิดผล ·{" "}
                        {status === 1 && "รอบล็อกถัดไป (commit–reveal กันการรู้ผลล่วงหน้า)"}
                        {status === 2 && "ค่าสุ่มมาจาก blockhash ของบล็อกที่ส่งคำขอ"}
                        {status === 3 && "เกิน 256 บล็อก — เปิดได้แต่ได้ผลขั้นต่ำ"}
                      </p>
                    </div>
                    <button className="abtn red big" onClick={doReveal} disabled={disabled || status === 1}>
                      OPEN!
                    </button>
                  </section>
                )}

                {/* ---------- GACHA ---------- */}
                {tab === "gacha" && (
                  <section className="stage gacha">
                    <div
                      className={`machine ${busy?.kind === "pull" ? "cranking" : ""} ${
                        hasPending && pendingKind === 1 ? "has-capsule" : ""
                      } ${status === 2 && pendingKind === 1 ? "ready" : ""}`}
                    >
                      <div className="globe">
                        {CAPSULES.map(([x, y, r], i) => (
                          <span key={i} className={`cap r${r}`} style={{ left: `${x}%`, top: `${y}%` }} />
                        ))}
                        <span className="shine" />
                      </div>
                      <div className="machine-body">
                        <span className="pixel plate">100 GEM</span>
                        <div className="crank">
                          <span />
                        </div>
                        <div className="chute">
                          <span className="capsule-out" />
                        </div>
                      </div>
                    </div>
                    <div className="stage-side">
                      <h2 className="pixel">DROP RATE</h2>
                      <div className="rates">
                        {RARITY.slice(0, 4).map((r, i) => (
                          <div key={r.name} className={`rate r${i}`}>
                            <b>{DROP_RATES[i]}%</b>
                            <span>{r.name}</span>
                          </div>
                        ))}
                      </div>
                      <p className="hint">Legendary และ Mythic ไม่ออกจากตู้ — ต้องผสมหรือสวมใส่เท่านั้น</p>
                      <button className="abtn red big" onClick={doPull} disabled={disabled || hasPending}>
                        PULL ✦ 100 GEM
                      </button>
                      {gemBal < PULL_COST && <p className="hint blink">GEM หมด — กด INSERT COIN ด้านล่าง</p>}
                    </div>
                  </section>
                )}

                {/* ---------- FORGE ---------- */}
                {tab === "forge" && (
                  <section className="stage">
                    <h2 className="pixel">FORGE · ผสมระดับเดียวกัน</h2>
                    <div className={`forge ${busy?.kind === "craft" ? "burning" : ""}`}>
                      {[0, 1].map((slot) => (
                        <div key={slot} className="slot">
                          {craftItems[slot] ? (
                            <ItemCard it={craftItems[slot]} small onClick={() => onPick(craftItems[slot])} />
                          ) : (
                            <span className="empty pixel">SLOT {slot + 1}</span>
                          )}
                        </div>
                      ))}
                      <span className="arrow pixel">▶</span>
                      <div className="slot result-slot pixel">?</div>
                    </div>
                    <p className={`hint ${canCraft ? "good" : ""}`}>{craftHint}</p>
                    <button className="abtn blue" onClick={doCraft} disabled={disabled || hasPending || !canCraft}>
                      FORGE · เผา 2 ชิ้น + 20 GEM
                    </button>
                    <div className="table">
                      <div>Common + Common → Rare <b>80%</b></div>
                      <div>Rare + Rare → Epic <b>50%</b></div>
                      <div>Epic + Epic → Legendary <b>20%</b></div>
                      <div className="muted">ล้มเหลว = ได้ระดับเดิมคืน 1 ชิ้น</div>
                    </div>
                  </section>
                )}

                {/* ---------- EVOLVE ---------- */}
                {tab === "evolve" && (
                  <section className="stage">
                    <h2 className="pixel">EVOLVE · สัตว์ + อุปกรณ์</h2>
                    <div className={`forge ${busy?.kind === "equip" ? "burning" : ""}`}>
                      <div className="slot">
                        {creatureItem ? (
                          <ItemCard it={creatureItem} small onClick={() => onPick(creatureItem)} />
                        ) : (
                          <span className="empty">🐾 สัตว์</span>
                        )}
                      </div>
                      <span className="arrow pixel">+</span>
                      <div className="slot">
                        {gearItem ? (
                          <ItemCard it={gearItem} small onClick={() => onPick(gearItem)} />
                        ) : (
                          <span className="empty">⚔️🛡️ อุปกรณ์</span>
                        )}
                      </div>
                      <span className="arrow pixel">▶</span>
                      <div className="slot result-slot">
                        {evolvePreview ? <ItemCard it={evolvePreview} small ghost /> : <span className="pixel">?</span>}
                      </div>
                    </div>
                    {equipPlan?.plan && (
                      <p className="hint good">
                        โอกาสสำเร็จ {Number(equipPlan.plan.rate) / 100}% → {RARITY[Number(equipPlan.plan.newRarity)].name} ·
                        tokenId เดิม (อัปเกรดในตัว ไม่ mint ใหม่)
                      </p>
                    )}
                    {equipPlan?.error && <p className="hint bad">{equipPlan.error}</p>}
                    {!equipPlan && <p className="hint">เลือกสัตว์ 1 ตัว และดาบหรือเกราะ 1 ชิ้นจากกระเป๋า</p>}
                    <button className="abtn green" onClick={doEquip} disabled={disabled || hasPending || !equipPlan?.plan}>
                      EVOLVE · เผาอุปกรณ์ + 20 GEM
                    </button>
                    <p className="hint">ล้มเหลว = เสียอุปกรณ์ แต่สัตว์ยังอยู่ · อัปเกรดทับได้ถ้าของใหม่ดีกว่า (ช่องอื่นคงเดิม)</p>
                    <div className="recipes">
                      <h3 className="pixel">RECIPE BOOK</h3>
                      {RECIPE_BOOK.map((r) => (
                        <div key={r.from} className="recipe">
                          <span>{r.from}</span>
                          <span className="to">→ {r.to}</span>
                          <b>{r.rate}</b>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ---------- SHOP ---------- */}
                {tab === "shop" && (
                  <section className="stage">
                    <h2 className="pixel">ITEM SHOP · ซื้อขายด้วย GEM</h2>
                    {!c.market && <p className="hint bad">ยังไม่มีสัญญาร้านค้า — deploy ใหม่</p>}
                    <div className="shop">
                      <div className="sell">
                        <h3 className="pixel">SELL</h3>
                        <div className="slot">
                          {sellItem ? (
                            <ItemCard it={sellItem} small onClick={() => onPick(sellItem)} />
                          ) : (
                            <span className="empty">เลือกของจากกระเป๋า</span>
                          )}
                        </div>
                        <label className="price-input">
                          <span>ราคา</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={sellPrice}
                            onChange={(e) => setSellPrice(e.target.value)}
                          />
                          <span>GEM</span>
                        </label>
                        <p className="hint">
                          ได้รับ {(Number(sellPrice || 0) * (100 - FEE_PCT)) / 100} GEM · ค่าธรรมเนียม {FEE_PCT}% ถูกเผาทิ้ง
                        </p>
                        <button className="abtn yellow" onClick={doList} disabled={disabled || !sellItem || !c.market}>
                          วางขาย
                        </button>
                      </div>
                      <div className="listings">
                        <h3 className="pixel">ON SALE ({listings.length})</h3>
                        {listings.length === 0 ? (
                          <p className="hint">ยังไม่มีของวางขาย</p>
                        ) : (
                          <div className="grid">
                            {listings.map((row) => {
                              const mine = row.seller.toLowerCase() === me;
                              return (
                                <ItemCard key={row.item.id.toString()} it={row.item}>
                                  <div className="price pixel">{fmtGem(row.price)} GEM</div>
                                  <div className="seller">{mine ? "ของคุณ" : `ผู้ขาย ${short(row.seller)}`}</div>
                                  {mine ? (
                                    <button className="abtn small" onClick={() => doCancel(row.item.id)} disabled={disabled}>
                                      ยกเลิก
                                    </button>
                                  ) : (
                                    <button
                                      className="abtn small yellow"
                                      onClick={() => doBuy(row)}
                                      disabled={disabled || gemBal < row.price}
                                    >
                                      ซื้อ
                                    </button>
                                  )}
                                </ItemCard>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </main>

          {/* ---------- กระเป๋า ---------- */}
          <aside className="screen crt bag">
            <div className="bag-head">
              <h2 className="pixel">BAG · {items.length}</h2>
              <button className="abtn small" onClick={refreshAll} disabled={loadingInv || !c}>
                {loadingInv ? "…" : "↻"}
              </button>
            </div>
            <div className="counts">
              {RARITY.map((r, i) => (
                <span key={r.name} className={`count r${i}`}>
                  {r.name[0]} {counts[i]}
                </span>
              ))}
            </div>
            <p className="hint bag-hint">
              {tab === "gacha" && "เลือกโหมด FORGE / EVOLVE / SHOP แล้วแตะของเพื่อใช้"}
              {tab === "forge" && "แตะ 2 ชิ้นระดับเดียวกันเพื่อผสม"}
              {tab === "evolve" && "แตะสัตว์ 1 ตัว + ดาบหรือเกราะ 1 ชิ้น"}
              {tab === "shop" && "แตะของที่ต้องการวางขาย"}
            </p>
            {items.length === 0 ? (
              <p className="hint center">กระเป๋าว่าง — ไปหมุนตู้กาชาก่อน</p>
            ) : (
              <div className="grid">
                {items.map((it) => {
                  const rule = pickRule(it);
                  return (
                    <ItemCard
                      key={it.id.toString()}
                      it={it}
                      selected={isSelected(it.id)}
                      dim={tab !== "gacha" && !rule.ok}
                      onClick={rule.ok && !disabled ? () => onPick(it) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </aside>
        </div>

        {/* ---------- Blockchain Activity Log ---------- */}
        <section className="chainlog">
          <div className="chainlog-head">
            <span className="pixel chainlog-title">BLOCKCHAIN ACTIVITY LOG</span>
            <span className="live pixel">
              <i /> LIVE
            </span>
            <small>
              ข้อมูลจาก Transaction Receipt จริง · ล่าสุด {LOG_SIZE} รายการ
              {NET.explorer && " · กด Tx เพื่อเปิดบน Etherscan"}
            </small>
          </div>
          {activity.length === 0 ? (
            <p className="chainlog-empty pixel blink">AWAITING TRANSACTION…</p>
          ) : (
            <ol className="chainlog-list">
              {activity.map((e, i) => (
                <li key={e.key} className={`logrow ${i === 0 ? "newest" : ""}`}>
                  <span className="blk pixel">[Block #{e.block}]</span>
                  <span className={`act pixel ${ACTION_COLOR[e.action] ?? "cyan"}`}>{e.action}</span>
                  {e.parties ? (
                    <span className="parties pixel">[{e.parties}]</span>
                  ) : (
                    <span className="who pixel">{e.player}</span>
                  )}
                  <span className="txh">
                    Tx:{" "}
                    {txUrl(e.hash) ? (
                      <a href={txUrl(e.hash)} target="_blank" rel="noreferrer" title="เปิดบน Etherscan">
                        <code>{short(e.hash)} ↗</code>
                      </a>
                    ) : (
                      <code title={e.hash}>{short(e.hash)}</code>
                    )}
                    <button
                      className={`copy ${copied === e.hash ? "done" : ""}`}
                      onClick={() => copyHash(e.hash)}
                      title="คัดลอก Transaction Hash เต็ม"
                    >
                      {copied === e.hash ? "COPIED ✓" : "COPY"}
                    </button>
                  </span>
                  <span className="detail">
                    {e.parts.map((p, j) => (
                      <span key={j} className={`part ${p.tone}`}>
                        {p.text}
                      </span>
                    ))}
                  </span>
                  <span className="gas pixel">GAS {Number(e.gas).toLocaleString("en-US")}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ---------- แผงควบคุม ---------- */}
        <div className="deck">
          <div className="joystick" aria-hidden="true">
            <span className="stick" />
          </div>
          <button className="coin-slot" onClick={doFaucet} disabled={disabled || !c}>
            <span className="slot-hole" />
            <span className="pixel blink">INSERT COIN</span>
            <small>+500 GEM ฟรี</small>
          </button>
          <div className="deck-btns" aria-hidden="true">
            <span className="ab red" />
            <span className="ab blue" />
            <span className="ab green" />
            <span className="ab yellow" />
          </div>
        </div>
      </div>

      <footer className="foot">
        CN478 Blockchain Technology · Demo บนเชนจำลอง Hardhat · {wallet ? short(wallet.account) : "—"}
      </footer>

      {busy && (
        <div className="busy">
          <span className="spinner" />
          {busy.label}
        </div>
      )}

      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function ResultModal({ result, onClose }) {
  const { kind, success, expired, item, tx } = result;
  let title = "CAPSULE GET!";
  let sub = "ได้รับไอเทมใหม่";
  if (kind === 2) {
    title = success ? "FORGED!" : "FAILED…";
    sub = success ? "ผสมสำเร็จ ได้ไอเทมระดับสูงขึ้น" : "ผสมไม่สำเร็จ ได้ไอเทมระดับเดิมคืน 1 ชิ้น";
  } else if (kind === 3) {
    title = success ? "EVOLVED!" : "BROKEN…";
    sub = success ? "อัปเกรดในตัวเดิม — tokenId ไม่เปลี่ยน" : "อุปกรณ์แตกหัก แต่สัตว์ยังอยู่ครบ";
  } else if (kind === "buy") {
    title = "PURCHASED!";
    sub = "ซื้อสำเร็จ ไอเทมเข้ากระเป๋าแล้ว";
  } else if (item.rarity >= 2) {
    title = "RARE DROP!";
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className={`modal-box r${item.rarity} ${success === false ? "fail" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h2 className="pixel">{title}</h2>
        <p className="hint">{expired ? "เปิดผลหลังหมดเวลา จึงได้ผลขั้นต่ำ" : sub}</p>
        <ItemCard it={item} big />
        <p className="hint">
          <code className="tx">tx {short(tx)}</code>
        </p>
        <button className="abtn red" onClick={onClose}>
          CONTINUE
        </button>
      </div>
    </div>
  );
}

function ItemCard({ it, selected, onClick, small, big, ghost, dim, children }) {
  const r = RARITY[it.rarity];
  const creature = it.itemType === TYPE.CREATURE;
  const clickable = !!onClick;
  return (
    <div
      className={`card r${it.rarity} ${selected ? "sel" : ""} ${small ? "small" : ""} ${big ? "big" : ""} ${
        ghost ? "ghost" : ""
      } ${dim ? "dim" : ""} ${clickable ? "clickable" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
    >
      <span className="badge pixel">{r.name}</span>
      {it.locked && <span className="lock" title="ล็อกระหว่างรอเปิดผล">🔒</span>}
      <span className="emoji">{emojiOf(it)}</span>
      <span className="name">{displayName(it)}</span>
      <span className="serial">#{it.serial}</span>
      {creature && !small && (
        <span className="gear">
          {it.armorTier !== NONE && <i>🛡️ {itemName(TYPE.ARMOR, it.armorTier)}</i>}
          {it.swordTier !== NONE && <i>⚔️ {itemName(TYPE.SWORD, it.swordTier)}</i>}
        </span>
      )}
      <span className="meta pixel">PWR {powerOf(it)}</span>
      {children}
    </div>
  );
}
