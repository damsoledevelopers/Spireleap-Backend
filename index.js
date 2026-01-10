const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
// CORS configuration - allow frontend URL from environment or Render domains
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'https://crm-frontend-1f2f.onrender.com',
  /^https:\/\/.*\.onrender\.com$/
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin matches allowed origins
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      } else if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      // For development, allow localhost
      if (process.env.NODE_ENV !== 'production' || origin.includes('localhost')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Rate limiting - More lenient for development
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files with proper headers
app.use('/uploads', express.static('uploads', {
  setHeaders: (res, path) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}));

// MongoDB connection
const dbName = process.env.MONGODB_DB_NAME || 'spireleap_crm';
const mongoUri = process.env.MONGODB_URI || `mongodb://localhost:27017/${dbName}`;

mongoose.connect(mongoUri)
.then(() => {
  console.log('MongoDB connected successfully');
  console.log(`Database: ${mongoose.connection.name}`);
})
.catch(err => {
  console.error('MongoDB connection error:', err.message);
  console.error('\n⚠️  Make sure MongoDB is running on your system.');
  console.error('   On Windows, you can start it with: net start MongoDB');
  console.error('   Or check if MongoDB service is running in Services.');
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/agencies', require('./routes/agencies'));
app.use('/api/cms', require('./routes/cms'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/email-templates', require('./routes/emailTemplates'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/saved-searches', require('./routes/savedSearches'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/privacy', require('./routes/privacy'));
app.use('/api/gdpr', require('./routes/gdpr'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/erp', require('./routes/erp'));
app.use('/api/stats', require('./routes/stats'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Initialize Socket.IO
const { initializeSocket } = require('./socket');
initializeSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start reminder scheduler if enabled
  if (process.env.ENABLE_REMINDER_SCHEDULER === 'true' || process.env.NODE_ENV === 'production') {
    const reminderScheduler = require('./schedulers/reminderScheduler');
    reminderScheduler.start();
  }
});

module.exports = app;
