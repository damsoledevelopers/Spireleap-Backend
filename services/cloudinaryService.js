const cloudinary = require('cloudinary').v2;

/** Trim .env values (spaces, CR, BOM, accidental quotes). */
function trimEnv(value) {
  if (value == null) return '';
  let s = String(value).trim();
  s = s.replace(/^\uFEFF/, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function getCloudinaryEnv() {
  return {
    cloud_name: trimEnv(process.env.CLOUDINARY_CLOUD_NAME),
    api_key: trimEnv(process.env.CLOUDINARY_API_KEY),
    api_secret: trimEnv(process.env.CLOUDINARY_API_SECRET)
  };
}

function isConfigured() {
  const { cloud_name, api_key, api_secret } = getCloudinaryEnv();
  return Boolean(cloud_name && api_key && api_secret);
}

function configure() {
  const { cloud_name, api_key, api_secret } = getCloudinaryEnv();
  if (!cloud_name || !api_key || !api_secret) {
    return false;
  }
  cloudinary.config({
    cloud_name,
    api_key,
    api_secret
  });
  return true;
}

/**
 * Media Library path prefix: `<project>/<profile>/…` (no leading/trailing slashes).
 * - Prefer `CLOUDINARY_PROJECT_FOLDER` + `CLOUDINARY_PROFILE_SUBFOLDER` (e.g. spireleap + profile).
 * - Else if `CLOUDINARY_PROFILE_FOLDER` is set alone, use that full path (legacy).
 * - Else default `spireleap/profile`.
 */
function getProfileStoragePrefix() {
  const projectPart = trimEnv(process.env.CLOUDINARY_PROJECT_FOLDER);
  const subPart = trimEnv(process.env.CLOUDINARY_PROFILE_SUBFOLDER);
  if (projectPart || subPart) {
    const p = projectPart || 'spireleap';
    const s = subPart || 'profile';
    return `${p.replace(/\/$/, '')}/${s.replace(/^\/+|\/+$/g, '')}`;
  }
  const legacy = trimEnv(process.env.CLOUDINARY_PROFILE_FOLDER);
  if (legacy) return legacy.replace(/^\/+|\/+$/g, '');
  return 'spireleap/profile';
}

/** Stable Cloudinary public_id: `<prefix>/user_<mongoUserId>` (one file per user). */
function profileAvatarPublicId(userId) {
  const base = getProfileStoragePrefix();
  return `${base}/user_${String(userId)}`;
}

/**
 * Parse delivery URL (res.cloudinary.com/.../image/upload/...) → API public_id (no extension).
 * Returns null if not a recognized Cloudinary image URL.
 */
function publicIdFromDeliveryUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed.includes('cloudinary.com')) return null;
  try {
    const pathname = new URL(trimmed).pathname;
    const marker = '/image/upload/';
    const i = pathname.indexOf(marker);
    if (i === -1) return null;
    let segments = pathname.slice(i + marker.length).split('/').filter(Boolean);
    while (segments.length && /^v\d+$/i.test(segments[0])) {
      segments.shift();
    }
    while (segments.length && segments[0].includes(',') && !segments[0].includes('.')) {
      segments.shift();
    }
    if (!segments.length) return null;
    const last = segments[segments.length - 1];
    if (!last.includes('.')) return null;
    const withoutExt = last.replace(/\.[^.]+$/, '');
    const prefix = segments.slice(0, -1);
    return prefix.length ? `${prefix.join('/')}/${withoutExt}` : withoutExt;
  } catch {
    return null;
  }
}

/**
 * Remove an asset by public_id (ignores "not found" style failures).
 */
async function destroyImageByPublicId(publicId) {
  if (!publicId || !configure()) return;
  const creds = getCloudinaryEnv();
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
      ...creds
    });
  } catch (err) {
    console.warn('Cloudinary destroy (non-fatal):', err?.message || err);
  }
}

