// ชุดทดสอบ GemForge — รันด้วย:  npm test
// แบ่งเป็น 5 กลุ่ม: GemToken · ItemNFT · กาชา · ผสม · การโจมตี (W9: Tests that attack)

const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, mine, time, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");

const PULL_COST = ethers.parseEther("100");
const CRAFT_COST = ethers.parseEther("20");
const FAUCET = ethers.parseEther("500");
const [COMMON, RARE, EPIC, LEGENDARY] = [0, 1, 2, 3];
const [SWORD, ARMOR, PET] = [0, 1, 2];

// ---------------------------------------------------------------
// Fixture: deploy ทั้ง 3 สัญญา + ตั้งค่าเหมือน scripts/deploy.js
// ---------------------------------------------------------------
async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();

  const gem = await ethers.deployContract("GemToken");
  const item = await ethers.deployContract("ItemNFT");
  const game = await ethers.deployContract("GachaGame", [gem.target, item.target]);
  const market = await ethers.deployContract("Marketplace", [item.target, gem.target]);

  await item.setMinter(game.target);
  await gem.setFaucetCooldown(0);

  for (const p of [alice, bob]) {
    for (let i = 0; i < 4; i++) await gem.connect(p).faucet(); // 2,000 GEM
    await gem.connect(p).approve(game.target, ethers.MaxUint256);
    await gem.connect(p).approve(market.target, ethers.MaxUint256);
    await item.connect(p).setApprovalForAll(market.target, true);
  }
  return { owner, alice, bob, gem, item, game, market };
}

const NONE = 255;

/** สร้างสัตว์สวมอุปกรณ์สำเร็จรูปให้ผู้เล่น (mint สัตว์เลี้ยง แล้ว setGear) — ใช้จัดฉาก test */
async function giveCreature({ owner, item, game }, to, baseTier, armorTier, swordTier) {
  await item.setMinter(owner.address);
  await item.mint(to.address, PET, baseTier);
  const id = await item.totalMinted();
  let hi = baseTier;
  if (armorTier !== NONE && armorTier > hi) hi = armorTier;
  if (swordTier !== NONE && swordTier > hi) hi = swordTier;
  await item.setGear(id, baseTier, armorTier, swordTier, hi + 1);
  await item.setMinter(game.target);
  return id;
}

function nameOf(uri) {
  return JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8")).name;
}

/** mint ไอเทมที่กำหนดเองให้ผู้เล่น (สลับ minter เป็น owner ชั่วคราว) — ใช้จัดฉากทดสอบการผสม */
async function giveItems({ owner, item, game }, to, specs) {
  await item.setMinter(owner.address);
  const ids = [];
  for (const [itemType, rarity] of specs) {
    await item.mint(to.address, itemType, rarity);
    ids.push(await item.totalMinted());
  }
  await item.setMinter(game.target);
  return ids;
}

/** reveal แล้วคืนค่าใน event Revealed */
async function reveal(game, player) {
  const rc = await (await game.connect(player).reveal()).wait();
  const ev = rc.logs.map((l) => { try { return game.interface.parseLog(l); } catch { return null; } })
    .find((x) => x?.name === "Revealed");
  return {
    tokenId: ev.args.tokenId,
    itemType: Number(ev.args.itemType),
    rarity: Number(ev.args.rarity),
    success: ev.args.craftSuccess,
    expired: ev.args.expired,
  };
}

async function topUp(gem, player, times) {
  for (let i = 0; i < times; i++) await gem.connect(player).faucet();
}

