import { createConfig, http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [hardhat, sepolia],
  connectors: [injected()],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http("https://sepolia.infura.io/v3/10cf6e9992e0469c8c2ad7ff21e88f40"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
