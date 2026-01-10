const express = require('express');
const { body, validationResult } = require('express-validator');
const Blog = require('../models/Blog');
const Page = require('../models/Page');
const Banner = require('../models/Banner');
const Category = require('../models/Category');
const Amenity = require('../models/Amenity');
const Testimonial = require('../models/Testimonial');
const ContactMessage = require('../models/ContactMessage');
const Footer = require('../models/Footer');
const Agency = require('../models/Agency');
const { auth, authorize, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ==================== BLOGS ====================

// @route   GET /api/cms/blogs
// @desc    Get all blogs
// @access  Public (with optional auth for admin access)
router.get('/blogs', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    // Only show published blogs to non-admin users
    // Admins (super_admin, agency_admin) can see all blogs including drafts
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.status = 'published';
    }

    const limit = parseInt(req.query.limit) || (req.user && (req.user.role === 'super_admin' || req.user.role === 'agency_admin') ? 100 : 10);
    
    const blogs = await Blog.find(filter)
      .populate('author', 'firstName lastName profileImage')
      .populate('category', 'name slug')
      .sort('-publishedAt -createdAt')
      .limit(limit);

    res.json({ blogs });
  } catch (error) {
    console.error('Get blogs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cms/blogs/:slug
// @desc    Get single blog by slug
// @access  Public
router.get('/blogs/:slug', async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug })
      .populate('author', 'firstName lastName profileImage')
      .populate('category', 'name slug');

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    blog.viewCount += 1;
    await blog.save();

    res.json({ blog });
  } catch (error) {
    console.error('Get blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/cms/blogs
// @desc    Create blog
// @access  Private (Super Admin, Agency Admin)
router.post('/blogs', auth, authorize('super_admin', 'agency_admin'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('content').notEmpty().withMessage('Content is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const blog = new Blog({
      ...req.body,
      author: req.user.id,
      publishedAt: req.body.status === 'published' ? new Date() : null
    });
    await blog.save();

    const populatedBlog = await Blog.findById(blog._id)
      .populate('author', 'firstName lastName')
      .populate('category', 'name slug');

    res.status(201).json({ blog: populatedBlog });
  } catch (error) {
    console.error('Create blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/cms/blogs/:id
// @desc    Update blog
// @access  Private
router.put('/blogs/:id', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    Object.assign(blog, req.body);
    if (req.body.status === 'published' && !blog.publishedAt) {
      blog.publishedAt = new Date();
    }
    await blog.save();

    res.json({ blog });
  } catch (error) {
    console.error('Update blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/cms/blogs/:id
// @desc    Delete blog
// @access  Private
router.delete('/blogs/:id', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    await blog.deleteOne();
    res.json({ message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('Delete blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== PAGES ====================

// @route   GET /api/cms/pages
// @desc    Get all pages
// @access  Public (with optional auth for admin access)
router.get('/pages', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    // Only show active pages to non-admin users
    // Admins can see all pages including inactive ones
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.isActive = true;
    }
    const pages = await Page.find(filter).sort('order');
    res.json({ pages });
  } catch (error) {
    console.error('Get pages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cms/pages/:slug
// @desc    Get single page by slug
// @access  Public
router.get('/pages/:slug', async (req, res) => {
  try {
    const page = await Page.findOne({ slug: req.params.slug, isActive: true });
    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }
    res.json({ page });
  } catch (error) {
    console.error('Get page error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/cms/pages
// @desc    Create page
// @access  Private (Super Admin)
router.post('/pages', auth, authorize('super_admin'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('slug').trim().notEmpty().withMessage('Slug is required'),
  body('content').notEmpty().withMessage('Content is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = new Page(req.body);
    await page.save();
    res.status(201).json({ page });
  } catch (error) {
    console.error('Create page error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/cms/pages/:id
// @desc    Update page
// @access  Private
router.put('/pages/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }

    Object.assign(page, req.body);
    await page.save();
    res.json({ page });
  } catch (error) {
    console.error('Update page error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/cms/pages/:id
// @desc    Delete page
// @access  Private
router.delete('/pages/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }

    await page.deleteOne();
    res.json({ message: 'Page deleted successfully' });
  } catch (error) {
    console.error('Delete page error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== BANNERS ====================

// @route   GET /api/cms/banners
// @desc    Get all banners
// @access  Public (with optional auth for admin access)
router.get('/banners', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    // Only show active banners to non-admin users
    // Admins can see all banners including inactive ones
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.isActive = true;
    }
    
    if (req.query.position) {
      filter.$or = [
        { position: req.query.position },
        { position: 'all' }
      ];
    }

    const limit = parseInt(req.query.limit) || (req.user && (req.user.role === 'super_admin' || req.user.role === 'agency_admin') ? 100 : 10);

    const banners = await Banner.find(filter)
      .sort('order')
      .limit(limit);

    res.json({ banners });
  } catch (error) {
    console.error('Get banners error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/cms/banners
// @desc    Create banner
// @access  Private (Super Admin)
router.post('/banners', auth, authorize('super_admin'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('image').notEmpty().withMessage('Image is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const banner = new Banner(req.body);
    await banner.save();
    res.status(201).json({ banner });
  } catch (error) {
    console.error('Create banner error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/cms/banners/:id
// @desc    Update banner
// @access  Private
router.put('/banners/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ message: 'Banner not found' });
    }

    Object.assign(banner, req.body);
    await banner.save();
    res.json({ banner });
  } catch (error) {
    console.error('Update banner error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/cms/banners/:id
// @desc    Delete banner
// @access  Private
router.delete('/banners/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ message: 'Banner not found' });
    }

    await banner.deleteOne();
    res.json({ message: 'Banner deleted successfully' });
  } catch (error) {
    console.error('Delete banner error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== CATEGORIES ====================

// @route   GET /api/cms/categories
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

// @route   POST /api/cms/categories
// @desc    Create category
// @access  Private (Super Admin)
router.post('/categories', auth, authorize('super_admin'), [
  body('name').trim().notEmpty().withMessage('Category name is required')
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

// @route   PUT /api/cms/categories/:id
// @desc    Update category
// @access  Private
router.put('/categories/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
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

// @route   DELETE /api/cms/categories/:id
// @desc    Delete category
// @access  Private
router.delete('/categories/:id', auth, authorize('super_admin'), async (req, res) => {
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

// ==================== AMENITIES ====================

// @route   GET /api/cms/amenities
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

// @route   POST /api/cms/amenities
// @desc    Create amenity
// @access  Private (Super Admin)
router.post('/amenities', auth, authorize('super_admin'), [
  body('name').trim().notEmpty().withMessage('Amenity name is required'),
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

// @route   PUT /api/cms/amenities/:id
// @desc    Update amenity
// @access  Private
router.put('/amenities/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
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

// @route   DELETE /api/cms/amenities/:id
// @desc    Delete amenity
// @access  Private
router.delete('/amenities/:id', auth, authorize('super_admin'), async (req, res) => {
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

// ==================== TESTIMONIALS ====================

// @route   GET /api/cms/testimonials
// @desc    Get all testimonials
// @access  Public (with optional auth for admin access)
router.get('/testimonials', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    // Only show active testimonials to non-admin users
    // Admins can see all testimonials including inactive ones
    if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'agency_admin')) {
      filter.isActive = true;
    }
    if (req.query.featured === 'true') {
      filter.isFeatured = true;
    }
    const limit = parseInt(req.query.limit) || (req.user && (req.user.role === 'super_admin' || req.user.role === 'agency_admin') ? 100 : 10);
    const testimonials = await Testimonial.find(filter)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .sort('-order -createdAt')
      .limit(limit);
    res.json({ testimonials });
  } catch (error) {
    console.error('Get testimonials error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/cms/testimonials
// @desc    Create testimonial
// @access  Private (Super Admin, Agency Admin)
router.post('/testimonials', auth, authorize('super_admin', 'agency_admin'), [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('role').trim().notEmpty().withMessage('Role is required'),
  body('content').trim().notEmpty().withMessage('Content is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const testimonial = new Testimonial(req.body);
    await testimonial.save();
    res.status(201).json({ testimonial });
  } catch (error) {
    console.error('Create testimonial error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/cms/testimonials/:id
// @desc    Update testimonial
// @access  Private
router.put('/testimonials/:id', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ message: 'Testimonial not found' });
    }

    Object.assign(testimonial, req.body);
    await testimonial.save();
    res.json({ testimonial });
  } catch (error) {
    console.error('Update testimonial error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/cms/testimonials/:id
// @desc    Delete testimonial
// @access  Private
router.delete('/testimonials/:id', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ message: 'Testimonial not found' });
    }

    await testimonial.deleteOne();
    res.json({ message: 'Testimonial deleted successfully' });
  } catch (error) {
    console.error('Delete testimonial error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== CONTACT MESSAGES ====================

// @route   GET /api/cms/contact-messages
// @desc    Get all contact messages
// @access  Private (Super Admin, Agency Admin)
router.get('/contact-messages', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const filter = {};
    
    // Agency admin can only see messages for their agency
    if (req.user.role === 'agency_admin') {
      if (!req.user.agency) {
        return res.status(403).json({ message: 'Agency not assigned to your account' });
      }
      filter.agency = req.user.agency;
    }
    
    const messages = await ContactMessage.find(filter)
      .populate('agency', 'name logo')
      .sort('-createdAt');
    
    res.json({ messages });
  } catch (error) {
    console.error('Get contact messages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/cms/contact-messages
// @desc    Create contact message (public endpoint for contact form)
// @access  Public
router.post('/contact-messages', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('message').trim().notEmpty().withMessage('Message is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Assign message to first active agency (similar to leads)
    let agencyId = req.body.agency;
    if (!agencyId) {
      const defaultAgency = await Agency.findOne({ isActive: true }).sort({ createdAt: 1 });
      if (!defaultAgency) {
        return res.status(400).json({ 
          message: 'No active agency found. Please contact the administrator.',
          code: 'NO_AGENCY_AVAILABLE'
        });
      }
      agencyId = defaultAgency._id;
    }

    const contactMessage = new ContactMessage({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone || '',
      subject: req.body.subject || '',
      message: req.body.message,
      agency: agencyId
    });

    await contactMessage.save();
    
    const populatedMessage = await ContactMessage.findById(contactMessage._id)
      .populate('agency', 'name logo');
    
    res.status(201).json({ 
      message: 'Contact message submitted successfully',
      contactMessage: populatedMessage
    });
  } catch (error) {
    console.error('Create contact message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/cms/contact-messages/:id
// @desc    Delete contact message
// @access  Private (Super Admin, Agency Admin)
router.delete('/contact-messages/:id', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const contactMessage = await ContactMessage.findById(req.params.id);
    if (!contactMessage) {
      return res.status(404).json({ message: 'Contact message not found' });
    }

    // Agency admin can only delete messages from their agency
    if (req.user.role === 'agency_admin') {
      const messageAgencyId = contactMessage.agency.toString();
      const userAgencyId = req.user.agency.toString();
      if (messageAgencyId !== userAgencyId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    await contactMessage.deleteOne();
    res.json({ message: 'Contact message deleted successfully' });
  } catch (error) {
    console.error('Delete contact message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/cms/contact-messages/:id/read
// @desc    Mark contact message as read
// @access  Private (Super Admin, Agency Admin)
router.put('/contact-messages/:id/read', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const contactMessage = await ContactMessage.findById(req.params.id);
    if (!contactMessage) {
      return res.status(404).json({ message: 'Contact message not found' });
    }

    // Agency admin can only mark messages from their agency as read
    if (req.user.role === 'agency_admin') {
      const messageAgencyId = contactMessage.agency.toString();
      const userAgencyId = req.user.agency.toString();
      if (messageAgencyId !== userAgencyId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    contactMessage.isRead = true;
    await contactMessage.save();
    res.json({ contactMessage });
  } catch (error) {
    console.error('Mark message as read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== FOOTER ====================

// @route   GET /api/cms/footer
// @desc    Get footer data
// @access  Public
router.get('/footer', async (req, res) => {
  try {
    // Footer is a singleton - get the first one or create default
    let footer = await Footer.findOne();
    if (!footer) {
      // Create default footer
      footer = new Footer({
        companyName: 'NOVA KEYS',
        companyTagline: 'Real Estate',
        description: 'Your trusted partner in finding the perfect property.',
        copyright: '2026 NOVAKEYS RealEstate. All Rights Reserved. Design and Developed with ♥ Spireleap Innovations',
        additionalContent: ''
      });
      await footer.save();
    }
    res.json({ footer });
  } catch (error) {
    console.error('Get footer error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/cms/footer
// @desc    Create footer data
// @access  Private (Super Admin only)
router.post('/footer', auth, authorize('super_admin'), async (req, res) => {
  try {
    // Check if footer already exists
    const existingFooter = await Footer.findOne();
    if (existingFooter) {
      return res.status(400).json({ message: 'Footer already exists. Use PUT to update.' });
    }

    const footer = new Footer(req.body);
    await footer.save();
    res.status(201).json({ footer });
  } catch (error) {
    console.error('Create footer error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/cms/footer/:id
// @desc    Update footer data
// @access  Private (Super Admin only)
router.put('/footer/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
    const footer = await Footer.findById(req.params.id);
    if (!footer) {
      return res.status(404).json({ message: 'Footer not found' });
    }

    Object.assign(footer, req.body);
    await footer.save();
    res.json({ footer });
  } catch (error) {
    console.error('Update footer error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

