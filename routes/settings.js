const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Settings = require('../models/Settings');
const { auth, authorize, checkModulePermission } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/settings
// @desc    Get all settings or by category
// @access  Private (Super Admin)
router.get('/', auth, checkModulePermission('settings', 'view'), async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category ? { category } : {};

    const settings = await Settings.find(filter).sort({ category: 1, key: 1 });

    // Group by category
    const grouped = {};
    settings.forEach(setting => {
      if (!grouped[setting.category]) {
        grouped[setting.category] = {};
      }
      grouped[setting.category][setting.key] = setting.value;
    });

    res.json({ settings: grouped, raw: settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/settings/:key
// @desc    Get specific setting by key
// @access  Private (Super Admin)
router.get('/:key', auth, checkModulePermission('settings', 'view'), async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: req.params.key });

    if (!setting) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    res.json({ setting });
  } catch (error) {
    console.error('Get setting error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/settings
// @desc    Update settings (bulk)
// @access  Private (Super Admin)
router.put('/', [
  auth,
  checkModulePermission('settings', 'edit'),
  body('settings').isObject().withMessage('Settings object is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = [];
    const settings = req.body.settings;

    for (const [key, value] of Object.entries(settings)) {
      const update = await Settings.findOneAndUpdate(
        { key },
        {
          value,
          updatedBy: req.user.id
        },
        {
          upsert: true,
          new: true
        }
      );
      updates.push(update);
    }

    res.json({
      message: 'Settings updated successfully',
      settings: updates
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/settings/:key
// @desc    Update specific setting
// @access  Private (Super Admin)
router.put('/:key', [
  auth,
  checkModulePermission('settings', 'edit'),
  body('value').notEmpty().withMessage('Value is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const setting = await Settings.findOneAndUpdate(
      { key: req.params.key },
      {
        value: req.body.value,
        updatedBy: req.user.id
      },
      {
        upsert: true,
        new: true
      }
    );

    res.json({
      message: 'Setting updated successfully',
      setting
    });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/settings/lead-stages
// @desc    Get configurable lead stages
// @access  Private (Super Admin, Agency Admin)
router.get('/lead-stages', auth, checkModulePermission('settings', 'view'), async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'lead_stages' });

    // Default stages if not configured
    const defaultStages = [
      { value: 'new', label: 'New Lead', order: 1, color: '#3B82F6' },
      { value: 'contacted', label: 'Contacted', order: 2, color: '#10B981' },
      { value: 'qualified', label: 'Qualified', order: 3, color: '#F59E0B' },
      { value: 'site_visit_scheduled', label: 'Site Visit Scheduled', order: 4, color: '#8B5CF6' },
      { value: 'site_visit_completed', label: 'Site Visit Completed', order: 5, color: '#EC4899' },
      { value: 'negotiation', label: 'Negotiation', order: 6, color: '#F97316' },
      { value: 'booked', label: 'Booked', order: 7, color: '#22C55E' },
      { value: 'lost', label: 'Lost / Closed', order: 8, color: '#EF4444' },
      { value: 'junk', label: 'Junk / Invalid', order: 9, color: '#6B7280' }
    ];

    const stages = setting ? setting.value : defaultStages;
    res.json({ stages });
  } catch (error) {
    console.error('Get lead stages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/settings/lead-stages
// @desc    Update configurable lead stages
// @access  Private (Super Admin only)
router.put('/lead-stages', [
  auth,
  checkModulePermission('settings', 'edit'),
  body('stages').isArray().withMessage('Stages array is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const setting = await Settings.findOneAndUpdate(
      { key: 'lead_stages' },
      {
        value: req.body.stages,
        category: 'lead_stages',
        updatedBy: req.user.id
      },
      {
        upsert: true,
        new: true
      }
    );

    res.json({
      message: 'Lead stages updated successfully',
      stages: setting.value
    });
  } catch (error) {
    console.error('Update lead stages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

