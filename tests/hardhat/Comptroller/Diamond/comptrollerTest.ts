import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai from "chai";
import { Signer, constants } from "ethers";
import { ethers } from "hardhat";

import { convertToUnit } from "../../../../helpers/utils";
import {
  Comptroller,
  ComptrollerLens,
  ComptrollerLens__factory,
  Comptroller__factory,
  EIP20Interface,
  IAccessControlManager,
  PriceOracle,
  VToken
} from "../../../../typechain";
import { ComptrollerErrorReporter } from "../../util/Errors";

const { deployDiamond } = require("../../../../script/diamond/deploy");

const { expect } = chai;
chai.use(smock.matchers);

type SimpleComptrollerFixture = {
  oracle: FakeContract<PriceOracle>;
  accessControl: FakeContract<IAccessControlManager>;
  comptrollerLens: MockContract<ComptrollerLens>;
  comptroller: MockContract<Comptroller>;
  comptrollerProxy: MockContract<Comptroller>;
};

async function deploySimpleComptroller(): Promise<SimpleComptrollerFixture> {
  const oracle = await smock.fake<PriceOracle>("contracts/Oracle/V0.8.13/PriceOracle.sol:PriceOracle");
  const accessControl = await smock.fake<IAccessControlManager>("contracts/Governance/V0.8.13/IAccessControlManager.sol:IAccessControlManager");
  accessControl.isAllowedToCall.returns(true);
  const ComptrollerLensFactory = await smock.mock<ComptrollerLens__factory>("ComptrollerLens");
  //   const ComptrollerFactory = await smock.mock<Comptroller__factory>("Comptroller");
  const result = await deployDiamond("");
  const comptroller = result.unitroller;
  const comptrollerProxy = await ethers.getContractAt("Comptroller", comptroller.address);
  const comptrollerLens = await ComptrollerLensFactory.deploy();
  await comptrollerProxy._setAccessControl(accessControl.address);
  await comptrollerProxy._setComptrollerLens(comptrollerLens.address);
  await comptrollerProxy._setPriceOracle(oracle.address);
  await comptrollerProxy._setLiquidationIncentive(convertToUnit("1", 18));
  return { oracle, comptrollerProxy, comptroller, comptrollerLens, accessControl };
}

function configureOracle(oracle: FakeContract<PriceOracle>) {
  oracle.getUnderlyingPrice.returns(convertToUnit(1, 18));
}

async function configureVToken(vToken: FakeContract<VToken>, comptroller: MockContract<Comptroller>) {
  const result = await deployDiamond("");
  comptroller = result.unitroller;
  vToken.comptroller.returns(comptroller.address);
  vToken.isVToken.returns(true);
  vToken.exchangeRateStored.returns(convertToUnit("2", 18));
  vToken.totalSupply.returns(convertToUnit("1000000", 18));
  vToken.totalBorrows.returns(convertToUnit("900000", 18));
}

