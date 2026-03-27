// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { VRFCoordinatorV2_5Mock } from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

contract MockVRFCoordinator is VRFCoordinatorV2_5Mock {
    constructor()
        VRFCoordinatorV2_5Mock(
            0,
            0,
            1000000000000000000
        )
    {}

    // 保留原项目里的手动 fulfill 体验，但底层走官方 v2.5 mock
    function fulfillRequest(uint256 requestId, address consumer, uint256 randomWord) external {
        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;
        fulfillRandomWordsWithOverride(requestId, consumer, words);
    }
}
