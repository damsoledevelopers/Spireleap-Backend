const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'Token is not valid' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      agency: user.agency ? user.agency.toString() : null
    };
    
    console.log('Auth middleware - User ID:', req.user.id, 'Role:', req.user.role, 'Agency:', req.user.agency || 'None');
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    console.log('Authorization check - User role:', req.user?.role, 'Required roles:', roles);
    
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      console.log('Authorization failed - User role:', req.user.role, 'not in required roles:', roles);
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.',
        userRole: req.user.role,
        requiredRoles: roles
      });
    }

    console.log('Authorization successful');
    next();
  };
};

// Optional auth middleware - doesn't fail if no token, but sets req.user if authenticated
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      // No token, continue without setting req.user
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const user = await User.findById(decoded.userId);
    
    if (user && user.isActive) {
      req.user = {
        id: user._id.toString(),
        role: user.role,
        email: user.email,
        agency: user.agency ? user.agency.toString() : null
      };
      console.log('Optional auth - User ID:', req.user.id, 'Role:', req.user.role, 'Agency:', req.user.agency || 'None');
    }
    
    next();
  } catch (error) {
    // If token is invalid, just continue without setting req.user
    console.log('Optional auth - Invalid token, continuing without authentication');
    next();
  }
};

module.exports = { auth, authorize, optionalAuth };
