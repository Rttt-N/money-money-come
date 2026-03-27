# MoneyMoneyCome Architecture

This document gives a high-level view of how the `money-money-come` project is structured and how data moves between the frontend, smart contracts, and local development helpers.

## System Overview

```mermaid
flowchart LR
    U[User<br/>Wallet / MetaMask]
    FE[Next.js Frontend<br/>App Router + wagmi + viem]
    HOOKS[Frontend Hooks<br/>useUserInfo / useRoundInfo / useSquad]
    ADDR[Contract Config<br/>ABI + addresses.json]

    MMC[MoneyMoneyCome<br/>Main Game Contract]
    VAULT[YieldVault<br/>ERC4626 Wrapper]
    NFT[TicketNFT<br/>ERC721 Round Ticket]
    SQUAD[SquadRegistry<br/>Squad Membership + Prize Split]
    USDC[MockUSDC<br/>Local Stablecoin]
    AAVE[MockAavePool + MockAToken<br/>Local Yield Source]
    VRF[Chainlink VRF v2.5 Mock<br/>Randomness Provider]

    SCRIPTS[Hardhat Scripts<br/>deploy / mint-usdc / run-draw]
    TESTS[Hardhat + Foundry Tests]

    U <--> FE
    FE --> HOOKS
    HOOKS --> ADDR
    HOOKS --> MMC
    HOOKS --> USDC
    HOOKS --> NFT
    HOOKS --> SQUAD

    U -->|approve USDC| USDC
    U -->|enterGame / withdraw| MMC

    MMC -->|transferFrom / transfer| USDC
    MMC -->|deposit / redeem| VAULT
    VAULT -->|supply / withdraw| AAVE
    AAVE -->|asset growth| VAULT

    MMC -->|mint / burn tickets| NFT
    MMC -->|validate squad / split prize| SQUAD
    MMC -->|request randomness| VRF
    VRF -->|fulfill random words| MMC

    SCRIPTS --> MMC
    SCRIPTS --> USDC
    SCRIPTS --> VRF
    SCRIPTS --> ADDR
    TESTS --> MMC
    TESTS --> VAULT
    TESTS --> NFT
    TESTS --> SQUAD
    TESTS --> USDC
    TESTS --> VRF
```

## Main Responsibilities

- `frontend/`: user interface, wallet connection, contract reads/writes, and display of rounds, deposits, squads, and withdrawals.
- `contracts/MoneyMoneyCome.sol`: core game logic for deposits, round lifecycle, yield harvesting, winner selection, and payouts.
- `contracts/YieldVault.sol`: vault layer that holds user funds and routes them into the Aave-like pool.
- `contracts/TicketNFT.sol`: NFT receipt for participation in a round.
- `contracts/SquadRegistry.sol`: team membership and squad payout calculation.
- `contracts/mocks/`: local-only mocks for USDC, Aave, and a wrapper around Chainlink's VRF v2.5 mock.
- `scripts/`: local development and demo helpers.
- `test/`: automated verification for the main protocol flow.

## Runtime Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant USDC
    participant MMC as MoneyMoneyCome
    participant Vault as YieldVault
    participant Aave as MockAavePool
    participant VRF as Chainlink VRF v2.5 Mock
    participant NFT as TicketNFT
    participant Squad as SquadRegistry

    User->>Frontend: Connect wallet and choose tier/amount
    Frontend->>USDC: approve(MMC, amount)
    Frontend->>MMC: enterGame(amount, tier, squadId)
    MMC->>USDC: transferFrom(user, MMC, amount)
    MMC->>Vault: deposit(amount, MMC)
    Vault->>Aave: supply(USDC)
    MMC->>NFT: mint(user, roundId, tier data, weight)
    MMC->>Squad: validate optional squad membership

    Note over Aave,Vault: Yield accumulates over time

    Frontend->>MMC: checkUpkeep() / performUpkeep()
    MMC->>Vault: redeem interest portion during harvest
    MMC->>VRF: requestRandomWords()
    VRF-->>MMC: fulfillRandomWords(requestId, randomWords)
    MMC->>Squad: calcSquadPrize(...) if winner is in squad
    MMC->>USDC: transfer prize to winner and squad members
    MMC->>NFT: mint rollover tickets for next round
```

## Folder Map

```text
money-money-come/
|- contracts/              Solidity contracts
|  |- MoneyMoneyCome.sol   Main protocol logic
|  |- YieldVault.sol       ERC4626 yield vault
|  |- TicketNFT.sol        Participation NFT
|  |- SquadRegistry.sol    Squad management and prize split
|  |- mocks/               Local mock dependencies
|- test/                   Hardhat TypeScript tests
|- scripts/                Local deploy and simulation scripts
|- frontend/               Next.js app
|  |- app/                 Pages
|  |- hooks/               Contract read/write hooks
|  |- lib/                 ABI, wagmi config, deployed addresses
|  |- components/          Reusable UI pieces
|- hardhat.config.ts       Backend toolchain config
|- README.md               Setup and local run guide
```
```mermaid
flowchart TB

    subgraph L1["Presentation Layer"]
        direction LR
        U[User]
        FE[Next.js Frontend]
        UI[Dashboard / Play / Squads / UI Components]
        U --> FE --> UI
    end

    subgraph L2["Application Layer"]
        direction LR
        APP["wagmi + viem + hooks + contracts.ts + addresses.json"]
    end

    subgraph L3["Blockchain Layer"]
        direction LR
        MMC["MoneyMoneyCome.sol - Main Game Contract"]
        YV["YieldVault.sol - ERC4626 Wrapper"]
        NFT["TicketNFT.sol - Round Ticket NFT"]
        SQ["SquadRegistry.sol - Squad Management"]
    end

    subgraph L4["External Protocol Services Layer"]
        direction LR
        WALLET[Wallet Provider]
        CHAIN[Local Hardhat or Test Network]
        USDC[USDC Token]
        AAVE[Aave Pool / Yield Source]
        VRF[VRF Randomness]
    end

    subgraph L5["Testing and Simulation"]
        direction LR
        MOCKS["MockUSDC + MockAavePool + Chainlink VRF v2.5 Mock"]
    end

    FE --> APP
    APP --> WALLET
    APP --> CHAIN

    APP --> MMC
    APP --> YV
    APP --> NFT
    APP --> SQ

    MMC --> YV
    MMC --> NFT
    MMC --> SQ

    MMC --> USDC
    YV --> AAVE
    MMC --> VRF

    MOCKS -.-> USDC
    MOCKS -.-> AAVE
    MOCKS -.-> VRF

    classDef presentation fill:#E3F2FD,stroke:#1E88E5,stroke-width:2px,color:#0D47A1;
    classDef application fill:#E8F5E9,stroke:#43A047,stroke-width:2px,color:#1B5E20;
    classDef blockchain fill:#F3E5F5,stroke:#8E24AA,stroke-width:2px,color:#4A148C;
    classDef external fill:#FFF3E0,stroke:#FB8C00,stroke-width:2px,color:#E65100;
    classDef testing fill:#FCE4EC,stroke:#D81B60,stroke-width:2px,color:#880E4F;

    class U,FE,UI presentation;
    class APP application;
    class MMC,YV,NFT,SQ blockchain;
    class WALLET,CHAIN,USDC,AAVE,VRF external;
    class MOCKS testing;
```
