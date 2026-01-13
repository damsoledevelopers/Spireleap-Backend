const express = require('express');
const { body, validationResult, query, param } = require('express-validator');
const mongoose = require('mongoose');
const Property = require('../models/Property');
const User = require('../models/User');
const Agency = require('../models/Agency');
const { auth, authorize, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('status').optional().isIn(['draft', 'pending', 'active', 'sold', 'rented', 'inactive']),
  query('propertyType').optional(),
  query('listingType').optional().isIn(['sale', 'rent', 'both']),
  query('city').optional(),
  query('state').optional(),
  query('country').optional(),
  query('area').optional(),
  query('agency').optional(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('bedrooms').optional().isInt({ min: 0 }),
  query('bathrooms').optional().isInt({ min: 0 }),
  query('minArea').optional().isFloat({ min: 0 }),
  query('maxArea').optional().isFloat({ min: 0 }),
  query('featured').optional().isBoolean(),
  query('trending').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};

    // Role-based filtering
    if (req.user) {
      if (req.user.role === 'agency_admin') {
        filter.agency = req.user.agency;
      } else if (req.user.role === 'agent') {
        filter.$or = [
          { agent: req.user.id },
          { createdBy: req.user.id }
        ];
      }
    }

    // Status filtering - query parameter takes precedence
    if (req.query.status && req.query.status.trim() !== '') {
      filter.status = req.query.status.trim();
    } else if (!req.user) {
      // For public (non-authenticated) users, only show active properties
      filter.status = 'active';
    }
    // If user is authenticated and no status filter, show all statuses (no status filter applied)
    if (req.query.propertyType) {
      filter.propertyType = req.query.propertyType;
    }
    if (req.query.listingType) {
      filter.listingType = req.query.listingType;
    }
    // Location filters
    if (req.query.city) {
      filter['location.city'] = new RegExp(req.query.city, 'i');
    }
    if (req.query.state) {
      filter['location.state'] = new RegExp(req.query.state, 'i');
    }
    if (req.query.country) {
      filter['location.country'] = new RegExp(req.query.country, 'i');
    }
    if (req.query.area) {
      const areaConditions = [
        { 'location.address': new RegExp(req.query.area, 'i') },
        { 'location.neighborhood': new RegExp(req.query.area, 'i') },
        { 'location.landmark': new RegExp(req.query.area, 'i') }
      ];

      // If we already have $or from search, combine with $and
      if (filter.$or && filter.$or.length > 0) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: areaConditions });
      } else {
        filter.$or = areaConditions;
      }
    }

    // Agency filter
    if (req.query.agency) {
      filter.agency = req.query.agency;
    }

    // Price filters
    if (req.query.minPrice || req.query.maxPrice) {
      const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
      const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
      const listingType = req.query.listingType;

      const priceConditions = [];

      // For sale properties or when listing type is not specified
      if (!listingType || listingType === 'sale' || listingType === 'both') {
        const salePriceFilter = {};
        if (minPrice !== null || maxPrice !== null) {
          salePriceFilter['price.sale'] = {};
          if (minPrice !== null) salePriceFilter['price.sale'].$gte = minPrice;
          if (maxPrice !== null) salePriceFilter['price.sale'].$lte = maxPrice;
          priceConditions.push(salePriceFilter);
        }
      }

      // For rent properties or when listing type is not specified
      if (!listingType || listingType === 'rent' || listingType === 'both') {
        const rentPriceFilter = {};
        if (minPrice !== null || maxPrice !== null) {
          rentPriceFilter['price.rent.amount'] = {};
          if (minPrice !== null) rentPriceFilter['price.rent.amount'].$gte = minPrice;
          if (maxPrice !== null) rentPriceFilter['price.rent.amount'].$lte = maxPrice;
          priceConditions.push(rentPriceFilter);
        }
      }

      if (priceConditions.length > 0) {
        if (priceConditions.length === 1) {
          // Single condition - merge directly into filter
          Object.assign(filter, priceConditions[0]);
        } else {
          // Multiple conditions - use $or
          if (!filter.$or) {
            filter.$or = [];
          }
          // If there's already an $or from search, we need to use $and
          if (filter.$or.length > 0) {
            filter.$and = filter.$and || [];
            filter.$and.push({ $or: priceConditions });
          } else {
            filter.$or = priceConditions;
          }
        }
      }
    }

    // Specification filters
    if (req.query.bedrooms) {
      filter['specifications.bedrooms'] = parseInt(req.query.bedrooms);
    }
    if (req.query.bathrooms) {
      filter['specifications.bathrooms'] = parseInt(req.query.bathrooms);
    }
    if (req.query.minArea || req.query.maxArea) {
      const areaFilter = {};
      if (req.query.minArea) {
        areaFilter['specifications.area.value'] = { $gte: parseFloat(req.query.minArea) };
      }
      if (req.query.maxArea) {
        if (areaFilter['specifications.area.value']) {
          areaFilter['specifications.area.value'].$lte = parseFloat(req.query.maxArea);
        } else {
          areaFilter['specifications.area.value'] = { $lte: parseFloat(req.query.maxArea) };
        }
      }
      filter.$and = filter.$and || [];
      filter.$and.push(areaFilter);
    }

    if (req.query.featured !== undefined) {
      filter.featured = req.query.featured === 'true';
    }
    if (req.query.trending !== undefined) {
      filter.trending = req.query.trending === 'true';
    }

    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      const searchRegex = new RegExp(searchTerm, 'i');

      const searchConditions = [
        { title: searchRegex },
        { description: searchRegex },
        { tags: searchRegex },
        { propertyType: searchRegex },
        { listingType: searchRegex },
        { status: searchRegex },
        { 'location.address': searchRegex },
        { 'location.city': searchRegex },
        { 'location.state': searchRegex },
        { 'location.country': searchRegex },
        { 'location.neighborhood': searchRegex },
        { 'location.landmark': searchRegex },
        { 'location.zipCode': searchRegex }
      ];

      // Search by agency name - find agencies matching the search term
      try {
        const matchingAgencies = await Agency.find({
          name: searchRegex
        }).select('_id');

        if (matchingAgencies.length > 0) {
          const agencyIds = matchingAgencies.map(agency => agency._id);
          searchConditions.push({ agency: { $in: agencyIds } });
        }
      } catch (error) {
        console.error('Error searching agencies:', error);
        // Continue with other search conditions even if agency search fails
      }

      // Also search in price fields if search term is numeric
      if (!isNaN(searchTerm) && searchTerm !== '') {
        const numericValue = parseFloat(searchTerm);
        searchConditions.push(
          { 'price.sale': numericValue },
          { 'price.rent.amount': numericValue },
          { 'specifications.bedrooms': numericValue },
          { 'specifications.bathrooms': numericValue },
          { 'specifications.area.value': numericValue }
        );
      }

      // If we already have $or from price filters or area filter, combine with $and
      if (filter.$or && filter.$or.length > 0) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: searchConditions });
      } else {
        filter.$or = searchConditions;
      }
    }

    const properties = await Property.find(filter)
      .populate('agency', 'name logo')
      .populate('agent', 'firstName lastName email phone')
      .populate('category', 'name')
      .populate('amenities', 'name icon')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Property.countDocuments(filter);

    res.json({
      properties,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to check if string is a valid MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && (String)(new mongoose.Types.ObjectId(id)) === id;
};

// @route   GET /api/properties/:id/leads
// @desc    Get property leads (must be before /:id route)
// @access  Private
router.get('/:id/leads', auth, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const Lead = require('../models/Lead');
    const leads = await Lead.find({ property: req.params.id })
      .populate('assignedAgent', 'firstName lastName email')
      .populate('agency', 'name')
      .populate('contact', 'firstName lastName email phone')
      .sort({ createdAt: -1 });

    res.json({ leads, total: leads.length });
  } catch (error) {
    console.error('Get property leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/properties/:id/notes
// @desc    Add note to property (must be before /:id route)
// @access  Private
router.post('/:id/notes', [
  auth,
  authorize('super_admin', 'agency_admin', 'agent'),
  body('note').trim().notEmpty().withMessage('Note is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Check permissions
    const propertyAgencyId = property.agency ? property.agency.toString() : null;
    const propertyAgentId = property.agent ? property.agent.toString() : null;

    if (req.user.role === 'agency_admin' && propertyAgencyId && propertyAgencyId !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (req.user.role === 'agent' && propertyAgentId && propertyAgentId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    property.notes.push({
      note: req.body.note,
      createdBy: req.user.id
    });

    await property.save();

    const updatedProperty = await Property.findById(property._id)
      .populate('agency', 'name logo')
      .populate('agent', 'firstName lastName email phone')
      .populate('category', 'name')
      .populate('amenities', 'name icon')
      .populate('notes.createdBy', 'firstName lastName email');

    res.json({ property: updatedProperty });
  } catch (error) {
    console.error('Add property note error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/:id/assign
// @desc    Reassign property to agent (must be before /:id route)
// @access  Private (Super Admin, Agency Admin)
router.put('/:id/assign', [
  auth,
  authorize('super_admin', 'agency_admin'),
  param('id').isMongoId().withMessage('Invalid property ID'),
  body('agent').isMongoId().withMessage('Valid agent ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Check permissions
    const propertyAgencyId = property.agency ? property.agency.toString() : null;

    if (req.user.role === 'agency_admin' && propertyAgencyId && propertyAgencyId !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Validate agent
    const agent = await User.findById(req.body.agent);
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ message: 'Agent not found' });
    }

    if (!agent.isActive) {
      return res.status(400).json({ message: 'Agent account is not active' });
    }

    // Check if agent belongs to the same agency as property
    const agentAgencyId = agent.agency ? agent.agency.toString() : null;
    if (propertyAgencyId && agentAgencyId && propertyAgencyId !== agentAgencyId) {
      return res.status(400).json({ message: 'Agent does not belong to the property agency' });
    }

    // Reassign property
    property.agent = req.body.agent;
    await property.save();

    const updatedProperty = await Property.findById(property._id)
      .populate('agency', 'name logo contact')
      .populate('agent', 'firstName lastName email phone profileImage')
      .populate('category', 'name')
      .populate('amenities', 'name icon');

    res.json({
      message: 'Property reassigned successfully',
      property: updatedProperty
    });
  } catch (error) {
    console.error('Reassign property error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const identifier = req.params.id;
    let property;

    // Check if identifier is a MongoDB ObjectId or a slug
    if (isValidObjectId(identifier)) {
      // It's an ObjectId, search by _id
      property = await Property.findById(identifier)
        .populate('agency', 'name logo contact')
        .populate('agent', 'firstName lastName email phone profileImage')
        .populate('category', 'name')
        .populate('amenities', 'name icon');
    } else {
      // It's a slug, search by slug
      property = await Property.findOne({ slug: identifier })
        .populate('agency', 'name logo contact')
        .populate('agent', 'firstName lastName email phone profileImage')
        .populate('category', 'name')
        .populate('amenities', 'name icon');
    }

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Handle access control with proper null checks
    if (!req.user) {
      if (property.status !== 'active') {
        return res.status(403).json({ message: 'Property not available' });
      }
    } else {
      // Get agency ID safely (handle both populated object and ObjectId)
      const propertyAgencyId = property.agency
        ? (typeof property.agency === 'object' && property.agency._id
          ? property.agency._id.toString()
          : property.agency.toString())
        : null;

      // Get agent ID safely (handle both populated object and ObjectId)
      const propertyAgentId = property.agent
        ? (typeof property.agent === 'object' && property.agent._id
          ? property.agent._id.toString()
          : property.agent.toString())
        : null;

      if (req.user.role === 'agency_admin' && propertyAgencyId && propertyAgencyId !== req.user.agency) {
        return res.status(403).json({ message: 'Access denied' });
      }
      if (req.user.role === 'agent' && propertyAgentId && propertyAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Safely increment viewCount
    if (typeof property.viewCount !== 'number') {
      property.viewCount = 0;
    }
    property.viewCount += 1;
    await property.save();

    res.json({ property });
  } catch (error) {
    console.error('Get property error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/slug/:slug', optionalAuth, async (req, res) => {
  try {
    const property = await Property.findOne({ slug: req.params.slug })
      .populate('agency', 'name logo contact')
      .populate('agent', 'firstName lastName email phone profileImage')
      .populate('category', 'name')
      .populate('amenities', 'name icon');

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Handle access control with proper null checks
    if (!req.user) {
      if (property.status !== 'active') {
        return res.status(403).json({ message: 'Property not available' });
      }
    } else {
      // Get agency ID safely (handle both populated object and ObjectId)
      const propertyAgencyId = property.agency
        ? (typeof property.agency === 'object' && property.agency._id
          ? property.agency._id.toString()
          : property.agency.toString())
        : null;

      // Get agent ID safely (handle both populated object and ObjectId)
      const propertyAgentId = property.agent
        ? (typeof property.agent === 'object' && property.agent._id
          ? property.agent._id.toString()
          : property.agent.toString())
        : null;

      if (req.user.role === 'agency_admin' && propertyAgencyId && propertyAgencyId !== req.user.agency) {
        return res.status(403).json({ message: 'Access denied' });
      }
      if (req.user.role === 'agent' && propertyAgentId && propertyAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Safely increment viewCount
    if (typeof property.viewCount !== 'number') {
      property.viewCount = 0;
    }
    property.viewCount += 1;
    await property.save();

    res.json({ property });
  } catch (error) {
    console.error('Get property by slug error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/', [
  auth,
  authorize('super_admin', 'agency_admin', 'agent'),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('propertyType').isIn(['apartment', 'house', 'villa', 'condo', 'townhouse', 'land', 'commercial', 'office', 'retail', 'warehouse', 'other']).withMessage('Invalid property type'),
  body('listingType').isIn(['sale', 'rent', 'both']).withMessage('Invalid listing type'),
  body('location.address').trim().notEmpty().withMessage('Address is required'),
  body('location.city').trim().notEmpty().withMessage('City is required'),
  body('location.state').trim().notEmpty().withMessage('State is required'),
  body('location.country').trim().notEmpty().withMessage('Country is required'),
  body('specifications.area.value').isNumeric().withMessage('Area value is required'),
  // agency and agent are optional - will be auto-populated from authenticated user
  body('agency').optional().isMongoId().withMessage('Valid agency ID is required'),
  body('agent').optional().isMongoId().withMessage('Valid agent ID is required')
], async (req, res) => {
  try {
    // Auto-populate agency and agent from authenticated user if not provided
    if (!req.body.agency) {
      if (req.user.role === 'agent' || req.user.role === 'agency_admin') {
        req.body.agency = req.user.agency;
      } else if (req.user.role === 'super_admin' && !req.body.agency) {
        return res.status(400).json({ message: 'Agency ID is required for super admin' });
      }
    }

    if (!req.body.agent) {
      if (req.user.role === 'agent') {
        req.body.agent = req.user.id;
      } else if (req.user.role === 'agency_admin' && !req.body.agent) {
        // Agency admin can create properties without specifying agent (optional)
        // But if they do specify, validate it
      }
    }

    // Now validate that agency and agent are present and valid
    if (!req.body.agency) {
      return res.status(400).json({ message: 'Agency ID is required' });
    }

    if (!req.body.agent && req.user.role === 'agent') {
      return res.status(400).json({ message: 'Agent ID is required' });
    }

    // Log the incoming request for debugging
    console.log('=== Property Creation Request ===');
    console.log('User:', {
      id: req.user.id,
      role: req.user.role,
      agency: req.user.agency
    });
    console.log('Request Body Keys:', Object.keys(req.body));
    console.log('Request Body:', {
      title: req.body.title,
      description: req.body.description ? 'Present' : 'Missing',
      propertyType: req.body.propertyType,
      listingType: req.body.listingType,
      agency: req.body.agency,
      agent: req.body.agent,
      location: req.body.location ? {
        address: req.body.location.address,
        city: req.body.location.city,
        state: req.body.location.state,
        country: req.body.location.country
      } : 'Missing',
      specifications: req.body.specifications ? {
        area: req.body.specifications.area
      } : 'Missing'
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('=== Validation Errors ===');
      console.error(JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({ errors: errors.array() });
    }

    if (req.user.role === 'agency_admin' && req.body.agency !== req.user.agency) {
      return res.status(403).json({ message: 'You can only create properties for your agency' });
    }

    if (req.user.role === 'agent' && req.body.agent !== req.user.id) {
      return res.status(403).json({ message: 'You can only create properties assigned to yourself' });
    }

    const agency = await Agency.findById(req.body.agency);
    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    // Validate agent only if provided (required for agents, optional for agency_admin)
    if (req.body.agent) {
      const agent = await User.findById(req.body.agent);
      if (!agent || agent.role !== 'agent') {
        return res.status(404).json({ message: 'Agent not found' });
      }
      if (!agent.isActive) {
        return res.status(400).json({ message: 'Agent account is not active. Please contact your agency admin.' });
      }
      if (agent.agency && agent.agency.toString() !== req.body.agency) {
        return res.status(400).json({ message: 'Agent does not belong to the specified agency' });
      }
      if (!agent.agency) {
        return res.status(400).json({ message: 'Agent is not associated with an agency. Please contact the administrator.' });
      }
    } else if (req.user.role === 'agent') {
      // Agent role must have agent ID (should have been auto-populated above)
      return res.status(400).json({ message: 'Agent ID is required' });
    }

    // Force status to pending for agents
    if (req.user.role === 'agent') {
      req.body.status = 'pending';
    }

    const property = new Property({
      ...req.body,
      createdBy: req.user.id,
      creatorRole: req.user.role
    });
    await property.save();

    const populatedProperty = await Property.findById(property._id)
      .populate('agency', 'name logo')
      .populate('agent', 'firstName lastName email phone')
      .populate('category', 'name')
      .populate('amenities', 'name icon');

    res.status(201).json(populatedProperty);
  } catch (error) {
    console.error('Create property error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Property with this slug already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/:id/approve
// @desc    Approve or reject property (must be before /:id route)
// @access  Private (Super Admin, Agency Admin)
router.put('/:id/approve', [
  auth,
  authorize('super_admin', 'agency_admin'),
  param('id').isMongoId().withMessage('Invalid property ID'),
  body('status').isIn(['active', 'inactive']).withMessage('Status must be active or inactive'),
  body('rejectionReason').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const property = await Property.findById(req.params.id)
      .populate('agent', 'firstName lastName email phone')
      .populate('agency', 'name');

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin') {
      // Handle both populated object and ID string formats
      const propertyAgencyId = typeof property.agency === 'object' && property.agency._id
        ? property.agency._id.toString()
        : property.agency?.toString() || property.agency

      const userAgencyId = req.user.agency?.toString() || req.user.agency

      if (propertyAgencyId !== userAgencyId) {
        console.error('Agency mismatch:', {
          propertyAgencyId,
          userAgencyId,
          propertyAgency: property.agency,
          userAgency: req.user.agency
        })
        return res.status(403).json({ message: 'Access denied. You can only approve properties from your agency.' });
      }
    }

    const oldStatus = property.status;
    property.status = req.body.status;

    if (req.body.status === 'inactive' && req.body.rejectionReason) {
      property.rejectionReason = req.body.rejectionReason;
    } else if (req.body.status === 'active') {
      property.rejectionReason = undefined;
    }

    await property.save();

    // Send notification to agent
    const emailService = require('../services/emailService');
    try {
      if (property.agent && property.agent.email) {
        if (req.body.status === 'active') {
          await emailService.sendPropertyApprovalNotification(property, property.agent, property.agency);
        } else {
          await emailService.sendPropertyRejectionNotification(property, property.agent, property.agency, req.body.rejectionReason);
        }
      }
    } catch (notifError) {
      console.error('Error sending property approval notification:', notifError);
      // Don't fail the request if notification fails
    }

    const updatedProperty = await Property.findById(property._id)
      .populate('agency', 'name logo')
      .populate('agent', 'firstName lastName email phone')
      .populate('category', 'name')
      .populate('amenities', 'name icon');

    res.json({
      message: `Property ${req.body.status === 'active' ? 'approved' : 'rejected'} successfully`,
      property: updatedProperty
    });
  } catch (error) {
    console.error('Approve property error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', [
  auth,
  authorize('super_admin', 'agency_admin', 'agent'),
  param('id').isMongoId().withMessage('Invalid property ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Get agency ID safely (handle both ObjectId and null)
    const propertyAgencyId = property.agency ? property.agency.toString() : null;
    const propertyAgentId = property.agent ? property.agent.toString() : null;

    if (req.user.role === 'agency_admin' && propertyAgencyId && propertyAgencyId !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (req.user.role === 'agent' && propertyAgentId && propertyAgentId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Creator-based permission restrictions
    if (property.creatorRole === 'agent') {
      // If property was created by an agent, agency_admin and super_admin cannot edit it
      if (req.user.role === 'agency_admin' || req.user.role === 'super_admin') {
        return res.status(403).json({ message: 'Access denied. Only the property creator (agent) can edit this property.' });
      }
    } else if (property.creatorRole === 'agency_admin') {
      // If property was created by an agency admin, super_admin cannot edit it
      if (req.user.role === 'super_admin') {
        return res.status(403).json({ message: 'Access denied. Only the agency admin who created this property can edit it.' });
      }
    }

    // Force status back to pending if edited by an agent to require re-approval
    if (req.user.role === 'agent') {
      req.body.status = 'pending';
    }

    Object.assign(property, req.body);
    await property.save();

    const updatedProperty = await Property.findById(property._id)
      .populate('agency', 'name logo')
      .populate('agent', 'firstName lastName email phone')
      .populate('category', 'name')
      .populate('amenities', 'name icon');

    res.json(updatedProperty);
  } catch (error) {
    console.error('Update property error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Property with this slug already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});


// @route   GET /api/properties/:id/inquiries
// @desc    Get property inquiry history
// @access  Private
router.get('/:id/inquiries', auth, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const Lead = require('../models/Lead');
    const inquiries = await Lead.find({ property: req.params.id })
      .populate('assignedAgent', 'firstName lastName email')
      .populate('agency', 'name')
      .sort({ createdAt: -1 });

    res.json({ inquiries, total: inquiries.length });
  } catch (error) {
    console.error('Get property inquiries error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/properties/compare
// @desc    Compare multiple properties
// @access  Public
router.post('/compare', optionalAuth, [
  body('propertyIds').isArray().withMessage('Property IDs array is required'),
  body('propertyIds.*').isMongoId().withMessage('Invalid property ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { propertyIds } = req.body;

    if (propertyIds.length < 2 || propertyIds.length > 5) {
      return res.status(400).json({ message: 'Please select 2-5 properties to compare' });
    }

    const properties = await Property.find({
      _id: { $in: propertyIds },
      status: req.user ? undefined : 'active'
    })
      .populate('agency', 'name logo')
      .populate('agent', 'firstName lastName email phone')
      .populate('category', 'name')
      .populate('amenities', 'name icon');

    if (properties.length !== propertyIds.length) {
      return res.status(404).json({ message: 'Some properties not found' });
    }

    // Helper function to find common amenities
    const findCommonAmenities = (props) => {
      if (props.length === 0) return [];

      const amenityCounts = {};
      props.forEach(property => {
        if (property.amenities) {
          property.amenities.forEach(amenity => {
            const amenityId = amenity._id?.toString() || amenity.toString();
            amenityCounts[amenityId] = (amenityCounts[amenityId] || 0) + 1;
          });
        }
      });

      // Return amenities that appear in all properties
      const commonAmenityIds = Object.keys(amenityCounts).filter(
        id => amenityCounts[id] === props.length
      );

      // Get amenity details from first property
      if (props[0] && props[0].amenities) {
        return props[0].amenities.filter(amenity => {
          const amenityId = amenity._id?.toString() || amenity.toString();
          return commonAmenityIds.includes(amenityId);
        });
      }
      return [];
    };

    // Create comparison data
    const comparison = {
      properties: properties.map(p => ({
        _id: p._id,
        title: p.title,
        slug: p.slug,
        propertyType: p.propertyType,
        listingType: p.listingType,
        price: p.price,
        location: p.location,
        specifications: p.specifications,
        amenities: p.amenities,
        images: p.images,
        description: p.description,
        agent: p.agent,
        agency: p.agency
      })),
      comparison: {
        priceRange: {
          min: Math.min(...properties.map(p => p.price?.sale || p.price?.rent?.amount || 0)),
          max: Math.max(...properties.map(p => p.price?.sale || p.price?.rent?.amount || 0))
        },
        averageArea: properties.reduce((sum, p) => sum + (p.specifications?.area?.value || 0), 0) / properties.length,
        commonAmenities: findCommonAmenities(properties),
        propertyTypes: [...new Set(properties.map(p => p.propertyType))]
      }
    };

    res.json({ comparison });
  } catch (error) {
    console.error('Compare properties error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/bulk
// @desc    Bulk update properties
// @access  Private (Super Admin, Agency Admin)
router.put('/bulk', [
  auth,
  authorize('super_admin', 'agency_admin'),
  body('propertyIds').isArray().withMessage('Property IDs array is required'),
  body('propertyIds.*').isMongoId().withMessage('Invalid property ID'),
  body('updates').isObject().withMessage('Updates object is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { propertyIds, updates } = req.body;
    const filter = { _id: { $in: propertyIds } };

    // Agency admin can only update their agency's properties
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    }

    const result = await Property.updateMany(filter, updates);

    res.json({
      message: `${result.modifiedCount} properties updated successfully`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount
    });
  } catch (error) {
    console.error('Bulk update properties error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/properties/bulk
// @desc    Bulk delete properties
// @access  Private (Super Admin, Agency Admin)
router.delete('/bulk', [
  auth,
  authorize('super_admin', 'agency_admin'),
  body('propertyIds').isArray().withMessage('Property IDs array is required'),
  body('propertyIds.*').isMongoId().withMessage('Invalid property ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { propertyIds } = req.body;
    const filter = { _id: { $in: propertyIds } };

    // Agency admin can only delete their agency's properties
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    }

    const result = await Property.deleteMany(filter);

    res.json({
      message: `${result.deletedCount} properties deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Bulk delete properties error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', [
  auth,
  authorize('super_admin', 'agency_admin'),
  param('id').isMongoId().withMessage('Invalid property ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // Get agency ID safely (handle both ObjectId and null)
    const propertyAgencyId = property.agency ? property.agency.toString() : null;

    if (req.user.role === 'agency_admin' && propertyAgencyId && propertyAgencyId !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Property.deleteOne({ _id: req.params.id });
    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

