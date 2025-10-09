// config/Config.js
//
// Centraliza variáveis de ambiente e aplica pequenos saneamentos (trim/defaults).

module.exports = {
  // Log
  LOG_LEVEL: (process.env.LOG_LEVEL || 'info').trim(),

  // WhatsApp Cloud API
  API_URL: (process.env.API_URL || '').trim(),
  API_VERSION: (process.env.API_VERSION || 'v20.0').trim(), // ajuste se usar outra versão
  PHONE_NUMBER_ID: (process.env.PHONE_NUMBER_ID || '').trim(),
  ACCESS_TOKEN: (process.env.ACCESS_TOKEN || '').trim(),

  // Token de verificação do webhook Meta (GET /user/message)
  VERIFY_TOKEN: (process.env.VERIFY_TOKEN || '').trim(),

  // ODA Webhook (obrigatórios)
  ODA_WEBHOOK_URL: (process.env.ODA_WEBHOOK_URL || '').trim(),
  ODA_WEBHOOK_SECRET: (process.env.ODA_WEBHOOK_SECRET || '').trim(),

  // Porta (Render usa PORT)
  PORT: process.env.PORT || 10000,

  // Eventos internos (fila de envio ao WhatsApp)
  EVENT_QUEUE_MESSAGE_TO_WHATSAPP: 'QUEUE_MESSAGE_TO_WHATSAPP',
  EVENT_WHATSAPP_MESSAGE_DELIVERED: 'WHATSAPP_MESSAGE_DELIVERED',
  EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE: 'PROCESS_NEXT_WHATSAPP_MESSAGE',
  ENDPOINT_API: 'messages',

  // Armazenamento S3 (para mídia)
  AWS_REGION: (process.env.AWS_REGION || '').trim(),
  AWS_S3_BUCKET: (process.env.AWS_S3_BUCKET || '').trim(),
  AWS_SIGNED_URL_EXPIRATION: parseInt(process.env.AWS_SIGNED_URL_EXPIRATION || '3600', 10),

  // Feature flag: salvar mídia recebida do WhatsApp
  WHATSAPP_UPLOAD_MEDIA: (process.env.WHATSAPP_UPLOAD_MEDIA || 'true').toLowerCase() === 'true',
};
