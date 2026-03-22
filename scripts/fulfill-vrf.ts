/**
 * Fulfill the latest VRF draw request without using console.
 *
 * Usage:
 *   npx hardhat run scripts/fulfill-vrf.ts --network localhost
 *
 * Optional env vars:
 *   RANDOM_WORD=42
 *   REQUEST_ID=1        // if provided, uses this requestId directly
 */
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { viem } = await network.connect();

const DRAW_REQUESTED_ABI = [
  {
    type: "event",
    name: "DrawRequested",
    inputs: [
      { indexed: true, name: "roundId", type: "uint256" },
      { indexed: false, name: "requestId", type: "uint256" },
    ],
  },
] as const;

async function main() {
  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Please deploy first: npx hardhat run scripts/deploy.ts --network localhost");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const mmcAddress = addresses["31337"]?.mmc as `0x${string}` | undefined;
  const vrfAddress = addresses["31337"]?.mockVRF as `0x${string}` | undefined;

  if (!mmcAddress || !vrfAddress) {
    console.error("Missing mmc/mockVRF address in frontend/lib/addresses.json");
    process.exit(1);
  }

  const randomWord = process.env.RANDOM_WORD ? BigInt(process.env.RANDOM_WORD) : 42n;
  const requestIdFromEnv = process.env.REQUEST_ID ? BigInt(process.env.REQUEST_ID) : null;

  let requestId: bigint;
  if (requestIdFromEnv !== null) {
    requestId = requestIdFromEnv;
  } else {
    const publicClient = await viem.getPublicClient();
    const events = await publicClient.getContractEvents({
      address: mmcAddress,
      abi: DRAW_REQUESTED_ABI,
      eventName: "DrawRequested",
      fromBlock: 0n,
      toBlock: "latest",
      strict: true,
    });
    if (events.length === 0) {
      console.error("No DrawRequested event found. Run run-draw.ts first.");
      process.exit(1);
    }
    requestId = events[events.length - 1].args.requestId;
  }

  const mockVRF = await viem.getContractAt("MockVRFCoordinator", vrfAddress);
  await mockVRF.write.fulfillRequest([requestId, randomWord]);
  console.log(`fulfillRequest success. requestId=${requestId.toString()} randomWord=${randomWord.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

