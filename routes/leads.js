const express = require('express');
const { body, validationResult, query } = require('express-validator');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Property = require('../models/Property');
const User = require('../models/User');
const Agency = require('../models/Agency');
const { auth, authorize, optionalAuth } = require('../middleware/auth');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const leadAssignmentService = require('../services/leadAssignmentService');
const leadScoringService = require('../services/leadScoringService');
const webhookService = require('../services/webhookService');
const encryptionService = require('../services/encryptionService');

const router = express.Router();

// Helper function to normalize lead priority
const normalizeLeadPriority = (lead) => {
  if (lead && lead.priority) {
    const validPriorities = ['hot', 'warm', 'cold', 'not_interested'];
    const priorityMap = {
      'high': 'hot',
      'medium': 'warm',
      'low': 'cold',
      'urgent': 'hot',
      'hot': 'hot',
      'warm': 'warm',
      'cold': 'cold',
      'not_interested': 'not_interested'
    };

    const currentPriority = lead.priority.toLowerCase();
    if (!validPriorities.includes(currentPriority)) {
      lead.priority = priorityMap[currentPriority] || 'warm';
    }
  }
  return lead;
};

// @route   GET /api/leads
// @desc    Get all leads
// @access  Private
router.get('/', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('status').optional().isIn(['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk']),
  query('priority').optional().isIn(['hot', 'warm', 'cold', 'not_interested'])
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
    let hasUnassignedFilter = false;

    // Handle agency filter FIRST (before role-based filtering) to allow unassigned override
    // Only super_admin can filter by unassigned, others are limited to their own agency
    if (req.query.agency && req.query.agency === 'unassigned' && req.user.role === 'super_admin') {
      // For unassigned, filter where agency is null or doesn't exist
      // In MongoDB, { agency: null } matches both null values and missing fields
      hasUnassignedFilter = true;
      // Use $or to explicitly check for both null and missing
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { agency: null },
          { agency: { $exists: false } }
        ]
      });
    } else {
      // Role-based filtering (only if not filtering by unassigned)
      if (req.user.role === 'agency_admin') {
        filter.agency = req.user.agency;
        // If user is team lead, show only their team's leads
        if (req.user.isTeamLead && req.user.team) {
          filter.team = req.user.team;
        }
      } else if (req.user.role === 'agent') {
        // Ensure proper ObjectId conversion for agent filtering
        if (mongoose.Types.ObjectId.isValid(req.user.id)) {
          filter.assignedAgent = new mongoose.Types.ObjectId(req.user.id);
        } else {
          filter.assignedAgent = req.user.id;
        }
        console.log(`🔍 Agent ${req.user.id} filtering leads by assignedAgent:`, filter.assignedAgent);
      }

      // Handle agency filter from query parameter (for super_admin only)
      if (req.query.agency && req.user.role === 'super_admin') {
        if (mongoose.Types.ObjectId.isValid(req.query.agency)) {
          filter.agency = new mongoose.Types.ObjectId(req.query.agency);
        }
      }
    }

    // Team-wise filtering
    if (req.query.team) {
      filter.team = req.query.team;
    }

    // Reporting manager filtering
    if (req.query.reportingManager) {
      if (mongoose.Types.ObjectId.isValid(req.query.reportingManager)) {
        filter.reportingManager = new mongoose.Types.ObjectId(req.query.reportingManager);
      } else {
        filter.reportingManager = req.query.reportingManager;
      }
    }

    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.owner) {
      // Validate ObjectId format before adding to filter
      if (mongoose.Types.ObjectId.isValid(req.query.owner)) {
        filter.assignedAgent = new mongoose.Types.ObjectId(req.query.owner);
      } else {
        filter.assignedAgent = req.query.owner;
      }
    }
    if (req.query.source) filter.source = req.query.source;
    if (req.query.property) {
      // Validate ObjectId format before adding to filter
      if (mongoose.Types.ObjectId.isValid(req.query.property)) {
        filter.property = new mongoose.Types.ObjectId(req.query.property);
      }
    }
    if (req.query.campaign) {
      filter.campaignName = new RegExp(req.query.campaign, 'i');
    }
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      const searchConditions = [
        { 'contact.firstName': new RegExp(searchTerm, 'i') },
        { 'contact.lastName': new RegExp(searchTerm, 'i') },
        { 'contact.email': new RegExp(searchTerm, 'i') },
        { 'contact.phone': new RegExp(searchTerm, 'i') },
        { 'leadId': new RegExp(searchTerm, 'i') }
      ];

      // Also search by MongoDB _id if the search term looks like an ObjectId
      if (searchTerm.match(/^[0-9a-fA-F]{24}$/)) {
        try {
          searchConditions.push({ _id: new mongoose.Types.ObjectId(searchTerm) });
        } catch (error) {
          // Invalid ObjectId format, ignore
        }
      }

      // If there's already an $and (from unassigned filter), add search to it
      if (hasUnassignedFilter || filter.$and) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: searchConditions });
      } else {
        filter.$or = searchConditions;
      }
    }

    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        try {
          // Parse date string (YYYY-MM-DD format) and set to start of day
          const startDateStr = req.query.startDate;
          if (startDateStr && startDateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [year, month, day] = startDateStr.split('-').map(Number);
            const startDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
            filter.createdAt.$gte = startDate;
          }
        } catch (error) {
          console.error('Error parsing startDate:', error);
        }
      }
      if (req.query.endDate) {
        try {
          // Parse date string (YYYY-MM-DD format) and set to end of day
          const endDateStr = req.query.endDate;
          if (endDateStr && endDateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [year, month, day] = endDateStr.split('-').map(Number);
            const endDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
            filter.createdAt.$lte = endDate;
          }
        } catch (error) {
          console.error('Error parsing endDate:', error);
        }
      }
    }

    // Debug: Log filter when unassigned is selected
    if (hasUnassignedFilter) {
      console.log('🔍 Unassigned filter applied:', JSON.stringify(filter, null, 2));
    }

    const leads = await Lead.find(filter)
      .populate('property', 'title slug images price location')
      .populate('agency', 'name logo')
      .populate('assignedAgent', 'firstName lastName email profileImage')
      .populate('assignedBy', 'firstName lastName')
      .populate('reportingManager', 'firstName lastName email')
      .populate('reminders.createdBy', 'firstName lastName')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit);

    // Decrypt sensitive contact information if encryption is enabled
    const decryptedLeads = leads.map(lead => {
      const leadObj = lead.toObject();
      if (leadObj.contact) {
        leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
      }
      return leadObj;
    });

    const total = await Lead.countDocuments(filter);

    res.json({
      leads: decryptedLeads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/:id
// @desc    Get single lead
// @access  Private
router.get('/:id', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('property', 'title slug images price location')
      .populate('agency', 'name logo')
      .populate('assignedAgent', 'firstName lastName email phone profileImage agentInfo')
      .populate('assignedBy', 'firstName lastName')
      .populate('reportingManager', 'firstName lastName email phone')
      .populate('notes.createdBy', 'firstName lastName')
      .populate('communications.createdBy', 'firstName lastName')
      .populate('tasks.assignedTo', 'firstName lastName')
      .populate('tasks.createdBy', 'firstName lastName')
      .populate('reminders.createdBy', 'firstName lastName')
      .populate('documents.uploadedBy', 'firstName lastName');

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    // Get lead agency ID (handle both populated object and ID string)
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    // Get user agency ID (handle both populated object and ID string)
    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    // Agency admin can only view leads from their agency
    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Agency admin can view all leads from their agency
    if (req.user.role === 'agency_admin') {
      if (leadAgencyId !== userAgencyId) {
        return res.status(403).json({ message: 'Access denied. You can only view leads from your agency.' });
      }
    }

    // Agent can view leads assigned to them OR unassigned leads from their agency
    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      // If lead is assigned to someone else, deny access
      if (assignedAgentId && assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // If lead is unassigned or assigned to this agent, check agency match
      if (leadAgencyId !== userAgencyId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Decrypt contact information if encryption is enabled
    const leadObj = lead.toObject();
    if (leadObj.contact) {
      leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    }

    res.json({ lead: leadObj });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads
// @desc    Create new lead (from website form or manually)
// @access  Public (website) / Private (manual)
router.post('/', optionalAuth, [
  body('contact.firstName').trim().notEmpty().withMessage('First name is required'),
  body('contact.lastName').trim().notEmpty().withMessage('Last name is required'),
  body('contact.email').isEmail().withMessage('Valid email is required'),
  body('contact.phone').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // If authenticated, use user's agency, otherwise require agency
    let agencyId = req.body.agency;
    if (req.user && req.user.role !== 'super_admin') {
      agencyId = req.user.agency || req.body.agency;
      // If user doesn't have an agency, try to use default agency as fallback
      if (!agencyId) {
        const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
        if (!defaultAgency) {
          return res.status(400).json({
            message: 'Your account is not associated with an agency and no default agency is available. Please contact the administrator to assign an agency to your account.',
            code: 'AGENCY_REQUIRED'
          });
        }
        agencyId = defaultAgency._id;
      }
    } else if (req.user && req.user.role === 'super_admin') {
      // Super admin must provide agency in request body
      if (!agencyId) {
        return res.status(400).json({ message: 'Agency is required for super admin. Please select an agency.' });
      }
    } else {
      // Not authenticated - try to use provided agency, or get first active agency as default
      if (!agencyId) {
        // For public contact forms, use the first active agency as default
        const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
        if (!defaultAgency) {
          return res.status(400).json({
            message: 'No active agency found. Please contact the administrator.',
            code: 'NO_AGENCY_AVAILABLE'
          });
        }
        agencyId = defaultAgency._id;
      }
    }

    // Check for duplicate leads (by email or phone)
    const duplicateConditions = [
      { 'contact.email': req.body.contact.email.toLowerCase() }
    ];

    // Only add phone to duplicate check if phone is provided
    if (req.body.contact.phone && req.body.contact.phone.trim()) {
      duplicateConditions.push({ 'contact.phone': req.body.contact.phone });
    }

    const duplicateLeads = await Lead.find({
      $or: duplicateConditions,
      agency: agencyId
    }).limit(5);

    // Auto-assign agent if not provided and auto-assignment is enabled
    let assignedAgentId = req.body.assignedAgent || null;
    if (!assignedAgentId) {
      const agency = await Agency.findById(agencyId);
      if (agency?.settings?.autoAssignLeads) {
        const assignmentMethod = agency.settings.assignmentMethod || 'round_robin';
        assignedAgentId = await leadAssignmentService.autoAssignLead(agencyId, assignmentMethod, req.body);
      }
    }

    // Validate and normalize priority
    const validPriorities = ['hot', 'warm', 'cold', 'not_interested'];
    let priority = req.body.priority ? req.body.priority.toLowerCase() : 'warm';

    // Map common frontend values to backend values
    const priorityMap = {
      'high': 'hot',
      'medium': 'warm',
      'low': 'cold',
      'urgent': 'hot',
      'hot': 'hot',
      'warm': 'warm',
      'cold': 'cold',
      'not_interested': 'not_interested'
    };

    priority = priorityMap[priority] || (validPriorities.includes(priority) ? priority : 'warm');

    // Validate and normalize status
    const validStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'];
    const status = req.body.status && validStatuses.includes(req.body.status.toLowerCase())
      ? req.body.status.toLowerCase()
      : 'new';

    // Validate and normalize source
    const validSources = ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'];
    const source = req.body.source && validSources.includes(req.body.source.toLowerCase())
      ? req.body.source.toLowerCase()
      : 'website';

    const leadData = {
      ...req.body,
      agency: agencyId,
      source: source,
      status: status,
      priority: priority,
      assignedAgent: assignedAgentId
    };

    // Clean up inquiry object - remove empty budget fields
    if (leadData.inquiry && leadData.inquiry.budget) {
      if (!leadData.inquiry.budget.min && !leadData.inquiry.budget.max) {
        // If both min and max are missing, keep only currency if provided
        if (leadData.inquiry.budget.currency) {
          leadData.inquiry.budget = { currency: leadData.inquiry.budget.currency };
        } else {
          delete leadData.inquiry.budget;
        }
      }
    }

    const lead = new Lead(leadData);

    // Initialize SLA tracking
    lead.sla = {
      firstContactSla: 3600000, // 1 hour default
      firstContactStatus: 'pending'
    };

    await lead.save();

    // Auto-score the lead
    try {
      await leadScoringService.autoScoreLead(lead._id);
    } catch (scoreError) {
      console.error('Error auto-scoring lead:', scoreError);
      // Don't fail the request if scoring fails
    }

    const populatedLead = await Lead.findById(lead._id)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName email phone');

    // Decrypt contact information for response
    const leadObj = populatedLead.toObject();
    if (leadObj.contact) {
      leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    }

    // Return duplicate warning if found
    if (duplicateLeads.length > 0 && !req.body.ignoreDuplicates) {
      return res.status(201).json({
        lead: leadObj,
        duplicates: duplicateLeads.map(d => ({
          _id: d._id,
          name: `${d.contact.firstName} ${d.contact.lastName}`,
          email: d.contact.email,
          phone: d.contact.phone,
          status: d.status,
          createdAt: d.createdAt
        })),
        warning: 'Potential duplicate leads found'
      });
    }

    // Send notifications
    try {
      const agency = await Agency.findById(agencyId);

      if (populatedLead.assignedAgent) {
        const agent = await User.findById(populatedLead.assignedAgent._id);
        if (agent) {
          // Send email notification
          await emailService.sendNewLeadNotification(populatedLead, agent, agency);

          // Send SMS notification if enabled
          if (agency?.settings?.smsNotifications) {
            await smsService.sendLeadNotification(populatedLead, agent);
          }
        }
      } else {
        // Notify agency admin if no agent assigned
        const agencyAdmin = await User.findOne({
          role: 'agency_admin',
          agency: agencyId
        });
        if (agencyAdmin) {
          await emailService.sendNewLeadNotification(populatedLead, agencyAdmin, agency);
        }
      }
    } catch (notifError) {
      console.error('Error sending notifications:', notifError);
      // Don't fail the request if notifications fail
    }

    // Send webhook for lead creation
    if (webhookService.isEnabled()) {
      try {
        await webhookService.sendLeadWebhook(populatedLead, 'lead_created');
      } catch (webhookError) {
        console.error('Error sending lead creation webhook:', webhookError);
        // Don't fail the request if webhook fails
      }
    }

    res.status(201).json({ lead: leadObj });
  } catch (error) {
    console.error('Create lead error:', error);
    console.error('Error stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));

    // Return more detailed error message
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({
        message: 'Validation error',
        errors: validationErrors
      });
    }

    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @route   PUT /api/leads/:id
// @desc    Update lead
// @access  Private
router.put('/:id', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    // Get lead agency ID (handle both populated object and ID string)
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    // Get user agency ID (handle both populated object and ID string)
    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    // Agency admin can only update leads from their agency
    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Agent can only update leads assigned to them
    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Normalize priority if provided
    if (req.body.hasOwnProperty('priority')) {
      if (req.body.priority === null || req.body.priority === '' || req.body.priority === undefined) {
        // Allow setting priority to null/empty/undefined
        req.body.priority = undefined;
      } else {
        const validPriorities = ['hot', 'warm', 'cold', 'not_interested'];
        const priorityMap = {
          'high': 'hot',
          'medium': 'warm',
          'low': 'cold',
          'urgent': 'hot',
          'hot': 'hot',
          'warm': 'warm',
          'cold': 'cold',
          'not_interested': 'not_interested'
        };

        const currentPriority = String(req.body.priority).toLowerCase();
        req.body.priority = priorityMap[currentPriority] || (validPriorities.includes(currentPriority) ? currentPriority : 'warm');
      }
    }

    // Normalize status if provided
    if (req.body.status) {
      const validStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'];
      const currentStatus = req.body.status.toLowerCase();
      if (validStatuses.includes(currentStatus)) {
        req.body.status = currentStatus;
      } else {
        // Try to map common variations
        const statusMap = {
          'site visit': 'site_visit_scheduled',
          'site_visit': 'site_visit_scheduled',
          'new lead': 'new'
        };
        req.body.status = statusMap[currentStatus] || 'new';
      }
    }

    // Normalize source if provided
    if (req.body.source) {
      const validSources = ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'];
      const currentSource = req.body.source.toLowerCase();
      if (validSources.includes(currentSource)) {
        req.body.source = currentSource;
      } else {
        req.body.source = 'other';
      }
    }

    // Normalize lead priority before assigning
    normalizeLeadPriority(lead);

    // Encrypt contact information if being updated
    if (req.body.contact) {
      req.body.contact = encryptionService.encryptLeadContact(req.body.contact);
    }

    // Handle nested objects properly (deep merge for inquiry, booking, etc.)
    if (req.body.inquiry) {
      // Deep merge inquiry object to preserve existing values
      if (!lead.inquiry) lead.inquiry = {};
      if (req.body.inquiry.budget) {
        lead.inquiry.budget = {
          ...lead.inquiry.budget,
          ...req.body.inquiry.budget
        };
        // Ensure budget values are numbers
        if (lead.inquiry.budget.min !== undefined) {
          lead.inquiry.budget.min = parseFloat(lead.inquiry.budget.min) || null;
        }
        if (lead.inquiry.budget.max !== undefined) {
          lead.inquiry.budget.max = parseFloat(lead.inquiry.budget.max) || null;
        }
      }
      // Merge other inquiry fields
      Object.assign(lead.inquiry, req.body.inquiry);
    }

    // Handle other nested objects
    if (req.body.booking) {
      if (!lead.booking) lead.booking = {};
      Object.assign(lead.booking, req.body.booking);
    }

    // Assign other top-level fields
    const fieldsToAssign = { ...req.body };
    delete fieldsToAssign.inquiry;
    delete fieldsToAssign.booking;
    Object.assign(lead, fieldsToAssign);

    // Normalize again after assignment to ensure it's valid
    normalizeLeadPriority(lead);

    await lead.save();

    // Recalculate lead score in real-time when lead is updated
    // This ensures score updates when source, budget, timeline, or inquiry changes
    try {
      await leadScoringService.autoScoreLead(lead._id);
    } catch (scoreError) {
      console.error('Error recalculating lead score:', scoreError);
      // Don't fail the update if scoring fails
    }

    // Fetch updated lead with fresh score data
    const updatedLead = await Lead.findById(lead._id)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName');

    // Decrypt contact information if encryption is enabled
    const leadObj = updatedLead.toObject();
    if (leadObj.contact) {
      leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    }

    // Send webhook for lead update
    if (webhookService.isEnabled()) {
      try {
        const previousData = {
          status: previousStatus,
          priority: previousPriority,
          assignedAgent: previousAssignedAgent
        };

        // Determine event type based on what changed
        let eventType = 'lead_updated';
        if (req.body.status && req.body.status !== previousStatus) {
          eventType = 'status_changed';

          // Special events for important status changes
          if (req.body.status === 'booked') {
            eventType = 'lead_booked';
          } else if (req.body.status === 'closed') {
            eventType = 'lead_closed';
          } else if (req.body.status === 'lost') {
            eventType = 'lead_lost';
          }
        }

        await webhookService.sendLeadWebhook(leadObj, eventType, previousData);
      } catch (webhookError) {
        console.error('Error sending lead update webhook:', webhookError);
        // Don't fail the request if webhook fails
      }
    }

    res.json({ lead: leadObj });
  } catch (error) {
    console.error('Update lead error:', error);
    console.error('Error stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));

    // Return more detailed error message
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({
        message: 'Validation error',
        errors: validationErrors
      });
    }

    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/leads/:id/notes
// @desc    Add note to lead
// @access  Private
router.post('/:id/notes', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('note').trim().notEmpty().withMessage('Note is required')
], async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Normalize priority before saving
    normalizeLeadPriority(lead);

    lead.notes.push({
      note: req.body.note,
      createdBy: req.user.id
    });

    await lead.save();
    res.json({ lead });
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/communications
// @desc    Add communication to lead
// @access  Private
router.post('/:id/communications', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('type').isIn(['call', 'email', 'sms', 'meeting', 'note']).withMessage('Valid communication type is required'),
  body('message').trim().notEmpty().withMessage('Message is required')
], async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Normalize priority before saving
    normalizeLeadPriority(lead);

    const communication = {
      ...req.body,
      createdBy: req.user.id
    };

    lead.communications.push(communication);

    // Track SLA - mark first contact if this is the first communication
    if (!lead.sla.firstContactAt && req.body.type !== 'note') {
      lead.sla.firstContactAt = new Date();
      lead.sla.responseTime = lead.sla.firstContactAt - lead.createdAt;

      // Check if SLA was met (default 1 hour)
      const slaThreshold = lead.sla.firstContactSla || 3600000; // 1 hour
      if (lead.sla.responseTime <= slaThreshold) {
        lead.sla.firstContactStatus = 'met';
      } else {
        lead.sla.firstContactStatus = 'breached';
      }
    }

    // Update last contact time
    lead.sla.lastContactAt = new Date();

    await lead.save();

    // Recalculate lead score in real-time when communication is added
    // This updates engagement score based on communications
    try {
      await leadScoringService.autoScoreLead(lead._id);
    } catch (scoreError) {
      console.error('Error recalculating lead score:', scoreError);
      // Don't fail the communication add if scoring fails
    }

    // Fetch updated lead with new score
    const updatedLead = await Lead.findById(lead._id)
      .populate('communications.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Add communication error:', error);
    console.error('Error stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/leads/:id/tasks
// @desc    Add task to lead
// @access  Private
router.post('/:id/tasks', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('title').trim().notEmpty().withMessage('Task title is required')
], async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Normalize priority before saving
    normalizeLeadPriority(lead);

    lead.tasks.push({
      ...req.body,
      createdBy: req.user.id
    });

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('tasks.assignedTo', 'firstName lastName')
      .populate('tasks.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Add task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/leads/:id/tasks/:taskId
// @desc    Update task
// @access  Private
router.put('/:id/tasks/:taskId', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const task = lead.tasks.id(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (req.body.title) task.title = req.body.title;
    if (req.body.description !== undefined) task.description = req.body.description;
    if (req.body.dueDate) task.dueDate = new Date(req.body.dueDate);
    if (req.body.taskType) task.taskType = req.body.taskType;
    if (req.body.status) {
      task.status = req.body.status;
      if (req.body.status === 'completed' && !task.completedAt) {
        task.completedAt = new Date();
      } else if (req.body.status !== 'completed') {
        task.completedAt = undefined;
      }
    }
    if (req.body.assignedTo !== undefined) task.assignedTo = req.body.assignedTo;

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('tasks.assignedTo', 'firstName lastName')
      .populate('tasks.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/:id/tasks/:taskId
// @desc    Delete task
// @access  Private
router.delete('/:id/tasks/:taskId', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    lead.tasks.id(req.params.taskId).remove();
    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('tasks.assignedTo', 'firstName lastName')
      .populate('tasks.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/reminders
// @desc    Add reminder to lead
// @access  Private
router.post('/:id/reminders', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('title').trim().notEmpty().withMessage('Reminder title is required'),
  body('reminderDate').isISO8601().withMessage('Valid reminder date is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Validate and convert reminder date
    const reminderDate = new Date(req.body.reminderDate);
    if (isNaN(reminderDate.getTime())) {
      return res.status(400).json({ message: 'Invalid reminder date format' });
    }

    // Ensure createdBy is a valid ObjectId
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Normalize priority before saving
    normalizeLeadPriority(lead);

    lead.reminders.push({
      title: req.body.title.trim(),
      description: (req.body.description || '').trim(),
      reminderDate: reminderDate,
      createdBy: req.user.id
    });

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('reminders.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Add reminder error:', error);
    console.error('Error stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    console.error('User:', req.user ? { id: req.user.id, role: req.user.role } : 'No user');
    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/leads/:id/reminders/:reminderId
// @desc    Update reminder
// @access  Private
router.put('/:id/reminders/:reminderId', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const reminder = lead.reminders.id(req.params.reminderId);
    if (!reminder) {
      return res.status(404).json({ message: 'Reminder not found' });
    }

    if (req.body.title) reminder.title = req.body.title;
    if (req.body.description !== undefined) reminder.description = req.body.description;
    if (req.body.reminderDate) reminder.reminderDate = new Date(req.body.reminderDate);
    if (req.body.isCompleted !== undefined) {
      reminder.isCompleted = req.body.isCompleted;
      if (req.body.isCompleted && !reminder.completedAt) {
        reminder.completedAt = new Date();
      } else if (!req.body.isCompleted) {
        reminder.completedAt = undefined;
      }
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('reminders.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Update reminder error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/:id/reminders/:reminderId
// @desc    Delete reminder
// @access  Private
router.delete('/:id/reminders/:reminderId', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    const leadAgencyId = lead.agency?._id
      ? lead.agency._id.toString()
      : (lead.agency?.toString() || lead.agency);

    const userAgencyId = req.user.agency?._id
      ? req.user.agency._id.toString()
      : (req.user.agency?.toString() || req.user.agency);

    if (req.user.role === 'agency_admin' && leadAgencyId !== userAgencyId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'agent') {
      const assignedAgentId = lead.assignedAgent?._id
        ? lead.assignedAgent._id.toString()
        : (lead.assignedAgent?.toString() || lead.assignedAgent);

      if (assignedAgentId !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    lead.reminders.id(req.params.reminderId).remove();
    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('reminders.createdBy', 'firstName lastName');

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/leads/:id/assign
// @desc    Assign lead to agent
// @access  Private
router.put('/:id/assign', auth, authorize('super_admin', 'agency_admin'), [
  body('assignedAgent').notEmpty().withMessage('Agent ID is required')
], async (req, res) => {
  try {
    // Fetch lead and agent in parallel for better performance
    const [lead, agent] = await Promise.all([
      Lead.findById(req.params.id).populate('agency', 'name').populate('property', 'title slug'),
      req.body.assignedAgent ? User.findById(req.body.assignedAgent).select('firstName lastName team email') : null
    ]);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Update lead assignment fields
    lead.assignedAgent = req.body.assignedAgent;
    lead.assignedBy = req.user.id;

    // Set reporting manager (if provided, otherwise use current user if they're a manager)
    if (req.body.reportingManager) {
      lead.reportingManager = req.body.reportingManager;
    } else if (req.user.role === 'agency_admin' || req.user.isTeamLead) {
      lead.reportingManager = req.user.id;
    }

    // Set team (if provided, otherwise get from assigned agent)
    if (req.body.team) {
      lead.team = req.body.team;
    } else if (agent.team) {
      lead.team = agent.team;
    }

    await lead.save();

    // Get agency if not already populated
    const agency = lead.agency?._id ? lead.agency : await Agency.findById(lead.agency).select('name settings');

    // Prepare response immediately (don't wait for notifications/scoring)
    const updatedLead = await Lead.findById(lead._id)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName email');

    // Decrypt contact information if encryption is enabled
    const leadObj = updatedLead.toObject();
    if (leadObj.contact) {
      leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    }

    // Return response immediately for fast API response
    res.json({ lead: leadObj });

    // Handle time-consuming operations in background (don't block response)
    setImmediate(async () => {
      try {
        // Recalculate lead score in background
        await leadScoringService.autoScoreLead(lead._id);
      } catch (scoreError) {
        console.error('Error recalculating lead score:', scoreError);
      }

      // Send notifications in background
      try {
        if (agent && agency) {
          const populatedLead = await Lead.findById(lead._id)
            .populate('property', 'title slug')
            .populate('agency', 'name');

          // Send email notification (async, don't wait)
          emailService.sendLeadAssignmentNotification(populatedLead, agent, agency).catch(err => {
            console.error('Error sending email notification:', err);
          });

          // Send SMS notification if enabled (async, don't wait)
          if (agency?.settings?.smsNotifications) {
            smsService.sendLeadAssignmentNotification(populatedLead, agent).catch(err => {
              console.error('Error sending SMS notification:', err);
            });
          }
        }
      } catch (notifError) {
        console.error('Error sending assignment notifications:', notifError);
      }
    });
  } catch (error) {
    console.error('Assign lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/auto-assign
// @desc    Auto-assign lead using specified method
// @access  Private (Super Admin, Agency Admin)
router.post('/:id/auto-assign', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    // Default to round_robin if not provided
    const assignmentMethod = req.body.assignmentMethod || 'round_robin';

    // Validate assignment method
    const validMethods = ['round_robin', 'workload', 'location', 'project', 'source', 'smart'];
    if (!validMethods.includes(assignmentMethod)) {
      return res.status(400).json({
        message: `Invalid assignment method. Must be one of: ${validMethods.join(', ')}`,
        received: assignmentMethod
      });
    }

    const lead = await Lead.findById(req.params.id)
      .populate('property', 'title')
      .populate('agency', 'name');

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Get agency ID - prefer from request, then from lead, then from user
    let agencyId = req.body.agencyId;
    if (!agencyId) {
      agencyId = lead.agency?._id || lead.agency;
    }
    if (!agencyId && req.user.agency) {
      agencyId = req.user.agency;
    }
    if (!agencyId) {
      return res.status(400).json({
        message: 'Agency is required for auto-assignment. Please provide agencyId or ensure lead has an agency assigned.'
      });
    }

    // Convert to ObjectId if it's a string
    if (typeof agencyId === 'string' && mongoose.Types.ObjectId.isValid(agencyId)) {
      agencyId = new mongoose.Types.ObjectId(agencyId);
    }

    // Prepare lead data for assignment
    const leadData = {
      property: lead.property?._id || lead.property,
      source: lead.source,
      inquiry: lead.inquiry || {}
    };

    // Auto-assign using specified method
    let assignedAgentId;
    try {
      console.log(`Attempting auto-assignment: method=${assignmentMethod}, agencyId=${agencyId}`);
      assignedAgentId = await leadAssignmentService.autoAssignLead(
        agencyId,
        assignmentMethod,
        leadData
      );
      console.log(`Auto-assignment result: ${assignedAgentId ? 'Success - Agent ID: ' + assignedAgentId : 'No agent found'}`);
    } catch (assignError) {
      console.error('Error in auto-assignment service:', assignError);
      return res.status(500).json({
        message: 'Error during auto-assignment',
        error: assignError.message,
        stack: process.env.NODE_ENV === 'development' ? assignError.stack : undefined
      });
    }

    if (!assignedAgentId) {
      // Check if there are any agents in the agency
      const agentCount = await User.countDocuments({
        role: 'agent',
        agency: agencyId,
        isActive: true
      });

      return res.status(400).json({
        message: agentCount === 0
          ? 'No active agents found in this agency. Please add agents before auto-assigning leads.'
          : 'No available agent found for assignment with the selected method. Try a different assignment method.',
        assignmentMethod: assignmentMethod,
        agencyId: agencyId.toString(),
        agentCount: agentCount
      });
    }

    // Assign the lead
    lead.assignedAgent = assignedAgentId;
    lead.assignedBy = req.user.id;

    // Set reporting manager and team
    const agent = await User.findById(assignedAgentId);
    if (agent) {
      if (agent.team) {
        lead.team = agent.team;
      }
      // Set reporting manager if agent has one
      if (req.user.role === 'agency_admin' || req.user.isTeamLead) {
        lead.reportingManager = req.user.id;
      }
    }

    await lead.save();

    // Recalculate lead score
    try {
      await leadScoringService.autoScoreLead(lead._id);
    } catch (scoreError) {
      console.error('Error recalculating lead score:', scoreError);
    }

    // Send notifications
    try {
      const populatedAgent = await User.findById(assignedAgentId);
      const agency = await Agency.findById(agencyId);
      if (populatedAgent && agency) {
        await emailService.sendLeadAssignmentNotification(lead, populatedAgent, agency);
      }
    } catch (notifError) {
      console.error('Error sending assignment notifications:', notifError);
    }

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedAgent', 'firstName lastName')
      .populate('agency', 'name');

    const leadObj = updatedLead.toObject();
    if (leadObj.contact) {
      leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    }

    res.json({
      lead: leadObj,
      assignmentMethod: assignmentMethod,
      message: `Lead auto-assigned using ${assignmentMethod.replace('_', ' ')} method`
    });
  } catch (error) {
    console.error('Auto-assign lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/re-score
// @desc    Re-score a lead
// @access  Private (Super Admin, Agency Admin, Agent)
router.post('/:id/re-score', auth, authorize('super_admin', 'agency_admin', 'agent'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin') {
      const leadAgencyId = lead.agency?._id || lead.agency;
      if (leadAgencyId.toString() !== req.user.agency.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (req.user.role === 'agent') {
      if (lead.assignedAgent?.toString() !== req.user.id.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Re-score the lead
    await leadScoringService.autoScoreLead(lead._id);

    const updatedLead = await Lead.findById(lead._id);
    const leadObj = updatedLead.toObject();
    if (leadObj.contact) {
      leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    }

    res.json({
      lead: leadObj,
      message: 'Lead re-scored successfully'
    });
  } catch (error) {
    console.error('Re-score lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/merge
// @desc    Merge lead with another lead
// @access  Private (Super Admin, Agency Admin)
router.post('/:id/merge', auth, authorize('super_admin', 'agency_admin'), [
  body('targetLeadId').isMongoId().withMessage('Valid target lead ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sourceLead = await Lead.findById(req.params.id);
    const targetLead = await Lead.findById(req.body.targetLeadId);

    if (!sourceLead || !targetLead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin') {
      const sourceAgencyId = sourceLead.agency?._id || sourceLead.agency;
      const targetAgencyId = targetLead.agency?._id || targetLead.agency;
      if (sourceAgencyId.toString() !== req.user.agency || targetAgencyId.toString() !== req.user.agency) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Merge source lead into target lead
    // Combine notes
    if (sourceLead.notes && sourceLead.notes.length > 0) {
      targetLead.notes = [...(targetLead.notes || []), ...sourceLead.notes];
    }

    // Combine communications
    if (sourceLead.communications && sourceLead.communications.length > 0) {
      targetLead.communications = [...(targetLead.communications || []), ...sourceLead.communications];
    }

    // Combine tasks
    if (sourceLead.tasks && sourceLead.tasks.length > 0) {
      targetLead.tasks = [...(targetLead.tasks || []), ...sourceLead.tasks];
    }

    // Update target lead with best data
    if (!targetLead.assignedAgent && sourceLead.assignedAgent) {
      targetLead.assignedAgent = sourceLead.assignedAgent;
    }
    if (targetLead.status === 'new' && sourceLead.status !== 'new') {
      targetLead.status = sourceLead.status;
    }
    if (targetLead.priority === 'medium' && sourceLead.priority !== 'medium') {
      targetLead.priority = sourceLead.priority;
    }

    await targetLead.save();

    // Delete source lead
    await Lead.deleteOne({ _id: sourceLead._id });

    const mergedLead = await Lead.findById(targetLead._id)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName');

    res.json({
      message: 'Leads merged successfully',
      lead: mergedLead,
      mergedFrom: {
        _id: sourceLead._id,
        name: `${sourceLead.contact.firstName} ${sourceLead.contact.lastName}`
      }
    });
  } catch (error) {
    console.error('Merge lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/:id/duplicates
// @desc    Find duplicate leads
// @access  Private
router.get('/:id/duplicates', auth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Find duplicates by email or phone
    const duplicates = await Lead.find({
      _id: { $ne: lead._id },
      agency: lead.agency,
      $or: [
        { 'contact.email': lead.contact.email.toLowerCase() },
        { 'contact.phone': lead.contact.phone }
      ]
    })
      .populate('assignedAgent', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({ duplicates });
  } catch (error) {
    console.error('Find duplicates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/:id
// @desc    Delete lead
// @access  Private (Agency Admin, Super Admin)
router.delete('/:id', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin' && lead.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Lead.findByIdAndDelete(req.params.id);
    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/bulk
// @desc    Create multiple leads from CSV/Excel upload
// @access  Private
router.post('/bulk', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const { leads } = req.body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ message: 'No leads data provided' });
    }

    // Determine agency for leads
    let defaultAgencyId = null;
    if (req.user.role === 'super_admin') {
      // Super admin must provide agency in each lead or use a default
      const firstLeadAgency = leads.find(l => l.agency);
      if (firstLeadAgency) {
        defaultAgencyId = firstLeadAgency.agency;
      } else {
        // Get first active agency as default
        const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
        if (!defaultAgency) {
          return res.status(400).json({ message: 'No active agency found. Please specify an agency for the leads.' });
        }
        defaultAgencyId = defaultAgency._id;
      }
    } else {
      // Agency admin uses their agency
      defaultAgencyId = req.user.agency;
      if (!defaultAgencyId) {
        const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
        if (!defaultAgency) {
          return res.status(400).json({ message: 'Your account is not associated with an agency.' });
        }
        defaultAgencyId = defaultAgency._id;
      }
    }

    const createdLeads = [];
    const errors = [];

    for (let i = 0; i < leads.length; i++) {
      const leadData = leads[i];

      try {
        // Validate required fields with detailed error messages
        if (!leadData.contact) {
          errors.push({
            row: leadData._rowIndex || i + 1,
            error: 'Missing contact information'
          });
          continue;
        }

        const missingFields = [];
        if (!leadData.contact.firstName || leadData.contact.firstName.trim().length === 0) {
          missingFields.push('firstName');
        }
        if (!leadData.contact.email || leadData.contact.email.trim().length === 0 || !leadData.contact.email.includes('@')) {
          missingFields.push('email');
        }
        if (!leadData.contact.phone || leadData.contact.phone.trim().length === 0) {
          missingFields.push('phone');
        }

        if (missingFields.length > 0) {
          errors.push({
            row: leadData._rowIndex || i + 1,
            error: `Missing required fields: ${missingFields.join(', ')}`
          });
          continue;
        }

        // Resolve agency - could be ObjectId or agency name
        let agencyId = defaultAgencyId;
        if (leadData.agency) {
          // Check if it's already an ObjectId
          if (mongoose.Types.ObjectId.isValid(leadData.agency) && String(leadData.agency).length === 24) {
            agencyId = new mongoose.Types.ObjectId(leadData.agency);
          } else {
            // It's a name, find the agency by name
            try {
              const agency = await Agency.findOne({
                name: new RegExp(`^${leadData.agency.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
                isActive: true
              });
              if (agency) {
                agencyId = agency._id;
                console.log(`✅ Resolved agency "${leadData.agency}" to ObjectId: ${agencyId}`);
              } else {
                // Agency not found, use default
                console.warn(`⚠️ Agency "${leadData.agency}" not found, using default agency: ${defaultAgencyId}`);
                // Don't change agencyId, keep using defaultAgencyId
              }
            } catch (agencyError) {
              console.error(`Error resolving agency "${leadData.agency}":`, agencyError);
              // Use default agency on error
            }
          }
        }

        // Final validation - ensure agencyId is a valid ObjectId
        if (!agencyId || !mongoose.Types.ObjectId.isValid(agencyId)) {
          errors.push({
            row: leadData._rowIndex || i + 1,
            error: `Invalid agency: ${leadData.agency || 'not provided'}. Could not resolve to a valid agency.`
          });
          continue;
        }

        // Resolve property if propertyTitle is provided
        let propertyId = leadData.property || null;
        if (leadData.propertyTitle && !propertyId) {
          const Property = require('../models/Property');
          // Make sure agencyId is a valid ObjectId before querying
          if (agencyId && mongoose.Types.ObjectId.isValid(agencyId)) {
            const property = await Property.findOne({
              title: new RegExp(leadData.propertyTitle.trim(), 'i'),
              agency: agencyId
            });
            if (property) {
              propertyId = property._id;
            }
          }
        }

        // Resolve assigned agent if assignedAgentName is provided
        let assignedAgentId = leadData.assignedAgent || null;
        if (leadData.assignedAgentName && !assignedAgentId) {
          // Make sure agencyId is a valid ObjectId before querying
          if (agencyId && mongoose.Types.ObjectId.isValid(agencyId)) {
            // Try to find agent by name (firstName + lastName or full name)
            const agentNameParts = leadData.assignedAgentName.trim().split(/\s+/);
            let agent = null;

            if (agentNameParts.length >= 2) {
              // Try full name match
              agent = await User.findOne({
                $or: [
                  {
                    firstName: new RegExp(agentNameParts[0], 'i'),
                    lastName: new RegExp(agentNameParts.slice(1).join(' '), 'i'),
                    role: 'agent',
                    agency: agencyId
                  },
                  {
                    $or: [
                      { firstName: new RegExp(leadData.assignedAgentName.trim(), 'i') },
                      { lastName: new RegExp(leadData.assignedAgentName.trim(), 'i') }
                    ],
                    role: 'agent',
                    agency: agencyId
                  }
                ]
              });
            } else {
              // Try single name match
              agent = await User.findOne({
                $or: [
                  { firstName: new RegExp(leadData.assignedAgentName.trim(), 'i') },
                  { lastName: new RegExp(leadData.assignedAgentName.trim(), 'i') },
                  { email: new RegExp(leadData.assignedAgentName.trim(), 'i') }
                ],
                role: 'agent',
                agency: agencyId
              });
            }

            if (agent) {
              assignedAgentId = agent._id;
            }
          }
        }

        // Validate status and priority
        const validStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'];
        const validPriorities = ['hot', 'warm', 'cold', 'not_interested'];
        const validSources = ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'];

        // Encrypt contact information if encryption is enabled
        const encryptedContact = encryptionService.encryptLeadContact({
          firstName: leadData.contact.firstName.trim(),
          lastName: leadData.contact.lastName?.trim() || '',
          email: leadData.contact.email.trim().toLowerCase(),
          phone: leadData.contact.phone.trim(),
          alternatePhone: leadData.contact.alternatePhone?.trim(),
          address: leadData.contact.address || {}
        });

        const lead = new Lead({
          contact: encryptedContact,
          status: validStatuses.includes(leadData.status?.toLowerCase()) ? leadData.status.toLowerCase() : 'new',
          priority: validPriorities.includes(leadData.priority?.toLowerCase()) ? leadData.priority.toLowerCase() : 'warm',
          source: validSources.includes(leadData.source?.toLowerCase()) ? leadData.source.toLowerCase() : 'other',
          agency: agencyId,
          property: propertyId && mongoose.Types.ObjectId.isValid(propertyId) ? propertyId : undefined,
          assignedAgent: assignedAgentId && mongoose.Types.ObjectId.isValid(assignedAgentId) ? assignedAgentId : undefined,
          inquiry: {
            message: leadData.inquiry?.message || '',
            budget: {
              min: leadData.inquiry?.budget?.min ? parseFloat(leadData.inquiry.budget.min) : undefined,
              max: leadData.inquiry?.budget?.max ? parseFloat(leadData.inquiry.budget.max) : undefined,
              currency: leadData.inquiry?.budget?.currency || 'USD'
            },
            preferredLocation: Array.isArray(leadData.inquiry?.preferredLocation)
              ? leadData.inquiry.preferredLocation.filter(l => l.trim())
              : [],
            propertyType: Array.isArray(leadData.inquiry?.propertyType)
              ? leadData.inquiry.propertyType.filter(t => t.trim())
              : [],
            timeline: leadData.inquiry?.timeline,
            requirements: leadData.inquiry?.requirements || ''
          }
        });

        await lead.save();
        createdLeads.push(lead._id);

        console.log(`✅ Lead created successfully: ${lead.contact.firstName} ${lead.contact.lastName} (${lead.contact.email})`);
      } catch (error) {
        console.error(`❌ Error creating lead at row ${leadData._rowIndex || i + 1}:`, error);
        errors.push({
          row: leadData._rowIndex || i + 1,
          error: error.message || 'Failed to create lead'
        });
      }
    }

    console.log(`📊 Bulk upload summary: ${createdLeads.length} created, ${errors.length} failed out of ${leads.length} total`);

    res.status(201).json({
      message: `Successfully created ${createdLeads.length} out of ${leads.length} leads`,
      created: createdLeads.length,
      failed: errors.length,
      total: leads.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Bulk create leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/landing-page
// @desc    Import leads from landing pages (dedicated endpoint)
// @access  Public (with optional API key validation)
router.post('/landing-page', optionalAuth, [
  body('leads').isArray().withMessage('Leads array is required'),
  body('landingPageName').optional().trim(),
  body('campaignName').optional().trim()
], async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: validationErrors.array()
      });
    }

    const { leads, landingPageName, campaignName } = req.body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ message: 'No leads data provided' });
    }

    // Determine agency
    let agencyId = req.body.agency;
    if (req.user && req.user.role !== 'super_admin') {
      agencyId = req.user.agency || req.body.agency;
      if (!agencyId) {
        const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
        if (!defaultAgency) {
          return res.status(400).json({
            message: 'No active agency found',
            code: 'NO_AGENCY_REQUIRED'
          });
        }
        agencyId = defaultAgency._id;
      }
    } else if (!agencyId) {
      const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
      if (!defaultAgency) {
        return res.status(400).json({
          message: 'No active agency found',
          code: 'NO_AGENCY_AVAILABLE'
        });
      }
      agencyId = defaultAgency._id;
    }

    const createdLeads = [];
    const errors = [];

    for (let i = 0; i < leads.length; i++) {
      const leadData = leads[i];

      try {
        // Validate required fields
        if (!leadData.contact || !leadData.contact.email || !leadData.contact.firstName) {
          errors.push({
            row: i + 1,
            error: 'Missing required fields: contact.email and contact.firstName'
          });
          continue;
        }

        // Auto-assign agent if enabled
        let assignedAgentId = leadData.assignedAgent || null;
        if (!assignedAgentId) {
          const agency = await Agency.findById(agencyId);
          if (agency?.settings?.autoAssignLeads) {
            const assignmentMethod = agency.settings.assignmentMethod || 'round_robin';
            assignedAgentId = await leadAssignmentService.autoAssignLead(agencyId, assignmentMethod, leadData);
          }
        }

        // Prepare lead data
        const validStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'];
        const validPriorities = ['hot', 'warm', 'cold', 'not_interested'];
        const validSources = ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'];

        const newLeadData = {
          contact: {
            firstName: leadData.contact.firstName.trim(),
            lastName: leadData.contact.lastName?.trim() || '',
            email: leadData.contact.email.trim().toLowerCase(),
            phone: leadData.contact.phone?.trim() || '',
            alternatePhone: leadData.contact.alternatePhone?.trim(),
            address: leadData.contact.address || {}
          },
          status: validStatuses.includes(leadData.status?.toLowerCase()) ? leadData.status.toLowerCase() : 'new',
          priority: validPriorities.includes(leadData.priority?.toLowerCase()) ? leadData.priority.toLowerCase() : 'warm',
          source: validSources.includes(leadData.source?.toLowerCase()) ? leadData.source.toLowerCase() : 'website',
          agency: agencyId,
          property: leadData.property && mongoose.Types.ObjectId.isValid(leadData.property) ? leadData.property : undefined,
          assignedAgent: assignedAgentId && mongoose.Types.ObjectId.isValid(assignedAgentId) ? assignedAgentId : undefined,
          campaignName: campaignName || leadData.campaignName || landingPageName || 'Landing Page',
          inquiry: {
            message: leadData.inquiry?.message || leadData.message || '',
            budget: {
              min: leadData.inquiry?.budget?.min ? parseFloat(leadData.inquiry.budget.min) : undefined,
              max: leadData.inquiry?.budget?.max ? parseFloat(leadData.inquiry.budget.max) : undefined,
              currency: leadData.inquiry?.budget?.currency || 'USD'
            },
            preferredLocation: Array.isArray(leadData.inquiry?.preferredLocation)
              ? leadData.inquiry.preferredLocation.filter(l => l.trim())
              : (leadData.preferredLocation ? [leadData.preferredLocation] : []),
            propertyType: Array.isArray(leadData.inquiry?.propertyType)
              ? leadData.inquiry.propertyType.filter(t => t.trim())
              : (leadData.propertyType ? [leadData.propertyType] : []),
            timeline: leadData.inquiry?.timeline || leadData.timeline,
            requirements: leadData.inquiry?.requirements || leadData.requirements || ''
          },
          tags: Array.isArray(leadData.tags) ? leadData.tags : (leadData.tags ? [leadData.tags] : ['landing_page'])
        };

        // Encrypt contact information if encryption is enabled
        if (newLeadData.contact) {
          newLeadData.contact = encryptionService.encryptLeadContact(newLeadData.contact);
        }

        const lead = new Lead(newLeadData);

        // Initialize SLA tracking
        lead.sla = {
          firstContactSla: 3600000, // 1 hour default
          firstContactStatus: 'pending'
        };

        await lead.save();

        // Auto-score the lead
        try {
          await leadScoringService.autoScoreLead(lead._id);
        } catch (scoreError) {
          console.error('Error auto-scoring lead:', scoreError);
        }

        createdLeads.push(lead._id);

        // Send notifications
        try {
          const agency = await Agency.findById(agencyId);
          if (lead.assignedAgent) {
            const agent = await User.findById(lead.assignedAgent);
            if (agent) {
              const populatedLead = await Lead.findById(lead._id)
                .populate('property', 'title slug')
                .populate('agency', 'name');

              await emailService.sendNewLeadNotification(populatedLead, agent, agency);

              if (agency?.settings?.smsNotifications) {
                await smsService.sendLeadNotification(populatedLead, agent);
              }
            }
          }
        } catch (notifError) {
          console.error('Error sending notifications:', notifError);
        }
      } catch (error) {
        console.error(`Error creating lead at row ${i + 1}:`, error);
        errors.push({
          row: i + 1,
          error: error.message || 'Failed to create lead'
        });
      }
    }

    res.status(201).json({
      message: `Successfully imported ${createdLeads.length} out of ${leads.length} leads from landing page`,
      created: createdLeads.length,
      failed: errors.length,
      total: leads.length,
      landingPageName: landingPageName || 'Unknown',
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Landing page import error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/leads/webhook
// @desc    Webhook endpoint for external lead capture (ad platforms, portals)
// @access  Public (with API key validation)
router.post('/webhook', async (req, res) => {
  try {
    // Validate webhook API key
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const validApiKey = process.env.WEBHOOK_API_KEY;

    if (validApiKey && apiKey !== validApiKey) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    // Extract lead data from webhook payload
    const webhookData = req.body;

    // Map common webhook formats to our lead format
    const leadData = {
      contact: {
        firstName: webhookData.firstName || webhookData.first_name || webhookData.name?.split(' ')[0] || 'Unknown',
        lastName: webhookData.lastName || webhookData.last_name || webhookData.name?.split(' ').slice(1).join(' ') || '',
        email: webhookData.email || webhookData.email_address || '',
        phone: webhookData.phone || webhookData.phone_number || webhookData.mobile || '',
        alternatePhone: webhookData.alternatePhone || webhookData.alternate_phone
      },
      inquiry: {
        message: webhookData.message || webhookData.inquiry || webhookData.notes || '',
        budget: webhookData.budget ? {
          min: webhookData.budget.min || webhookData.budget,
          max: webhookData.budget.max || webhookData.budget
        } : undefined,
        preferredLocation: Array.isArray(webhookData.preferredLocation)
          ? webhookData.preferredLocation
          : (webhookData.preferredLocation ? [webhookData.preferredLocation] : []),
        propertyType: Array.isArray(webhookData.propertyType)
          ? webhookData.propertyType
          : (webhookData.propertyType ? [webhookData.propertyType] : []),
        timeline: webhookData.timeline,
        requirements: webhookData.requirements || webhookData.requirement
      },
      source: webhookData.source || 'other',
      campaignName: webhookData.campaignName || webhookData.campaign_name || webhookData.campaign,
      status: 'new',
      priority: 'warm'
    };

    // Validate required fields
    if (!leadData.contact.email && !leadData.contact.phone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }

    // Find or create agency (use default agency if not specified)
    let agencyId = webhookData.agency;
    if (!agencyId) {
      const Agency = require('../models/Agency');
      const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
      if (!defaultAgency) {
        return res.status(400).json({ message: 'No active agency found' });
      }
      agencyId = defaultAgency._id;
    }

    // Auto-assign agent if enabled
    let assignedAgentId = webhookData.assignedAgent || null;
    if (!assignedAgentId) {
      const Agency = require('../models/Agency');
      const agency = await Agency.findById(agencyId);
      if (agency?.settings?.autoAssignLeads) {
        const assignmentMethod = agency.settings.assignmentMethod || 'round_robin';
        assignedAgentId = await leadAssignmentService.autoAssignLead(agencyId, assignmentMethod, leadData);
      }
    }

    leadData.agency = agencyId;
    leadData.assignedAgent = assignedAgentId;

    // Encrypt contact information if encryption is enabled
    if (leadData.contact) {
      leadData.contact = encryptionService.encryptLeadContact(leadData.contact);
    }

    // Create lead
    const lead = new Lead(leadData);

    // Initialize SLA tracking
    lead.sla = {
      firstContactSla: 3600000, // 1 hour default
      firstContactStatus: 'pending'
    };

    await lead.save();

    // Auto-score the lead
    try {
      await leadScoringService.autoScoreLead(lead._id);
    } catch (scoreError) {
      console.error('Error auto-scoring lead:', scoreError);
    }

    // Send notifications
    try {
      const Agency = require('../models/Agency');
      const agency = await Agency.findById(agencyId);

      if (assignedAgentId) {
        const User = require('../models/User');
        const agent = await User.findById(assignedAgentId);
        if (agent) {
          const populatedLead = await Lead.findById(lead._id)
            .populate('property', 'title slug')
            .populate('agency', 'name');

          await emailService.sendNewLeadNotification(populatedLead, agent, agency);

          if (agency?.settings?.smsNotifications) {
            await smsService.sendLeadNotification(populatedLead, agent);
          }
        }
      }
    } catch (notifError) {
      console.error('Error sending notifications:', notifError);
    }

    res.status(201).json({
      success: true,
      leadId: lead.leadId,
      leadMongoId: lead._id,
      message: 'Lead created successfully via webhook'
    });
  } catch (error) {
    console.error('Webhook lead creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/leads/:id/site-visit
// @desc    Schedule site visit and send confirmation
// @access  Private
router.post('/:id/site-visit', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date is required'),
  body('scheduledTime').trim().notEmpty().withMessage('Scheduled time is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Auto-assign agent if not assigned (especially when super admin schedules site visit)
    if (!lead.assignedAgent && lead.agency) {
      try {
        const Agency = require('../models/Agency');
        const agency = await Agency.findById(lead.agency);

        if (agency) {
          // Use agency's auto-assignment settings if enabled
          if (agency.settings?.autoAssignLeads) {
            const assignmentMethod = agency.settings.assignmentMethod || 'round_robin';
            const leadData = {
              property: lead.property,
              inquiry: lead.inquiry,
              source: lead.source
            };
            const assignedAgentId = await leadAssignmentService.autoAssignLead(
              lead.agency,
              assignmentMethod,
              leadData
            );

            if (assignedAgentId) {
              lead.assignedAgent = assignedAgentId;
              lead.assignedBy = req.user.id;
              console.log(`✅ Auto-assigned lead ${lead._id} to agent ${assignedAgentId} when scheduling site visit`);
            }
          } else {
            // If auto-assignment is disabled, use round-robin as fallback
            const assignedAgentId = await leadAssignmentService.roundRobinAssignment(lead.agency);
            if (assignedAgentId) {
              lead.assignedAgent = assignedAgentId;
              lead.assignedBy = req.user.id;
              console.log(`✅ Auto-assigned lead ${lead._id} to agent ${assignedAgentId} (round-robin fallback)`);
            }
          }
        }
      } catch (assignError) {
        console.error('Error auto-assigning agent during site visit scheduling:', assignError);
        // Don't fail the request if assignment fails
      }
    }

    // Update site visit details
    lead.siteVisit = {
      ...lead.siteVisit,
      scheduledDate: new Date(req.body.scheduledDate),
      scheduledTime: req.body.scheduledTime,
      status: 'scheduled',
      relationshipManager: req.body.relationshipManager || lead.assignedAgent || req.user.id
    };

    // Update lead status
    if (lead.status === 'qualified' || lead.status === 'contacted' || lead.status === 'new') {
      lead.status = 'site_visit_scheduled';
    }

    await lead.save();

    // Send site visit confirmation
    try {
      const Agency = require('../models/Agency');
      const User = require('../models/User');

      const agency = await Agency.findById(lead.agency);
      const rm = await User.findById(lead.siteVisit.relationshipManager);

      // Send SMS confirmation to lead
      if (lead.contact.phone && agency?.settings?.smsNotifications) {
        await smsService.sendSiteVisitConfirmation(lead);
      }

      // Send email confirmation to lead
      if (lead.contact.email) {
        await emailService.sendSiteVisitConfirmation(lead, rm, agency);
      }

      // Notify assigned agent about site visit
      if (lead.assignedAgent) {
        const assignedAgent = await User.findById(lead.assignedAgent);
        if (assignedAgent) {
          // Send email notification to agent
          try {
            await emailService.sendSiteVisitNotificationToAgent(lead, assignedAgent, agency);
          } catch (emailError) {
            console.error('Error sending site visit email to agent:', emailError);
          }

          // Send SMS notification to agent if enabled
          if (agency?.settings?.smsNotifications && assignedAgent.phone) {
            try {
              await smsService.sendSiteVisitReminder(lead, assignedAgent);
            } catch (smsError) {
              console.error('Error sending site visit SMS to agent:', smsError);
            }
          }

          // Send lead assignment notification to agent (so lead appears in "My Leads")
          // This is especially important when super admin schedules site visit and agent is auto-assigned
          try {
            const populatedLead = await Lead.findById(lead._id)
              .populate('property', 'title slug')
              .populate('agency', 'name');

            await emailService.sendNewLeadNotification(populatedLead, assignedAgent, agency);

            if (agency?.settings?.smsNotifications && assignedAgent.phone) {
              await smsService.sendLeadNotification(populatedLead, assignedAgent);
            }

            console.log(`✅ Lead assignment notification sent to agent ${assignedAgent._id}`);
          } catch (assignNotifError) {
            console.error('Error sending lead assignment notification to agent:', assignNotifError);
            // Don't fail the request if notification fails
          }
        }
      }

      // Also notify relationship manager if different from assigned agent
      if (rm && rm._id?.toString() !== lead.assignedAgent?.toString()) {
        // Send email notification to relationship manager
        try {
          await emailService.sendSiteVisitNotificationToAgent(lead, rm, agency);
        } catch (emailError) {
          console.error('Error sending site visit email to relationship manager:', emailError);
        }

        // Send SMS notification to relationship manager if enabled
        if (agency?.settings?.smsNotifications && rm.phone) {
          try {
            await smsService.sendSiteVisitReminder(lead, rm);
          } catch (smsError) {
            console.error('Error sending site visit SMS to relationship manager:', smsError);
          }
        }
      }

      // Create auto-reminder for 24 hours before visit
      const reminderDate = new Date(lead.siteVisit.scheduledDate);
      reminderDate.setHours(reminderDate.getHours() - 24);

      if (reminderDate > new Date()) {
        lead.reminders.push({
          title: `Site Visit Reminder - ${lead.contact.firstName} ${lead.contact.lastName}`,
          description: `Reminder: Site visit scheduled for ${new Date(lead.siteVisit.scheduledDate).toLocaleDateString()} at ${lead.siteVisit.scheduledTime}`,
          reminderDate: reminderDate,
          createdBy: req.user.id
        });
        await lead.save();
      }
    } catch (notifError) {
      console.error('Error sending site visit confirmation:', notifError);
      // Don't fail the request if notifications fail
    }

    const updatedLead = await Lead.findById(lead._id)
      .populate('siteVisit.relationshipManager', 'firstName lastName email phone')
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName email phone');

    // Send webhook for site visit scheduling
    if (webhookService.isEnabled()) {
      try {
        await webhookService.sendLeadWebhook(updatedLead, 'site_visit_scheduled');
      } catch (webhookError) {
        console.error('Error sending site visit scheduling webhook:', webhookError);
        // Don't fail the request if webhook fails
      }
    }

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Schedule site visit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/leads/:id/site-visit/complete
// @desc    Mark site visit as completed
// @access  Private
router.put('/:id/site-visit/complete', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('feedback').optional().trim(),
  body('interestLevel').optional().isIn(['high', 'medium', 'low', 'not_interested']),
  body('nextAction').optional().trim()
], async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    lead.siteVisit.status = 'completed';
    lead.siteVisit.completedDate = new Date();
    if (req.body.feedback) lead.siteVisit.feedback = req.body.feedback;
    if (req.body.interestLevel) lead.siteVisit.interestLevel = req.body.interestLevel;
    if (req.body.nextAction) lead.siteVisit.nextAction = req.body.nextAction;

    // Auto-update status
    if (lead.status === 'site_visit_scheduled') {
      lead.status = 'site_visit_completed';
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('siteVisit.relationshipManager', 'firstName lastName')
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName');

    // Send webhook for site visit completion
    if (webhookService.isEnabled()) {
      try {
        await webhookService.sendLeadWebhook(updatedLead, 'site_visit_completed');
      } catch (webhookError) {
        console.error('Error sending site visit completion webhook:', webhookError);
        // Don't fail the request if webhook fails
      }
    }

    res.json({ lead: updatedLead });
  } catch (error) {
    console.error('Complete site visit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/recurring-followup
// @desc    Enable recurring follow-ups for a lead
// @access  Private
router.post('/:id/recurring-followup', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), [
  body('interval').isInt({ min: 1, max: 365 }).withMessage('Interval must be between 1 and 365 days')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const interval = parseInt(req.body.interval) || 7; // Default 7 days
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);

    lead.recurringFollowUp = {
      enabled: true,
      interval: interval,
      nextFollowUpDate: nextDate,
      count: 0
    };

    await lead.save();
    res.json({ lead });
  } catch (error) {
    console.error('Enable recurring follow-up error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/analytics/dashboard-metrics
// @desc    Get dashboard metrics with Today and Month breakdown
// @access  Private
router.get('/analytics/dashboard-metrics', auth, authorize('super_admin', 'agency_admin', 'agent'), async (req, res) => {
  try {
    const filter = {};

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    } else if (req.user.role === 'agent') {
      filter.assignedAgent = req.user.id;
    }

    // Get all leads for this user/agency
    const allLeads = await Lead.find(filter);

    // Calculate date ranges
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Filter leads by date
    const leadsToday = allLeads.filter(lead => {
      const leadDate = new Date(lead.createdAt);
      return leadDate >= startOfToday && leadDate <= endOfToday;
    });

    const leadsThisMonth = allLeads.filter(lead => {
      const leadDate = new Date(lead.createdAt);
      return leadDate >= startOfMonth && leadDate <= endOfMonth;
    });

    // Filter leads with follow-ups scheduled for today
    const todaysFollowUps = allLeads.filter(lead => {
      if (!lead.followUpDate) return false;
      const followUpDate = new Date(lead.followUpDate);
      // Check if follow-up date is today
      return followUpDate >= startOfToday && followUpDate <= endOfToday;
    });

    // Calculate today's follow-up analysis
    const activeStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation'];
    const todaysFollowUpsActive = todaysFollowUps.filter(l => activeStatuses.includes(l.status));
    const todaysFollowUpsCompleted = todaysFollowUps.filter(l => l.status === 'booked' || l.status === 'closed');
    // Pending = active leads that still need follow-up action today
    const todaysFollowUpsPending = todaysFollowUpsActive.length;

    // Calculate metrics
    const metrics = {
      totalLeads: allLeads.length,
      newLeads: {
        total: allLeads.filter(l => l.status === 'new').length,
        today: leadsToday.filter(l => l.status === 'new').length,
        thisMonth: leadsThisMonth.filter(l => l.status === 'new').length
      },
      totalNewLeads: allLeads.filter(l => l.status === 'new').length,
      newLeadsToday: leadsToday.filter(l => l.status === 'new').length,
      newLeadsThisMonth: leadsThisMonth.filter(l => l.status === 'new').length,
      conversionRate: allLeads.length > 0
        ? ((allLeads.filter(l => l.status === 'booked' || l.status === 'closed').length / allLeads.length) * 100).toFixed(2)
        : 0,
      todaysFollowUps: {
        total: todaysFollowUps.length,
        active: todaysFollowUpsActive.length,
        completed: todaysFollowUpsCompleted.length,
        pending: todaysFollowUpsPending,
        completionRate: todaysFollowUps.length > 0
          ? ((todaysFollowUpsCompleted.length / todaysFollowUps.length) * 100).toFixed(1)
          : 0
      },
      leadSourcePerformance: {},
      salesExecutivePerformance: {}
    };

    // Source performance
    allLeads.forEach(lead => {
      const source = lead.source || 'unknown';
      if (!metrics.leadSourcePerformance[source]) {
        metrics.leadSourcePerformance[source] = {
          total: 0,
          converted: 0,
          conversionRate: 0
        };
      }
      metrics.leadSourcePerformance[source].total++;
      if (lead.status === 'booked' || lead.status === 'closed') {
        metrics.leadSourcePerformance[source].converted++;
      }
    });

    // Calculate conversion rates for sources
    Object.keys(metrics.leadSourcePerformance).forEach(source => {
      const sourceData = metrics.leadSourcePerformance[source];
      sourceData.conversionRate = sourceData.total > 0
        ? ((sourceData.converted / sourceData.total) * 100).toFixed(2)
        : 0;
    });

    // Sales executive performance (if agent role, show only their data)
    const agentLeadsMap = {};
    allLeads.forEach(lead => {
      if (lead.assignedAgent) {
        const agentId = lead.assignedAgent.toString();
        if (!agentLeadsMap[agentId]) {
          agentLeadsMap[agentId] = {
            agentId: agentId,
            totalLeads: 0,
            convertedLeads: 0,
            conversionRate: 0
          };
        }
        agentLeadsMap[agentId].totalLeads++;
        if (lead.status === 'booked' || lead.status === 'closed') {
          agentLeadsMap[agentId].convertedLeads++;
        }
      }
    });

    // Calculate conversion rates for agents
    Object.keys(agentLeadsMap).forEach(agentId => {
      const agentData = agentLeadsMap[agentId];
      agentData.conversionRate = agentData.totalLeads > 0
        ? ((agentData.convertedLeads / agentData.totalLeads) * 100).toFixed(2)
        : 0;
    });

    metrics.salesExecutivePerformance = Object.values(agentLeadsMap);

    res.json({
      metrics: metrics,
      dateRanges: {
        today: {
          start: startOfToday,
          end: endOfToday
        },
        thisMonth: {
          start: startOfMonth,
          end: endOfMonth
        }
      }
    });
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/analytics/advanced
// @desc    Get advanced analytics with comparisons and predictions
// @access  Private
router.get('/analytics/advanced', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const filter = {};

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    }

    // Date range filtering
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days

    filter.createdAt = {
      $gte: startDate,
      $lte: endDate
    };

    // Get all leads in date range
    const leads = await Lead.find(filter)
      .populate('assignedAgent', 'firstName lastName')
      .populate('property', 'price')
      .populate('booking', 'bookingAmount');

    // Calculate time periods for comparison
    const periodLength = Math.ceil((endDate - startDate) / (2 * 24 * 60 * 60 * 1000)); // Half period in days
    const previousStartDate = new Date(startDate.getTime() - (endDate - startDate));
    const previousEndDate = startDate;

    const previousLeads = await Lead.find({
      ...filter,
      createdAt: {
        $gte: previousStartDate,
        $lte: previousEndDate
      }
    })
      .populate('assignedAgent', 'firstName lastName')
      .populate('property', 'price')
      .populate('booking', 'bookingAmount');

    // Current period metrics
    const currentMetrics = {
      totalLeads: leads.length,
      newLeads: leads.filter(l => l.status === 'new').length,
      convertedLeads: leads.filter(l => l.status === 'booked' || l.status === 'closed').length,
      totalRevenue: leads.reduce((sum, l) => {
        return sum + (l.booking?.bookingAmount || l.property?.price || 0);
      }, 0),
      averageLeadValue: 0,
      conversionRate: 0,
      sourceBreakdown: {},
      agentPerformance: {}
    };

    // Previous period metrics
    const previousMetrics = {
      totalLeads: previousLeads.length,
      newLeads: previousLeads.filter(l => l.status === 'new').length,
      convertedLeads: previousLeads.filter(l => l.status === 'booked' || l.status === 'closed').length,
      totalRevenue: previousLeads.reduce((sum, l) => {
        return sum + (l.booking?.bookingAmount || l.property?.price || 0);
      }, 0),
      averageLeadValue: 0,
      conversionRate: 0
    };

    // Calculate conversion rates
    currentMetrics.conversionRate = currentMetrics.totalLeads > 0
      ? (currentMetrics.convertedLeads / currentMetrics.totalLeads * 100)
      : 0;
    previousMetrics.conversionRate = previousMetrics.totalLeads > 0
      ? (previousMetrics.convertedLeads / previousMetrics.totalLeads * 100)
      : 0;

    // Calculate average lead values
    currentMetrics.averageLeadValue = currentMetrics.convertedLeads > 0
      ? (currentMetrics.totalRevenue / currentMetrics.convertedLeads)
      : 0;
    previousMetrics.averageLeadValue = previousMetrics.convertedLeads > 0
      ? (previousMetrics.totalRevenue / previousMetrics.convertedLeads)
      : 0;

    // Source breakdown
    leads.forEach(lead => {
      const source = lead.source || 'unknown';
      if (!currentMetrics.sourceBreakdown[source]) {
        currentMetrics.sourceBreakdown[source] = {
          total: 0,
          converted: 0,
          revenue: 0
        };
      }
      currentMetrics.sourceBreakdown[source].total++;
      if (lead.status === 'booked' || lead.status === 'closed') {
        currentMetrics.sourceBreakdown[source].converted++;
        currentMetrics.sourceBreakdown[source].revenue += (lead.booking?.bookingAmount || lead.property?.price || 0);
      }
    });

    // Agent performance
    leads.forEach(lead => {
      if (lead.assignedAgent) {
        const agentId = lead.assignedAgent._id.toString();
        if (!currentMetrics.agentPerformance[agentId]) {
          currentMetrics.agentPerformance[agentId] = {
            agentName: `${lead.assignedAgent.firstName} ${lead.assignedAgent.lastName}`,
            totalLeads: 0,
            convertedLeads: 0,
            revenue: 0,
            conversionRate: 0
          };
        }
        currentMetrics.agentPerformance[agentId].totalLeads++;
        if (lead.status === 'booked' || lead.status === 'closed') {
          currentMetrics.agentPerformance[agentId].convertedLeads++;
          currentMetrics.agentPerformance[agentId].revenue += (lead.booking?.bookingAmount || lead.property?.price || 0);
        }
      }
    });

    // Calculate agent conversion rates
    Object.keys(currentMetrics.agentPerformance).forEach(agentId => {
      const agent = currentMetrics.agentPerformance[agentId];
      agent.conversionRate = agent.totalLeads > 0
        ? (agent.convertedLeads / agent.totalLeads * 100)
        : 0;
    });

    // Calculate trends (percentage change)
    const trends = {
      totalLeads: previousMetrics.totalLeads > 0
        ? (((currentMetrics.totalLeads - previousMetrics.totalLeads) / previousMetrics.totalLeads) * 100).toFixed(2)
        : currentMetrics.totalLeads > 0 ? 100 : 0,
      conversionRate: previousMetrics.conversionRate > 0
        ? (((currentMetrics.conversionRate - previousMetrics.conversionRate) / previousMetrics.conversionRate) * 100).toFixed(2)
        : currentMetrics.conversionRate > 0 ? 100 : 0,
      revenue: previousMetrics.totalRevenue > 0
        ? (((currentMetrics.totalRevenue - previousMetrics.totalRevenue) / previousMetrics.totalRevenue) * 100).toFixed(2)
        : currentMetrics.totalRevenue > 0 ? 100 : 0
    };

    // Predictions (simple linear projection)
    const predictions = {
      nextPeriodLeads: Math.round(currentMetrics.totalLeads * (1 + (parseFloat(trends.totalLeads) / 100))),
      nextPeriodRevenue: Math.round(currentMetrics.totalRevenue * (1 + (parseFloat(trends.revenue) / 100))),
      nextPeriodConversions: Math.round(currentMetrics.convertedLeads * (1 + (parseFloat(trends.conversionRate) / 100)))
    };

    res.json({
      currentPeriod: {
        startDate: startDate,
        endDate: endDate,
        metrics: currentMetrics
      },
      previousPeriod: {
        startDate: previousStartDate,
        endDate: previousEndDate,
        metrics: previousMetrics
      },
      trends: trends,
      predictions: predictions,
      sourceBreakdown: Object.entries(currentMetrics.sourceBreakdown).map(([source, data]) => ({
        source,
        total: data.total,
        converted: data.converted,
        revenue: data.revenue,
        conversionRate: data.total > 0 ? ((data.converted / data.total) * 100).toFixed(2) : 0
      })).sort((a, b) => b.revenue - a.revenue),
      agentPerformance: Object.values(currentMetrics.agentPerformance)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10) // Top 10 agents
    });
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/analytics/campaign-roi
// @desc    Get campaign ROI analysis report
// @access  Private
router.get('/analytics/campaign-roi', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const filter = {};

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    }

    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    // Get all leads with campaign names
    const leads = await Lead.find({
      ...filter,
      campaignName: { $exists: true, $ne: null, $ne: '' }
    })
      .populate('property', 'price')
      .populate('booking', 'bookingAmount');

    // Group by campaign
    const campaignData = {};

    leads.forEach(lead => {
      const campaign = lead.campaignName || 'Unknown';
      if (!campaignData[campaign]) {
        campaignData[campaign] = {
          campaignName: campaign,
          totalLeads: 0,
          convertedLeads: 0,
          totalRevenue: 0,
          averageLeadValue: 0,
          conversionRate: 0,
          leads: []
        };
      }

      campaignData[campaign].totalLeads++;

      // Check if converted (booked or closed)
      if (lead.status === 'booked' || lead.status === 'closed') {
        campaignData[campaign].convertedLeads++;

        // Calculate revenue
        let revenue = 0;
        if (lead.booking?.bookingAmount) {
          revenue = lead.booking.bookingAmount;
        } else if (lead.property?.price) {
          revenue = lead.property.price;
        }
        campaignData[campaign].totalRevenue += revenue;
      }

      campaignData[campaign].leads.push({
        _id: lead._id,
        leadId: lead.leadId,
        name: `${lead.contact.firstName} ${lead.contact.lastName}`,
        status: lead.status,
        revenue: lead.booking?.bookingAmount || lead.property?.price || 0,
        createdAt: lead.createdAt
      });
    });

    // Calculate metrics for each campaign
    const campaigns = Object.values(campaignData).map(campaign => {
      campaign.conversionRate = campaign.totalLeads > 0
        ? ((campaign.convertedLeads / campaign.totalLeads) * 100).toFixed(2)
        : 0;
      campaign.averageLeadValue = campaign.convertedLeads > 0
        ? (campaign.totalRevenue / campaign.convertedLeads).toFixed(2)
        : 0;

      // ROI calculation (assuming campaign cost is stored separately, for now using lead count as proxy)
      // In real implementation, you'd fetch campaign costs from a campaigns table
      campaign.estimatedROI = campaign.totalRevenue > 0
        ? ((campaign.totalRevenue - (campaign.totalLeads * 100)) / (campaign.totalLeads * 100) * 100).toFixed(2)
        : 0;

      return campaign;
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalLeads = leads.length;
    const totalConverted = leads.filter(l => l.status === 'booked' || l.status === 'closed').length;
    const totalRevenue = campaigns.reduce((sum, c) => sum + parseFloat(c.totalRevenue), 0);

    res.json({
      campaigns,
      summary: {
        totalCampaigns: campaigns.length,
        totalLeads,
        totalConverted,
        totalRevenue: totalRevenue.toFixed(2),
        overallConversionRate: totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(2) : 0,
        averageRevenuePerConversion: totalConverted > 0 ? (totalRevenue / totalConverted).toFixed(2) : 0
      }
    });
  } catch (error) {
    console.error('Campaign ROI analysis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/analytics/lost-reasons
// @desc    Get lost reason analysis report
// @access  Private
router.get('/analytics/lost-reasons', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const filter = {};

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    }

    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    // Get lost leads with reasons
    const lostLeads = await Lead.find({
      ...filter,
      status: 'lost',
      lostReason: { $exists: true, $ne: null, $ne: '' }
    });

    // Analyze lost reasons
    const reasonAnalysis = {};
    lostLeads.forEach(lead => {
      const reason = lead.lostReason || 'Not specified';
      if (!reasonAnalysis[reason]) {
        reasonAnalysis[reason] = {
          reason: reason,
          count: 0,
          percentage: 0,
          leads: []
        };
      }
      reasonAnalysis[reason].count++;
      reasonAnalysis[reason].leads.push({
        _id: lead._id,
        leadId: lead.leadId,
        name: `${lead.contact.firstName} ${lead.contact.lastName}`,
        email: lead.contact.email,
        phone: lead.contact.phone,
        createdAt: lead.createdAt,
        lostAt: lead.updatedAt
      });
    });

    // Calculate percentages
    const total = lostLeads.length;
    const analysis = Object.values(reasonAnalysis).map(item => ({
      ...item,
      percentage: total > 0 ? ((item.count / total) * 100).toFixed(2) : 0
    })).sort((a, b) => b.count - a.count);

    res.json({
      total: total,
      analysis: analysis,
      summary: {
        totalLostLeads: total,
        totalWithReasons: lostLeads.filter(l => l.lostReason).length,
        topReason: analysis.length > 0 ? analysis[0] : null
      }
    });
  } catch (error) {
    console.error('Lost reason analysis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/auto-stage
// @desc    Trigger auto stage movement check
// @access  Private
router.post('/:id/auto-stage', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const previousStatus = lead.status;

    // Auto stage movement logic
    // 1. If site visit completed with high interest -> move to negotiation
    if (lead.status === 'site_visit_completed' && lead.siteVisit?.interestLevel === 'high') {
      lead.status = 'negotiation';
    }

    // 2. If negotiation and booking details added -> move to booked
    if (lead.status === 'negotiation' && lead.booking?.bookingAmount) {
      lead.status = 'booked';
      lead.convertedAt = new Date();
    }

    // 3. If contacted multiple times but no progress -> check for qualification
    if (lead.status === 'contacted' && lead.communications && lead.communications.length >= 3) {
      // Check if lead has shown interest (has property inquiry, budget, etc.)
      if (lead.property || (lead.inquiry?.budget && lead.inquiry.budget.min)) {
        lead.status = 'qualified';
      }
    }

    // 4. If site visit scheduled but not completed after scheduled date + 1 day -> mark as no-show
    if (lead.status === 'site_visit_scheduled' && lead.siteVisit?.scheduledDate) {
      const scheduledDate = new Date(lead.siteVisit.scheduledDate);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (scheduledDate < tomorrow && lead.siteVisit.status === 'scheduled') {
        // Check if visit was completed
        if (!lead.siteVisit.completedDate) {
          lead.siteVisit.status = 'no_show';
        }
      }
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('property', 'title slug')
      .populate('assignedAgent', 'firstName lastName');

    res.json({
      lead: updatedLead,
      statusChanged: previousStatus !== lead.status,
      previousStatus,
      newStatus: lead.status
    });
  } catch (error) {
    console.error('Auto stage movement error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/webhook/send-all
// @desc    Send all leads to external webhook (bulk export)
// @access  Private (super_admin only)
router.post('/webhook/send-all', auth, authorize('super_admin'), async (req, res) => {
  try {
    const { status, agency, startDate, endDate, limit } = req.body;

    // Build filter
    const filter = {};
    if (status) filter.status = status;
    if (agency) {
      if (mongoose.Types.ObjectId.isValid(agency)) {
        filter.agency = new mongoose.Types.ObjectId(agency);
      }
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const [year, month, day] = startDate.split('-').map(Number);
        filter.createdAt.$gte = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
      if (endDate) {
        const [year, month, day] = endDate.split('-').map(Number);
        filter.createdAt.$lte = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
      }
    }

    // Fetch all leads with proper population
    const maxLimit = limit && limit <= 10000 ? parseInt(limit) : 10000;
    const leads = await Lead.find(filter)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('assignedAgent', 'firstName lastName email')
      .sort('-createdAt')
      .limit(maxLimit);

    if (leads.length === 0) {
      return res.status(404).json({ message: 'No leads found to send' });
    }

    // Send bulk webhook
    if (!webhookService.isEnabled()) {
      return res.status(400).json({
        message: 'Webhook not configured. Please set OUTBOUND_WEBHOOK_URL in environment variables.'
      });
    }

    const result = await webhookService.sendBulkLeadsWebhook(leads, 'bulk_export');

    if (result.success) {
      res.json({
        success: true,
        message: `Successfully sent ${leads.length} leads to webhook`,
        totalLeads: leads.length,
        webhookResponse: result.response
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send leads to webhook',
        error: result.error,
        totalLeads: leads.length
      });
    }
  } catch (error) {
    console.error('Bulk webhook send error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

