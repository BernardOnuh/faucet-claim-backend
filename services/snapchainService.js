const axios = require('axios');

class SnapchainService {
  constructor() {
    this.baseURL = 'https://snapchain-api.neynar.com';
    this.apiKey = process.env.SNAPCHAIN_API_KEY;
    
    if (!this.apiKey) {
      console.warn('SNAPCHAIN_API_KEY not found in environment variables');
    }
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey
    };
  }

  async getApiInfo() {
    try {
      const response = await axios.get(`${this.baseURL}/v1/info`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error getting API info:', error.response?.data || error.message);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/user/by-username`, {
        params: { username },
        headers: this.getHeaders()
      });
      return response.data.user;
    } catch (error) {
      console.error('Error getting user by username:', error.response?.data || error.message);
      return null;
    }
  }

  async getUserByFid(fid) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/user`, {
        params: { fid },
        headers: this.getHeaders()
      });
      return response.data.user;
    } catch (error) {
      console.error('Error getting user by FID:', error.response?.data || error.message);
      return null;
    }
  }

  async getCast(hash) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/cast`, {
        params: { hash },
        headers: this.getHeaders()
      });
      return response.data.cast;
    } catch (error) {
      console.error('Error getting cast:', error.response?.data || error.message);
      return null;
    }
  }

  async getCastLikes(hash, limit = 100) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/cast/likes`, {
        params: { hash, limit },
        headers: this.getHeaders()
      });
      return response.data.likes || [];
    } catch (error) {
      console.error('Error getting cast likes:', error.response?.data || error.message);
      return [];
    }
  }

  async getCastRecasts(hash, limit = 100) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/cast/recasts`, {
        params: { hash, limit },
        headers: this.getHeaders()
      });
      return response.data.recasts || [];
    } catch (error) {
      console.error('Error getting cast recasts:', error.response?.data || error.message);
      return [];
    }
  }

  async getUserFollowing(fid, limit = 100) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/user/following`, {
        params: { fid, limit },
        headers: this.getHeaders()
      });
      return response.data.users || [];
    } catch (error) {
      console.error('Error getting user following:', error.response?.data || error.message);
      return [];
    }
  }

  async getUserFollowers(fid, limit = 100) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/user/followers`, {
        params: { fid, limit },
        headers: this.getHeaders()
      });
      return response.data.users || [];
    } catch (error) {
      console.error('Error getting user followers:', error.response?.data || error.message);
      return [];
    }
  }

  async getChannelMembers(channelId, limit = 100) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/channel/members`, {
        params: { id: channelId, limit },
        headers: this.getHeaders()
      });
      return response.data.members || [];
    } catch (error) {
      console.error('Error getting channel members:', error.response?.data || error.message);
      return [];
    }
  }

  async getChannelFollowers(channelId, limit = 100) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/channel/followers`, {
        params: { id: channelId, limit },
        headers: this.getHeaders()
      });
      return response.data.users || [];
    } catch (error) {
      console.error('Error getting channel followers:', error.response?.data || error.message);
      return [];
    }
  }

  async getUserChannels(fid) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/user/channels`, {
        params: { fid },
        headers: this.getHeaders()
      });
      return response.data.channels || [];
    } catch (error) {
      console.error('Error getting user channels:', error.response?.data || error.message);
      return [];
    }
  }

  // Task verification methods
  async verifyUserFollowsUser(userFid, targetUsername) {
    try {
      // Get target user's FID
      const targetUser = await this.getUserByUsername(targetUsername);
      if (!targetUser) {
        console.log(`Target user ${targetUsername} not found`);
        return false;
      }

      // Get user's following list
      const following = await this.getUserFollowing(userFid, 1000);
      
      // Check if target user is in following list
      const isFollowing = following.some(user => user.fid === targetUser.fid);
      
      console.log(`User ${userFid} follows ${targetUsername} (${targetUser.fid}): ${isFollowing}`);
      return isFollowing;
    } catch (error) {
      console.error('Error verifying user follows user:', error);
      return false;
    }
  }

  async verifyCastLike(userFid, castHash) {
    try {
      // Get cast likes
      const likes = await this.getCastLikes(castHash, 1000);
      
      // Check if user liked the cast
      const hasLiked = likes.some(like => like.user.fid === userFid);
      
      console.log(`User ${userFid} liked cast ${castHash}: ${hasLiked}`);
      return hasLiked;
    } catch (error) {
      console.error('Error verifying cast like:', error);
      return false;
    }
  }

  async verifyCastRecast(userFid, castHash) {
    try {
      // Get cast recasts
      const recasts = await this.getCastRecasts(castHash, 1000);
      
      // Check if user recasted the cast
      const hasRecasted = recasts.some(recast => recast.user.fid === userFid);
      
      console.log(`User ${userFid} recasted cast ${castHash}: ${hasRecasted}`);
      return hasRecasted;
    } catch (error) {
      console.error('Error verifying cast recast:', error);
      return false;
    }
  }

  async verifyChannelMembership(userFid, channelId) {
    try {
      // Check if user is a member of the channel
      const members = await this.getChannelMembers(channelId, 1000);
      const isMember = members.some(member => member.fid === userFid);
      
      // Also check if user follows the channel
      const followers = await this.getChannelFollowers(channelId, 1000);
      const isFollower = followers.some(follower => follower.fid === userFid);
      
      const isMemberOrFollower = isMember || isFollower;
      
      console.log(`User ${userFid} is member/follower of channel ${channelId}: ${isMemberOrFollower}`);
      return isMemberOrFollower;
    } catch (error) {
      console.error('Error verifying channel membership:', error);
      return false;
    }
  }
}

module.exports = new SnapchainService();