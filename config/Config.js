// config/Config.js
module.exports = {
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // WhatsApp Cloud API
  API_URL: process.env.API_URL,
  API_VERSION: process.env.API_VERSION,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  ACCESS_TOKEN: process.env.ACCESS_TOKEN,

  // Controle interno de filas/eventos (se já tiver no seu projeto, mantenha)
  EVENT_QUEUE_MESSAGE_TO_WHATSAPP: 'QUEUE_MESSAGE_TO_WHATSAPP',
  EVENT_WHATSAPP_MESSAGE_DELIVERED: 'WHATSAPP_MESSAGE_DELIVERED',
  EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE: 'PROCESS_NEXT_WHATSAPP_MESSAGE',
  ENDPOINT_API: 'messages',

  // S3
  AWS_REGION: process.env.AWS_REGION,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_SIGNED_URL_EXPIRATION: parseInt(process.env.AWS_SIGNED_URL_EXPIRATION || '3600', 10),

  // feature flag para upload de mídia vindo do WhatsApp
  WHATSAPP_UPLOAD_MEDIA: (process.env.WHATSAPP_UPLOAD_MEDIA || 'true').toLowerCase() === 'true',
};
