const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RolePermission = require('../models/RolePermission');

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

const checkModulePermission = (moduleName, action) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Super Admin has all permissions bypass
      if (req.user.role === 'super_admin') {
        return next();
      }

      const rolePermission = await RolePermission.findOne({ role: req.user.role });

      if (!rolePermission) {
        // Fallback: If no permissions defined, check if role is allowed via static authorize
        // For now, we'll allow it to continue if it's a known role, but normally we'd deny.
        // Let's be strict for security.
        return res.status(403).json({ message: `Access denied. No module permissions defined for role: ${req.user.role}` });
      }

      const modulePerms = rolePermission.permissions[moduleName];
      if (modulePerms && modulePerms[action]) {
        return next();
      }

      console.log(`Permission denied - Role: ${req.user.role}, Module: ${moduleName}, Action: ${action}`);
      return res.status(403).json({
        message: `Access denied. You do not have permission to ${action} ${moduleName}.`,
        module: moduleName,
        action: action
      });
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Server error during permission check' });
    }
  };
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
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
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = { auth, authorize, optionalAuth, checkModulePermission };
