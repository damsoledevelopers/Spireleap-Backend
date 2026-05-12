/**
 * Optional postal / ZIP / PIN: empty ok; if present, digits only after stripping non-digits, length 1–9.
 */
function isPostalDigitsOrEmpty(value) {
  if (value === null || value === undefined) return true
  const digits = String(value).trim().replace(/\D/g, '')
  if (!digits) return true
  return digits.length >= 1 && digits.length <= 9
}

const POSTAL_DIGITS_VALIDATION_MESSAGE =
  'You can enter up to 9 digits for your ZIP or postal code.'

module.exports = {
  isPostalDigitsOrEmpty,
  POSTAL_DIGITS_VALIDATION_MESSAGE
}
