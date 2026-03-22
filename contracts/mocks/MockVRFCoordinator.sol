// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external;
}

contract MockVRFCoordinator {
    // ⚠️ 必须与 MoneyMoneyCome.sol 里的接口定义完全一致，否则函数选择器不同会 revert
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16  requestConfirmations;
        uint32  callbackGasLimit;
        uint32  numWords;
        bytes   extraArgs;
    }

    uint256 private _nextRequestId = 1;

    // requestId → consumer 合约地址
    mapping(uint256 => address) public pendingRequests;

    // ✅ 接受 struct，与主合约 IVRFCoordinatorV2Plus 接口匹配
    function requestRandomWords(RandomWordsRequest calldata /* req */) external returns (uint256 requestId) {
        requestId = _nextRequestId++;
        pendingRequests[requestId] = msg.sender;
    }

    // 测试时手动调用，模拟 Chainlink 随机数回调
    // randomWord 传什么数字就用什么数字当随机数
    function fulfillRequest(uint256 requestId, uint256 randomWord) external {
        address consumer = pendingRequests[requestId];
        require(consumer != address(0), "MockVRF: unknown request");

        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;

        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
        delete pendingRequests[requestId];
    }
}
