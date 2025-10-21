// config/Config.js
// -> Centraliza variáveis de ambiente e constantes usadas no conector

// ODA (Webhook de saída do seu servidor para o ODA)
exports.ODA_WEBHOOK_URL = process.env.ODA_WEBHOOK_URL || '';
exports.ODA_WEBHOOK_SECRET = process.env.ODA_WEBHOOK_SECRET || '';

// WhatsApp (API Cloud da Meta)
exports.API_URL = 'https://graph.facebook.com';
exports.ENDPOINT_API = 'messages';
exports.VERIFY_TOKEN = process.env.VERIFY_TOKEN || '';
exports.ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
exports.API_VERSION = process.env.VERSION || 'v16.0';
exports.PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
exports.LIST_TITLE_DEFAULT_LABEL = 'Select one';

// Geral (porta, logs, URLs)
exports.port = process.env.port || 3000;
exports.FILES_URL = process.env.FILES_URL;
exports.LOG_LEVEL = 'info'; // mude para 'warn' ou 'error' para reduzir ruído de log

// Eventos internos do sender (fila de envio)
exports.EVENT_QUEUE_MESSAGE_TO_WHATSAPP = "100";
exports.EVENT_WHATSAPP_MESSAGE_DELIVERED = "1000";
exports.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE = "2000";

// (Opcional) nome de bucket GCP (mantido para futuros usos)
exports.GCP_BUCKET_NAME = process.env.GCP_BUCKET_NAME;

// AWS S3 (armazenar/servir anexos baixados da Meta)
exports.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
exports.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
exports.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
exports.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
exports.AWS_SIGNED_URL_EXPIRATION = parseInt(process.env.AWS_SIGNED_URL_EXPIRATION || '3600', 10);
