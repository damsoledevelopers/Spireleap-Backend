const express = require('express');
const mongoose = require('mongoose');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Agency = require('../models/Agency');
const { auth, authorize, checkModulePermission } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/stats/dashboard
// @desc    Get optimized dashboard statistics
// @access  Private
router.get('/dashboard', auth, checkModulePermission('leads', 'view'), async (req, res) => {
  try {
    const leadFilter = {};
    const propertyFilter = {};

    // Role-based filtering with explicit ObjectId casting for aggregation
    const agencyId = req.user.agency && mongoose.Types.ObjectId.isValid(req.user.agency)
      ? new mongoose.Types.ObjectId(req.user.agency)
      : req.user.agency;

    const userId = req.user.id && mongoose.Types.ObjectId.isValid(req.user.id)
      ? new mongoose.Types.ObjectId(req.user.id)
      : req.user.id;

    if (req.user.role === 'agency_admin') {
      leadFilter.agency = agencyId;
      propertyFilter.agency = agencyId;
    } else if (req.user.role === 'agent') {
      // Agents see leads assigned to them OR leads for properties they manage
      const agentProperties = await Property.find({ agent: userId }).distinct('_id');

      leadFilter.agency = agencyId;
      leadFilter.$and = [
        {
          $or: [
            { assignedAgent: userId },
            { property: { $in: agentProperties } }
          ]
        }
      ];

      propertyFilter.agent = userId;
      propertyFilter.agency = agencyId;
    }

    // Use aggregation for efficient counting
    const [
      totalAgencies,
      totalProperties,
      activeProperties,
      totalLeads,
      activeLeads,
      agentStats,
      staffStats,
      inquiryStats,
      inquiriesByAgency
    ] = await Promise.all([
      // Total agencies (only for super_admin and staff)
      (req.user.role === 'super_admin' || req.user.role === 'staff')
        ? Agency.countDocuments()
        : Promise.resolve(0),

      // Total properties
      Property.countDocuments(propertyFilter),

      // Active properties
      Property.countDocuments({ ...propertyFilter, status: 'active' }),

      // Total leads
      Lead.countDocuments(leadFilter),

      // Active leads
      Lead.countDocuments({
        ...leadFilter,
        status: { $in: ['new', 'contacted', 'site_visit_scheduled', 'site_visit_completed', 'negotiation'] }
      }),

      // Agent Stats
      User.aggregate([
        {
          $match: {
            role: 'agent',
            ...((req.user.role !== 'super_admin' && req.user.role !== 'staff') ? { agency: agencyId } : {})
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } }
          }
        }
      ]),

      // Staff Stats
      User.aggregate([
        {
          $match: {
            role: 'staff',
            ...((req.user.role !== 'super_admin' && req.user.role !== 'staff') ? { agency: agencyId } : {})
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } }
          }
        }
      ]),

      // Inquiry stats by source (aggregation)
      Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 }
          }
        }
      ]),

      // Inquiries by agency (only for super_admin and staff)
      (req.user.role === 'super_admin' || req.user.role === 'staff')
        ? Lead.aggregate([
          {
            $group: {
              _id: '$agency',
              count: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'agencies',
              localField: '_id',
              foreignField: '_id',
              as: 'agency'
            }
          },
          {
            $unwind: {
              path: '$agency',
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $project: {
              name: { $ifNull: ['$agency.name', 'Unknown Agency'] },
              count: 1
            }
          },
          { $limit: 10 }
        ])
        : Promise.resolve([])
    ]);

    // Format inquiry stats
    const formattedInquiryStats = {
      website: 0,
      phone: 0,
      email: 0,
      walk_in: 0,
      referral: 0,
      other: 0
    };

    inquiryStats.forEach(stat => {
      const source = stat._id || 'other';
      if (formattedInquiryStats.hasOwnProperty(source)) {
        formattedInquiryStats[source] = stat.count;
      } else {
        formattedInquiryStats.other += stat.count;
      }
    });

    const agentRes = agentStats[0] || { total: 0, active: 0 };
    const staffRes = staffStats[0] || { total: 0, active: 0 };

    // Property stats by status
    const propertyStatusStats = await Property.aggregate([
      { $match: propertyFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const propertyStatusMap = {};
    propertyStatusStats.forEach(stat => {
      propertyStatusMap[stat._id] = stat.count;
    });

    // Unique locations aggregation
    const uniqueLocations = await Property.aggregate([
      { $match: propertyFilter },
      {
        $group: {
          _id: null,
          cities: { $addToSet: '$location.city' },
          states: { $addToSet: '$location.state' },
          countries: { $addToSet: '$location.country' },
          areas: { $addToSet: '$location.area' }
        }
      }
    ]);

    const locations = uniqueLocations[0] || { cities: [], states: [], countries: [], areas: [] };
    // Filter out null/empty values and sort
    const cleanSort = (arr) => [...new Set(arr.filter(Boolean))].sort();

    res.json({
      totalAgencies,
      totalProperties,
      activeProperties: propertyStatusMap['active'] || 0,
      soldProperties: propertyStatusMap['sold'] || 0,
      rentedProperties: propertyStatusMap['rented'] || 0,
      pendingProperties: propertyStatusMap['pending'] || 0,
      inactiveProperties: propertyStatusMap['inactive'] || 0,
      uniqueLocations: {
        cities: cleanSort(locations.cities),
        states: cleanSort(locations.states),
        countries: cleanSort(locations.countries),
        areas: cleanSort(locations.areas)
      },
      totalLeads,
      activeLeads,
      totalAgents: agentRes.total,
      activeAgents: agentRes.active,
      inactiveAgents: agentRes.total - agentRes.active,
      totalStaff: staffRes.total,
      activeStaff: staffRes.active,
      inactiveStaff: staffRes.total - staffRes.active,
      inquiryStats: formattedInquiryStats,
      inquiriesByAgency
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/stats/reports
// @desc    Get optimized report statistics with date filtering
// @access  Private
router.get('/reports', auth, checkModulePermission('analytics', 'view'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const dateFilter = {};

    // Date filtering
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        const [year, month, day] = startDate.split('-').map(Number);
        dateFilter.createdAt.$gte = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
      if (endDate) {
        const [year, month, day] = endDate.split('-').map(Number);
        dateFilter.createdAt.$lte = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
      }
    }

    let leadFilter = { ...dateFilter };
    let propertyFilter = { ...dateFilter };

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      leadFilter.agency = req.user.agency;
      propertyFilter.agency = req.user.agency;
    } else if (req.user.role === 'agent') {
      const agentId = mongoose.Types.ObjectId.isValid(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : req.user.id;
      const agentProperties = await Property.find({ agent: agentId }).distinct('_id');

      leadFilter.agency = req.user.agency;
      leadFilter.$and = leadFilter.$and || [];
      leadFilter.$and.push({
        $or: [
          { assignedAgent: agentId },
          { property: { $in: agentProperties } }
        ]
      });

      propertyFilter.agent = agentId;
      propertyFilter.agency = req.user.agency;
    }

    // Use aggregation for efficient statistics
    const [
      propertiesByStatus,
      propertiesByType,
      propertiesByListingType,
      propertiesByLocation,
      leadsByStatus,
      leadsBySource,
      leadsByPriority,
      usersByRole,
      totalPropertyValue,
      recentProperties,
      recentLeads,
      agentPerformance
    ] = await Promise.all([
      // Properties by status
      Property.aggregate([
        { $match: propertyFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Properties by type
      Property.aggregate([
        { $match: propertyFilter },
        {
          $group: {
            _id: '$propertyType',
            count: { $sum: 1 }
          }
        }
      ]),

      // Properties by listing type
      Property.aggregate([
        { $match: propertyFilter },
        {
          $group: {
            _id: '$listingType',
            count: { $sum: 1 }
          }
        }
      ]),

      // Properties by location
      Property.aggregate([
        { $match: propertyFilter },
        {
          $group: {
            _id: '$location.city',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),

      // Leads by status
      Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Leads by source
      Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 }
          }
        }
      ]),

      // Leads by priority
      Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: '$priority',
            count: { $sum: 1 }
          }
        }
      ]),

      // Users by role (only for super_admin)
      req.user.role === 'super_admin'
        ? User.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: '$role',
              count: { $sum: 1 }
            }
          }
        ])
        : Promise.resolve([]),

      // Total property value (sale prices only)
      Property.aggregate([
        { $match: propertyFilter },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  { $ifNull: ['$price.sale', false] },
                  '$price.sale',
                  0
                ]
              }
            }
          }
        }
      ]),

      // Recent Activity - Properties
      Property.find(propertyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('agent', 'firstName lastName')
        .lean(),

      // Recent Activity - Leads
      Lead.find(leadFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

      // Agent Performance
      User.aggregate([
        {
          $match: {
            role: 'agent',
            ...(req.user.role !== 'super_admin' ? { agency: agencyId } : {})
          }
        },
        {
          $lookup: {
            from: 'leads',
            localField: '_id',
            foreignField: 'assignedAgent',
            as: 'leads'
          }
        },
        {
          $lookup: {
            from: 'properties',
            localField: '_id',
            foreignField: 'agent',
            as: 'properties'
          }
        },
        {
          $project: {
            firstName: 1,
            lastName: 1,
            email: 1,
            totalLeads: { $size: '$leads' },
            convertedLeads: {
              $size: {
                $filter: {
                  input: '$leads',
                  as: 'lead',
                  cond: { $eq: ['$$lead.status', 'converted'] }
                }
              }
            },
            totalProperties: { $size: '$properties' },
            activeProperties: {
              $size: {
                $filter: {
                  input: '$properties',
                  as: 'prop',
                  cond: { $eq: ['$$prop.status', 'active'] }
                }
              }
            }
          }
        },
        { $sort: { totalLeads: -1 } },
        { $limit: 10 }
      ])
    ]);

    // Format results
    const formatStats = (stats) => {
      const result = {};
      stats.forEach(stat => {
        result[stat._id || 'unknown'] = stat.count;
      });
      return result;
    };

    // Format recent activity
    const recentActivity = [
      ...recentProperties.map(p => ({
        type: 'property_added',
        message: `New property: ${p.title}`,
        time: p.createdAt,
        user: p.agent ? `${p.agent.firstName || ''} ${p.agent.lastName || ''}`.trim() : 'System',
        link: `/admin/properties/${p._id}`
      })),
      ...recentLeads.map(l => ({
        type: 'lead_created',
        message: `New lead: ${l.contact?.firstName || ''} ${l.contact?.lastName || ''}`.trim(),
        time: l.createdAt,
        user: l.source || 'Website',
        link: `/admin/leads/${l._id}`
      }))
    ].sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json({
      propertiesByStatus: formatStats(propertiesByStatus),
      propertiesByType: formatStats(propertiesByType),
      propertiesByListingType: formatStats(propertiesByListingType),
      propertiesByLocation: formatStats(propertiesByLocation),
      leadsByStatus: formatStats(leadsByStatus),
      leadsBySource: formatStats(leadsBySource),
      leadsByPriority: formatStats(leadsByPriority),
      usersByRole: formatStats(usersByRole),
      totalPropertyValue: totalPropertyValue[0]?.total || 0,
      recentActivity,
      agentPerformance: agentPerformance.map(a => ({
        ...a,
        name: `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
        conversionRate: a.totalLeads > 0 ? ((a.convertedLeads / a.totalLeads) * 100).toFixed(1) : 0
      }))
    });
  } catch (error) {
    console.error('Get report stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

