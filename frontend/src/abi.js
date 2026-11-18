// Human-readable ABI ของ Ethers.js — เขียนเฉพาะฟังก์ชัน/event/error ที่หน้าเว็บใช้
// error ต้องใส่ไว้ด้วย เพื่อให้ถอดชื่อ error ตอนธุรกรรม revert ได้

const ERC20_ERRORS = [
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
];

const ERC721_ERRORS = [
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  "error NotMinter(address caller)",
  "error NotTokenOwner(uint256 tokenId, address expectedOwner)",
  "error ItemLocked(uint256 tokenId)",
  "error InvalidGear()",
];

const ITEM_TUPLE = "tuple(uint8 itemType, uint8 rarity, uint32 serial, uint8 baseTier, uint8 armorTier, uint8 swordTier)";

export const GEM_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function faucet()",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "error FaucetOnCooldown(uint256 availableAt)",
  ...ERC20_ERRORS,
];

export const ITEM_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  `function getItem(uint256 tokenId) view returns (${ITEM_TUPLE})`,
  "function locked(uint256 tokenId) view returns (bool)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ...ERC721_ERRORS,
];

export const GAME_ABI = [
  "function pull()",
  "function craft(uint256 tokenA, uint256 tokenB)",
  "function equip(uint256 creatureId, uint256 gearId)",
  "function reveal() returns (uint256)",
  "function revealStatus(address player) view returns (uint8)",
  "function pending(address player) view returns (uint64 blockNumber, uint8 kind, uint8 rarity, uint8 typeA, uint8 typeB, uint64 creatureId, uint8 slot, uint8 gearTier, uint16 rate)",
  "function previewEquip(address player, uint256 creatureId, uint256 gearId) view returns (tuple(uint8 baseTier, uint8 slot, uint8 gearTier, uint8 newArmor, uint8 newSword, uint8 newRarity, uint16 rate))",
  "event Revealed(address indexed player, uint8 kind, uint256 indexed tokenId, uint8 itemType, uint8 rarity, bool craftSuccess, bool expired)",
  "error AlreadyPending()",
  "error NothingPending()",
  "error TooEarly(uint256 revealFromBlock)",
  "error SameToken()",
  "error NotYourItem(uint256 tokenId)",
  "error RarityMismatch(uint8 rarityA, uint8 rarityB)",
  "error MaxRarity()",
  "error CreatureNotCraftable(uint256 tokenId)",
  "error NotACreature(uint256 tokenId)",
  "error NotGear(uint256 tokenId)",
  "error NotAnUpgrade(uint8 currentTier, uint8 offeredTier)",
  "error NoRecipe()",
  "error ReentrancyGuardReentrantCall()",
  ...ERC20_ERRORS,
  ...ERC721_ERRORS,
];

export const MARKET_ABI = [
  "function list(uint256 tokenId, uint256 price)",
  "function cancel(uint256 tokenId)",
  "function buy(uint256 tokenId)",
  "function getListings() view returns (uint256[] ids, address[] sellers, uint256[] prices)",
  "event Listed(address indexed seller, uint256 indexed tokenId, uint256 price)",
  "event Cancelled(address indexed seller, uint256 indexed tokenId)",
  "event Sold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price, uint256 feeBurned)",
  "error PriceOutOfRange()",
  "error NotListed(uint256 tokenId)",
  "error NotSeller(uint256 tokenId)",
  "error CannotBuyOwn(uint256 tokenId)",
  "error ReentrancyGuardReentrantCall()",
  ...ERC20_ERRORS,
  ...ERC721_ERRORS,
];
