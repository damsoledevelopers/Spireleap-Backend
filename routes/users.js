const express = require('express');
const { body, validationResult, param } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');
const { auth, authorize, checkModulePermission } = require('../middleware/auth');
const emailService = require('../services/emailService');
const Agency = require('../models/Agency');

const router = express.Router();

// @route   POST /api/users
// @desc    Create new user
// @access  Private (Super Admin only)
router.post('/', [
  auth,
  checkModulePermission('users', 'create'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['super_admin', 'agency_admin', 'agent', 'staff', 'user']).withMessage('Invalid role'),
  body('phone').optional().trim(),
  body('address').optional(),
  body('agency').optional(),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      address,
      role = 'user',
      agency,
      isActive = true
    } = req.body;

    // Agency Admin restrictions
    if (req.user.role === 'agency_admin') {
      // Can only create agents or staff (or generic users)
      if (['super_admin', 'agency_admin'].includes(role)) {
        return res.status(403).json({ message: 'Agency admins can only create agents or staff' });
      }
      // Force agency to be their own
      if (agency && agency !== req.user.agency.toString()) {
        // If they tried to pass a different agency
        return res.status(403).json({ message: 'You can only create users for your own agency' });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Create new user
    const userData = {
      firstName,
      lastName,
      email,
      password,
      phone,
      address,
      role,
      role,
      agency: req.user.role === 'agency_admin' ? req.user.agency : (agency || null),
      isActive
    };

    const user = new User(userData);
    await user.save();

    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;

    // Send welcome email with credentials in background
    setImmediate(async () => {
      try {
        const agencyData = user.agency ? await Agency.findById(user.agency).select('name') : null;
        const userWithAgency = user.toObject();
        userWithAgency.agency = agencyData;

        await emailService.sendAccountCreatedNotification(userWithAgency, password);
      } catch (emailError) {
        console.error('Error sending account creation email:', emailError);
      }
    });

    res.status(201).json({
      message: 'User created successfully',
      user: userResponse
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users
// @desc    Get all users with filtering
// @access  Private (Super Admin, Agency Admin)
router.get('/', [
  auth,
  checkModulePermission('users', 'view')
], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const {
      role,
      search,
      isActive,
      agency,
      department,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};

    if (role) {
      filter.role = role;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    if (department) {
      filter['staffInfo.department'] = department;
    }

    // Date range filtering
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        // Set to end of day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Agency filtering - if agency query param is provided, use it (for super_admin and staff)
    if (agency && (req.user.role === 'super_admin' || req.user.role === 'staff')) {
      if (mongoose.Types.ObjectId.isValid(agency)) {
        filter.agency = new mongoose.Types.ObjectId(agency);
      } else {
        filter.agency = agency;
      }
    } else if (req.user.role === 'agency_admin') {
      // Agency admin: only agents/users created or added by this agency
      const agencyId = req.user.agency;
      if (agencyId && mongoose.Types.ObjectId.isValid(agencyId)) {
        filter.agency = new mongoose.Types.ObjectId(agencyId);
      } else {
        filter.agency = agencyId;
      }
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(filter)
      .select('-password')
      .populate('agency', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(filter);

    res.json({
      users,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        limit
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/stats/overview
// @desc    Get user statistics
// @access  Private (Super Admin only)
router.get('/stats/overview', [
  auth,
  authorize('super_admin')
], async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const usersByRole = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    const recentUsers = await User.find()
      .select('firstName lastName email role createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      usersByRole,
      recentUsers
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/:id
// @desc    Get single user
// @access  Private
router.get('/:id', [
  auth,
  param('id').custom((value) => {
    if (!value) {
      throw new Error('User ID is required');
    }
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid user ID format');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Additional safety check
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('agency', 'name logo');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check access permissions
    // Get user agency ID (handle both populated object and ID string)
    let targetUserAgencyId = null;
    if (user.agency) {
      if (user.agency._id) {
        targetUserAgencyId = user.agency._id.toString();
      } else if (typeof user.agency === 'string' || (user.agency.toString && typeof user.agency.toString === 'function')) {
        targetUserAgencyId = user.agency.toString();
      } else {
        targetUserAgencyId = user.agency;
      }
    }

    // Get requesting user agency ID (handle both populated object and ID string)
    let requestingUserAgencyId = null;
    if (req.user.agency) {
      if (req.user.agency._id) {
        requestingUserAgencyId = req.user.agency._id.toString();
      } else if (typeof req.user.agency === 'string' || (req.user.agency.toString && typeof req.user.agency.toString === 'function')) {
        requestingUserAgencyId = req.user.agency.toString();
      } else {
        requestingUserAgencyId = req.user.agency;
      }
    }

    // Super admin can view any user
    if (req.user.role === 'super_admin') {
      return res.json(user);
    }

    // Agency admin can only view users from their agency
    if (req.user.role === 'agency_admin') {
      if (!requestingUserAgencyId || targetUserAgencyId !== requestingUserAgencyId) {
        return res.status(403).json({ message: 'Not authorized to view this user' });
      }
      return res.json(user);
    }

    // Users can view their own profile
    if (req.user.id === req.params.id) {
      return res.json(user);
    }

    // All other cases: deny access
    return res.status(403).json({ message: 'Not authorized to view this user' });
  } catch (error) {
    console.error('Get user error:', error);
    // Handle CastError (invalid ObjectId)
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private
router.put('/:id', [
  auth,
  param('id').custom((value) => {
    if (!value) {
      throw new Error('User ID is required');
    }
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid user ID format');
    }
    return true;
  }),
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().trim(),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('address').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Additional safety check
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const oldRole = user.role;

    // Check access permissions
    // Get user agency ID (handle both populated object and ID string)
    const targetUserAgencyId = user.agency?._id
      ? user.agency._id.toString()
      : (user.agency?.toString() || user.agency);

    // Get requesting user agency ID (handle both populated object and ID string)
    const requestingUserAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin') {
      if (targetUserAgencyId !== requestingUserAgencyId) {
        return res.status(403).json({ message: 'Not authorized to update this user' });
      }
      // Agency admin cannot change role to super_admin
      if (req.body.role === 'super_admin') {
        delete req.body.role;
      }
    } else if (req.user.role !== 'super_admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }

    // Prevent role changes for non-super-admins
    if (req.user.role !== 'super_admin' && req.body.role) {
      delete req.body.role;
    }

    // Only super_admin and agency_admin (for their agency's agents) can change passwords for other users
    // Regular users can only change their own password via the password endpoint
    if (req.body.password) {
      if (req.user.role === 'super_admin') {
        // Super admin can change any user's password
      } else if (req.user.role === 'agency_admin' && targetUserAgencyId === requestingUserAgencyId) {
        // Agency admin can change passwords for users in their agency
      } else if (req.user.id === req.params.id) {
        // Users can change their own password
      } else {
        // Not authorized to change this user's password
        delete req.body.password;
      }
    }

    // Prepare update data
    const updateData = { ...req.body };

    // If password is provided, we need to use .save() to trigger the pre-save hook for hashing
    // Otherwise, we can use findByIdAndUpdate for better performance
    if (updateData.password) {
      // Fetch the user document to use .save() which triggers password hashing
      const userToUpdate = await User.findById(req.params.id);
      if (!userToUpdate) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Update all fields
      Object.keys(updateData).forEach(key => {
        if (key === 'password') {
          // Set password directly - pre-save hook will hash it
          userToUpdate.password = updateData.password;
        } else if (key === 'address' && updateData.address) {
          // Merge address object
          userToUpdate.address = { ...userToUpdate.address, ...updateData.address };
        } else {
          userToUpdate[key] = updateData[key];
        }
      });

      // Save the document - this will trigger the pre-save hook to hash the password
      await userToUpdate.save();

      // Fetch the updated user without password
      const updatedUser = await User.findById(req.params.id).select('-password');

      res.json({
        message: 'User updated successfully',
        user: updatedUser
      });

      // Send notifications in background
      setImmediate(async () => {
        try {
          if (updateData.role && updateData.role !== oldRole) {
            await emailService.sendRoleChangeNotification(updatedUser, oldRole, updateData.role);
          } else {
            // If role didn't change, it's a profile update
            await emailService.sendProfileUpdateNotification(updatedUser);
          }
        } catch (emailError) {
          console.error('Error sending update notification email:', emailError);
        }
      });
    } else {
      // No password update, use findByIdAndUpdate for better performance
      const updatedUser = await User.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      ).select('-password');

      res.json({
        message: 'User updated successfully',
        user: updatedUser
      });

      // Send notifications in background
      setImmediate(async () => {
        try {
          if (updateData.role && updateData.role !== oldRole) {
            await emailService.sendRoleChangeNotification(updatedUser, oldRole, updateData.role);
          } else {
            // If role didn't change, it's a profile update
            await emailService.sendProfileUpdateNotification(updatedUser);
          }
        } catch (emailError) {
          console.error('Error sending update notification email:', emailError);
        }
      });
    }
  } catch (error) {
    console.error('Update user error:', error);
    // Handle CastError (invalid ObjectId)
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/:id/status
// @desc    Update user status (activate/deactivate)
// @access  Private (Super Admin, Agency Admin)
router.put('/:id/status', [
  auth,
  checkModulePermission('users', 'edit'),
  param('id').custom((value) => {
    if (!value) {
      throw new Error('User ID is required');
    }
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid user ID format');
    }
    return true;
  }),
  body('isActive').isBoolean().withMessage('isActive must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Additional safety check
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Agency admin can only update users from their agency
    if (req.user.role === 'agency_admin' && user.agency?.toString() !== req.user.agency) {
      return res.status(403).json({
        message: 'Not authorized to update this user status'
      });
    }

    user.isActive = req.body.isActive;
    await user.save();

    res.json({
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Update user status error:', error);
    // Handle CastError (invalid ObjectId)
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user
// @access  Private (Super Admin, Agency Admin, Self)
router.delete('/:id', [
  auth,
  param('id').custom((value) => {
    if (!value) {
      throw new Error('User ID is required');
    }
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid user ID format');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Additional safety check
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Authorization Logic
    const isSelf = user._id.toString() === req.user.id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const isAgencyAdmin = req.user.role === 'agency_admin';

    // 1. Allow Self Deletion
    // 2. Allow Super Admin to delete anyone
    // 3. Allow Agency Admin to delete users in their agency (check agency match)

    if (!isSelf && !isSuperAdmin) {
      if (isAgencyAdmin) {
        // Check if target user belongs to the same agency
        if (user.agency?.toString() !== req.user.agency) {
          return res.status(403).json({ message: 'Not authorized to delete this user (Agency Mismatch)' });
        }
      } else {
        // Agents/Staff/Users cannot delete others
        return res.status(403).json({ message: 'Not authorized to delete this user' });
      }
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      message: 'User deleted successfully',
      deletedUser: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    // Handle CastError (invalid ObjectId)
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/:id/password
// @desc    Change user password
// @access  Private
router.put('/:id/password', [
  auth,
  param('id').custom((value) => {
    if (!value) {
      throw new Error('User ID is required');
    }
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid user ID format');
    }
    return true;
  }),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Additional safety check
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const user = await User.findById(req.params.id).select('+password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check access permissions
    if (req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Not authorized to change this password' });
    }

    const { currentPassword, newPassword } = req.body;

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Send confirmation email in background
    setImmediate(async () => {
      try {
        await emailService.sendPasswordChangeConfirmation(user);
      } catch (emailError) {
        console.error('Error sending password confirmation email:', emailError);
      }
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    // Handle CastError (invalid ObjectId)
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
