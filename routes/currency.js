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

      const dupCountry = await Currency.findOne({
        isDeleted: false,
        countryName: new RegExp(`^${escapeRegExp(String(req.body.countryName).trim())}$`, 'i')
      });
      if (dupCountry) {
        return res.status(400).json({ message: 'A currency is already configured for this country' });
      }

      const existing = await Currency.findOne({ currencyCode: payload.currencyCode, isDeleted: false });
      if (existing) {
        return res.status(400).json({ message: 'Currency code must be unique' });
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
    const currencies = await Currency.find({ isDeleted: false }).sort({ countryName: 1, currencyCode: 1 });
    res.json({ currencies });
  } catch (error) {
    console.error('List currencies error:', error);
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