describe("GemForge", function () {
  // hardhat.config ตั้งให้ขุดบล็อกทุก 3 วินาที (สำหรับหน้าเว็บ) — ใน test ปิดไว้ให้ผลคงที่
  before(async () => {
    await network.provider.send("evm_setIntervalMining", [0]);
  });

  // =================================================================
  describe("1. GemToken (ERC-20)", function () {
    it("faucet ให้ 500 GEM", async () => {
      const [, , , carol] = await ethers.getSigners();
      const gem = await ethers.deployContract("GemToken");
      await expect(gem.connect(carol).faucet()).to.changeTokenBalance(gem, carol, FAUCET);
    });

    it("cooldown เริ่มต้น 1 วัน: กดซ้ำทันทีต้อง revert, ครบ 1 วันกดได้", async () => {
      const [, , , carol] = await ethers.getSigners();
      const gem = await ethers.deployContract("GemToken");
      await gem.connect(carol).faucet();
      await expect(gem.connect(carol).faucet()).to.be.revertedWithCustomError(gem, "FaucetOnCooldown");
      await time.increase(24 * 60 * 60);
      await expect(gem.connect(carol).faucet()).to.changeTokenBalance(gem, carol, FAUCET);
    });

    it("เฉพาะ owner ตั้ง cooldown ได้", async () => {
      const { gem, alice } = await loadFixture(deployFixture);
      await expect(gem.connect(alice).setFaucetCooldown(0))
        .to.be.revertedWithCustomError(gem, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
    });
  });

  // =================================================================
  describe("2. ItemNFT (ERC-721)", function () {
    it("เฉพาะ owner ตั้ง minter ได้ และห้ามเป็น address 0", async () => {
      const { item, alice } = await loadFixture(deployFixture);
      await expect(item.connect(alice).setMinter(alice.address))
        .to.be.revertedWithCustomError(item, "OwnableUnauthorizedAccount");
      await expect(item.setMinter(ethers.ZeroAddress)).to.be.revertedWithCustomError(item, "ZeroAddress");
    });

    it("ผู้เล่นและแม้แต่ owner mint/burn ตรง ๆ ไม่ได้ (ต้องเป็น minter = GachaGame)", async () => {
      const f = await loadFixture(deployFixture);
      const { item, owner, alice } = f;
      await expect(item.connect(alice).mint(alice.address, SWORD, LEGENDARY))
        .to.be.revertedWithCustomError(item, "NotMinter").withArgs(alice.address);
      await expect(item.mint(owner.address, SWORD, LEGENDARY))
        .to.be.revertedWithCustomError(item, "NotMinter").withArgs(owner.address);

      const [id] = await giveItems(f, alice, [[SWORD, COMMON]]);
      await expect(item.connect(alice).burn(alice.address, id)).to.be.revertedWithCustomError(item, "NotMinter");
    });

    it("ปฏิเสธประเภท/ระดับที่ไม่มีอยู่", async () => {
      const { item, owner } = await loadFixture(deployFixture);
      await item.setMinter(owner.address);
      await expect(item.mint(owner.address, 3, COMMON)).to.be.revertedWithCustomError(item, "InvalidItem");
      await expect(item.mint(owner.address, SWORD, 4)).to.be.revertedWithCustomError(item, "InvalidItem");
    });

    it("serial นับแยกตาม (ประเภท, ระดับ) และไม่นำเลขที่ถูกเผากลับมาใช้", async () => {
      const f = await loadFixture(deployFixture);
      const { item, owner, alice } = f;
      const [a, b, c] = await giveItems(f, alice, [[SWORD, COMMON], [SWORD, COMMON], [SWORD, RARE]]);
      expect((await item.getItem(a)).serial).to.equal(1);
      expect((await item.getItem(b)).serial).to.equal(2);
      expect((await item.getItem(c)).serial).to.equal(1);

      await item.setMinter(owner.address);
      await item.burn(alice.address, a);
      await item.mint(alice.address, SWORD, COMMON);
      expect((await item.getItem(await item.totalMinted())).serial).to.equal(3);
    });

    it("burn ต้องระบุเจ้าของที่ถูกต้อง (ป้องกันเผาของคนอื่น)", async () => {
      const f = await loadFixture(deployFixture);
      const { item, owner, alice, bob } = f;
      const [id] = await giveItems(f, alice, [[ARMOR, RARE]]);
      await item.setMinter(owner.address);
      await expect(item.burn(bob.address, id))
        .to.be.revertedWithCustomError(item, "NotTokenOwner").withArgs(id, bob.address);
      await expect(item.burn(alice.address, 999)).to.be.revertedWithCustomError(item, "ERC721NonexistentToken");

      await expect(item.burn(alice.address, id)).to.emit(item, "ItemBurned").withArgs(alice.address, id, ARMOR, RARE);
      await expect(item.getItem(id)).to.be.revertedWithCustomError(item, "ERC721NonexistentToken");
    });

    it("tokenURI เป็น JSON บนเชน มีชื่อภาษาไทยและคุณสมบัติ", async () => {
      const f = await loadFixture(deployFixture);
      const [id] = await giveItems(f, f.alice, [[PET, LEGENDARY]]);
      const uri = await f.item.tokenURI(id);
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
      expect(json.name).to.equal("ฟีนิกซ์ #1");
      expect(json.attributes).to.deep.include({ trait_type: "Rarity", value: "Legendary" });
      expect(json.attributes).to.deep.include({ trait_type: "Type", value: "Pet" });
    });
  });

  // =================================================================
  describe("3. กาชา (pull → reveal)", function () {
    it("pull เผา 100 GEM (supply ลดลงจริง) และตั้งคำขอรอ reveal", async () => {
      const { gem, game, alice } = await loadFixture(deployFixture);
      const supply = await gem.totalSupply();
      const tx = game.connect(alice).pull();
      await expect(tx).to.changeTokenBalance(gem, alice, -PULL_COST);
      await expect(tx).to.emit(game, "PullRequested");
      expect(await gem.totalSupply()).to.equal(supply - PULL_COST);
      expect(await game.revealStatus(alice.address)).to.equal(1); // ยังอยู่บล็อกเดิม
    });

    it("reveal แล้วได้ NFT 1 ชิ้น สถานะกลับเป็น 0", async () => {
      const { item, game, alice } = await loadFixture(deployFixture);
      await game.connect(alice).pull();
      const r = await reveal(game, alice); // ธุรกรรมนี้อยู่บล็อกถัดไปแล้ว
      expect(await item.ownerOf(r.tokenId)).to.equal(alice.address);
      expect(r.rarity).to.be.lessThan(LEGENDARY);
      expect(await game.revealStatus(alice.address)).to.equal(0);
    });

    it("ห้าม pull ซ้อนขณะยังมีคำขอค้าง / reveal ซ้ำ / reveal โดยไม่มีคำขอ", async () => {
      const { game, alice } = await loadFixture(deployFixture);
      await expect(game.connect(alice).reveal()).to.be.revertedWithCustomError(game, "NothingPending");
      await game.connect(alice).pull();
      await expect(game.connect(alice).pull()).to.be.revertedWithCustomError(game, "AlreadyPending");
      await game.connect(alice).reveal();
      await expect(game.connect(alice).reveal()).to.be.revertedWithCustomError(game, "NothingPending");
    });

    it("GEM ไม่พอ หรือไม่ได้ approve → revert ด้วย error ของ ERC-20", async () => {
      const { gem, game } = await loadFixture(deployFixture);
      const [, , , carol, dave] = await ethers.getSigners();
      await expect(game.connect(carol).pull()).to.be.revertedWithCustomError(gem, "ERC20InsufficientAllowance");
      await gem.connect(dave).approve(game.target, ethers.MaxUint256);
      await expect(game.connect(dave).pull()).to.be.revertedWithCustomError(gem, "ERC20InsufficientBalance");
    });

    it("revealStatus: 1 รอ → 2 เปิดได้ → 3 หมดเวลา (เกิน 256 บล็อก)", async () => {
      const { game, alice } = await loadFixture(deployFixture);
      await game.connect(alice).pull();
      expect(await game.revealStatus(alice.address)).to.equal(1);
      await mine(1);
      expect(await game.revealStatus(alice.address)).to.equal(2);
      await mine(300);
      expect(await game.revealStatus(alice.address)).to.equal(3);
    });

    it("เปิดผลหลังหมดเวลา → ได้ Common เสมอ (ไม่มีประโยชน์ที่จะตั้งใจรอ)", async () => {
      const { game, alice } = await loadFixture(deployFixture);
      for (let i = 0; i < 5; i++) {
        await game.connect(alice).pull();
        await mine(300);
        const r = await reveal(game, alice);
        expect(r.expired).to.equal(true);
        expect(r.rarity).to.equal(COMMON);
      }
    });

    it("อัตราดรอปจาก 300 ครั้ง ใกล้เคียง 70/25/5 และไม่มี Legendary", async function () {
      this.timeout(120000);
      const { gem, game, alice } = await loadFixture(deployFixture);
      await topUp(gem, alice, 60); // +30,000 GEM
      const N = 300;
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < N; i++) {
        await game.connect(alice).pull();
        counts[(await reveal(game, alice)).rarity]++;
      }
      console.log(`      ผลสุ่ม ${N} ครั้ง (C/R/E/L):`, counts.join(" / "));
      expect(counts[COMMON] / N).to.be.within(0.55, 0.85);
      expect(counts[RARE] / N).to.be.within(0.13, 0.37);
      expect(counts[EPIC] / N).to.be.within(0.005, 0.12);
      expect(counts[LEGENDARY]).to.equal(0);
    });
  });

  // =================================================================
  describe("4. การผสม (Burn & Mint)", function () {
    it("craft เผา NFT 2 ชิ้นทันที + เผา 20 GEM", async () => {
      const f = await loadFixture(deployFixture);
      const { gem, item, game, alice } = f;
      const [a, b] = await giveItems(f, alice, [[SWORD, COMMON], [SWORD, COMMON]]);

      const craftBlock = (await ethers.provider.getBlockNumber()) + 1;
      const tx = game.connect(alice).craft(a, b);
      await expect(tx).to.changeTokenBalance(gem, alice, -CRAFT_COST);
      await expect(tx).to.emit(game, "CraftRequested").withArgs(alice.address, a, b, COMMON, craftBlock);

      await expect(item.ownerOf(a)).to.be.revertedWithCustomError(item, "ERC721NonexistentToken");
      await expect(item.ownerOf(b)).to.be.revertedWithCustomError(item, "ERC721NonexistentToken");
      expect(await item.balanceOf(alice.address)).to.equal(0);

      const r = await reveal(game, alice);
      expect(await item.balanceOf(alice.address)).to.equal(1);
      expect(r.rarity).to.equal(r.success ? RARE : COMMON); // สำเร็จ = ขึ้น 1 ขั้น · ล้มเหลว = ระดับเดิม
      expect(r.itemType).to.equal(SWORD); // ประเภทเดียวกัน → ได้ประเภทนั้น
    });

    it("ห้ามผสมชิ้นเดียวกัน / ต่างระดับ / Legendary", async () => {
      const f = await loadFixture(deployFixture);
      const { game, alice } = f;
      const [c1, r1, l1, l2] = await giveItems(f, alice, [
        [SWORD, COMMON], [SWORD, RARE], [PET, LEGENDARY], [PET, LEGENDARY],
      ]);
      await expect(game.connect(alice).craft(c1, c1)).to.be.revertedWithCustomError(game, "SameToken");
      await expect(game.connect(alice).craft(c1, r1))
        .to.be.revertedWithCustomError(game, "RarityMismatch").withArgs(COMMON, RARE);
      await expect(game.connect(alice).craft(l1, l2)).to.be.revertedWithCustomError(game, "MaxRarity");
    });

    it("ห้ามผสมขณะมีคำขอค้าง", async () => {
      const f = await loadFixture(deployFixture);
      const [a, b] = await giveItems(f, f.alice, [[SWORD, COMMON], [SWORD, COMMON]]);
      await f.game.connect(f.alice).pull();
      await expect(f.game.connect(f.alice).craft(a, b)).to.be.revertedWithCustomError(f.game, "AlreadyPending");
    });

    it("เปิดผลการผสมหลังหมดเวลา → นับเป็นล้มเหลว ได้ระดับเดิมคืน", async () => {
      const f = await loadFixture(deployFixture);
      const [a, b] = await giveItems(f, f.alice, [[ARMOR, EPIC], [ARMOR, EPIC]]);
      await f.game.connect(f.alice).craft(a, b);
      await mine(300);
      const r = await reveal(f.game, f.alice);
      expect(r).to.include({ expired: true, success: false, rarity: EPIC, itemType: ARMOR });
    });

    it("วัตถุดิบต่างประเภท → ได้หนึ่งในสองประเภทนั้นเท่านั้น และอัตราสำเร็จ Common ใกล้ 80%", async function () {
      this.timeout(120000);
      const f = await loadFixture(deployFixture);
      const { gem, game, alice } = f;
      const N = 120;
      const specs = [];
      for (let i = 0; i < N; i++) specs.push([SWORD, COMMON], [PET, COMMON]);
      const ids = await giveItems(f, alice, specs);
      await topUp(gem, alice, 3); // ค่าผสม 120 × 20 = 2,400 GEM

      let success = 0;
      const types = new Set();
      for (let i = 0; i < N; i++) {
        await game.connect(alice).craft(ids[2 * i], ids[2 * i + 1]);
        const r = await reveal(game, alice);
        expect([SWORD, PET]).to.include(r.itemType);
        expect(r.rarity).to.equal(r.success ? RARE : COMMON);
        types.add(r.itemType);
        if (r.success) success++;
      }
      console.log(`      ผสม Common ${N} ครั้ง สำเร็จ ${success} ครั้ง (${((success / N) * 100).toFixed(1)}%)`);
      expect(success / N).to.be.within(0.65, 0.93);
      expect(types.size).to.equal(2); // สุ่มได้ทั้งสองประเภทจริง
    });
  });

  // =================================================================
  describe("5. การโจมตี (W9: Tests that attack)", function () {
    it("[Access control] ผสมไอเทมของคนอื่นไม่ได้", async () => {
      const f = await loadFixture(deployFixture);
      const [a, b] = await giveItems(f, f.alice, [[SWORD, COMMON], [SWORD, COMMON]]);
      await expect(f.game.connect(f.bob).craft(a, b))
        .to.be.revertedWithCustomError(f.game, "NotYourItem").withArgs(a);
    });

    it("[Access control] โอน NFT ออกไปแล้ว เจ้าของเดิมใช้ผสมไม่ได้ แต่เจ้าของใหม่ใช้ได้", async () => {
      const f = await loadFixture(deployFixture);
      const { item, game, alice, bob } = f;
      const [a, b] = await giveItems(f, alice, [[SWORD, COMMON], [SWORD, COMMON]]);
      await item.connect(alice).transferFrom(alice.address, bob.address, a);
      await item.connect(alice).transferFrom(alice.address, bob.address, b);
      await expect(game.connect(alice).craft(a, b)).to.be.revertedWithCustomError(game, "NotYourItem");
      await expect(game.connect(bob).craft(a, b)).to.emit(game, "CraftRequested");
    });

    it("[สุ่มซ้ำ] สัญญาผู้โจมตี pull + reveal ในธุรกรรมเดียวไม่ได้ (TooEarly)", async () => {
      const { gem, game } = await loadFixture(deployFixture);
      const attacker = await ethers.deployContract("SameTxRerollAttacker", [game.target, gem.target]);
      await expect(attacker.pullAndRevealNow()).to.be.revertedWithCustomError(game, "TooEarly");
    });

    it("[สุ่มซ้ำ] รอเปิดผลในบล็อกอื่น ผลลัพธ์ยังเหมือนเดิม (revert แล้วลองใหม่ไม่ช่วย)", async () => {
      const { item, game, alice } = await loadFixture(deployFixture);
      await game.connect(alice).pull();
      await mine(1);

      const results = [];
      for (const wait of [0, 7, 50]) {
        const snap = await takeSnapshot();
        await mine(wait);
        const r = await reveal(game, alice);
        const it = await item.getItem(r.tokenId);
        results.push(`${it.itemType}-${it.rarity}`);
        await snap.restore(); // จำลองการ revert ผลที่ไม่ชอบแล้วลองใหม่ทีหลัง
      }
      expect(new Set(results).size).to.equal(1);
    });

    it("[Re-entrancy] callback จาก _safeMint เรียก pull ซ้ำกลางทางไม่ได้ (nonReentrant)", async () => {
      const { gem, item, game } = await loadFixture(deployFixture);
      const player = await ethers.deployContract("ReentrantPlayer", [game.target, gem.target]);
      await player.doPull();
      await player.doReveal();

      expect(await player.reentryAttempts()).to.equal(1);  // พยายามเรียกซ้ำจริง
      expect(await player.reentrySucceeded()).to.equal(0); // แต่ถูกบล็อก
      expect(await item.balanceOf(player.target)).to.equal(1); // ได้ NFT ชิ้นเดียวตามปกติ
      expect(await game.revealStatus(player.target)).to.equal(0); // ไม่มีคำขอใหม่แอบเกิดขึ้น
      expect(await gem.balanceOf(player.target)).to.equal(FAUCET - PULL_COST); // จ่ายแค่ครั้งเดียว
    });
  });

  // =================================================================
  describe("6. สวมอุปกรณ์ (Craft-Only NFT ตาม CSV)", function () {
    // [คำอธิบาย, สร้างสัตว์, ประเภทอุปกรณ์, ระดับอุปกรณ์, โอกาสที่คาด, ระดับผลลัพธ์ที่คาด]
    const CASES = [
      ["ลูกไก่ + เกราะหนัง", { pet: 0 }, ARMOR, 0, 9000, RARE],
      ["ลูกไก่ + เกราะโซ่", { pet: 0 }, ARMOR, 1, 7000, EPIC],
      ["ลูกไก่ + เกราะมังกร", { pet: 0 }, ARMOR, 2, 4500, LEGENDARY],
      ["ลูกไก่ + เกราะนิรันดร์ → Mythic", { pet: 0 }, ARMOR, 3, 2500, 4],
      ["พ่อไก่เกราะหนัง + ดาบไม้", { gear: [0, 0, NONE] }, SWORD, 0, 9000, RARE],
      ["พ่อไก่เกราะหนัง + ดาบเหล็ก", { gear: [0, 0, NONE] }, SWORD, 1, 7500, EPIC],
      ["พ่อไก่เกราะหนัง + ดาบเพลิง", { gear: [0, 0, NONE] }, SWORD, 2, 5000, LEGENDARY],
      ["พ่อไก่เกราะหนัง + ดาบสุริยัน", { gear: [0, 0, NONE] }, SWORD, 3, 2500, 4],
      ["อัปเกราะทับ หนัง→โซ่", { gear: [0, 0, NONE] }, ARMOR, 1, 7500, EPIC],
      ["อัปเกราะทับ หนัง→มังกร", { gear: [0, 0, NONE] }, ARMOR, 2, 4500, LEGENDARY],
      ["อัปเกราะทับ หนัง→นิรันดร์", { gear: [0, 0, NONE] }, ARMOR, 3, 2000, 4],
      ["อัปดาบทับ ไม้→เพลิง", { gear: [0, 0, 0] }, SWORD, 2, 5000, LEGENDARY],
      ["หมาป่า + ดาบเหล็ก", { pet: 1 }, SWORD, 1, 7500, EPIC],
      ["หมาป่า + ดาบเพลิง", { pet: 1 }, SWORD, 2, 4500, LEGENDARY],
      ["กริฟฟิน + เกราะโซ่", { pet: 2 }, ARMOR, 1, 6000, LEGENDARY],
      ["กริฟฟิน + เกราะมังกร (ตามสูตร = Legendary)", { pet: 2 }, ARMOR, 2, 3500, LEGENDARY],
      ["ฟีนิกซ์ + ดาบสุริยัน", { pet: 3 }, SWORD, 3, 2000, 4],
    ];

    for (const [label, setup, gearType, gearTier, rate, rarity] of CASES) {
      it(`สูตร: ${label} → ${rate / 100}% · ระดับ ${rarity}`, async () => {
        const f = await loadFixture(deployFixture);
        const creature = setup.pet !== undefined
          ? (await giveItems(f, f.alice, [[PET, setup.pet]]))[0]
          : await giveCreature(f, f.alice, ...setup.gear);
        const [gear] = await giveItems(f, f.alice, [[gearType, gearTier]]);
        const plan = await f.game.previewEquip(f.alice.address, creature, gear);
        expect(plan.rate).to.equal(rate);
        expect(plan.newRarity).to.equal(rarity);
      });
    }

    it("สวมสำเร็จ: tokenId เดิม กลายเป็นพ่อไก่ (type 3) · อุปกรณ์ถูกเผา · เสีย 20 GEM", async () => {
      const f = await loadFixture(deployFixture);
      const { item, game, gem, alice } = f;
      const [chick] = await giveItems(f, alice, [[PET, 0]]);
      let success = false;
      for (let i = 0; i < 15 && !success; i++) {
        const [armor] = await giveItems(f, alice, [[ARMOR, 0]]);
        const tx = game.connect(alice).equip(chick, armor);
        await expect(tx).to.changeTokenBalance(gem, alice, -CRAFT_COST);
        await expect(item.ownerOf(armor)).to.be.revertedWithCustomError(item, "ERC721NonexistentToken");
        expect(await item.locked(chick)).to.equal(true);
        const r = await reveal(game, alice);
        expect(r.tokenId).to.equal(chick);
        expect(await item.locked(chick)).to.equal(false);
        success = r.success;
      }
      expect(success).to.equal(true);
      const it = await item.getItem(chick);
      expect([it.itemType, it.rarity, it.baseTier, it.armorTier, it.swordTier].map(Number))
        .to.deep.equal([3, RARE, 0, 0, NONE]);
      expect(await item.ownerOf(chick)).to.equal(alice.address);
      expect(nameOf(await item.tokenURI(chick))).to.equal("พ่อไก่ใส่เกราะหนัง #1");
    });

    it("อัปเกรดเกราะทับ: ดาบเดิมยังอยู่ครบ (เปลี่ยนแค่ armorTier)", async () => {
      const f = await loadFixture(deployFixture);
      const { item, game, alice } = f;
      const rooster = await giveCreature(f, alice, 0, 0, 2); // เกราะหนัง + ดาบเพลิง
      let success = false;
      for (let i = 0; i < 20 && !success; i++) {
        const [armor] = await giveItems(f, alice, [[ARMOR, 1]]);
        await game.connect(alice).equip(rooster, armor);
        success = (await reveal(game, alice)).success;
      }
      expect(success).to.equal(true);
      const it = await item.getItem(rooster);
      expect(Number(it.armorTier)).to.equal(1);
      expect(Number(it.swordTier)).to.equal(2); // ไม่ถูกรีเซ็ต
      expect(Number(it.rarity)).to.equal(LEGENDARY); // max(0,1,2)+1
      expect(nameOf(await item.tokenURI(rooster))).to.equal("พ่อไก่ใส่เกราะโซ่ถือดาบเพลิง #1");
    });

    it("ล้มเหลว (หมดเวลา): เสียอุปกรณ์ แต่สัตว์ยังอยู่ไม่เปลี่ยนและปลดล็อกแล้ว", async () => {
      const f = await loadFixture(deployFixture);
      const { item, game, alice } = f;
      const [chick, armor] = await giveItems(f, alice, [[PET, 0], [ARMOR, 3]]);
      await game.connect(alice).equip(chick, armor);
      await mine(300);
      const r = await reveal(game, alice);
      expect(r).to.include({ success: false, expired: true });
      expect(await item.ownerOf(chick)).to.equal(alice.address);
      expect(Number((await item.getItem(chick)).itemType)).to.equal(PET);
      expect(await item.locked(chick)).to.equal(false);
      await expect(item.ownerOf(armor)).to.be.revertedWithCustomError(item, "ERC721NonexistentToken");
    });

    it("ห้ามอัปเกรดลดระดับหรือเท่าเดิม (NotAnUpgrade)", async () => {
      const f = await loadFixture(deployFixture);
      const rooster = await giveCreature(f, f.alice, 0, 1, NONE);
      const [a0, a1] = await giveItems(f, f.alice, [[ARMOR, 0], [ARMOR, 1]]);
      await expect(f.game.previewEquip(f.alice.address, rooster, a0))
        .to.be.revertedWithCustomError(f.game, "NotAnUpgrade").withArgs(1, 0);
      await expect(f.game.connect(f.alice).equip(rooster, a1))
        .to.be.revertedWithCustomError(f.game, "NotAnUpgrade").withArgs(1, 1);
    });

    it("คู่ที่ไม่มีในตารางสูตร → NoRecipe (เช่น ลูกไก่ถือดาบก่อนใส่เกราะ, หมาป่าใส่เกราะ)", async () => {
      const f = await loadFixture(deployFixture);
      const [chick, wolf, sword, armor] = await giveItems(f, f.alice, [[PET, 0], [PET, 1], [SWORD, 0], [ARMOR, 1]]);
      await expect(f.game.previewEquip(f.alice.address, chick, sword)).to.be.revertedWithCustomError(f.game, "NoRecipe");
      await expect(f.game.previewEquip(f.alice.address, wolf, armor)).to.be.revertedWithCustomError(f.game, "NoRecipe");
    });

    it("ใช้ของผิดช่อง: ดาบเป็นสัตว์ไม่ได้, สัตว์เป็นอุปกรณ์ไม่ได้", async () => {
      const f = await loadFixture(deployFixture);
      const [sword, chick, wolf] = await giveItems(f, f.alice, [[SWORD, 0], [PET, 0], [PET, 1]]);
      await expect(f.game.previewEquip(f.alice.address, sword, chick)).to.be.revertedWithCustomError(f.game, "NotACreature");
      await expect(f.game.previewEquip(f.alice.address, chick, wolf)).to.be.revertedWithCustomError(f.game, "NotGear");
    });

    it("สัตว์สวมอุปกรณ์ใช้ผสมปกติไม่ได้ (CreatureNotCraftable)", async () => {
      const f = await loadFixture(deployFixture);
      const r1 = await giveCreature(f, f.alice, 0, 0, NONE);
      const r2 = await giveCreature(f, f.alice, 0, 0, NONE);
      await expect(f.game.connect(f.alice).craft(r1, r2)).to.be.revertedWithCustomError(f.game, "CreatureNotCraftable");
    });

    it("ชื่อพิเศษและ Mythic ใน tokenURI", async () => {
      const f = await loadFixture(deployFixture);
      const wolf = await giveCreature(f, f.alice, 1, NONE, 2);
      const emperor = await giveCreature(f, f.alice, 0, 3, NONE);
      expect(nameOf(await f.item.tokenURI(wolf))).to.equal("หมาป่าเขี้ยวอัคคี #1");
      const uri = await f.item.tokenURI(emperor);
      expect(nameOf(uri)).to.equal("พ่อไก่จักรพรรดิเกราะนิรันดร์ #1");
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
      expect(json.attributes).to.deep.include({ trait_type: "Rarity", value: "Mythic" });
      expect(json.attributes).to.deep.include({ trait_type: "Armor", value: "เกราะนิรันดร์" });
    });

    it("เฉพาะ owner เพิ่มสูตรใหม่ได้ และใช้ได้ทันทีโดยไม่ต้อง deploy ใหม่", async () => {
      const f = await loadFixture(deployFixture);
      const [wolf, armor] = await giveItems(f, f.alice, [[PET, 1], [ARMOR, 1]]);
      await expect(f.game.connect(f.alice).setRecipe(1, ARMOR, 1, false, true, 5000))
        .to.be.revertedWithCustomError(f.game, "OwnableUnauthorizedAccount");
      await f.game.setRecipe(1, ARMOR, 1, false, true, 5000); // หมาป่า + เกราะโซ่
      expect((await f.game.previewEquip(f.alice.address, wolf, armor)).rate).to.equal(5000);
      await expect(f.game.setRecipe(1, ARMOR, 1, false, true, 10001)).to.be.revertedWithCustomError(f.game, "InvalidRate");
    });

    it("[โจมตี] โอนหรือวางขายสัตว์ระหว่างรอเปิดผลไม่ได้ (ItemLocked)", async () => {
      const f = await loadFixture(deployFixture);
      const { item, game, market, alice, bob } = f;
      const [chick, armor] = await giveItems(f, alice, [[PET, 0], [ARMOR, 0]]);
      await game.connect(alice).equip(chick, armor);
      await expect(item.connect(alice).transferFrom(alice.address, bob.address, chick))
        .to.be.revertedWithCustomError(item, "ItemLocked").withArgs(chick);
      await expect(market.connect(alice).list(chick, ethers.parseEther("50")))
        .to.be.revertedWithCustomError(item, "ItemLocked");
      await reveal(game, alice);
      await item.connect(alice).transferFrom(alice.address, bob.address, chick); // ปลดล็อกแล้ว โอนได้
      expect(await item.ownerOf(chick)).to.equal(bob.address);
    });
  });

  // =================================================================
  describe("7. ร้านค้า (ซื้อขายด้วย GEM)", function () {
    const PRICE = ethers.parseEther("200");
    const FEE = (PRICE * 500n) / 10000n; // 5%

    it("วางขาย: NFT ถูกฝากไว้ที่ร้านค้า และขึ้นในรายการ", async () => {
      const f = await loadFixture(deployFixture);
      const [id] = await giveItems(f, f.alice, [[SWORD, EPIC]]);
      await expect(f.market.connect(f.alice).list(id, PRICE)).to.emit(f.market, "Listed").withArgs(f.alice.address, id, PRICE);
      expect(await f.item.ownerOf(id)).to.equal(f.market.target);
      const [ids, sellers, prices] = await f.market.getListings();
      expect(ids).to.deep.equal([id]);
      expect(sellers).to.deep.equal([f.alice.address]);
      expect(prices).to.deep.equal([PRICE]);
    });

    it("ซื้อ: ผู้ขายได้ 95% · 5% ถูกเผา · NFT ไปหาผู้ซื้อ · รายการหายไป", async () => {
      const f = await loadFixture(deployFixture);
      const { gem, item, market, alice, bob } = f;
      const [id] = await giveItems(f, alice, [[PET, RARE]]);
      await market.connect(alice).list(id, PRICE);
      const supply = await gem.totalSupply();

      const tx = market.connect(bob).buy(id);
      await expect(tx).to.changeTokenBalances(gem, [bob, alice], [-PRICE, PRICE - FEE]);
      expect(await gem.totalSupply()).to.equal(supply - FEE);
      expect(await item.ownerOf(id)).to.equal(bob.address);
      expect((await market.getListings())[0]).to.deep.equal([]);
    });

    it("ยกเลิกได้เฉพาะผู้ขาย และของกลับไปหาผู้ขาย", async () => {
      const f = await loadFixture(deployFixture);
      const [id] = await giveItems(f, f.alice, [[ARMOR, COMMON]]);
      await f.market.connect(f.alice).list(id, PRICE);
      await expect(f.market.connect(f.bob).cancel(id)).to.be.revertedWithCustomError(f.market, "NotSeller");
      await f.market.connect(f.alice).cancel(id);
      expect(await f.item.ownerOf(id)).to.equal(f.alice.address);
      await expect(f.market.connect(f.bob).buy(id)).to.be.revertedWithCustomError(f.market, "NotListed");
    });

    it("ห้ามซื้อของตัวเอง / ห้ามตั้งราคา 0 / ห้ามขายของคนอื่น", async () => {
      const f = await loadFixture(deployFixture);
      const [id] = await giveItems(f, f.alice, [[SWORD, COMMON]]);
      await expect(f.market.connect(f.alice).list(id, 0)).to.be.revertedWithCustomError(f.market, "PriceOutOfRange");
      await expect(f.market.connect(f.bob).list(id, PRICE)).to.be.reverted; // ไม่ใช่เจ้าของ → ERC721 ปฏิเสธ
      await f.market.connect(f.alice).list(id, PRICE);
      await expect(f.market.connect(f.alice).buy(id)).to.be.revertedWithCustomError(f.market, "CannotBuyOwn");
    });

    it("GEM ไม่พอ → ซื้อไม่ได้ และรายการยังอยู่", async () => {
      const f = await loadFixture(deployFixture);
      const [id] = await giveItems(f, f.alice, [[SWORD, COMMON]]);
      await f.market.connect(f.alice).list(id, ethers.parseEther("1000000"));
      await expect(f.market.connect(f.bob).buy(id)).to.be.revertedWithCustomError(f.gem, "ERC20InsufficientBalance");
      expect((await f.market.getListings())[0]).to.deep.equal([id]);
    });

    it("ของที่วางขายอยู่ ผู้ขายเอาไปผสมไม่ได้ (เพราะอยู่ที่ร้านค้า)", async () => {
      const f = await loadFixture(deployFixture);
      const [a, b] = await giveItems(f, f.alice, [[SWORD, COMMON], [SWORD, COMMON]]);
      await f.market.connect(f.alice).list(a, PRICE);
      await expect(f.game.connect(f.alice).craft(a, b)).to.be.revertedWithCustomError(f.game, "NotYourItem").withArgs(a);
    });

    it("ลบรายการกลางลิสต์แล้วรายการอื่นยังถูกต้อง (swap-and-pop)", async () => {
      const f = await loadFixture(deployFixture);
      const ids = await giveItems(f, f.alice, [[SWORD, 0], [ARMOR, 0], [PET, 0]]);
      for (const id of ids) await f.market.connect(f.alice).list(id, PRICE);
      await f.market.connect(f.bob).buy(ids[0]);
      const [left] = await f.market.getListings();
      expect([...left].sort()).to.deep.equal([ids[1], ids[2]].sort());
      await f.market.connect(f.alice).cancel(ids[2]);
      expect((await f.market.getListings())[0]).to.deep.equal([ids[1]]);
    });
  });
});
