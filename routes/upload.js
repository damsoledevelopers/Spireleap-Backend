const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { auth, authorize, checkModulePermission } = require('../middleware/auth');
const cloudinaryService = require('../services/cloudinaryService');
const { uploadSingle, uploadMultiple, uploadFields, deleteFile, getFileUrl, uploadDirs } = require('../middleware/upload');
const Lead = require('../models/Lead');
const User = require('../models/User');
const encryptionService = require('../services/encryptionService');
const emailService = require('../services/emailService');

const router = express.Router();

// Generic upload endpoint for different folders
// Supports query parameter: ?folder=agencies or body field: folder=agencies
router.post('/', auth, (req, res) => {
  // Get folder from query parameter (available before multer processes)
  const folderFromQuery = req.query.folder;
  
  // Configure storage with dynamic folder support
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      // Use query parameter if available, otherwise default to 'agencies' (most common use case)
      const folder = folderFromQuery || 'agencies';
      const uploadPath = `uploads/${folder}`;
      
      // Create folder if it doesn't exist
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  };

  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    }
  });

  // Use any() to handle file and folder field together
  upload.any()(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File too large. Maximum size is 10MB.' });
      }
      return res.status(400).json({ message: err.message });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    // Find the file (not the folder field)
    const file = req.files?.find(f => f.fieldname === 'file');
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Get folder from query or body (multer.any() parses all fields)
    const folder = folderFromQuery || req.body?.folder || 'agencies';

    const fileUrl = getFileUrl(req, file.path);
    
    res.json({
      message: 'File uploaded successfully',
      url: fileUrl,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size
    });
  });
});

// @route   POST /api/upload/property-image
// @desc    Upload property image
// @access  Private (Agency Admin, Agent)
router.post('/property-image', [
  auth,
  checkModulePermission('properties', 'edit'),
  uploadSingle('image')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileUrl = getFileUrl(req, req.file.path);
    
    res.json({
      message: 'Image uploaded successfully',
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        url: fileUrl,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Upload property image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/upload/property-images
// @desc    Upload multiple property images
// @access  Private (Agency Admin, Agent)
router.post('/property-images', [
  auth,
  checkModulePermission('properties', 'edit'),
  uploadMultiple('images', 10)
], async (req, res) => {
  try {
    console.log('Property images upload request received');
    console.log('Files:', req.files ? req.files.length : 0);
    
    if (!req.files || req.files.length === 0) {
      console.error('No files in request');
      return res.status(400).json({ message: 'No files uploaded. Please select at least one image.' });
    }

    const files = req.files.map(file => {
      const fileUrl = getFileUrl(req, file.path);
      console.log(`File uploaded: ${file.originalname} -> ${fileUrl}`);
      return {
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        url: fileUrl,
        size: file.size,
        mimetype: file.mimetype
      };
    });
    
    console.log(`Successfully processed ${files.length} file(s)`);
    
    res.json({
      message: 'Images uploaded successfully',
      files
    });
  } catch (error) {
    console.error('Upload property images error:', error);
    res.status(500).json({ 
      message: error.message || 'Server error during upload',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB — profile avatars
const ALLOWED_PROFILE_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const memoryProfileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_IMAGE_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_PROFILE_IMAGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'), false);
    }
  }
});

// @route   POST /api/upload/cloudinary/profile-image
// @desc    Upload super-admin profile image to Cloudinary (secrets stay on server)
// @access  Private — super_admin only
router.post('/cloudinary/profile-image', [auth, authorize('super_admin')], (req, res) => {
  memoryProfileImageUpload.single('image')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          message: `File too large. Maximum size is ${PROFILE_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`
        });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    if (!cloudinaryService.isConfigured()) {
      return res.status(503).json({
        message:
          'Cloudinary is not configured on the server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
      });
    }

    try {
      const dbUser = await User.findById(req.user.id).select('profileImage').lean();
      const previousUrl = dbUser?.profileImage || '';

      const { secure_url, public_id, width, height } = await cloudinaryService.uploadUserProfileAvatar(
        req.user.id,
        req.file.buffer,
        req.file.mimetype,
        previousUrl
      );

      return res.json({
        message: 'Profile image uploaded successfully',
        secure_url,
        public_id,
        storage_prefix: cloudinaryService.getProfileStoragePrefix(),
        file: {
          url: secure_url,
          public_id,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          width,
          height
        }
      });
    } catch (uploadErr) {
      console.error('Cloudinary profile upload error:', uploadErr);
      const { status, message } = cloudinaryService.formatUploadError(uploadErr);
      return res.status(status).json({
        message,
        ...(process.env.NODE_ENV === 'development' && {
          detail: uploadErr?.message,
          http_code: uploadErr?.http_code
        })
      });
    }
  });
});

// @route   DELETE /api/upload/cloudinary/profile-image
// @desc    Remove super-admin profile image from Cloudinary and clear DB field
// @access  Private — super_admin only
router.delete('/cloudinary/profile-image', [auth, authorize('super_admin')], async (req, res) => {
  try {
    if (!cloudinaryService.isConfigured()) {
      return res.status(503).json({
        message:
          'Cloudinary is not configured on the server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
      });
    }

    const dbUser = await User.findById(req.user.id).select('profileImage').lean();
    const previousUrl = dbUser?.profileImage || '';

    await cloudinaryService.removeUserProfileAvatar(req.user.id, previousUrl);

    await User.findByIdAndUpdate(req.user.id, { $set: { profileImage: '' } }, { runValidators: false });

    return res.json({
      message: 'Profile image removed',
      storage_prefix: cloudinaryService.getProfileStoragePrefix(),
      profileImage: ''
    });
  } catch (err) {
    console.error('Cloudinary profile delete error:', err);
    return res.status(500).json({ message: err.message || 'Failed to remove profile image' });
  }
});

// @route   POST /api/upload/profile-image
// @desc    Upload profile image
// @access  Private
router.post('/profile-image', [
  auth,
  uploadSingle('image')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileUrl = getFileUrl(req, req.file.path);
    
    res.json({
      message: 'Profile image uploaded successfully',
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        url: fileUrl,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/upload/:filename
// @desc    Delete uploaded file
// @access  Private
router.delete('/:filename', auth, async (req, res) => {
  try {
    const { filename } = req.params;
    const { type } = req.query; // 'property', 'profile', 'cms', 'lead'
    
    let filePath;
    switch (type) {
      case 'property':
        filePath = path.join('uploads/properties', filename);
        break;
      case 'profile':
        filePath = path.join('uploads/profiles', filename);
        break;
      case 'cms':
        filePath = path.join('uploads/cms', filename);
        break;
      case 'lead':
        filePath = path.join('uploads/leads/documents', filename);
        break;
      default:
        return res.status(400).json({ message: 'Invalid file type' });
    }

    const deleted = deleteFile(filePath);
    
    if (deleted) {
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ message: 'File not found' });
    }
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/upload/property-documents
// @desc    Upload property documents (PDF, DOC, DOCX, images)
// @access  Private (Agency Admin, Agent)
router.post('/property-documents', [
  auth,
  checkModulePermission('properties', 'edit')
], (req, res) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = 'uploads/properties/documents';
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and images are allowed'), false);
    }
  };

  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    }
  });

  upload.array('documents', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File too large. Maximum size is 10MB.' });
      }
      return res.status(400).json({ message: err.message });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const files = req.files.map(file => {
      const fileUrl = getFileUrl(req, file.path);
      const fileType = file.mimetype.includes('pdf') ? 'pdf' :
                      file.mimetype.includes('word') ? 'docx' :
                      file.mimetype.includes('msword') ? 'doc' : 'image';
      
      return {
        name: file.originalname,
        url: fileUrl,
        type: fileType,
        size: file.size,
        filename: file.filename
      };
    });

    res.json({
      message: 'Documents uploaded successfully',
      documents: files
    });
  });
});

