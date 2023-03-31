import { Address, DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Contracts as Mainnet } from "../networks/mainnet.json";
import { Contracts as Testnet } from "../networks/testnet.json";

interface AddressConfig {
  [key: string]: {
    [key: string]: Address;
  };
}

const ADDRESSES: AddressConfig = {
  bsctestnet: {
    WBNBAddress: Testnet.WBNB,
    pancakeFactory: Testnet.pancakeFactory,
    unitroller: Testnet.Unitroller,
  },
  bscmainnet: {
    WBNBAddress: Mainnet.WBNB,
    pancakeFactory: Mainnet.pancakeFactory,
    unitroller: Mainnet.Unitroller,
  },
};

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, network, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const networkName = network.name === "bscmainnet" ? "bscmainnet" : "bsctestnet";
  const WBNBAddress = ADDRESSES[networkName].WBNBAddress;
  const pancakeFactoryAddress = ADDRESSES[networkName].pancakeFactory;

  await deploy("SwapRouter", {
    contract: "SwapRouter",
    from: deployer,
    args: [WBNBAddress, pancakeFactoryAddress],
    log: true,
    autoMine: true,
    proxy: {
      owner: deployer,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        methodName: "initialize",
        args: [ADDRESSES[networkName].unitroller],
      },
    },
  });
};

func.tags = ["SwapRouter"];

export default func;
