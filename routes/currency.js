const express = require('express');
const { body, validationResult, param } = require('express-validator');
const Currency = require('../models/Currency');
const { auth, checkModulePermission } = require('../middleware/auth');

const router = express.Router();

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// @route   POST /api/currency
// @desc    Add currency
// @access  Private
router.post(
  '/',
  auth,
  checkModulePermission('settings', 'create'),
  [
    body('countryName').trim().notEmpty().withMessage('Country name is required'),
    body('currencyName').trim().notEmpty().withMessage('Currency name is required'),
    body('currencyCode')
      .trim()
      .notEmpty()
      .withMessage('Currency code is required')
      .isLength({ min: 3, max: 10 })
      .withMessage('Currency code must be 3-10 characters'),
    body('aedRate')
      .notEmpty()
      .withMessage('AED rate is required')
      .isFloat({ min: 0 })
      .withMessage('AED rate must be a number >= 0'),
    body('status').optional().isBoolean().withMessage('Status must be boolean'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const rate = Number(req.body.aedRate);

      const payload = {
        countryName: req.body.countryName,
        currencyName: req.body.currencyName,
        currencyCode: String(req.body.currencyCode).trim().toUpperCase(),
        aedRate: rate,
        status: req.body.status !== undefined ? Boolean(req.body.status) : true,
      };

      const countryRegex = new RegExp(`^${escapeRegExp(String(req.body.countryName).trim())}$`, 'i');

      // Include soft-deleted rows: unique index still blocks re-insert with same code
      const existingByCode = await Currency.findOne({ currencyCode: payload.currencyCode });
      if (existingByCode) {
        if (existingByCode.isDeleted) {
          const countryTaken = await Currency.findOne({
            isDeleted: false,
            countryName: countryRegex,
            _id: { $ne: existingByCode._id }
          });
          if (countryTaken) {
            return res.status(400).json({
              message: `Another active currency already uses country "${countryTaken.countryName}"`
            });
          }
          existingByCode.isDeleted = false;
          existingByCode.countryName = payload.countryName;
          existingByCode.currencyName = payload.currencyName;
          existingByCode.aedRate = payload.aedRate;
          existingByCode.status = payload.status;
          await existingByCode.save();
          return res.status(200).json({ currency: existingByCode, restored: true });
        }
        return res.status(400).json({
          message: `Currency code ${payload.currencyCode} is already used for ${existingByCode.countryName}`,
          existingId: existingByCode._id
        });
      }

      const dupCountry = await Currency.findOne({ countryName: countryRegex });
      if (dupCountry) {
        if (dupCountry.isDeleted) {
          dupCountry.isDeleted = false;
          dupCountry.currencyName = payload.currencyName;
          dupCountry.currencyCode = payload.currencyCode;
          dupCountry.aedRate = payload.aedRate;
          dupCountry.status = payload.status;
          await dupCountry.save();
          return res.status(200).json({ currency: dupCountry, restored: true });
        }
        return res.status(400).json({ message: 'A currency is already configured for this country' });
      }

      const currency = new Currency(payload);
      await currency.save();

      res.status(201).json({ currency });
    } catch (error) {
      console.error('Create currency error:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Currency code must be unique' });
      }
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   GET /api/currency
// @desc    List all currencies
// @access  Private
router.get('/', auth, checkModulePermission('settings', 'view'), async (req, res) => {
  try {
    const includeDeleted = String(req.query.includeDeleted || '').toLowerCase() === 'true';
    const active = await Currency.find({ isDeleted: false }).sort({ countryName: 1, currencyCode: 1 });
    if (!includeDeleted) {
      return res.json({ currencies: active });
    }
    const hidden = await Currency.find({ isDeleted: true }).sort({ countryName: 1, currencyCode: 1 });
    res.json({ currencies: active, hidden });
  } catch (error) {
    console.error('List currencies error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/currency/:id/restore
// @desc    Restore a soft-deleted currency
// @access  Private
router.post('/:id/restore', auth, checkModulePermission('settings', 'edit'), async (req, res) => {
  try {
    const currency = await Currency.findById(req.params.id);
    if (!currency || !currency.isDeleted) {
      return res.status(404).json({ message: 'Deleted currency not found' });
    }

    const codeClash = await Currency.findOne({
      currencyCode: currency.currencyCode,
      isDeleted: false,
      _id: { $ne: currency._id }
    });
    if (codeClash) {
      return res.status(400).json({
        message: `Cannot restore: ${currency.currencyCode} is already active for ${codeClash.countryName}`
      });
    }

    const countryClash = await Currency.findOne({
      isDeleted: false,
      countryName: new RegExp(`^${escapeRegExp(String(currency.countryName || '').trim())}$`, 'i'),
      _id: { $ne: currency._id }
    });
    if (countryClash) {
      return res.status(400).json({
        message: `Cannot restore: country "${currency.countryName}" already has an active currency`
      });
    }

    currency.isDeleted = false;
    await currency.save();
    res.json({ currency, restored: true });
  } catch (error) {
    console.error('Restore currency error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/currency/:id
// @desc    Update currency (name, rate, status)
// @access  Private
router.put(
  '/:id',
  auth,
  checkModulePermission('settings', 'edit'),
  [
    param('id').notEmpty().withMessage('Currency id is required'),
    body('currencyName').optional().trim().notEmpty().withMessage('Currency name cannot be empty'),
    body('aedRate').optional().isFloat({ min: 0 }).withMessage('AED rate must be a number >= 0'),
    body('status').optional().isBoolean().withMessage('Status must be boolean'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const currency = await Currency.findOne({ _id: req.params.id, isDeleted: false });
      if (!currency) return res.status(404).json({ message: 'Currency not found' });

      if (req.body.currencyName !== undefined) currency.currencyName = req.body.currencyName;
      if (req.body.aedRate !== undefined) currency.aedRate = Number(req.body.aedRate);
      if (req.body.status !== undefined) currency.status = Boolean(req.body.status);

      await currency.save();
      res.json({ currency });
    } catch (error) {
      console.error('Update currency error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   DELETE /api/currency/:id
// @desc    Delete currency (soft delete)
// @access  Private
router.delete('/:id', auth, checkModulePermission('settings', 'delete'), async (req, res) => {
  try {
    const currency = await Currency.findOne({ _id: req.params.id, isDeleted: false });
    if (!currency) return res.status(404).json({ message: 'Currency not found' });

    currency.isDeleted = true;
    await currency.save();

    res.json({ message: 'Currency deleted successfully' });
  } catch (error) {
    console.error('Delete currency error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

