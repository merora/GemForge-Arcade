// Deploy ทั้ง 4 สัญญา (GemToken, ItemNFT, GachaGame, Marketplace) + ตั้งค่า
// แล้วเขียน address ลง frontend/src/deployments.json
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const deployBlock = await ethers.provider.getBlockNumber();
  console.log(`Deployer: ${deployer.address}  chainId: ${chainId}`);

  const gem = await (await ethers.getContractFactory("GemToken")).deploy();
  await gem.waitForDeployment();
  console.log("GemToken :", gem.target);

  const item = await (await ethers.getContractFactory("ItemNFT")).deploy();
  await item.waitForDeployment();
  console.log("ItemNFT  :", item.target);

  const game = await (await ethers.getContractFactory("GachaGame")).deploy(gem.target, item.target);
  await game.waitForDeployment();
  console.log("GachaGame:", game.target);

  const market = await (await ethers.getContractFactory("Marketplace")).deploy(item.target, gem.target);
  await market.waitForDeployment();
  console.log("Market   :", market.target);

  // สำคัญ: ให้ GachaGame เป็นผู้เดียวที่ mint/burn NFT ได้
  await (await item.setMinter(game.target)).wait();
  console.log("setMinter -> GachaGame ✓");

  // เชนจำลอง: ปิด cooldown ของ faucet เพื่อให้ทดลองได้สะดวก
  if (chainId === 31337n) {
    await (await gem.setFaucetCooldown(0)).wait();
    console.log("faucet cooldown = 0 (demo mode) ✓");
  }

  const file = path.join(__dirname, "..", "frontend", "src", "deployments.json");
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all[chainId.toString()] = {
    gem: gem.target,
    item: item.target,
    game: game.target,
    market: market.target,
    deployBlock,
  };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
  console.log(`เขียน address ลง ${path.relative(process.cwd(), file)} แล้ว`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
