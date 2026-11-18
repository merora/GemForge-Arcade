// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  GemForge Marketplace — ร้านค้าซื้อขาย NFT ด้วย GEM
/// @notice แบบ escrow: ตอนวางขาย NFT จะถูกย้ายมาฝากไว้ที่สัญญานี้ → ไม่มีรายการค้างที่ขายไม่ได้จริง
///         ผู้ซื้อจ่าย GEM: 95% ไปให้ผู้ขาย · 5% ถูกเผาทิ้ง (token sink)
contract Marketplace is ReentrancyGuard {
    uint256 public constant FEE_BPS = 500; // 5%

    IERC721 public immutable item;
    ERC20Burnable public immutable gem;

    struct Listing {
        address seller; // 20 bytes
        uint96 price;   // 12 bytes → รวม 1 storage slot
    }

    mapping(uint256 => Listing) public listings;

    // รายการ tokenId ที่วางขายอยู่ (ลบแบบ swap-and-pop = O(1) ไม่มี loop บนเชน)
    uint256[] private _ids;
    mapping(uint256 => uint256) private _indexPlusOne;

    event Listed(address indexed seller, uint256 indexed tokenId, uint256 price);
    event Cancelled(address indexed seller, uint256 indexed tokenId);
    event Sold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price, uint256 feeBurned);

    error PriceOutOfRange();
    error NotListed(uint256 tokenId);
    error NotSeller(uint256 tokenId);
    error CannotBuyOwn(uint256 tokenId);

    constructor(IERC721 item_, ERC20Burnable gem_) {
        item = item_;
        gem = gem_;
    }

    /// @notice วางขาย (ต้อง setApprovalForAll ให้ร้านค้าก่อน) — ย้ายได้เฉพาะของ msg.sender เอง
    function list(uint256 tokenId, uint256 price) external nonReentrant {
        if (price == 0 || price > type(uint96).max) revert PriceOutOfRange();

        // EFFECTS
        listings[tokenId] = Listing(msg.sender, uint96(price));
        _ids.push(tokenId);
        _indexPlusOne[tokenId] = _ids.length;
        emit Listed(msg.sender, tokenId, price);

        // INTERACTION — ERC721 ตรวจเองว่า msg.sender เป็นเจ้าของ และของไม่ได้ถูกล็อก
        item.transferFrom(msg.sender, address(this), tokenId);
    }

    /// @notice ยกเลิกการขาย ของกลับไปหาผู้ขาย
    function cancel(uint256 tokenId) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (l.seller != msg.sender) revert NotSeller(tokenId);

        _remove(tokenId);
        emit Cancelled(msg.sender, tokenId);

        item.transferFrom(address(this), msg.sender, tokenId);
    }

    /// @notice ซื้อ (ต้อง approve GEM ให้ร้านค้าก่อน)
    function buy(uint256 tokenId) external nonReentrant {
        // CHECKS
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (l.seller == msg.sender) revert CannotBuyOwn(tokenId);

        // EFFECTS — ลบรายการก่อนโอนเงิน/ของ (CEI)
        _remove(tokenId);
        uint256 fee = (uint256(l.price) * FEE_BPS) / 10000;
        emit Sold(l.seller, msg.sender, tokenId, l.price, fee);

        // INTERACTIONS
        gem.burnFrom(msg.sender, fee);
        gem.transferFrom(msg.sender, l.seller, uint256(l.price) - fee);
        item.transferFrom(address(this), msg.sender, tokenId); // transferFrom ไม่มี callback
    }

    /// @notice รายการที่วางขายทั้งหมด (view = ฟรี)
    function getListings()
        external
        view
        returns (uint256[] memory ids, address[] memory sellers, uint256[] memory prices)
    {
        uint256 n = _ids.length;
        ids = new uint256[](n);
        sellers = new address[](n);
        prices = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = _ids[i];
            ids[i] = id;
            sellers[i] = listings[id].seller;
            prices[i] = listings[id].price;
        }
    }

    function _remove(uint256 tokenId) private {
        uint256 idx = _indexPlusOne[tokenId] - 1;
        uint256 last = _ids[_ids.length - 1];
        _ids[idx] = last;
        _indexPlusOne[last] = idx + 1;
        _ids.pop();
        delete _indexPlusOne[tokenId];
        delete listings[tokenId];
    }
}
