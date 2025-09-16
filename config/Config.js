// ODA Details
exports.ODA_WEBHOOK_URL = process.env.ODA_WEBHOOK_URL || '';
exports.ODA_WEBHOOK_SECRET = process.env.ODA_WEBHOOK_SECRET || '';

// WhatsApp Details
exports.API_URL = 'https://graph.facebook.com';
exports.ENDPOINT_API = 'messages';
exports.VERIFY_TOKEN = process.env.VERIFY_TOKEN || '';
exports.ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
exports.API_VERSION = process.env.VERSION || 'v16.0';
exports.PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
exports.LIST_TITLE_DEFAULT_LABEL = 'Select one';

// General Detail
exports.port = process.env.port || 3000;
exports.FILES_URL = process.env.FILES_URL;
exports.LOG_LEVEL = 'info';

// WhatsApp Sender event IDs
exports.EVENT_QUEUE_MESSAGE_TO_WHATSAPP = "100";
exports.EVENT_WHATSAPP_MESSAGE_DELIVERED = "1000";
exports.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE = "2000";

exports.GCP_BUCKET_NAME = process.env.GCP_BUCKET_NAME;
// exports.GOOGLE_CLOUD_CREDENTIALS = process.env.GOOGLE_CLOUD_CREDENTIALS;

