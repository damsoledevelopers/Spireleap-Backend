const mongoose = require('mongoose');

const rolePermissionSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['agency_admin', 'agent', 'staff', 'user'],
        required: true,
        unique: true
    },
    permissions: {
        leads: {
            view: { type: Boolean, default: true },
            create: { type: Boolean, default: true },
            edit: { type: Boolean, default: true },
            delete: { type: Boolean, default: false }
        },
        properties: {
            view: { type: Boolean, default: true },
            create: { type: Boolean, default: true },
            edit: { type: Boolean, default: true },
            delete: { type: Boolean, default: false }
        },
        inquiries: {
            view: { type: Boolean, default: true },
            create: { type: Boolean, default: true },
            edit: { type: Boolean, default: true },
            delete: { type: Boolean, default: false }
        },
        contact_messages: {
            view: { type: Boolean, default: true },
            create: { type: Boolean, default: false },
            edit: { type: Boolean, default: true },
            delete: { type: Boolean, default: false }
        }
    },
    lastUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
