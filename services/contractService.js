// services/contractService.js
const { ethers } = require('ethers');

class ContractService {
  constructor() {
    // Base Sepolia configuration
    this.provider = new ethers.JsonRpcProvider(
      process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
    );
    this.privateKey = process.env.BACKEND_PRIVATE_KEY;
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);
    this.contractAddress = process.env.CONTRACT_ADDRESS;
    
    // Network details for Base Sepolia
    this.networkConfig = {
      chainId: 84532,
      name: 'Base Sepolia',
      symbol: 'ETH',
      decimals: 18,
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      blockExplorer: 'https://sepolia.basescan.org'
    };
    
    // ABI for the TaskReward contract
    this.contractABI = [
      "function createTask(uint256 maxParticipants) external payable",
      "function claimReward(uint256 taskId, uint256 rewardAmount, bytes calldata signature) external",
      "function getTaskDetails(uint256 taskId) external view returns (address creator, uint256 rewardPerDev, uint256 maxParticipants, uint256 numClaimed, bool isActive)",
      "function hasDevClaimed(uint256 taskId, address developer) external view returns (bool)",
      "function verifyClaimSignature(uint256 taskId, address developer, uint256 rewardAmount, bytes calldata signature) external view returns (bool)",
      "function taskCount() external view returns (uint256)",
      "event TaskCreated(uint256 indexed taskId, address indexed creator, uint256 totalFunding, uint256 rewardPerDev, uint256 maxParticipants)",
      "event RewardClaimed(uint256 indexed taskId, address indexed developer, uint256 rewardAmount)"
    ];
    
    this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);
    
    // Log network info
    console.log(`🔗 Connected to ${this.networkConfig.name} (Chain ID: ${this.networkConfig.chainId})`);
    console.log(`📋 Contract Address: ${this.contractAddress}`);
    console.log(`🌐 RPC URL: ${this.networkConfig.rpcUrl}`);
  }

  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const balance = await this.provider.getBalance(this.wallet.address);
      
      return {
        network: {
          name: network.name,
          chainId: Number(network.chainId),
          ensAddress: network.ensAddress
        },
        wallet: {
          address: this.wallet.address,
          balance: ethers.formatEther(balance)
        },
        contract: {
          address: this.contractAddress
        }
      };
    } catch (error) {
      console.error('Error getting network info:', error);
      throw error;
    }
  }

  async createTaskOnChain(maxParticipants, totalFundingEth) {
    try {
      console.log(`💰 Creating task with ${totalFundingEth} ETH for ${maxParticipants} participants`);
      
      // Check wallet balance first
      const balance = await this.provider.getBalance(this.wallet.address);
      const requiredAmount = ethers.parseEther(totalFundingEth.toString());
      
      if (balance < requiredAmount) {
        throw new Error(`Insufficient balance. Required: ${totalFundingEth} ETH, Available: ${ethers.formatEther(balance)} ETH`);
      }

      // Estimate gas
      const gasEstimate = await this.contract.createTask.estimateGas(maxParticipants, {
        value: requiredAmount
      });
      
      console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);

      // Send transaction with some buffer on gas
      const tx = await this.contract.createTask(maxParticipants, {
        value: requiredAmount,
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      });
      
      console.log(`📤 Transaction sent: ${tx.hash}`);
      console.log(`🔍 Track on Base Sepolia: ${this.networkConfig.blockExplorer}/tx/${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
      
      // Get task ID from event
      const taskCreatedEvent = receipt.logs.find(log => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed.name === 'TaskCreated';
        } catch (e) {
          return false;
        }
      });
      
      if (taskCreatedEvent) {
        const parsed = this.contract.interface.parseLog(taskCreatedEvent);
        const taskId = parsed.args.taskId.toString();
        
        console.log(`🎉 Task created with ID: ${taskId}`);
        
        return {
          taskId,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          explorerUrl: `${this.networkConfig.blockExplorer}/tx/${receipt.hash}`
        };
      }
      
      throw new Error('TaskCreated event not found');
    } catch (error) {
      console.error('❌ Error creating task on Base Sepolia:', error);
      throw error;
    }
  }

  async getTaskDetails(taskId) {
    try {
      const details = await this.contract.getTaskDetails(taskId);
      return {
        creator: details[0],
        rewardPerDev: details[1].toString(),
        maxParticipants: details[2].toString(),
        numClaimed: details[3].toString(),
        isActive: details[4]
      };
    } catch (error) {
      console.error('Error getting task details:', error);
      throw error;
    }
  }

  async generateClaimSignature(taskId, developerAddress, rewardAmount) {
    try {
      console.log(`🖋️  Generating signature for task ${taskId}, user ${developerAddress}`);
      
      // Create message hash (same as smart contract)
      const messageHash = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256'],
        [taskId, developerAddress, rewardAmount]
      );
      
      // Sign the message
      const signature = await this.wallet.signMessage(ethers.getBytes(messageHash));
      
      console.log(`✅ Signature generated: ${signature.slice(0, 20)}...`);
      return signature;
    } catch (error) {
      console.error('Error generating claim signature:', error);
      throw error;
    }
  }

  async verifyClaimSignature(taskId, developerAddress, rewardAmount, signature) {
    try {
      const isValid = await this.contract.verifyClaimSignature(
        taskId,
        developerAddress,
        rewardAmount,
        signature
      );
      return isValid;
    } catch (error) {
      console.error('Error verifying claim signature:', error);
      throw error;
    }
  }

  async hasUserClaimed(taskId, userAddress) {
    try {
      const hasClaimed = await this.contract.hasDevClaimed(taskId, userAddress);
      return hasClaimed;
    } catch (error) {
      console.error('Error checking if user claimed:', error);
      throw error;
    }
  }

  // Utility function to get Base Sepolia faucet info
  getFaucetInfo() {
    return {
      faucets: [
        {
          name: 'Base Sepolia Faucet',
          url: 'https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet',
          description: 'Official Coinbase faucet for Base Sepolia ETH'
        },
        {
          name: 'Alchemy Base Sepolia Faucet',
          url: 'https://sepoliafaucet.com/',
          description: 'Alternative faucet for Base Sepolia ETH'
        }
      ],
      networkDetails: {
        chainId: '0x14a34', // 84532 in hex
        chainName: 'Base Sepolia',
        nativeCurrency: {
          name: 'ETH',
          symbol: 'ETH',
          decimals: 18
        },
        rpcUrls: ['https://sepolia.base.org'],
        blockExplorerUrls: ['https://sepolia.basescan.org']
      }
    };
  }
}
