// services/sponsoredGasService.js
const axios = require('axios');
const { ethers } = require('ethers');

class SponsoredGasService {
  constructor() {
    this.paymasterUrl = process.env.PAYMASTER_URL;
    this.entryPointAddress = process.env.ENTRY_POINT_ADDRESS || '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789';
    this.enabled = process.env.ENABLE_SPONSORED_GAS === 'true';
    
    console.log(`🎭 Sponsored Gas ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
    if (this.enabled) {
      console.log(`💰 Paymaster URL: ${this.paymasterUrl}`);
    }
  }

  async getPaymasterStubData(userOp) {
    if (!this.enabled) {
      return null;
    }

    try {
      const response = await axios.post(this.paymasterUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "pm_getPaymasterStubData",
        params: [
          userOp,
          this.entryPointAddress,
          "0x14a34", // Base Sepolia chain ID in hex
          {}
        ]
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.error) {
        console.error('Paymaster error:', response.data.error);
        return null;
      }

      return response.data.result;
    } catch (error) {
      console.error('Error getting paymaster data:', error.response?.data || error.message);
      return null;
    }
  }

  async getPaymasterAndData(userOp) {
    if (!this.enabled) {
      return null;
    }

    try {
      const response = await axios.post(this.paymasterUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "pm_getPaymasterAndData",
        params: [
          userOp,
          this.entryPointAddress,
          "0x14a34", // Base Sepolia chain ID in hex
          {}
        ]
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.error) {
        console.error('Paymaster error:', response.data.error);
        return null;
      }

      return response.data.result;
    } catch (error) {
      console.error('Error getting paymaster and data:', error.response?.data || error.message);
      return null;
    }
  }

  createUserOperation(sender, callData, nonce = "0x0") {
    return {
      sender,
      nonce,
      initCode: "0x",
      callData,
      callGasLimit: "0x0",
      verificationGasLimit: "0x0", 
      preVerificationGas: "0x0",
      maxFeePerGas: "0x0",
      maxPriorityFeePerGas: "0x0",
      paymasterAndData: "0x",
      signature: "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000041fffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c00000000000000000000000000000000000000000000000000000000000000"
    };
  }

  async estimateGasForClaim(contractAddress, taskId, rewardAmount, signature, userAddress) {
    try {
      const contractABI = [
        "function claimReward(uint256 taskId, uint256 rewardAmount, bytes calldata signature) external"
      ];
      
      const iface = new ethers.Interface(contractABI);
      const callData = iface.encodeFunctionData("claimReward", [taskId, rewardAmount, signature]);
      
      // Create user operation for gas estimation
      const userOp = this.createUserOperation(userAddress, callData);
      
      // Get paymaster stub data for gas estimation
      const stubData = await this.getPaymasterStubData(userOp);
      
      if (stubData) {
        return {
          callGasLimit: stubData.callGasLimit,
          verificationGasLimit: stubData.verificationGasLimit,
          preVerificationGas: stubData.preVerificationGas,
          sponsored: true
        };
      } else {
        // Fallback to regular gas estimation
        const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL);
        const contract = new ethers.Contract(contractAddress, contractABI, provider);
        
        const gasEstimate = await contract.claimReward.estimateGas(taskId, rewardAmount, signature);
        
        return {
          gasLimit: gasEstimate.toString(),
          sponsored: false
        };
      }
    } catch (error) {
      console.error('Error estimating gas for claim:', error);
      throw error;
    }
  }

  async prepareSponsoredClaim(contractAddress, taskId, rewardAmount, signature, userAddress) {
    if (!this.enabled) {
      return {
        sponsored: false,
        message: 'Sponsored gas not enabled'
      };
    }

    try {
      const contractABI = [
        "function claimReward(uint256 taskId, uint256 rewardAmount, bytes calldata signature) external"
      ];
      
      const iface = new ethers.Interface(contractABI);
      const callData = iface.encodeFunctionData("claimReward", [taskId, rewardAmount, signature]);
      
      // Create user operation
      const userOp = this.createUserOperation(userAddress, callData);
      
      // Get paymaster data
      const paymasterData = await this.getPaymasterAndData(userOp);
      
      if (paymasterData) {
        return {
          sponsored: true,
          userOperation: {
            ...userOp,
            callGasLimit: paymasterData.callGasLimit,
            verificationGasLimit: paymasterData.verificationGasLimit,
            preVerificationGas: paymasterData.preVerificationGas,
            maxFeePerGas: paymasterData.maxFeePerGas,
            maxPriorityFeePerGas: paymasterData.maxPriorityFeePerGas,
            paymasterAndData: paymasterData.paymasterAndData
          },
          entryPoint: this.entryPointAddress
        };
      } else {
        return {
          sponsored: false,
          message: 'Paymaster not available for this transaction'
        };
      }
    } catch (error) {
      console.error('Error preparing sponsored claim:', error);
      return {
        sponsored: false,
        error: error.message
      };
    }
  }
}

module.exports = new SponsoredGasService();