// @route   POST /api/upload/lead-documents
// @desc    Upload lead documents (PDF, DOC, DOCX, images)
// @access  Private (Super Admin, Agency Admin, Agent)
router.post('/lead-documents', [
  auth,
  checkModulePermission('leads', 'edit')
], (req, res) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = 'uploads/leads/documents';
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and images are allowed'), false);
    }
  };

  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    }
  });

  upload.array('documents', 10)(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File too large. Maximum size is 10MB.' });
      }
      return res.status(400).json({ message: err.message });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const files = req.files.map(file => {
      const fileUrl = getFileUrl(req, file.path);
      const fileType = file.mimetype.includes('pdf') ? 'pdf' :
                      file.mimetype.includes('word') ? 'docx' :
                      file.mimetype.includes('msword') ? 'doc' : 'image';
      
      return {
        name: file.originalname,
        url: fileUrl,
        type: fileType,
        size: file.size,
        filename: file.filename
      };
    });

    // If leadId provided, send uploaded documents to customer email
    const leadId = req.body?.leadId;
    if (leadId && files.length > 0) {
      try {
        const lead = await Lead.findById(leadId)
          .populate('property', 'title')
          .populate('agency', 'name')
          .lean();
        if (lead) {
          const decryptedContact = encryptionService.decryptLeadContact(lead.contact);
          const leadForEmail = { ...lead, contact: decryptedContact };
          const filePaths = req.files.map(f => f.path);
          await emailService.sendDocumentUploadedToCustomer(leadForEmail, files, filePaths);
        }
      } catch (emailErr) {
        console.error('Failed to send document email to customer:', emailErr);
        // Do not fail the upload response; documents are already saved
      }
    }

    res.json({
      message: 'Documents uploaded successfully',
      documents: files
    });
  });
});

// @route   GET /api/upload/files/:filename
// @desc    Serve uploaded files
// @access  Private
router.get('/files/:filename', auth, async (req, res) => {
  try {
    const { filename } = req.params;
    const { type } = req.query; // 'property', 'profile', 'cms', 'lead'
    
    let filePath;
    switch (type) {
      case 'property':
        filePath = path.join('uploads/properties', filename);
        break;
      case 'profile':
        filePath = path.join('uploads/profiles', filename);
        break;
      case 'cms':
        filePath = path.join('uploads/cms', filename);
        break;
      case 'lead':
        filePath = path.join('uploads/leads/documents', filename);
        break;
      default:
        return res.status(400).json({ message: 'Invalid file type' });
    }

    if (fs.existsSync(filePath)) {
      res.sendFile(path.resolve(filePath));
    } else {
      res.status(404).json({ message: 'File not found' });
    }
  } catch (error) {
    console.error('Serve file error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

