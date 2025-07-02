import { createPool, createPoolInstruction } from "./src/dbc/create-pool"
import { createConfig } from "./src/dbc/create-config"
import { writeFileSync } from "fs";
import { PublicKey } from "@solana/web3.js"
import { VersionedTransaction } from "@solana/web3.js"
import { BUNDLER_TOTAL_FUND_AMOUNT, BUNDLER_WALLET_NUM, BUNDLER_WALLET_SOURCE, connection, JITO_FEE, MAIN_KP } from "./config"
import { TransactionMessage } from "@solana/web3.js"
import { Keypair } from "@solana/web3.js"
import base58 from "bs58"
import { distributeSol, readJson, saveDataToFile, splitAmount } from "./utils";
import { executeJitoTx, sendBundleByScript } from "./executor/jito";
import { getSwapInstructions, getSwapBuyInstructions, swapBuy, buyTx, sellTx } from "./src/dbc/swap";
import { createAndSendV0Tx, sleep } from "./executor/legacy";
import { addAddressesToTable, createLUT } from "./lut/createLut";
import { TransactionInstruction } from "@solana/web3.js";
import { AddressLookupTableProgram } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { BN as BigNumber } from 'bn.js';
import { sendBundleByLilJit } from "./executor/liljit";

const main = async () => {
  const transactions: VersionedTransaction[] = []
  // Step 1: Generate Mint Keypair
  const mintKp = Keypair.generate();

  // Step 2: Create Token
  const { instructions: creationInstructions, poolId } = await createPoolInstruction(configAddress, mintKp);

  // Step 3: Create Lookup Table (LUT)
  const lutAddress = await createLUT();
  if (!lutAddress) throw new Error("LUT creation failed.");
  writeFileSync("./public/lut.json", JSON.stringify(lutAddress));
  console.log("LUT Address:", lutAddress.toBase58());

  writeFileSync("./public/mint.json", JSON.stringify(""));
  saveDataToFile([base58.encode(mintKp.secretKey)], "./public/mint.json");
  console.log("Mint Keypair saved!");

  // Step 4: Distribute Funds
  console.log("Distributing SOL to bundler wallets...")
  const bundlerAmounts = await splitAmount(BUNDLER_TOTAL_FUND_AMOUNT, BUNDLER_WALLET_NUM, true);
  const walletKPs = await distributeSol(connection, MAIN_KP, BUNDLER_WALLET_NUM, bundlerAmounts, BUNDLER_WALLET_SOURCE);
  
  await sleep(10000); // Adjust sleep duration as needed

  if (!walletKPs) {
    console.log("walletKPs is not set")
    return
  }

  // Step 5: Extend Lookup Table with Wallet Addresses
  await addAddressesToTable(MAIN_KP, lutAddress, mintKp.publicKey, walletKPs)

  const lookupTable = (await connection.getAddressLookupTable(lutAddress)).value;
  if (!lookupTable) {
    console.log("Lookup table not ready")
    return
  }

  const latestBlockhash = await connection.getLatestBlockhash()

  const tokenCreationTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: MAIN_KP.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: creationInstructions
    }).compileToV0Message()
  )

  console.log("creationInstructions", creationInstructions)
  tokenCreationTx.sign([MAIN_KP, mintKp])

  console.log("tokenCreationTx Confirmation", (await connection.simulateTransaction(tokenCreationTx)))
  transactions.push(tokenCreationTx)

  // Step 6: Add buy transactions and confirm
  await sendBundleByLilJit(transactions)
}

main()
