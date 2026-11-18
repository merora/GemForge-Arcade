// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// สัญญาผู้โจมตีสำหรับ test เท่านั้น — ไม่ได้ deploy จริง (scripts/deploy.js ไม่ได้ใช้)
// ใช้พิสูจน์ว่าการป้องกันใน GachaGame ได้ผลจริง (W9: "Tests that attack")

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IGacha {
    function pull() external;
    function reveal() external returns (uint256);
}

interface IFaucet {
    function faucet() external;
}

/// @notice ผู้เล่นที่เป็นสัญญา — ตอนได้รับ NFT (callback จาก _safeMint) จะพยายามเรียกเกมซ้ำ (re-entrancy)
contract ReentrantPlayer is IERC721Receiver {
    IGacha public immutable game;
    bool private armed;
    uint256 public reentryAttempts;
    uint256 public reentrySucceeded;

    constructor(address game_, address gem_) {
        game = IGacha(game_);
        IFaucet(gem_).faucet();
        IERC20(gem_).approve(game_, type(uint256).max);
    }

    function doPull() external {
        game.pull();
    }

    function doReveal() external {
        armed = true;
        game.reveal();
        armed = false;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (armed) {
            armed = false;
            reentryAttempts++;
            // ตอนนี้ pending ถูกลบไปแล้ว — ถ้าไม่มี nonReentrant การ pull ซ้ำกลางทางจะสำเร็จ
            try game.pull() {
                reentrySucceeded++;
            } catch {}
        }
        return this.onERC721Received.selector;
    }
}

/// @notice พยายาม pull + reveal ในธุรกรรมเดียว เพื่อรู้ผลทันทีแล้ว revert ถ้าไม่ชอบ
contract SameTxRerollAttacker is IERC721Receiver {
    IGacha public immutable game;

    constructor(address game_, address gem_) {
        game = IGacha(game_);
        IFaucet(gem_).faucet();
        IERC20(gem_).approve(game_, type(uint256).max);
    }

    function pullAndRevealNow() external {
        game.pull();
        game.reveal(); // ต้อง revert ด้วย TooEarly
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