/**
 * Delete profile avatar(s) from Cloudinary for this user (deterministic id + URL-derived id if different).
 */
async function removeUserProfileAvatar(userId, currentProfileImageUrl) {
  const deterministic = profileAvatarPublicId(userId);
  const fromUrl = publicIdFromDeliveryUrl(currentProfileImageUrl);
  const ids = new Set([deterministic]);
  if (fromUrl) ids.add(fromUrl);
  for (const id of ids) {
    await destroyImageByPublicId(id);
  }
}

/**
 * Upload image buffer. If options.public_id is set, that asset is overwritten (no random filenames).
 * @param {Buffer} buffer
 * @param {string} [mimetype]
 * @param {object} [options] optional: public_id, overwrite, invalidate, folder (when no public_id)
 */
function uploadImageBuffer(buffer, mimetype = 'image/jpeg', options = {}) {
  if (!configure()) {
    return Promise.reject(new Error('Cloudinary is not configured'));
  }

  const defaultFolder = getProfileStoragePrefix();
  const folder = trimEnv(options.folder) || defaultFolder;
  const safeMime =
    /^image\/(jpeg|jpg|png|gif|webp)$/i.test(String(mimetype || '').trim()) ? mimetype.trim() : 'image/jpeg';
  const dataUri = `data:${safeMime};base64,${buffer.toString('base64')}`;
  const { cloud_name, api_key, api_secret } = getCloudinaryEnv();

  const uploadOptions = {
    resource_type: 'image',
    cloud_name,
    api_key,
    api_secret
  };

  if (options.public_id) {
    uploadOptions.public_id = options.public_id;
    uploadOptions.overwrite = options.overwrite !== false;
    uploadOptions.invalidate = options.invalidate !== false;
  } else {
    uploadOptions.folder = folder;
    uploadOptions.use_filename = true;
    uploadOptions.unique_filename = true;
  }

  return cloudinary.uploader.upload(dataUri, uploadOptions).then((result) => {
    if (!result?.secure_url || !result?.public_id) {
      throw new Error('Unexpected Cloudinary response');
    }
    return {
      secure_url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height
    };
  });
}

/**
 * Upload profile avatar to a fixed public_id per user, then delete previous Cloudinary file if it used another id.
 */
async function uploadUserProfileAvatar(userId, buffer, mimetype, previousProfileImageUrl) {
  const newPublicId = profileAvatarPublicId(userId);
  const oldPublicId = publicIdFromDeliveryUrl(previousProfileImageUrl);

  const uploaded = await uploadImageBuffer(buffer, mimetype, {
    public_id: newPublicId,
    overwrite: true,
    invalidate: true
  });

  if (oldPublicId && oldPublicId !== uploaded.public_id) {
    await destroyImageByPublicId(oldPublicId);
  }

  return uploaded;
}

/** Map Cloudinary / config errors to a safe client message (no secrets). */
function formatUploadError(err) {
  const msg = err?.message || String(err);
  const http = err?.http_code;
  if (/Invalid cloud_name|cloud_name/i.test(msg) || http === 401) {
    return {
      status: 502,
      message:
        'Cloudinary rejected the request. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in the server .env (Dashboard → Product environment credentials; cloud name must match your account, with no extra spaces).'
    };
  }
  if (/Invalid api_key|api_secret|401/i.test(msg)) {
    return {
      status: 502,
      message:
        'Cloudinary API credentials look invalid. Verify CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the server .env file.'
    };
  }
  return {
    status: 500,
    message: msg || 'Failed to upload image to Cloudinary'
  };
}

module.exports = {
  isConfigured,
  configure,
  getProfileStoragePrefix,
  uploadImageBuffer,
  uploadUserProfileAvatar,
  removeUserProfileAvatar,
  profileAvatarPublicId,
  publicIdFromDeliveryUrl,
  destroyImageByPublicId,
  formatUploadError
};
