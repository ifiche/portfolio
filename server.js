import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { createClient } from 'redis';
import basicAuth from 'express-basic-auth';
import useragent from 'useragent';
import geoip from 'geoip-lite';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import os from 'os';

// Configure environment variables
dotenv.config();

// ES Modules equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// WebSocket Server
const wss = new WebSocketServer({ server });

// Redis Client Setup
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

// Enhanced Mobile Detection Function
const isMobileDevice = (userAgent) => {
    const agent = useragent.parse(userAgent);
    return agent.device.family === 'iPhone' || 
           agent.device.family === 'iPad' || 
           agent.device.family === 'Android' ||
           /Mobile|iP(hone|od|ad)|Android|BlackBerry|IEMobile/.test(userAgent);
};

// Middleware
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mobile Detection Middleware
app.use((req, res, next) => {
    res.locals.isMobile = isMobileDevice(req.headers['user-agent']);
    next();
});

// Static files with mobile adaptation
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') && res.locals.isMobile) {
            res.setHeader('X-Viewport-Meta', 'width=device-width, initial-scale=1.0');
        }
    }
});

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});

// Visitor Tracking Middleware
app.use(async (req, res, next) => {
    if (process.env.TRACK_VISITORS === 'true') {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const agent = useragent.parse(req.headers['user-agent']);
        const geo = geoip.lookup(ip);
        
        const visitorData = {
            ip: process.env.ANONYMIZE_IPS === 'true' ? 
                ip.split('.').slice(0,2).join('.') + '.x.x' : ip,
            device: agent.device.toString(),
            os: agent.os.toString(),
            browser: agent.toAgent(),
            isMobile: isMobileDevice(req.headers['user-agent']),
            geo: geo ? {
                country: geo.country,
                region: geo.region,
                city: geo.city,
                ll: geo.ll
            } : null,
            path: req.path,
            referrer: req.headers.referer || 'Direct',
            timestamp: new Date().toISOString()
        };

        try {
            await redisClient.zAdd(`visitor:${visitorData.ip}`, [
                {
                    score: Date.now(),
                    value: JSON.stringify(visitorData)
                }
            ]);
            await redisClient.expire(`visitor:${visitorData.ip}`, process.env.REDIS_VISITOR_TTL || 2592000);
            await redisClient.incr('total:visits');
            
            // Broadcast new visit to WebSocket clients
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ 
                        type: 'new_visit', 
                        data: {
                            ip: visitorData.ip,
                            timestamp: visitorData.timestamp
                        }
                    }));
                }
            });
        } catch (err) {
            console.error('Redis tracking error:', err);
        }
    }
    next();
});

// Admin Authentication
const adminAuth = basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
    challenge: true,
    realm: 'Admin Dashboard'
});

// Admin Panel Routes
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-panel', 'index.html'));
});

app.use('/admin', adminAuth, express.static(path.join(__dirname, 'admin-panel')));

// Admin API Endpoints
app.get('/admin/api/stats', adminAuth, async (req, res) => {
    try {
        const totalVisits = await redisClient.get('total:visits');
        const uniqueVisitors = await redisClient.keys('visitor:*');
        const mobileVisits = await redisClient.get('mobile:visits') || 0;

        res.json({
            totalVisits: parseInt(totalVisits) || 0,
            uniqueVisitors: uniqueVisitors.length || 0,
            mobileVisits: parseInt(mobileVisits) || 0,
            status: 'success'
        });
    } catch (err) {
        res.status(500).json({ error: err.message, status: 'error' });
    }
});

app.get('/admin/api/visitors', adminAuth, async (req, res) => {
    try {
        const range = req.query.range || '7d';
        const now = Date.now();
        let cutoff = now;
        
        switch(range) {
            case '24h':
                cutoff = now - (24 * 60 * 60 * 1000);
                break;
            case '7d':
                cutoff = now - (7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                cutoff = now - (30 * 24 * 60 * 60 * 1000);
                break;
            case 'all':
                cutoff = 0;
                break;
        }

        const keys = await redisClient.keys('visitor:*');
        const visitors = await Promise.all(
            keys.map(async key => {
                const visits = await redisClient.zRangeByScore(key, cutoff, now);
                return {
                    ip: key.replace('visitor:', ''),
                    visits: visits.map(JSON.parse)
                };
            })
        );
        
        visitors.sort((a, b) => {
            return new Date(b.visits[b.visits.length-1].timestamp) - 
                   new Date(a.visits[a.visits.length-1].timestamp);
        });

        res.json({ visitors, status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message, status: 'error' });
    }
});

app.get('/admin/api/visitors/:ip', adminAuth, async (req, res) => {
    try {
        const visits = await redisClient.zRange(`visitor:${req.params.ip}`, 0, -1);
        res.json({
            ip: req.params.ip,
            visits: visits.map(JSON.parse),
            status: 'success'
        });
    } catch (err) {
        res.status(500).json({ error: err.message, status: 'error' });
    }
});

app.get('/admin/api/performance', adminAuth, (req, res) => {
    try {
        res.json({
            avgLoadTime: 0, // Would be calculated from actual metrics
            memoryUsage: process.memoryUsage().rss,
            uptime: process.uptime(),
            cpuUsage: os.loadavg()[0],
            status: 'success'
        });
    } catch (err) {
        res.status(500).json({ error: err.message, status: 'error' });
    }
});

app.get('/admin/api/export', adminAuth, async (req, res) => {
    try {
        const keys = await redisClient.keys('visitor:*');
        const visitors = await Promise.all(
            keys.map(async key => {
                const visits = await redisClient.zRange(key, 0, -1);
                return {
                    ip: key.replace('visitor:', ''),
                    visits: visits.map(JSON.parse)
                };
            })
        );

        // Create CSV header
        let csv = 'IP,Timestamp,Device,OS,Browser,Location,Path,Referrer,Is Mobile\n';
        
        // Add each visit as a row
        visitors.forEach(visitor => {
            visitor.visits.forEach(visit => {
                const location = visit.geo ? 
                    `${visit.geo.city || ''}${visit.geo.city && visit.geo.country ? ', ' : ''}${visit.geo.country || ''}` : 
                    'Unknown';
                
                csv += `"${visitor.ip}","${visit.timestamp}","${visit.device || 'Unknown'}","${visit.os || 'Unknown'}","${visit.browser || 'Unknown'}","${location}","${visit.path || '/'}","${visit.referrer || 'Direct'}","${visit.isMobile ? 'Yes' : 'No'}"\n`;
            });
        });

        // Set headers and send CSV
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=visitors-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: err.message, status: 'error' });
    }
});

// Connect to Redis and Start Server
(async () => {
    try {
        await redisClient.connect();
        console.log('Connected to Redis');
        
        server.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Admin panel: http://localhost:${PORT}/admin`);
        });
    } catch (err) {
        console.error('Redis connection error:', err);
        process.exit(1);
    }
})();

process.on('SIGINT', () => {
    redisClient.quit();
    process.exit();
});
