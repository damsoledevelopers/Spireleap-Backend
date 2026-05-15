const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const Amenity = require('../models/Amenity');
const Currency = require('../models/Currency');
const Location = require('../models/Location');
const { auth, authorize, optionalAuth, checkModulePermission } = require('../middleware/auth');
const emailService = require('../services/emailService');

const router = express.Router();

// ==================== DROPDOWN OPTIONS (Centralized) ====================
// @route   GET /api/settings/dropdown-options
// @desc    Get centralized dropdown option sets for frontend forms
// @access  Public
router.get('/dropdown-options', optionalAuth, async (req, res) => {
  try {
    const currencyDocs = await Currency.find({ isDeleted: false, status: true })
      .select('currencyCode aedRate')
      .sort({ currencyCode: 1 })
      .lean();

    const currencyCodes = (currencyDocs || [])
      .map((d) => String(d.currencyCode || '').trim().toUpperCase())
      .filter(Boolean);

    const currencyRates = (currencyDocs || []).reduce((acc, d) => {
      const code = String(d.currencyCode || '').trim().toUpperCase();
      const rate = Number(d.aedRate);
      if (code && Number.isFinite(rate) && rate > 0) {
        acc[code] = rate;
      }
      return acc;
    }, { AED: 1 });

    const locationDocs = await Location.find({ isDeleted: false, isActive: true })
      .select('country state city')
      .sort({ country: 1, state: 1, city: 1 })
      .lean();

    const locations = (locationDocs || []).map((loc) => {
      const country = String(loc.country || '').trim();
      const state = String(loc.state || '').trim();
      const city = String(loc.city || '').trim();
      const parts = [city, state, country].filter(Boolean);
      return {
        country,
        state,
        city,
        label: parts.join(', '),
      };
    });

    res.json({
      paginationLimits: [10, 20, 50, 100],
      currencies: currencyCodes.length > 0 ? currencyCodes : ['AED', 'USD', 'INR'],
      currencyRates,
      timezones: [
        '(UTC +00:00) Coordinated Universal Time',
        '(UTC +05:30) India Standard Time',
        '(UTC -05:00) Eastern Standard Time',
        '(UTC -08:00) Pacific Standard Time',
        '(UTC +00:00) Greenwich Mean Time'
      ],
      languages: ['English', 'Spanish', 'French', 'German'],
      logLevels: ['debug', 'info', 'warn', 'error'],
      backupFrequencies: ['hourly', 'daily', 'weekly', 'monthly'],
      budgetCurrencies: ['USD', 'EUR', 'GBP'],
      inquiryTimelines: [
        { value: 'immediate', label: 'Immediate' },
        { value: '1_month', label: '1 Month' },
        { value: '3_months', label: '3 Months' },
        { value: '6_months', label: '6 Months' },
        { value: '1_year', label: '1 Year' },
        { value: 'flexible', label: 'Flexible' }
      ],
      leadSources: [
        { value: 'website', label: 'Website' },
        { value: 'phone', label: 'Phone' },
        { value: 'email', label: 'Email' },
        { value: 'walk_in', label: 'Walk In' },
        { value: 'referral', label: 'Referral' },
        { value: 'social_media', label: 'Social Media' },
        { value: 'other', label: 'Other' }
      ],
      leadPriorities: [
        { value: 'Hot', label: 'Hot' },
        { value: 'Warm', label: 'Warm' },
        { value: 'Cold', label: 'Cold' },
        { value: 'Not_interested', label: 'Not Interested' }
      ],
      leadStatuses: [
        { value: 'new', label: 'New Lead' },
        { value: 'contacted', label: 'Contacted' },
        { value: 'qualified', label: 'Qualified' },
        { value: 'site_visit_scheduled', label: 'Site Visit Scheduled' },
        { value: 'site_visit_completed', label: 'Site Visit Completed' },
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'booked', label: 'Booked' },
        { value: 'lost', label: 'Lost' },
        { value: 'closed', label: 'Closed' },
        { value: 'junk', label: 'Junk / Invalid' }
      ],
      autoAssignMethods: [
        { value: 'round_robin', label: 'Round-Robin' },
        { value: 'workload', label: 'Workload-Based (Least Leads)' },
        { value: 'location', label: 'Location-Based' },
        { value: 'project', label: 'Project-Based' },
        { value: 'source', label: 'Source-Based' },
        { value: 'smart', label: 'Smart Assignment' }
      ],
      locations,
    });
  } catch (error) {
    console.error('Get dropdown options error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== CATEGORIES (Moved from CMS) ====================
//
// NOTE: These endpoints were previously under `/api/cms/*`.
// They are now available under `/api/settings/*` with the same behavior.

// @route   GET /api/settings/categories
// @desc    Get all categories
// @access  Public (with optional auth for admin access)
router.get('/categories', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    // Only show active categories to non-admin users
    // Admins can see all categories including inactive ones
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.isActive = true;
    }
    const categories = await Category.find(filter).sort('order');
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/settings/categories
// @desc    Create category
// @access  Private (Super Admin)
router.post('/categories', auth, checkModulePermission('settings', 'create'), [
  body('name')
    .trim()
    .notEmpty().withMessage('Category name is required')
    .matches(/^[A-Za-z\s.'-]+$/).withMessage('Category name must contain only alphabets')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const category = new Category(req.body);
    await category.save();
    res.status(201).json({ category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/settings/categories/:id
// @desc    Update category
// @access  Private
router.put('/categories/:id', auth, checkModulePermission('settings', 'edit'), async (req, res) => {
  try {
    if (req.body.name !== undefined && req.body.name !== null && String(req.body.name).trim() !== '') {
      const nameVal = String(req.body.name).trim()
      if (!/^[A-Za-z\s.'-]+$/.test(nameVal)) {
        return res.status(400).json({ errors: [{ msg: 'Category name must contain only alphabets', path: 'name' }] })
      }
      req.body.name = nameVal
    }
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    Object.assign(category, req.body);
    await category.save();
    res.json({ category });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/settings/categories/:id
// @desc    Delete category
// @access  Private
router.delete('/categories/:id', auth, checkModulePermission('settings', 'delete'), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    await category.deleteOne();
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== AMENITIES (Moved from CMS) ====================

// @route   GET /api/settings/amenities
// @desc    Get all amenities
// @access  Public (with optional auth for admin access)
router.get('/amenities', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    // Only show active amenities to non-admin users
    // Admins can see all amenities including inactive ones
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.isActive = true;
    }
    if (req.query.category) {
      filter.category = req.query.category;
    }
    const amenities = await Amenity.find(filter).sort('order');
    res.json({ amenities });
  } catch (error) {
    console.error('Get amenities error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/settings/amenities
// @desc    Create amenity
// @access  Private (Super Admin)
router.post('/amenities', auth, checkModulePermission('settings', 'create'), [
  body('name')
    .trim()
    .notEmpty().withMessage('Amenity name is required')
    .matches(/^[A-Za-z\s.'-]+$/).withMessage('Amenity name must contain only alphabets'),
  body('category')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (!value || value === '') return true; // Allow empty strings
      return ['interior', 'exterior', 'community', 'security', 'other'].includes(value);
    })
    .withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Clean up the data - only send valid fields
    const amenityData = {
      name: req.body.name.trim(),
      icon: req.body.icon?.trim() || undefined,
      category: req.body.category && req.body.category.trim() && ['interior', 'exterior', 'community', 'security', 'other'].includes(req.body.category.trim())
        ? req.body.category.trim()
        : 'other',
      order: parseInt(req.body.order) || 0,
      isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true
    };

    const amenity = new Amenity(amenityData);
    await amenity.save();
    res.status(201).json({ amenity });
  } catch (error) {
    console.error('Create amenity error:', error);

    // Return more specific error messages
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validation error', errors });
    }

    if (error.code === 11000) {
      // Duplicate key error (unique constraint violation)
      return res.status(400).json({ message: 'An amenity with this name already exists' });
    }

    res.status(500).json({
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// @route   PUT /api/settings/amenities/:id
// @desc    Update amenity
// @access  Private
router.put('/amenities/:id', auth, checkModulePermission('settings', 'edit'), async (req, res) => {
  try {
    if (req.body.name !== undefined && req.body.name !== null && String(req.body.name).trim() !== '') {
      const nameVal = String(req.body.name).trim()
      if (!/^[A-Za-z\s.'-]+$/.test(nameVal)) {
        return res.status(400).json({ errors: [{ msg: 'Amenity name must contain only alphabets', path: 'name' }] })
      }
      req.body.name = nameVal
    }
    const amenity = await Amenity.findById(req.params.id);
    if (!amenity) {
      return res.status(404).json({ message: 'Amenity not found' });
    }

    Object.assign(amenity, req.body);
    await amenity.save();
    res.json({ amenity });
  } catch (error) {
    console.error('Update amenity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/settings/amenities/:id
// @desc    Delete amenity
// @access  Private
router.delete('/amenities/:id', auth, checkModulePermission('settings', 'delete'), async (req, res) => {
  try {
    const amenity = await Amenity.findById(req.params.id);
    if (!amenity) {
      return res.status(404).json({ message: 'Amenity not found' });
    }

    await amenity.deleteOne();
    res.json({ message: 'Amenity deleted successfully' });
  } catch (error) {
    console.error('Delete amenity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== LOCATIONS ====================

// @route   GET /api/settings/locations
// @desc    List locations (active for public; all for admins)
// @access  Public (optional auth)
router.get('/locations', optionalAuth, async (req, res) => {
  try {
    const filter = { isDeleted: false };
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.isActive = true;
    }
    const locations = await Location.find(filter).sort({ country: 1, state: 1, city: 1 });
    res.json({ locations });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/settings/locations
// @desc    Create location
// @access  Private
router.post(
  '/locations',
  auth,
  checkModulePermission('settings', 'create'),
  [
    body('country').trim().notEmpty().withMessage('Country is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('state').optional({ values: 'falsy' }).trim(),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = {
        country: String(req.body.country || '').trim(),
        state: String(req.body.state || '').trim(),
        city: String(req.body.city || '').trim(),
        countryName: String(req.body.country || '').trim(),
        stateName: String(req.body.state || '').trim(),
        cityName: String(req.body.city || '').trim(),
        isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
      };

      console.log('payload', payload);

      const location = new loc(payload);
      await location.save();
      res.status(201).json({ location });
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(400).json({ message: 'A location with this country, state and city already exists' });
      }
      console.error('Create location error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   POST /api/settings/locations/bulk
// @desc    Create multiple cities for a single country/state (idempotent)
// @access  Private
router.post(
  '/locations/bulk',
  auth,
  checkModulePermission('settings', 'create'),
  [
    body('country').trim().notEmpty().withMessage('Country is required'),
    body('state').optional({ values: 'falsy' }).trim(),
    body('cities').isArray({ min: 1 }).withMessage('Cities must be an array with at least 1 item'),
    body('cities.*').trim().notEmpty().withMessage('City is required'),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const country = String(req.body.country || '').trim();
      const state = String(req.body.state || '').trim();
      const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : true;

      const rawCities = Array.isArray(req.body.cities) ? req.body.cities : [];
      const normalizedCities = rawCities.map((c) => String(c || '').trim()).filter(Boolean);
      const uniqueCities = Array.from(new Set(normalizedCities));

      if (uniqueCities.length === 0) {
        return res.status(400).json({ message: 'Cities must contain at least 1 non-empty city' });
      }

      // Use bulk upserts so re-sending the same payload won't error.
      const ops = uniqueCities.map((city) => ({
        updateOne: {
          filter: { country, state, city, isDeleted: false },
          update: {
            $setOnInsert: {
              country,
              state,
              city,
              countryName: country,
              stateName: state,
              cityName: city,
              isActive,
              isDeleted: false,
            },
          },
          upsert: true,
        },
      }));

      const result = await Location.bulkWrite(ops, { ordered: false });

      const created = result?.upsertedCount || 0;
      const attempted = uniqueCities.length;
      const alreadyExisted = attempted - created;

      return res.status(201).json({ attempted, created, alreadyExisted });
    } catch (error) {
      console.error('Bulk create locations error:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   PUT /api/settings/locations/:id
// @desc    Update location
// @access  Private
router.put(
  '/locations/:id',
  auth,
  checkModulePermission('settings', 'edit'),
  [
    body('country').optional().trim().notEmpty(),
    body('city').optional().trim().notEmpty(),
    body('state').optional({ values: 'falsy' }).trim(),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const location = await Location.findOne({ _id: req.params.id, isDeleted: false });
      if (!location) {
        return res.status(404).json({ message: 'Location not found' });
      }

      if (req.body.country !== undefined) location.country = String(req.body.country).trim();
      if (req.body.state !== undefined) location.state = String(req.body.state || '').trim();
      if (req.body.city !== undefined) location.city = String(req.body.city).trim();
      if (req.body.isActive !== undefined) location.isActive = Boolean(req.body.isActive);

      await location.save();
      res.json({ location });
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(400).json({ message: 'A location with this country, state and city already exists' });
      }
      console.error('Update location error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   DELETE /api/settings/locations/:id
// @desc    Soft-delete location
// @access  Private
router.delete('/locations/:id', auth, checkModulePermission('settings', 'delete'), async (req, res) => {
  try {
    const location = await Location.findOne({ _id: req.params.id, isDeleted: false });
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    location.isDeleted = true;
    location.isActive = false;
    await location.save();
    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Delete location error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

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
    let emailSettingsUpdated = false;

    for (const [key, value] of Object.entries(settings)) {
      // Infers category from the key (e.g., "email.smtpHost" => "email")
      let category = 'general';
      if (key.includes('.')) {
        const prefix = key.split('.')[0];
        const validCategories = ['general', 'email', 'security', 'notifications', 'system', 'sms', 'payment', 'lead_stages'];
        if (validCategories.includes(prefix)) {
          category = prefix;
        }
      }

      const update = await Settings.findOneAndUpdate(
        { key },
        {
          value,
          category,
          updatedBy: req.user.id
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      updates.push(update);

      // Check if any email settings were updated (support both naming conventions)
      if (key.startsWith('smtp_') || key.startsWith('email.smtp') || update.category === 'email') {
        emailSettingsUpdated = true;
      }
    }

    // Reinitialize email service if email settings were updated
    if (emailSettingsUpdated) {
      console.log('Settings: Email settings updated, reinitializing email service...');
      try {
        await emailService.reinitialize();
        console.log('Settings: Email service reinitialized successfully');
      } catch (error) {
        console.error('Settings: Error reinitializing email service:', error);
      }
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

    // Reinitialize email service if email setting was updated (support both naming conventions)
    if (req.params.key.startsWith('smtp_') || req.params.key.startsWith('email.smtp') || setting.category === 'email') {
      console.log('Settings: Email setting updated, reinitializing email service...');
      try {
        await emailService.reinitialize();
        console.log('Settings: Email service reinitialized successfully');
      } catch (error) {
        console.error('Settings: Error reinitializing email service:', error);
      }
    }

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

