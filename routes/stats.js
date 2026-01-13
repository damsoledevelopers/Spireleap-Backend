const express = require('express');
const mongoose = require('mongoose');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Agency = require('../models/Agency');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/stats/dashboard
// @desc    Get optimized dashboard statistics
// @access  Private
router.get('/dashboard', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const filter = {};

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    } else if (req.user.role === 'agent') {
      filter.assignedAgent = req.user.id;
      filter.agency = req.user.agency;
    }

    // Use aggregation for efficient counting
    const [
      totalAgencies,
      totalProperties,
      activeProperties,
      totalLeads,
      activeLeads,
      totalUsers,
      inquiryStats,
      inquiriesByAgency
    ] = await Promise.all([
      // Total agencies (only for super_admin)
      req.user.role === 'super_admin'
        ? Agency.countDocuments()
        : Promise.resolve(0),

      // Total properties
      Property.countDocuments(filter),

      // Active properties
      Property.countDocuments({ ...filter, status: 'active' }),

      // Total leads
      Lead.countDocuments(filter),

      // Active leads
      Lead.countDocuments({
        ...filter,
        status: { $in: ['new', 'contacted', 'site_visit_scheduled', 'site_visit_completed', 'negotiation'] }
      }),

      // Total users (only for super_admin)
      req.user.role === 'super_admin'
        ? User.countDocuments()
        : User.countDocuments({ ...filter, role: 'agent' }),

      // Inquiry stats by source (aggregation)
      Lead.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 }
          }
        }
      ]),

      // Inquiries by agency (only for super_admin)
      req.user.role === 'super_admin'
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

    res.json({
      totalAgencies,
      totalProperties,
      activeProperties,
      totalLeads,
      activeLeads,
      totalUsers,
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
router.get('/reports', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const dateFilter = {};

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      filter.agency = req.user.agency;
    }

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

    const propertyFilter = { ...filter, ...dateFilter };
    const leadFilter = { ...filter, ...dateFilter };

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
      totalPropertyValue
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

    res.json({
      propertiesByStatus: formatStats(propertiesByStatus),
      propertiesByType: formatStats(propertiesByType),
      propertiesByListingType: formatStats(propertiesByListingType),
      propertiesByLocation: formatStats(propertiesByLocation),
      leadsByStatus: formatStats(leadsByStatus),
      leadsBySource: formatStats(leadsBySource),
      leadsByPriority: formatStats(leadsByPriority),
      usersByRole: formatStats(usersByRole),
      totalPropertyValue: totalPropertyValue[0]?.total || 0
    });
  } catch (error) {
    console.error('Get report stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

