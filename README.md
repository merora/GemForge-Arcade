# GemForge Arcade — Web3 Gacha & Item Crafting

A blockchain mini-game built for **CN478 Blockchain Technology**.

Players spend **GEM** tokens (ERC-20) to pull a gacha machine and receive **item NFTs** (ERC-721).
Two items of the same rarity can be **forged** together: both are **burned forever** and a new, rarer item is **minted**.
Pets can **evolve** by wearing armor and swords, becoming secret *craft-only* creatures — up to the **Mythic** tier.
Players can trade items with each other in an on-chain **shop**, paying in GEM.

It runs in two modes:
- **LOCAL**: a Hardhat blockchain on your own computer. No MetaMask is needed, which makes it best for a live demo.
- **SEPOLIA**: the public Ethereum testnet. You sign with MetaMask, and every transaction can be checked on Etherscan.

No real money is used in either mode.

> A detailed Thai-language document covering blockchain concepts, the full game design, every file and function,
> and a step-by-step demo script is in [`SOFTWARE_ARCHITECTURE_AND_GDD.txt`](SOFTWARE_ARCHITECTURE_AND_GDD.txt).

---

## Problem: why blockchain?

In a normal gacha game, players must trust the company:

| Problem in a normal gacha game | Trust the player needs | How GemForge removes it |
|---|---|---|
| Drop rates are announced but cannot be checked | That the server does not secretly change the rates | Rates live in the contract; anyone can read the code |
| Items are rows in the company's database | That the company never deletes items, shuts down, or bans the account | Items are NFTs owned by the player's address |
| Trading between players needs a middleman | That the other side really pays or delivers | Escrow swaps payment and item in one transaction |
| The company can quietly create more rare items | That rare items are not inflated | Every mint and burn emits an event that anyone can audit |

**Why not a database?** A database is faster and cheaper, but whoever runs it can always edit the data.
We need results that players can verify without trusting anyone, so only those parts go on-chain.

### On-chain vs off-chain

| On-chain (must be verifiable) | Off-chain (display only) |
|---|---|
| GEM balances and NFT ownership | Web UI, arcade theme, emoji |
| Item data (9 bytes per item, one storage slot) | Activity Log (rebuilt from receipts and events) |
| Gacha rates, forge rates, evolve recipes | Player labels 1P / 2P / 3P |
| Pending commit–reveal requests | A display copy of the rate tables |
| Shop listings (escrow) | Private keys (held by the wallet / node) |
| Events for every action | |

We avoid storing more than needed on-chain:
- The 96 creature names are generated from the tiers when read, instead of being stored as strings.
- History comes from events, so it is never written to storage.
- Metadata is computed in `tokenURI`, so there is no IPFS dependency.

---

## Features

| Mode | What the player does | What happens on-chain |
|---|---|---|
| **INSERT COIN** | Get 500 free GEM | `GemToken.faucet()` mints 500 GEM |
| **GACHA** | Pull the machine (100 GEM) | GEM is burned, then a random item NFT is minted |
| **FORGE** | Combine 2 items of the same rarity (20 GEM) | Both NFTs are burned, a new NFT is minted (one tier up on success) |
| **EVOLVE** | Equip a pet with armor or a sword (20 GEM) | The gear NFT is burned, the pet NFT is upgraded **in place** (same token ID) |
| **SHOP** | List, cancel, or buy items | NFT is held in escrow; buyer pays seller 95%, 5% fee is burned |
| **Activity Log** | Watch every transaction | Block number, tx hash, GEM and NFT movements decoded from real receipts |

Randomness uses a **commit–reveal** scheme: every pull / forge / evolve is a two-step action
(send request → wait 1 block → press **OPEN!**), so nobody can know or cherry-pick the result in advance.

---

## Tech stack

| Layer | Tools |
|---|---|
| Smart contracts | Solidity 0.8.24, OpenZeppelin Contracts 5.0.2 (ERC20, ERC721, Ownable, ReentrancyGuard) |
| Local blockchain & tests | Hardhat 2.22, Mocha / Chai, hardhat-network-helpers |
| Frontend | React 18, Vite 5, Ethers.js 6 |

---

## Requirements

- **Node.js 18 or newer** (includes `npm`)
- A modern browser (Chrome, Edge, Firefox)

## Installation (first time only)

```bash
cd GemForge
npm install
cd frontend
npm install
cd ..
```

## Run the demo — one command

```bash
npm run demo
```

