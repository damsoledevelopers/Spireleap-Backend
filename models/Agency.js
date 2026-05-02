const mongoose = require('mongoose');

const NAME_REGEX = /^[A-Za-z\s.'-]+$/;
const ALPHA_TEXT_REGEX = /^[A-Za-z\s.'-]+$/;
const ZIP_REGEX = /^(\d{5}|\d{9})$/;

const isAlphaTextOrEmpty = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  return ALPHA_TEXT_REGEX.test(s);
};

const isZipOrEmpty = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  return ZIP_REGEX.test(s);
};

const agencySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Agency name is required'],
    trim: true,
    match: [NAME_REGEX, 'Agency name must contain only alphabets']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  logo: {
    type: String
  },
  coverImage: {
    type: String
  },
  contact: {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true
    },
    website: String,
    address: {
      street: String,
      city: {
        type: String,
        trim: true,
        validate: { validator: isAlphaTextOrEmpty, message: 'City must contain only alphabets' }
      },
      state: {
        type: String,
        trim: true,
        validate: { validator: isAlphaTextOrEmpty, message: 'State must contain only alphabets' }
      },
      country: {
        type: String,
        trim: true,
        validate: { validator: isAlphaTextOrEmpty, message: 'Country must contain only alphabets' }
      },
      zipCode: {
        type: String,
        trim: true,
        validate: { validator: isZipOrEmpty, message: 'Zip code must be 5 digits or 9 digits (ZIP+4)' }
      }
    }
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  settings: {
    currency: {
      type: String,
      default: 'USD'
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    emailNotifications: {
      type: Boolean,
      default: true
    },
    smsNotifications: {
      type: Boolean,
      default: false
    }
  },
  stats: {
    totalProperties: {
      type: Number,
      default: 0
    },
    activeProperties: {
      type: Number,
      default: 0
    },
    soldProperties: {
      type: Number,
      default: 0
    },
    rentedProperties: {
      type: Number,
      default: 0
    },
    totalLeads: {
      type: Number,
      default: 0
    },
    activeLeads: {
      type: Number,
      default: 0
    },
    totalAgents: {
      type: Number,
      default: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Generate slug before saving
agencySchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

module.exports = mongoose.model('Agency', agencySchema);

