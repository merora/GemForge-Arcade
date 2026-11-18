// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title  GemForge ItemNFT — ไอเทมในเกม (ERC-721)
/// @notice ไอเทมทั่วไป (ดาบ/เกราะ/สัตว์เลี้ยง) ได้จากกาชาและการผสม
///         "สัตว์สวมอุปกรณ์" (type 3, Craft-Only) เกิดจากการเอาสัตว์เลี้ยงมาสวมเกราะ/ดาบ
///         — อัปเกรดในตัวเดิม (tokenId ไม่เปลี่ยน) เก็บสถานะอุปกรณ์ไว้ใน struct เดียว (1 storage slot)
///         มีเพียง minter (GachaGame) ที่ mint / burn / อัปเกรด / ล็อกได้
contract ItemNFT is ERC721, Ownable {
    using Strings for uint256;

    // ---------------------------------------------------------------
    // ค่าคงที่
    // ---------------------------------------------------------------
    uint8 public constant NUM_TYPES = 3; // ประเภทที่ได้จากกาชา
    uint8 public constant TYPE_SWORD = 0;
    uint8 public constant TYPE_ARMOR = 1;
    uint8 public constant TYPE_PET = 2;
    uint8 public constant TYPE_CREATURE = 3; // สัตว์สวมอุปกรณ์ (Craft-Only)

    uint8 public constant MAX_RARITY = 3; // สูงสุดของไอเทมทั่วไป = Legendary
    uint8 public constant MYTHIC = 4;     // มีเฉพาะสัตว์สวมอุปกรณ์
    uint8 public constant NONE = 255;     // ช่องอุปกรณ์ว่าง

    // ---------------------------------------------------------------
    // State — struct ทั้งก้อน 9 bytes อยู่ใน storage slot เดียว (32 bytes)
    // ---------------------------------------------------------------
    struct Item {
        uint8 itemType;  // 0 ดาบ · 1 เกราะ · 2 สัตว์เลี้ยง · 3 สัตว์สวมอุปกรณ์
        uint8 rarity;    // 0 Common · 1 Rare · 2 Epic · 3 Legendary · 4 Mythic
        uint32 serial;   // ลำดับที่ของชนิดนั้น เช่น "ดาบไม้ #27"
        uint8 baseTier;  // type 3: ชนิดสัตว์ตั้งต้น 0 ลูกไก่→พ่อไก่ · 1 หมาป่า · 2 กริฟฟิน · 3 ฟีนิกซ์
        uint8 armorTier; // type 3: ระดับเกราะที่สวม 0–3 หรือ NONE
        uint8 swordTier; // type 3: ระดับดาบที่ถือ 0–3 หรือ NONE
    }

    mapping(uint256 => Item) private _items;
    mapping(uint8 => mapping(uint8 => uint32)) public mintedCount; // serial ไอเทมทั่วไป ต่อ (ประเภท, ระดับ)
    mapping(uint8 => uint32) public creatureCount;                  // serial สัตว์สวมอุปกรณ์ ต่อชนิดสัตว์
    mapping(uint256 => bool) public locked;                         // ล็อกระหว่างรอเปิดผลการสวมใส่

    uint256 private _nextTokenId = 1;
    address public minter;

    // ---------------------------------------------------------------
    // Events / Errors
    // ---------------------------------------------------------------
    event MinterChanged(address indexed oldMinter, address indexed newMinter);
    event ItemMinted(address indexed to, uint256 indexed tokenId, uint8 itemType, uint8 rarity, uint32 serial);
    event ItemBurned(address indexed from, uint256 indexed tokenId, uint8 itemType, uint8 rarity);
    event ItemUpgraded(uint256 indexed tokenId, uint8 rarity, uint8 baseTier, uint8 armorTier, uint8 swordTier, uint32 serial);
    event LockChanged(uint256 indexed tokenId, bool locked);

    error NotMinter(address caller);
    error InvalidItem(uint8 itemType, uint8 rarity);
    error InvalidGear();
    error NotTokenOwner(uint256 tokenId, address expectedOwner);
    error ItemLocked(uint256 tokenId);
    error ZeroAddress();

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter(msg.sender);
        _;
    }

    constructor() ERC721("GemForge Item", "GFI") Ownable(msg.sender) {}

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------
    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        emit MinterChanged(minter, newMinter);
        minter = newMinter;
    }

    // ---------------------------------------------------------------
    // Mint / Burn — ไอเทมทั่วไปเท่านั้น (สัตว์สวมอุปกรณ์เกิดจาก setGear)
    // ---------------------------------------------------------------
    function mint(address to, uint8 itemType, uint8 rarity) external onlyMinter returns (uint256 tokenId) {
        // CHECKS
        if (itemType >= NUM_TYPES || rarity > MAX_RARITY) revert InvalidItem(itemType, rarity);

        // EFFECTS
        tokenId = _nextTokenId++;
        uint32 serial = ++mintedCount[itemType][rarity];
        _items[tokenId] = Item(itemType, rarity, serial, rarity, NONE, NONE);
        emit ItemMinted(to, tokenId, itemType, rarity, serial);

        // INTERACTION — _safeMint มี callback ไปหาผู้รับ จึงอยู่ท้ายสุด
        _safeMint(to, tokenId);
    }

    function burn(address from, uint256 tokenId) external onlyMinter {
        if (ownerOf(tokenId) != from) revert NotTokenOwner(tokenId, from);
        Item memory it = _items[tokenId];
        delete _items[tokenId];
        _burn(tokenId); // ถ้าถูกล็อกอยู่ _update จะ revert
        emit ItemBurned(from, tokenId, it.itemType, it.rarity);
    }

    // ---------------------------------------------------------------
    // อัปเกรดในตัวเดิม — เขียน slot เดิมซ้ำ ถูกกว่า burn + mint ใหม่มาก
    // ---------------------------------------------------------------

    /// @notice เปลี่ยนสัตว์เลี้ยงเป็นสัตว์สวมอุปกรณ์ หรืออัปเดตอุปกรณ์ของตัวเดิม (tokenId เดิม เจ้าของเดิม)
    function setGear(uint256 tokenId, uint8 baseTier, uint8 armorTier, uint8 swordTier, uint8 rarity)
        external
        onlyMinter
    {
        _requireOwned(tokenId);
        if (
            baseTier > MAX_RARITY || rarity > MYTHIC || (armorTier > MAX_RARITY && armorTier != NONE)
                || (swordTier > MAX_RARITY && swordTier != NONE)
        ) revert InvalidGear();

        Item storage it = _items[tokenId];
        if (it.itemType != TYPE_CREATURE) {
            // แปลงร่างครั้งแรก: ลูกไก่ → พ่อไก่ ฯลฯ ได้ serial ใหม่ของสัตว์สวมอุปกรณ์
            it.itemType = TYPE_CREATURE;
            it.serial = ++creatureCount[baseTier];
        }
        it.rarity = rarity;
        it.baseTier = baseTier;
        it.armorTier = armorTier;
        it.swordTier = swordTier;
        emit ItemUpgraded(tokenId, rarity, baseTier, armorTier, swordTier, it.serial);
    }

    /// @notice ล็อกไม่ให้โอน/เผา ระหว่างรอเปิดผล (กันโอนสัตว์ออกไปกลางทาง — W9 half-finished state)
    function setLocked(uint256 tokenId, bool value) external onlyMinter {
        _requireOwned(tokenId);
        locked[tokenId] = value;
        emit LockChanged(tokenId, value);
    }

    /// @dev hook ของ OpenZeppelin ที่ทำงานทุกครั้งที่ mint / transfer / burn
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && locked[tokenId]) revert ItemLocked(tokenId);
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------
    // View
    // ---------------------------------------------------------------
    function getItem(uint256 tokenId) external view returns (Item memory) {
        _requireOwned(tokenId);
        return _items[tokenId];
    }

    function rarityOf(uint256 tokenId) external view returns (uint8) {
        _requireOwned(tokenId);
        return _items[tokenId].rarity;
    }

    function typeOf(uint256 tokenId) external view returns (uint8) {
        _requireOwned(tokenId);
        return _items[tokenId].itemType;
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /// @notice metadata แบบ on-chain (JSON ใน data URI)
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Item memory it = _items[tokenId];
        string memory serialStr = uint256(it.serial).toString();

        string memory attrs = string.concat(
            '[{"trait_type":"Type","value":"', _typeName(it.itemType), '"},',
            '{"trait_type":"Rarity","value":"', _rarityName(it.rarity), '"},',
            '{"trait_type":"Serial","display_type":"number","value":', serialStr, "}"
        );
        if (it.itemType == TYPE_CREATURE) {
            attrs = string.concat(
                attrs,
                ',{"trait_type":"Armor","value":"', _gearName(TYPE_ARMOR, it.armorTier), '"}',
                ',{"trait_type":"Sword","value":"', _gearName(TYPE_SWORD, it.swordTier), '"}'
            );
        }

        string memory json = string.concat(
            '{"name":"', _displayName(it), " #", serialStr,
            '","description":"GemForge item - CN478 Blockchain demo","attributes":', attrs, "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ---------------------------------------------------------------
    // ชื่อสำหรับแสดงผล (หน้าเว็บใช้ชุดเดียวกันใน frontend/src/items.js)
    // ---------------------------------------------------------------
    function _displayName(Item memory it) internal pure returns (string memory) {
        if (it.itemType != TYPE_CREATURE) return _itemName(it.itemType, it.rarity);
        return _creatureName(it.baseTier, it.armorTier, it.swordTier);
    }

    function _creatureName(uint8 b, uint8 a, uint8 s) internal pure returns (string memory) {
        // ชื่อพิเศษตามสูตรลับ (CSV หมวด 5)
        if (b == 1 && a == NONE && s == 1) return unicode"หมาป่าคาบดาบเหล็ก";
        if (b == 1 && a == NONE && s == 2) return unicode"หมาป่าเขี้ยวอัคคี";
        if (b == 2 && a == 1 && s == NONE) return unicode"กริฟฟินหุ้มเกราะโซ่";
        if (b == 2 && a == 2 && s == NONE) return unicode"กริฟฟินเกราะเกล็ดมังกร";
        if (b == 3 && a == NONE && s == 3) return unicode"ฟีนิกซ์สุริยันนิรันดร์";

        // ชื่อประกอบ: พ่อไก่ + ใส่<เกราะ> + ถือ<ดาบ>
        bool emperor = b == 0 && a == 3;
        string memory n = b == 0 ? (emperor ? unicode"พ่อไก่จักรพรรดิ" : unicode"พ่อไก่") : _itemName(TYPE_PET, b);
        if (a != NONE) n = string.concat(n, emperor ? "" : unicode"ใส่", _itemName(TYPE_ARMOR, a));
        if (s != NONE) n = string.concat(n, unicode"ถือ", _itemName(TYPE_SWORD, s));
        return n;
    }

    function _itemName(uint8 t, uint8 r) internal pure returns (string memory) {
        if (t == TYPE_SWORD) return _pick(r, unicode"ดาบไม้", unicode"ดาบเหล็ก", unicode"ดาบเพลิง", unicode"ดาบสุริยัน");
        if (t == TYPE_ARMOR) return _pick(r, unicode"เกราะหนัง", unicode"เกราะโซ่", unicode"เกราะมังกร", unicode"เกราะนิรันดร์");
        return _pick(r, unicode"ลูกไก่", unicode"หมาป่า", unicode"กริฟฟิน", unicode"ฟีนิกซ์");
    }

    function _gearName(uint8 t, uint8 tier) internal pure returns (string memory) {
        return tier == NONE ? "-" : _itemName(t, tier);
    }

    function _typeName(uint8 t) internal pure returns (string memory) {
        if (t == TYPE_SWORD) return "Sword";
        if (t == TYPE_ARMOR) return "Armor";
        if (t == TYPE_PET) return "Pet";
        return "Creature";
    }

    function _rarityName(uint8 r) internal pure returns (string memory) {
        if (r == MYTHIC) return "Mythic";
        return _pick(r, "Common", "Rare", "Epic", "Legendary");
    }

    function _pick(uint8 i, string memory a, string memory b, string memory c, string memory d)
        private
        pure
        returns (string memory)
    {
        if (i == 0) return a;
        if (i == 1) return b;
        if (i == 2) return c;
        return d;
    }
}