This script:
1. starts a local Hardhat blockchain at `http://127.0.0.1:8545` (a new block every 3 seconds),
2. deploys all four contracts and writes their addresses to `frontend/src/deployments.json`,
3. starts the web app and prints its URL (normally **http://localhost:5173**).

Press **Ctrl+C** to stop everything. The local chain lives in memory, so all data is reset on the next start.
If a demo is already running, `npm run demo` reuses it instead of deploying a second copy.

### How to play

1. Choose a player (**1P / 2P / 3P**) at the top right. Each one is a separate blockchain account.
2. Press **INSERT COIN** on the control deck to receive 500 GEM.
3. **GACHA** → press **PULL** → wait about 3 seconds → press **OPEN!**
4. **FORGE** → tap two items of the same rarity in the **BAG** → **FORGE** → **OPEN!**
5. **EVOLVE** → tap a pet (e.g. Chick) and a piece of gear (e.g. Leather Armor) → **EVOLVE** → **OPEN!**
6. **SHOP** → tap an item, set a price, **List**. Switch to another player to **Buy** it.
7. Watch the **BLOCKCHAIN ACTIVITY LOG** below the screen; press **COPY** to copy a full transaction hash.

---

## Play on the Sepolia testnet (MetaMask)

The contracts are deployed on **Ethereum Sepolia** (chainId 11155111):

| Contract | Address |
|---|---|
| GemToken (ERC-20) | [`0x19639f0DA4c3763BA61c6d3eD02693e59b3b4c84`](https://sepolia.etherscan.io/address/0x19639f0DA4c3763BA61c6d3eD02693e59b3b4c84) |
| ItemNFT (ERC-721) | [`0xA452BEc3171682DcFe768B9B550Bd70561Cd91fB`](https://sepolia.etherscan.io/address/0xA452BEc3171682DcFe768B9B550Bd70561Cd91fB) |
| GachaGame | [`0x3dC467D88E76472f224711366640b99439f00418`](https://sepolia.etherscan.io/address/0x3dC467D88E76472f224711366640b99439f00418) |
| Marketplace | [`0xAb06d6e5B9249DE4b6a4EF3D3B510F70255A2A73`](https://sepolia.etherscan.io/address/0xAb06d6e5B9249DE4b6a4EF3D3B510F70255A2A73) |

To play:
1. Install MetaMask and get free Sepolia ETH from a faucet (for gas).
2. Start the web app (`npm run demo`, or `cd frontend && npm run dev`).
3. In the top bar, set **NETWORK → SEPOLIA**, then press **CONNECT**. MetaMask asks to connect and to switch to Sepolia.
4. Play as usual. MetaMask asks you to confirm every transaction. A block takes about 12 seconds, so wait a little longer before **OPEN!**
5. Every transaction in the Activity Log links to Etherscan.

On Sepolia, **INSERT COIN** can be used once per day per address (faucet cooldown).

### Deploy your own copy

1. Copy `.env.example` to `.env` and set `PRIVATE_KEY` to the private key of a **test-only** wallet that holds Sepolia ETH.
   Never commit `.env` or share the key; it is already listed in `.gitignore`.
2. Run `npm run deploy:sepolia` (or `npm run deploy:base-sepolia` for the Base Sepolia Layer 2).
3. The new addresses are written to `frontend/src/deployments.json` under the chain ID, next to the local ones.

---

## Game rules (summary)

### Items — 3 gacha types × 4 rarities

| Rarity | ⚔️ Sword | 🛡️ Armor | 🐾 Pet | Power |
|---|---|---|---|---|
| Common | Wooden Sword | Leather Armor | Chick | 10 |
| Rare | Iron Sword | Chain Armor | Wolf | 25 |
| Epic | Flame Sword | Dragon Armor | Griffin | 60 |
| Legendary | Sun Sword | Eternal Armor | Phoenix | 150 |

**Mythic** exists only for evolved creatures. (Item names are displayed in Thai in the game.)

### Gacha — 100 GEM per pull
Common 70% · Rare 25% · Epic 5% · Legendary 0% (Legendary and Mythic can only be crafted). Item type is 1/3 each.

### Forge — 20 GEM
| Recipe | Success |
|---|---|
| Common + Common → Rare | 80% |
| Rare + Rare → Epic | 50% |
| Epic + Epic → Legendary | 20% |

On failure the player gets one item of the original rarity back. Same-type inputs keep the type; mixed inputs pick one of the two at random.

### Evolve — 20 GEM (craft-only creatures)
| Combination | Success rates |
|---|---|
| Chick + Armor (Leather / Chain / Dragon / Eternal) → Rooster in armor | 90 / 70 / 45 / 25% |
| Armored Rooster + Sword (Wood / Iron / Flame / Sun) | 90 / 75 / 50 / 25% |
| Rooster: armor upgrade (Chain / Dragon / Eternal), sword kept | 75 / 45 / 20% |
| Rooster: sword upgrade (Iron / Flame / Sun), armor kept | 75 / 50 / 25% |
| Wolf + Iron / Flame Sword | 75 / 45% |
| Griffin + Chain / Dragon Armor | 60 / 35% |
| Phoenix + Sun Sword | 20% |

- On failure the gear is lost but the pet is kept unchanged.
- **Rarity** = max(pet tier, armor tier, sword tier) + 1, up to Mythic (4).
- **Power** = pet power + 1.5 × armor power + 1.5 × sword power (rounded down).
- The recipe table is stored on-chain; the owner can add recipes with `setRecipe` without redeploying.

### Shop
Listing moves the NFT into the Marketplace contract (escrow). On purchase the buyer pays the price in GEM:
**95% goes to the seller, 5% is burned**, and the NFT is transferred to the buyer.

---

## Project structure

```
GemForge/
├── contracts/
│   ├── GemToken.sol            ERC-20 GEM token with faucet and burn
│   ├── ItemNFT.sol             ERC-721 items: data, names, on-chain metadata, lock
│   ├── GachaGame.sol           Game rules: pull, craft, equip, reveal, recipe table
│   ├── Marketplace.sol         Escrow shop: list, cancel, buy (5% fee burned)
│   └── test/AttackerContracts.sol   Malicious contracts used only by the tests
├── scripts/
│   ├── deploy.js               Deploys and wires the contracts, writes deployments.json
│   └── demo.js                 One-command launcher (chain + deploy + web)
├── test/GemForge.test.js       60 automated tests
├── frontend/
│   ├── index.html              Page shell and fonts
│   └── src/
│       ├── main.jsx            React entry point
│       ├── App.jsx             The whole arcade UI and all blockchain calls
│       ├── abi.js              Contract interfaces used by Ethers.js
│       ├── items.js            Item names, emojis, power formula, recipe book
│       ├── activity.js         Decodes transaction receipts for the Activity Log
│       ├── errors.js           Translates contract errors into Thai messages
│       ├── deployments.json    Contract addresses (written by deploy.js)
│       └── styles.css          Neon arcade theme
├── hardhat.config.js           Compiler and local-chain settings
├── package.json                Scripts: demo, test, compile, node, deploy:local
└── SOFTWARE_ARCHITECTURE_AND_GDD.txt   Detailed Thai documentation
```

## Smart contract API (main functions)

| Contract | Function | Purpose |
|---|---|---|
| GemToken | `faucet()` | Mint 500 GEM to the caller (cooldown configurable by owner) |
| GachaGame | `pull()` | Burn 100 GEM and register a gacha request |
| GachaGame | `craft(a, b)` | Burn two same-rarity NFTs + 20 GEM, register a forge request |
| GachaGame | `equip(creature, gear)` | Lock the creature, burn the gear + 20 GEM, register an evolve request |
| GachaGame | `previewEquip(player, creature, gear)` | Free read: success rate and resulting rarity, or the reason it is not allowed |
| GachaGame | `reveal()` | Resolve the pending request using the block hash and mint / upgrade the NFT |
| GachaGame | `setRecipe(...)` | Owner adds or changes an evolve recipe |
| ItemNFT | `getItem(id)`, `tokenURI(id)` | Read item data / on-chain JSON metadata |
| Marketplace | `list(id, price)`, `cancel(id)`, `buy(id)`, `getListings()` | Shop operations |

---

## Tests

```bash
npm test
```

60 tests in 7 groups: GemToken, ItemNFT, gacha, forge, attack tests (access control, re-roll, re-entrancy),
evolve recipes from the design spreadsheet, and the shop.

## Security analysis

Each row is a vulnerability that applies to *these* contracts, what an attacker could do without the defense,
and where the defense lives in the code.

| Vulnerability | Attack without the defense | Defense | Where in the code / test |
|---|---|---|---|
| **Re-entrancy** | `_safeMint` calls `onERC721Received` on the receiver; an attacker contract calls `pull()` again mid-reveal | `nonReentrant` on every state-changing function + Checks-Effects-Interactions (pending request is deleted before minting) | `GachaGame.sol:224`, `GachaGame.sol:252`; test `ReentrantPlayer` |
| **Bad randomness / re-roll** | An attacker contract requests and reveals in one transaction and reverts until it gets a good item | Commit–reveal: reveal must be in a later block (`TooEarly`); after 256 blocks the result is the worst outcome | `GachaGame.sol:228`, `:230`, `:351`; test `SameTxRerollAttacker` |
| **Access control** | Anyone calls `mint()` and creates Legendary items for themselves | `onlyMinter` (only `GachaGame`), `onlyOwner` for settings, custom errors | `ItemNFT.sol:66`, `:85`; `GachaGame.sol:294` |
| **Double use during evolve** | Request an evolve, then sell or transfer the creature before the reveal | Creature is locked; `_update` reverts with `ItemLocked` | `GachaGame.sol:178`; `ItemNFT.sol:145` |
| **Trade fraud** | Seller takes the money but never delivers the item | Escrow: the NFT is held by the market; payment, fee burn and delivery happen in one transaction | `Marketplace.sol:53`, `Marketplace.sol:69-83` |

Removing `nonReentrant` makes the re-entrancy test fail, which shows the tests really catch the bug.
The web app decodes every custom error into a readable message, so failed transactions are reported to the player.

Known trust that remains: the owner can change recipes and reassign the minter.
A production system should hand ownership to a multisig or renounce it.

## Troubleshooting

| Problem | Fix |
|---|---|
| Screen shows **NO SIGNAL** | The local chain is not running — run `npm run demo` |
| Screen shows **NO CARTRIDGE** | Contracts are not deployed — run `npm run demo` and refresh |
| Bag is empty after restarting | Expected: the local chain starts fresh every time |
| Web opens on port 5174 | Port 5173 is already in use (another dev server is running) |
| `OPEN!` is disabled | Wait for the next block (about 3 seconds) |

## Limitations

- Testnet only: deployed on Sepolia and on a local chain, not on mainnet.
- The contracts' source code is not yet verified on Etherscan, so Etherscan shows only bytecode.
- Block-hash randomness is fine for a demo but can be influenced by block producers; production would use Chainlink VRF.
- The Activity Log is kept in the browser only and resets when the page is refreshed.

## Layer 1 vs Layer 2

| | Layer 1 (Ethereum) | Layer 2 rollup (Arbitrum, Optimism, zkSync, Base) |
|---|---|---|
| Where transactions run | Directly on Ethereum | Off L1; compressed data is posted back to L1 |
| Security | Ethereum's own consensus | Inherited from L1 (fraud proofs or validity proofs) |
| Gas cost | High and volatile | Typically tens of times cheaper or more |
| Confirmation time | ~12 s per block | Sub-second to ~2 s |
| Withdrawing to L1 | — | Optimistic rollups: ~7-day challenge period; ZK rollups: faster |

Gas used by our contracts, measured on Hardhat:

| Function | Gas used |
|---|---|
| `faucet` | 42,369 |
| `pull` | 66,127 |
| `reveal` (pull) | 123,070 |
| `craft` | 110,156 |
| `reveal` (craft) | 122,434 |
| `equip` | 131,412 |
| `reveal` (equip) | 78,470 |
| `list` | 160,486 |
| `buy` | 97,131 |

One gacha pull is two transactions, about 189,000 gas in total.
At an example gas price of 10 gwei, that is about 0.0019 ETH per pull. Real gas prices change constantly.
A game makes many small, frequent transactions, so it fits Layer 2 better.
The contracts are plain EVM code, so they deploy to an EVM Layer 2 without changes.

## Lessons learned

- **On-chain randomness is hard.** Everything on-chain is public and a transaction can revert, so we needed commit–reveal.
- **Every byte costs gas.** Item data is packed into one storage slot, names are generated instead of stored, and history comes from events.
- **Tests must attack.** Writing real attacker contracts is what proved the defenses work.
- **An economy needs sinks.** If GEM is minted by the faucet, it must also be burned, or it inflates.
- **UX matters as much as the contract.** Errors must be translated and receipts shown, so players understand what happened on-chain.
- **Blockchain is not the answer to everything.** It is slower and more expensive than a database, so we use it only where trust is needed.

## AI usage disclosure

This project was developed with help from an AI coding assistant (Claude by Anthropic), as allowed by the course policy.
The AI helped write the smart contracts, tests, web app, documentation and presentation slides, based on the game design,
recipe spreadsheet and requirements written by the group.
Group members reviewed, ran and tested all code, and are able to explain every part of it.

<!-- Group: edit this section to describe exactly which parts each member wrote, reviewed or changed. -->
