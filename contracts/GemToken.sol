// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  GemForge GEM — เหรียญในเกม (ERC-20)
/// @notice ได้มาจาก faucet เท่านั้น · ถูกเผาเมื่อสุ่มกาชา/ผสม (token sink)
contract GemToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant FAUCET_AMOUNT = 500 ether; // 500 GEM (18 decimals เหมือน ETH)
    uint256 public faucetCooldown = 1 days;             // owner ตั้งเป็น 0 ได้ตอนสาธิต

    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed who, uint256 amount);
    event FaucetCooldownChanged(uint256 newCooldown);

    error FaucetOnCooldown(uint256 availableAt);

    constructor() ERC20("GemForge Gem", "GEM") Ownable(msg.sender) {}

    /// @notice รับ GEM ฟรี 500 เหรียญ ทุก ๆ faucetCooldown วินาที
    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + faucetCooldown) {
            revert FaucetOnCooldown(last + faucetCooldown);
        }
        lastClaim[msg.sender] = block.timestamp; // EFFECT ก่อน
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice โหมดสาธิต: ตั้ง cooldown เป็น 0 เพื่อกดรับได้ไม่จำกัด
    function setFaucetCooldown(uint256 seconds_) external onlyOwner {
        faucetCooldown = seconds_;
        emit FaucetCooldownChanged(seconds_);
    }
}
