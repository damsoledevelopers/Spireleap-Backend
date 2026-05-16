const mongoose = require('mongoose');
const { isPostalDigitsOrEmpty, POSTAL_DIGITS_VALIDATION_MESSAGE } = require('../utils/postalCode');

const ALPHA_TEXT_REGEX = /^[A-Za-z\s.'-]+$/;

const isAlphaTextOrEmpty = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  return ALPHA_TEXT_REGEX.test(s);
};

const propertySchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    default: ''
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  propertyType: {
    type: String,
    enum: ['apartment', 'house', 'villa', 'condo', 'townhouse', 'land', 'commercial', 'office', 'retail', 'warehouse', 'off_plan', 'ready_to_move', 'under_construction', 'other'],
    required: [true, 'Property type is required']
  },
  listingType: {
    type: String,
    enum: ['sale', 'rent', 'both'],
    required: [true, 'Listing type is required']
  },
  price: {
    sale: {
      type: Number,
      min: 0
    },
    rent: {
      amount: {
        type: Number,
        min: 0
      },
      period: {
        type: String,
        enum: ['monthly', 'yearly', 'weekly', 'daily']
      }
    },
    currency: {
      type: String,
      default: 'USD'
    }
  },
  location: {
    address: {
      type: String,
      trim: true,
      default: ''
    },
    city: {
      type: String,
      trim: true,
      default: '',
      validate: { validator: isAlphaTextOrEmpty, message: 'City must contain only alphabets' }
    },
    state: {
      type: String,
      trim: true,
      default: '',
      validate: { validator: isAlphaTextOrEmpty, message: 'State must contain only alphabets' }
    },
    country: {
      type: String,
      trim: true,
      default: '',
      validate: { validator: isAlphaTextOrEmpty, message: 'Country must contain only alphabets' }
    },
    zipCode: {
      type: String,
      trim: true,
      validate: { validator: isPostalDigitsOrEmpty, message: POSTAL_DIGITS_VALIDATION_MESSAGE }
    },
    coordinates: {
      lat: {
        type: Number
      },
      lng: {
        type: Number
      }
    },
    neighborhood: String,
    landmark: String
  },
  specifications: {
    bedrooms: {
      type: Number,
      min: 0
    },
    bathrooms: {
      type: Number,
      min: 0
    },
    balconies: {
      type: Number,
      min: 0,
      default: 0
    },
    livingRoom: {
      type: Number,
      min: 0,
      default: 0
    },
    isStudio: {
      type: Boolean,
      default: false
    },
    unfurnished: {
      type: Number,
      min: 0,
      default: 0
    },
    semiFurnished: {
      type: Number,
      min: 0,
      default: 0
    },
    fullyFurnished: {
      type: Number,
      min: 0,
      default: 0
    },
    area: {
      value: {
        type: Number,
        min: 0
      },
      unit: {
        type: String,
        enum: ['sqft', 'sqm', 'acre'],
        default: 'sqft'
      }
    },
    parking: {
      type: Number,
      min: 0,
      default: 0
    },
    floors: {
      type: Number,
      min: 0,
      default: 1
    },
    yearBuilt: Number,
    lotSize: {
      value: Number,
      unit: {
        type: String,
        enum: ['sqft', 'sqm', 'acre']
      }
    }
  },
  amenities: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Amenity'
  }],
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: String,
    isPrimary: {
      type: Boolean,
      default: false
    },
    order: {
      type: Number,
      default: 0
    }
  }],
  videos: [{
    url: String,
    type: {
      type: String,
      enum: ['youtube', 'vimeo', 'direct'],
      default: 'youtube'
    },
    thumbnail: String
  }],
  virtualTour: {
    url: String,
    type: {
      type: String,
      enum: ['3d', 'video', '360']
    }
  },
  agency: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agency',
    default: null
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  regulatoryInformation: {
    reference: { type: String, trim: true },
    listedAt: { type: Date },
    brokerLicense: { type: String, trim: true },
    agencyName: { type: String, trim: true },
    zoneName: { type: String, trim: true },
    agentLicense: { type: String, trim: true },
    dldPermitNumber: { type: String, trim: true },
    // QR image can be a hosted URL or a data URL (base64) sent from frontend.
    // Prefer URL for size/performance.
    qrImage: { type: String, trim: true },
    // Optional: the QR payload/value (e.g., a listing URL) if you want to regenerate QR later.
    qrValue: { type: String, trim: true }
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'active', 'booked', 'sold', 'rented', 'inactive', 'unavailable'],
    default: 'pending'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  creatorRole: {
    type: String,
    enum: ['super_admin', 'agency_admin', 'agent']
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  featured: {
    type: Boolean,
    default: false
  },
  trending: {
    type: Boolean,
    default: false
  },
  viewCount: {
    type: Number,
    default: 0
  },
  inquiryCount: {
    type: Number,
    default: 0
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  tags: [String],
  seo: {
    metaTitle: String,
    metaDescription: String,
    keywords: [String]
  },
  documents: [{
    name: String,
    url: String,
    type: {
      type: String,
      enum: ['pdf', 'doc', 'docx', 'image']
    }
  }],
  notes: [{
    note: {
      type: String,
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  entryPermissions: {
    agency_admin: {
      view: { type: Boolean, default: true },
      edit: { type: Boolean, default: true },
      delete: { type: Boolean, default: false }
    },
    agent: {
      view: { type: Boolean, default: true },
      edit: { type: Boolean, default: true },
      delete: { type: Boolean, default: false }
    },
    staff: {
      view: { type: Boolean, default: true },
      edit: { type: Boolean, default: true },
      delete: { type: Boolean, default: false }
    }
  }
}, {
  timestamps: true
});

// Title default and unique slug before saving
propertySchema.pre('save', function (next) {
  if (!this.title || !String(this.title).trim()) {
    this.title = 'Property listing';
  }
  if (!this.slug) {
    const base = String(this.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'property';
    const idPart = this._id ? String(this._id).slice(-8) : Math.random().toString(36).slice(2, 10);
    this.slug = `${base}-${idPart}`;
  }
  next();
});

// Indexes for search and filtering
propertySchema.index({ title: 'text', description: 'text', tags: 'text' });
propertySchema.index({ 'location.city': 1, 'location.state': 1, 'location.country': 1 });
propertySchema.index({ propertyType: 1, listingType: 1, status: 1 });
propertySchema.index({ 'location.coordinates': '2dsphere' });
propertySchema.index({ featured: 1, trending: 1, status: 1 });
propertySchema.index({ agency: 1, agent: 1 });
propertySchema.index({ agency: 1, createdAt: -1 }); // For agency-based date filtering
propertySchema.index({ status: 1, createdAt: -1 }); // For status-based date filtering
propertySchema.index({ propertyType: 1, createdAt: -1 }); // For type-based reports

module.exports = mongoose.model('Property', propertySchema);

