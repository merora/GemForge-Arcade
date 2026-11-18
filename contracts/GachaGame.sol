// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ItemNFT} from "./ItemNFT.sol";

/// @title  GemForge GachaGame — สุ่มกาชา · ผสมไอเทม · สวมอุปกรณ์ให้สัตว์ (Craft-Only)
/// @notice ทุกการกระทำใช้ commit–reveal 2 จังหวะ:
///         1) pull() / craft() / equip()  → จ่ายค่าใช้จ่าย + บันทึกเลขบล็อก (ผลยังไม่ถูกกำหนด)
///         2) reveal()                    → ใช้ blockhash ของบล็อกนั้นเป็นค่าสุ่ม แล้วให้ผลลัพธ์
contract GachaGame is ReentrancyGuard, Ownable {
    // ---------------------------------------------------------------
    // ค่าตาม Game Design — หน่วย basis point: 10000 = 100%
    // ---------------------------------------------------------------
    uint256 public constant PULL_COST = 100 ether;  // 100 GEM
    uint256 public constant CRAFT_COST = 20 ether;  // 20 GEM
    uint256 public constant EQUIP_COST = 20 ether;  // 20 GEM

    uint16 public constant DROP_EPIC = 500;   //  5%
    uint16 public constant DROP_RARE = 2500;  // 25%  (ที่เหลือ 70% = Common, Legendary 0%)

    /// @notice ผสมปกติ: Common→Rare 80%, Rare→Epic 50%, Epic→Legendary 20%
    function craftSuccessRate(uint8 rarity) public pure returns (uint16) {
        if (rarity == 0) return 8000;
        if (rarity == 1) return 5000;
        return 2000;
    }

    uint8 private constant KIND_NONE = 0;
    uint8 private constant KIND_PULL = 1;
    uint8 private constant KIND_CRAFT = 2;
    uint8 private constant KIND_EQUIP = 3;

    // ค่าเดียวกับใน ItemNFT (เก็บเป็นค่าคงที่ไว้ที่นี่ด้วย เพื่อไม่ต้องเรียกข้ามสัญญา)
    uint8 private constant TYPE_SWORD = 0;
    uint8 private constant TYPE_ARMOR = 1;
    uint8 private constant TYPE_PET = 2;
    uint8 private constant TYPE_CREATURE = 3;
    uint8 private constant LEGENDARY = 3;
    uint8 private constant NONE = 255;

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------
    ERC20Burnable public immutable gem;
    ItemNFT public immutable item;

    /// @dev คำขอที่รอ reveal — ผู้เล่น 1 คนมีได้ทีละ 1 คำขอ (ทั้งก้อนอยู่ใน 1 storage slot)
    struct Pending {
        uint64 blockNumber; // บล็อกที่ส่งคำขอ
        uint8 kind;         // PULL / CRAFT / EQUIP
        uint8 rarity;       // craft: rarity ของวัตถุดิบ
        uint8 typeA;        // craft: ประเภทวัตถุดิบชิ้นที่ 1
        uint8 typeB;        // craft: ประเภทวัตถุดิบชิ้นที่ 2
        uint64 creatureId;  // equip: สัตว์ที่กำลังสวมอุปกรณ์ (ถูกล็อกไว้)
        uint8 slot;         // equip: 0 = ดาบ, 1 = เกราะ
        uint8 gearTier;     // equip: ระดับอุปกรณ์ที่ใส่
        uint16 rate;        // equip: โอกาสสำเร็จจากตารางสูตร
    }

    mapping(address => Pending) public pending;
    mapping(address => uint256) public nonce;

    /// @notice ตารางสูตรสวมใส่: key = recipeKey(...) → โอกาสสำเร็จ (0 = ไม่มีสูตรนี้)
    mapping(bytes32 => uint16) public recipeRate;

    /// @notice ผลที่จะเกิดถ้าสวมใส่สำเร็จ (ใช้ทั้งในสัญญาและให้หน้าเว็บ preview)
    struct EquipPlan {
        uint8 baseTier;
        uint8 slot;
        uint8 gearTier;
        uint8 newArmor;
        uint8 newSword;
        uint8 newRarity;
        uint16 rate;
    }

    // ---------------------------------------------------------------
    // Events / Errors
    // ---------------------------------------------------------------
    event PullRequested(address indexed player, uint256 blockNumber);
    event CraftRequested(address indexed player, uint256 burnedA, uint256 burnedB, uint8 rarity, uint256 blockNumber);
    event EquipRequested(
        address indexed player, uint256 indexed creatureId, uint256 burnedGear, uint8 slot, uint8 gearTier, uint16 rate, uint256 blockNumber
    );
    event Revealed(
        address indexed player,
        uint8 kind,
        uint256 indexed tokenId,
        uint8 itemType,
        uint8 rarity,
        bool craftSuccess,
        bool expired
    );
    event RecipeSet(uint8 baseTier, uint8 slot, uint8 gearTier, bool isUpgrade, bool fromPet, uint16 rate);

    error AlreadyPending();
    error NothingPending();
    error TooEarly(uint256 revealFromBlock);
    error SameToken();
    error NotYourItem(uint256 tokenId);
    error RarityMismatch(uint8 rarityA, uint8 rarityB);
    error MaxRarity();
    error CreatureNotCraftable(uint256 tokenId);
    error NotACreature(uint256 tokenId);
    error NotGear(uint256 tokenId);
    error NotAnUpgrade(uint8 currentTier, uint8 offeredTier);
    error NoRecipe();
    error InvalidRate();

    constructor(ERC20Burnable gem_, ItemNFT item_) Ownable(msg.sender) {
        gem = gem_;
        item = item_;
        _seedRecipes();
    }

    // ===============================================================
    // 1) สุ่มกาชา
    // ===============================================================

    /// @notice จ่าย 100 GEM เพื่อสุ่ม 1 ครั้ง (ต้อง approve GEM ให้สัญญานี้ก่อน)
    function pull() external nonReentrant {
        if (pending[msg.sender].kind != KIND_NONE) revert AlreadyPending();

        pending[msg.sender] = Pending(uint64(block.number), KIND_PULL, 0, 0, 0, 0, 0, 0, 0);
        emit PullRequested(msg.sender, block.number);

        gem.burnFrom(msg.sender, PULL_COST);
    }

    // ===============================================================
    // 2) ผสมปกติ — ระดับเดียวกัน 2 ชิ้น → เผาทั้งคู่ → mint ชิ้นใหม่
    // ===============================================================

    function craft(uint256 tokenA, uint256 tokenB) external nonReentrant {
        // CHECKS
        if (pending[msg.sender].kind != KIND_NONE) revert AlreadyPending();
        if (tokenA == tokenB) revert SameToken();
        if (item.ownerOf(tokenA) != msg.sender) revert NotYourItem(tokenA);
        if (item.ownerOf(tokenB) != msg.sender) revert NotYourItem(tokenB);

        ItemNFT.Item memory a = item.getItem(tokenA);
        ItemNFT.Item memory b = item.getItem(tokenB);
        if (a.itemType == TYPE_CREATURE) revert CreatureNotCraftable(tokenA);
        if (b.itemType == TYPE_CREATURE) revert CreatureNotCraftable(tokenB);
        if (a.rarity != b.rarity) revert RarityMismatch(a.rarity, b.rarity);
        if (a.rarity >= LEGENDARY) revert MaxRarity();

        // EFFECTS
        pending[msg.sender] = Pending(uint64(block.number), KIND_CRAFT, a.rarity, a.itemType, b.itemType, 0, 0, 0, 0);
        emit CraftRequested(msg.sender, tokenA, tokenB, a.rarity, block.number);

        // INTERACTIONS — burn ไม่มี callback ไปหาผู้เล่น
        item.burn(msg.sender, tokenA);
        item.burn(msg.sender, tokenB);
        gem.burnFrom(msg.sender, CRAFT_COST);
    }

    // ===============================================================
    // 3) สวมอุปกรณ์ (Craft-Only) — เผาอุปกรณ์ 1 ชิ้น แล้วอัปเกรดสัตว์ "ตัวเดิม"
    // ===============================================================

    /// @notice สัตว์เลี้ยง (หรือสัตว์สวมอุปกรณ์) + ดาบ/เกราะ 1 ชิ้น + 20 GEM
    ///         ล้มเหลว = เสียอุปกรณ์ แต่สัตว์ยังอยู่ครบ
    function equip(uint256 creatureId, uint256 gearId) external nonReentrant {
        // CHECKS (ทั้งหมดอยู่ใน previewEquip)
        if (pending[msg.sender].kind != KIND_NONE) revert AlreadyPending();
        EquipPlan memory p = previewEquip(msg.sender, creatureId, gearId);

        // EFFECTS
        pending[msg.sender] =
            Pending(uint64(block.number), KIND_EQUIP, 0, 0, 0, uint64(creatureId), p.slot, p.gearTier, p.rate);
        emit EquipRequested(msg.sender, creatureId, gearId, p.slot, p.gearTier, p.rate, block.number);

        // INTERACTIONS — ล็อกสัตว์ไม่ให้โอนออกไประหว่างรอผล แล้วเผาอุปกรณ์ + GEM
        item.setLocked(creatureId, true);
        item.burn(msg.sender, gearId);
        gem.burnFrom(msg.sender, EQUIP_COST);
    }

    /// @notice ตรวจว่าสวมได้ไหม และถ้าสำเร็จจะได้อะไร — revert พร้อมเหตุผลถ้าสวมไม่ได้
    function previewEquip(address player, uint256 creatureId, uint256 gearId)
        public
        view
        returns (EquipPlan memory p)
    {
        if (creatureId == gearId) revert SameToken();
        if (item.ownerOf(creatureId) != player) revert NotYourItem(creatureId);
        if (item.ownerOf(gearId) != player) revert NotYourItem(gearId);

        ItemNFT.Item memory c = item.getItem(creatureId);
        ItemNFT.Item memory g = item.getItem(gearId);
        bool fromPet = c.itemType == TYPE_PET;
        if (!fromPet && c.itemType != TYPE_CREATURE) revert NotACreature(creatureId);
        if (g.itemType != TYPE_SWORD && g.itemType != TYPE_ARMOR) revert NotGear(gearId);

        p.baseTier = fromPet ? c.rarity : c.baseTier; // สัตว์เลี้ยง: ระดับ = ชนิดสัตว์
        p.slot = g.itemType;
        p.gearTier = g.rarity;

        uint8 curArmor = fromPet ? NONE : c.armorTier;
        uint8 curSword = fromPet ? NONE : c.swordTier;
        uint8 current = p.slot == TYPE_ARMOR ? curArmor : curSword;
        bool isUpgrade = current != NONE;

        // อัปเกรดทับ: ต้องดีกว่าของเดิมเท่านั้น (ช่องอื่นไม่ถูกแตะ)
        if (isUpgrade && p.gearTier <= current) revert NotAnUpgrade(current, p.gearTier);

        p.rate = recipeRate[recipeKey(p.baseTier, p.slot, p.gearTier, isUpgrade, fromPet)];
        if (p.rate == 0) revert NoRecipe();

        p.newArmor = p.slot == TYPE_ARMOR ? p.gearTier : curArmor;
        p.newSword = p.slot == TYPE_SWORD ? p.gearTier : curSword;
        p.newRarity = _creatureRarity(p.baseTier, p.newArmor, p.newSword);
    }

    // ===============================================================
    // 4) เปิดผล — ใช้ได้กับทุกคำขอ
    // ===============================================================

    /// @dev เกิน 256 บล็อก blockhash = 0 → ได้ผลแย่สุด (กาชา = Common, ผสม/สวมใส่ = ล้มเหลว)
    function reveal() external nonReentrant returns (uint256 tokenId) {
        Pending memory p = pending[msg.sender];

        if (p.kind == KIND_NONE) revert NothingPending();
        if (block.number <= p.blockNumber) revert TooEarly(uint256(p.blockNumber) + 1);

        bytes32 bh = blockhash(p.blockNumber);
        bool expired = (bh == bytes32(0));
        uint256 seed = uint256(keccak256(abi.encode(bh, msg.sender, nonce[msg.sender])));

        // EFFECTS — ลบคำขอก่อน (กันเรียก reveal ซ้ำ)
        delete pending[msg.sender];
        nonce[msg.sender]++;

        if (p.kind == KIND_EQUIP) return _revealEquip(p, seed, expired);

        uint8 itemType;
        uint8 rarity;
        bool success;
        if (p.kind == KIND_PULL) {
            itemType = uint8((seed >> 128) % item.NUM_TYPES());
            rarity = expired ? 0 : _rollDrop(seed % 10000);
        } else {
            success = !expired && (seed % 10000) < craftSuccessRate(p.rarity);
            rarity = success ? p.rarity + 1 : p.rarity;
            itemType = (p.typeA == p.typeB || ((seed >> 128) & 1) == 0) ? p.typeA : p.typeB;
        }

        // INTERACTION — _safeMint มี callback ไปหาผู้รับ จึงอยู่ท้ายสุด (+ nonReentrant)
        tokenId = item.mint(msg.sender, itemType, rarity);
        emit Revealed(msg.sender, p.kind, tokenId, itemType, rarity, success, expired);
    }

    function _revealEquip(Pending memory p, uint256 seed, bool expired) private returns (uint256 tokenId) {
        tokenId = p.creatureId;
        bool success = !expired && (seed % 10000) < p.rate;
        ItemNFT.Item memory c = item.getItem(tokenId);

        item.setLocked(tokenId, false);

        uint8 itemType = c.itemType;
        uint8 rarity = c.rarity;
        if (success) {
            bool fromPet = c.itemType == TYPE_PET;
            uint8 base = fromPet ? c.rarity : c.baseTier;
            uint8 armor = p.slot == TYPE_ARMOR ? p.gearTier : (fromPet ? NONE : c.armorTier);
            uint8 sword = p.slot == TYPE_SWORD ? p.gearTier : (fromPet ? NONE : c.swordTier);
            itemType = TYPE_CREATURE;
            rarity = _creatureRarity(base, armor, sword);
            item.setGear(tokenId, base, armor, sword, rarity); // เขียนทับ slot เดิม — ไม่ mint ใหม่
        }
        emit Revealed(msg.sender, KIND_EQUIP, tokenId, itemType, rarity, success, expired);
    }

    // ---------------------------------------------------------------
    // ตารางสูตร (owner เพิ่ม/แก้สูตรได้โดยไม่ต้อง deploy ใหม่)
    // ---------------------------------------------------------------

    /// @param fromPet   true = สัตว์ยังเป็นสัตว์เลี้ยงธรรมดา (type 2) · false = เป็นสัตว์สวมอุปกรณ์แล้ว
    /// @param isUpgrade true = ช่องนี้มีอุปกรณ์อยู่แล้ว (อัปเกรดทับ)
    function recipeKey(uint8 baseTier, uint8 slot, uint8 gearTier, bool isUpgrade, bool fromPet)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(baseTier, slot, gearTier, isUpgrade, fromPet));
    }

    function setRecipe(uint8 baseTier, uint8 slot, uint8 gearTier, bool isUpgrade, bool fromPet, uint16 rate)
        external
        onlyOwner
    {
        _setRecipe(baseTier, slot, gearTier, isUpgrade, fromPet, rate);
    }

    function _setRecipe(uint8 baseTier, uint8 slot, uint8 gearTier, bool isUpgrade, bool fromPet, uint16 rate) private {
        if (rate > 10000) revert InvalidRate();
        recipeRate[recipeKey(baseTier, slot, gearTier, isUpgrade, fromPet)] = rate;
        emit RecipeSet(baseTier, slot, gearTier, isUpgrade, fromPet, rate);
    }

    /// @dev สูตรตาม gemforge_crafting_recipes.csv
    function _seedRecipes() private {
        uint8 S = TYPE_SWORD;
        uint8 A = TYPE_ARMOR;

        // หมวด 2: ลูกไก่ + เกราะ → พ่อไก่ใส่เกราะ (90 / 70 / 45 / 25%)
        _setRecipe(0, A, 0, false, true, 9000);
        _setRecipe(0, A, 1, false, true, 7000);
        _setRecipe(0, A, 2, false, true, 4500);
        _setRecipe(0, A, 3, false, true, 2500);

        // หมวด 3: พ่อไก่ (ใส่เกราะแล้ว) ถือดาบครั้งแรก (90 / 75 / 50 / 25%)
        _setRecipe(0, S, 0, false, false, 9000);
        _setRecipe(0, S, 1, false, false, 7500);
        _setRecipe(0, S, 2, false, false, 5000);
        _setRecipe(0, S, 3, false, false, 2500);

        // หมวด 4: อัปเกรดเกราะทับ คงดาบเดิม (โซ่ 75 / มังกร 45 / นิรันดร์ 20%)
        _setRecipe(0, A, 1, true, false, 7500);
        _setRecipe(0, A, 2, true, false, 4500);
        _setRecipe(0, A, 3, true, false, 2000);

        // อัปเกรดดาบทับ คงเกราะเดิม (ข้อตกลง #6: แบบเดียวกับเกราะ)
        _setRecipe(0, S, 1, true, false, 7500);
        _setRecipe(0, S, 2, true, false, 5000);
        _setRecipe(0, S, 3, true, false, 2500);

        // หมวด 5: สูตรลับสัตว์เลี้ยงระดับสูง
        _setRecipe(1, S, 1, false, true, 7500);  // หมาป่า + ดาบเหล็ก   → หมาป่าคาบดาบเหล็ก
        _setRecipe(1, S, 2, false, true, 4500);  // หมาป่า + ดาบเพลิง   → หมาป่าเขี้ยวอัคคี
        _setRecipe(1, S, 2, true, false, 4500);  // หมาป่าคาบดาบเหล็ก อัปเป็นดาบเพลิง
        _setRecipe(2, A, 1, false, true, 6000);  // กริฟฟิน + เกราะโซ่  → กริฟฟินหุ้มเกราะโซ่
        _setRecipe(2, A, 2, false, true, 3500);  // กริฟฟิน + เกราะมังกร → กริฟฟินเกราะเกล็ดมังกร
        _setRecipe(2, A, 2, true, false, 3500);  // กริฟฟินหุ้มเกราะโซ่ อัปเป็นเกราะมังกร
        _setRecipe(3, S, 3, false, true, 2000);  // ฟีนิกซ์ + ดาบสุริยัน → ฟีนิกซ์สุริยันนิรันดร์
    }

    // ---------------------------------------------------------------
    // View / Internal
    // ---------------------------------------------------------------

    /// @return 0 = ไม่มีคำขอ, 1 = รอบล็อกถัดไป, 2 = reveal ได้, 3 = หมดเวลา
    function revealStatus(address player) external view returns (uint8) {
        Pending memory p = pending[player];
        if (p.kind == KIND_NONE) return 0;
        if (block.number <= p.blockNumber) return 1;
        if (block.number > uint256(p.blockNumber) + 256) return 3;
        return 2;
    }

    /// @dev ระดับสัตว์สวมอุปกรณ์ = max(ชนิดสัตว์, เกราะ, ดาบ) + 1  (สูงสุด Mythic = 4)
    function _creatureRarity(uint8 base, uint8 armor, uint8 sword) private pure returns (uint8) {
        uint8 hi = base;
        if (armor != NONE && armor > hi) hi = armor;
        if (sword != NONE && sword > hi) hi = sword;
        return hi + 1;
    }

    /// @dev roll 0–9999: [0,500) Epic · [500,3000) Rare · ที่เหลือ Common
    function _rollDrop(uint256 roll) private pure returns (uint8) {
        if (roll < DROP_EPIC) return 2;
        if (roll < uint256(DROP_EPIC) + DROP_RARE) return 1;
        return 0;
    }
}
