const redis = require('redis');
const { promisify } = require('util');

class RedisClient {
    constructor() {
        this.client = redis.createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });

        this.client.on('error', (err) => {
            console.error('Redis error:', err);
        });

        this.getAsync = promisify(this.client.get).bind(this.client);
        this.setAsync = promisify(this.client.set).bind(this.client);
        this.incrAsync = promisify(this.client.incr).bind(this.client);
    }

    async connect() {
        await this.client.connect();
    }

    async disconnect() {
        await this.client.quit();
    }
}

const redisClient = new RedisClient();
module.exports = redisClient;