describe("Comptroller", () => {
  let root: Signer;
  let accounts: Signer[];

  before(async () => {
    [root, ...accounts] = await ethers.getSigners();
  });

  describe("constructor", () => {
    it("on success it sets admin to creator and pendingAdmin is unset", async () => {
      const { comptrollerProxy } = await loadFixture(deploySimpleComptroller);
      expect(await comptrollerProxy.admin()).to.equal(await root.getAddress());
      expect(await comptrollerProxy.pendingAdmin()).to.equal(constants.AddressZero);
    });
  });

  describe("_setLiquidationIncentive", () => {
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;
    const initialIncentive = convertToUnit("1", 18);
    const validIncentive = convertToUnit("1.1", 18);
    const tooSmallIncentive = convertToUnit("0.99999", 18);

    beforeEach(async () => {
      ({ comptroller } = await loadFixture(deploySimpleComptroller));
      comptrollerProxy = await ethers.getContractAt("Comptroller", comptroller.address);
    });

    it("fails if incentive is less than 1e18", async () => {
      await expect(comptrollerProxy._setLiquidationIncentive(tooSmallIncentive)).to.be.revertedWith(
        "incentive must be over 1e18",
      );
    });

    it("accepts a valid incentive and emits a NewLiquidationIncentive event", async () => {
      expect(await comptrollerProxy.callStatic._setLiquidationIncentive(validIncentive)).to.equal(
        ComptrollerErrorReporter.Error.NO_ERROR,
      );
      expect(await comptrollerProxy._setLiquidationIncentive(validIncentive))
        .to.emit(comptroller, "NewLiquidationIncentive")
        .withArgs(initialIncentive, validIncentive);
      expect(await comptrollerProxy.liquidationIncentiveMantissa()).to.equal(validIncentive);
    });
  });

  describe("Non zero address check", () => {
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;

    beforeEach(async () => {
      ({ comptroller } = await loadFixture(deploySimpleComptroller));
      comptrollerProxy = await ethers.getContractAt("Comptroller", comptroller.address);
    });

    type FuncNames = keyof Comptroller["functions"];

    function testZeroAddress<Func extends FuncNames>(funcName: Func, args: Parameters<Comptroller[Func]>) {
      it(funcName, async () => {
        await expect(comptrollerProxy[funcName](...args)).to.be.revertedWith("can't be zero address");
      });
    }
    testZeroAddress("_setPriceOracle", [constants.AddressZero]);
    testZeroAddress("_setCollateralFactor", [constants.AddressZero, 0]);
    testZeroAddress("_setPauseGuardian", [constants.AddressZero]);
    testZeroAddress("_setVAIController", [constants.AddressZero]);
    testZeroAddress("_setTreasuryData", [constants.AddressZero, constants.AddressZero, 0]);
    testZeroAddress("_setComptrollerLens", [constants.AddressZero]);
    testZeroAddress("_setVAIVaultInfo", [constants.AddressZero, 0, 0]);
    testZeroAddress("_setVenusSpeeds", [[constants.AddressZero], [0], [0]]);
  });

  describe("_setPriceOracle", () => {
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;
    let oracle: FakeContract<PriceOracle>;
    let newOracle: FakeContract<PriceOracle>;

    type Contracts = SimpleComptrollerFixture & {
      newOracle: FakeContract<PriceOracle>;
    };

    async function deploy(): Promise<Contracts> {
      const contracts = await deploySimpleComptroller();
      const newOracle = await smock.fake<PriceOracle>("contracts/Oracle/V0.8.13/PriceOracle.sol:PriceOracle");
      // comptrollerProxy = await ethers.getContractAt("Comptroller", contracts.comptroller);
      return { ...contracts, newOracle };
    }

    beforeEach(async () => {
      ({ comptrollerProxy, oracle, newOracle } = await loadFixture(deploy));
    });

    it("fails if called by non-admin", async () => {
      await expect(comptrollerProxy.connect(accounts[0])._setPriceOracle(oracle.address)).to.be.revertedWith(
        "only admin can",
      );
      expect(await comptrollerProxy.oracle()).to.equal(oracle.address);
    });

    it("accepts a valid price oracle and emits a NewPriceOracle event", async () => {
      expect(await comptrollerProxy._setPriceOracle(newOracle.address))
        .to.emit(comptroller, "NewPriceOracle")
        .withArgs(oracle.address, newOracle.address);
      expect(await comptrollerProxy.oracle()).to.equal(newOracle.address);
    });
  });

  describe("_setComptrollerLens", () => {
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;
    let comptrollerLens: MockContract<ComptrollerLens>;

    type Contracts = {
      comptroller: MockContract<Comptroller>;
      comptrollerProxy: MockContract<Comptroller>;
      comptrollerLens: MockContract<ComptrollerLens>;
    };

    async function deploy(): Promise<Contracts> {
      // const ComptrollerFactory = await smock.mock<Comptroller__factory>("Comptroller");
      const result = await deployDiamond("");
      comptroller = result.unitroller;
      const comptrollerProxy = await ethers.getContractAt("Comptroller", comptroller.address);
      const ComptrollerLensFactory = await smock.mock<ComptrollerLens__factory>("ComptrollerLens");
      const comptrollerLens = await ComptrollerLensFactory.deploy();
      return { comptrollerProxy, comptrollerLens };
    }

    beforeEach(async () => {
      ({ comptrollerProxy, comptrollerLens } = await loadFixture(deploy));
    });

    it("fails if not called by admin", async () => {
      await expect(
        comptrollerProxy.connect(accounts[0])._setComptrollerLens(comptrollerLens.address),
      ).to.be.revertedWith("only admin can");
    });

    it("should fire an event", async () => {
      const { comptrollerProxy, comptrollerLens } = await loadFixture(deploy);
      const oldComptrollerLensAddress = await comptrollerProxy.comptrollerLens();
      expect(await comptrollerProxy._setComptrollerLens(comptrollerLens.address))
        .to.emit(comptroller, "NewComptrollerLens")
        .withArgs(oldComptrollerLensAddress, comptrollerLens.address);
    });
  });

  describe("_setCloseFactor", () => {
    let comptrollerProxy: MockContract<Comptroller>;

    beforeEach(async () => {
      ({ comptrollerProxy } = await loadFixture(deploySimpleComptroller));
    });

    it("fails if not called by admin", async () => {
      await expect(comptrollerProxy.connect(accounts[0])._setCloseFactor(1)).to.be.revertedWith("only admin can");
    });
  });

  describe("_setCollateralFactor", () => {
    const half = convertToUnit("0.5", 18);
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;
    let vToken: FakeContract<VToken>;
    let oracle: FakeContract<PriceOracle>;

    type Contracts = SimpleComptrollerFixture & { vToken: FakeContract<VToken> };

    async function deploy(): Promise<Contracts> {
      const contracts = await deploySimpleComptroller();
      const vToken = await smock.fake<VToken>("contracts/Tokens/V0.8.13/VTokens/VToken.sol:VToken");
      vToken.comptroller.returns(contracts.comptroller.address);
      vToken.isVToken.returns(true);
      return { vToken, ...contracts };
    }

    beforeEach(async () => {
      ({ comptrollerProxy, oracle, vToken } = await loadFixture(deploy));
      configureOracle(oracle);
    });

    it("fails if asset is not listed", async () => {
      await expect(comptrollerProxy._setCollateralFactor(vToken.address, half)).to.be.revertedWith("market not listed");
    });

    it("fails if factor is set without an underlying price", async () => {
      await comptrollerProxy._supportMarket(vToken.address);
      oracle.getUnderlyingPrice.returns(0);
      expect(await comptrollerProxy._setCollateralFactor(vToken.address, half))
        .to.emit(comptroller, "Failure")
        .withArgs(
          ComptrollerErrorReporter.Error.PRICE_ERROR,
          ComptrollerErrorReporter.FailureInfo.SET_COLLATERAL_FACTOR_WITHOUT_PRICE,
        );
    });

    it("succeeds and sets market", async () => {
      await comptrollerProxy._supportMarket(vToken.address);
      expect(await comptrollerProxy._setCollateralFactor(vToken.address, half))
        .to.emit(comptroller, "NewCollateralFactor")
        .withArgs(vToken.address, "0", half);
    });
  });

  describe("_supportMarket", () => {
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;
    let oracle: FakeContract<PriceOracle>;
    let vToken1: FakeContract<VToken>;
    let vToken2: FakeContract<VToken>;
    let token: FakeContract<EIP20Interface>;

    type Contracts = SimpleComptrollerFixture & {
      vToken1: FakeContract<VToken>;
      vToken2: FakeContract<VToken>;
      token: FakeContract<EIP20Interface>;
    };

    async function deploy(): Promise<Contracts> {
      const contracts = await deploySimpleComptroller();
      const vToken1 = await smock.fake<VToken>("contracts/Tokens/V0.8.13/VTokens/VToken.sol:VToken");
      const vToken2 = await smock.fake<VToken>("contracts/Tokens/V0.8.13/VTokens/VToken.sol:VToken");
      const token = await smock.fake<EIP20Interface>("contracts/Tokens/V0.8.13/EIP20Interface.sol:EIP20Interface");
      return { ...contracts, vToken1, vToken2, token };
    }

    beforeEach(async () => {
      ({ comptrollerProxy, oracle, vToken1, vToken2, token } = await loadFixture(deploy));
      configureOracle(oracle);
      configureVToken(vToken1, comptroller);
      configureVToken(vToken2, comptroller);
    });

    // it("fails if asset is not a VToken", async () => {
    //   await expect(comptrollerProxy._supportMarket(token.address)).to.be.reverted;
    // });

    it("succeeds and sets market", async () => {
      expect(await comptrollerProxy._supportMarket(vToken1.address))
        .to.emit(comptroller, "MarketListed")
        .withArgs(vToken1.address);
    });

    it("cannot list a market a second time", async () => {
      const tx1 = await comptrollerProxy._supportMarket(vToken1.address);
      const tx2 = await comptrollerProxy._supportMarket(vToken1.address);
      expect(tx1).to.emit(comptrollerProxy, "MarketListed").withArgs(vToken1.address);
      expect(tx2)
        .to.emit(comptroller, "Failure")
        .withArgs(
          ComptrollerErrorReporter.Error.MARKET_ALREADY_LISTED,
          ComptrollerErrorReporter.FailureInfo.SUPPORT_MARKET_EXISTS,
        );
    });

    it("can list two different markets", async () => {
      const tx1 = await comptrollerProxy._supportMarket(vToken1.address);
      const tx2 = await comptrollerProxy._supportMarket(vToken2.address);
      expect(tx1).to.emit(comptrollerProxy, "MarketListed").withArgs(vToken1.address);
      expect(tx2).to.emit(comptroller, "MarketListed").withArgs(vToken2.address);
    });
  });

  describe("Hooks", () => {
    let comptroller: MockContract<Comptroller>;
    let comptrollerProxy: MockContract<Comptroller>;
    let vToken: FakeContract<VToken>;

    type Contracts = SimpleComptrollerFixture & { vToken: FakeContract<VToken> };

    async function deploy(): Promise<Contracts> {
      const contracts = await deploySimpleComptroller();
      const vToken = await smock.fake<VToken>("contracts/Tokens/V0.8.13/VTokens/VToken.sol:VToken");
      await contracts.comptrollerProxy._supportMarket(vToken.address);
      return { ...contracts, vToken };
    }

    beforeEach(async () => {
      ({ comptrollerProxy, vToken } = await loadFixture(deploy));
      configureVToken(vToken, comptroller);
    });

    describe("mintAllowed", () => {
      beforeEach(async () => {
        ({ comptrollerProxy, vToken } = await loadFixture(deploy));
        configureVToken(vToken, comptroller);
      });

      it("allows minting if cap is not reached", async () => {
        const cap = convertToUnit("1001", 18);
        const currentVTokenSupply = convertToUnit("500", 18);
        const exchangeRate = convertToUnit("2", 18);
        // underlying supply = currentVTokenSupply * exchangeRate = 1000

        vToken.totalSupply.returns(currentVTokenSupply);
        vToken.exchangeRateStored.returns(exchangeRate);
        await comptrollerProxy._setMarketSupplyCaps([vToken.address], [cap]);
        expect(
          await comptrollerProxy.callStatic.mintAllowed(
            vToken.address,
            await root.getAddress(),
            convertToUnit("0.9999", 18),
          ),
        ).to.equal(0); // 0 means "no error"
      });

      it("reverts if supply cap reached", async () => {
        const cap = convertToUnit("1001", 18);
        const currentVTokenSupply = convertToUnit("500", 18);
        const exchangeRate = convertToUnit("2", 18);
        // underlying supply = currentVTokenSupply * exchangeRate = 1000

        vToken.totalSupply.returns(currentVTokenSupply);
        vToken.exchangeRateStored.returns(exchangeRate);
        await comptrollerProxy._setMarketSupplyCaps([vToken.address], [cap]);
        await expect(
          comptrollerProxy.mintAllowed(vToken.address, await root.getAddress(), convertToUnit("1.01", 18)),
        ).to.be.revertedWith("market supply cap reached");
      });

      it("reverts if market is not listed", async () => {
        const someVToken = await smock.fake<VToken>("contracts/Tokens/V0.8.13/VTokens/VToken.sol:VToken");
        await expect(
          comptrollerProxy.mintAllowed(someVToken.address, await root.getAddress(), convertToUnit("1", 18)),
        ).to.be.revertedWith("market not listed");
      });
    });

    describe("redeemVerify", () => {
      it("should allow you to redeem 0 underlying for 0 tokens", async () => {
        await comptrollerProxy.redeemVerify(vToken.address, await accounts[0].getAddress(), 0, 0);
      });

      it("should allow you to redeem 5 underlyig for 5 tokens", async () => {
        await comptrollerProxy.redeemVerify(vToken.address, await accounts[0].getAddress(), 5, 5);
      });

      it("should not allow you to redeem 5 underlying for 0 tokens", async () => {
        await expect(
          comptrollerProxy.redeemVerify(vToken.address, await accounts[0].getAddress(), 5, 0),
        ).to.be.revertedWith("redeemTokens zero");
      });
    });
  });
});
