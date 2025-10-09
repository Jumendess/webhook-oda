// WhatsAppSender.js
const Config = require('../../config/Config');
const Emitter = require('events').EventEmitter;
const log4js = require('log4js');
const axios = require('axios');
const mime = require('mime-types'); // detectar MIME automaticamente

// ===== AWS S3 (SDK v3) =====
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let logger = log4js.getLogger('WhatsAppSender');
logger.level = Config.LOG_LEVEL;

// ===== Cliente S3 =====
const s3 = new S3Client({
  region: process.env.AWS_REGION || Config.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || Config.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || Config.AWS_SECRET_ACCESS_KEY,
  },
});

class WhatsAppSender {
  constructor() {
    this.messagesQueue = [];
    this.eventsEmitter = new Emitter();
    this.whatsAppApiUrl = Config.API_URL;
    this.whatsAppEndpointApi = Config.ENDPOINT_API;
    this.whatsAppVerifyToken = Config.VERIFY_TOKEN;
    this.whatsAppAccessToken = Config.ACCESS_TOKEN;
    this.whatsAppApiVersion = Config.API_VERSION;

    const self = this;

    self.eventsEmitter.on(Config.EVENT_QUEUE_MESSAGE_TO_WHATSAPP, async (payload) => {
      self.messagesQueue.unshift(payload);
      if (self.messagesQueue.length === 1) {
        try {
          await self._sendMessageToWhatsApp(payload);
        } catch (error) {
          throw error;
        }
      }
    });

    self.eventsEmitter.on(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, (messageId) => {
      logger.info(`Message with ID (${messageId}) delivered`);
      self.messagesQueue.pop();
      self.eventsEmitter.emit(Config.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE);
    });

    self.eventsEmitter.on(Config.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE, async () => {
      if (self.messagesQueue.length > 0) {
        const next = self.messagesQueue[self.messagesQueue.length - 1];
        await self._sendMessageToWhatsApp(next);
      }
    });
  }

  _queueMessage(message) {
    this.eventsEmitter.emit(Config.EVENT_QUEUE_MESSAGE_TO_WHATSAPP, message);
  }

  async _sendMessageToWhatsApp(message) {
    try {
      const url = `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${Config.PHONE_NUMBER_ID}/${this.whatsAppEndpointApi}`;
      const headers = {
        'Authorization': `Bearer ${this.whatsAppAccessToken}`,
        'Content-Type': 'application/json'
      };

      const resp = await axios.post(url, message, { headers });
      const messageId = resp?.data?.messages?.[0]?.id || '';
      this.eventsEmitter.emit(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, messageId);
    } catch (error) {
      logger.error('Erro enviando mensagem ao WhatsApp:', error?.response?.data || error.message || error);
      throw error;
    }
  }

  /**
   * Envia um media_id para a API do WhatsApp (upload nativo da Meta)
   * Mantido como no seu código original (interface compatível).
   */
  async _uploadToWhatsAppMedia(binary, mimeType) {
    const url = `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${Config.PHONE_NUMBER_ID}/media`;
    const headers = {
      'Authorization': `Bearer ${this.whatsAppAccessToken}`,
      'Content-Type': mimeType || 'application/octet-stream'
    };
    const resp = await axios.post(url, binary, { headers });
    return resp?.data?.id;
  }

  /**
   * Baixa a mídia do WhatsApp (via Graph) e SALVA no S3.
   * Retorna uma URL ASSINADA temporária para leitura.
   * => Mantém o mesmo nome/método que seu fluxo já usa.
   */
  async _downloadAndSaveWhatsAppAttachmentMessage(attachment) {
    try {
      // 1) Recupera URL da mídia no WhatsApp (Graph)
      const metaResp = await axios.get(
        `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${attachment.id}`,
        { headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` } }
      );
      if (!metaResp.data.url) {
        console.error("URL do anexo não encontrada! Resposta:", metaResp.data);
        return null;
      }

      // 2) Baixa o binário
      const fileResponse = await axios.get(metaResp.data.url, {
        headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` },
        responseType: "arraybuffer",
      });

      const mimeType = attachment?.mime_type || fileResponse.headers['content-type'] || 'application/octet-stream';
      const fileExtension = mime.extension(mimeType) || 'bin';
      const fileName = `whatsapp_${Date.now()}.${fileExtension}`;

      // 3) Upload ao S3
      await s3.send(new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET || Config.AWS_S3_BUCKET,
        Key: fileName,
        Body: Buffer.from(fileResponse.data),
        ContentType: mimeType,
      }));

      // 4) Assina URL (GET) com expiração configurável
      const expiresIn = parseInt(process.env.AWS_SIGNED_URL_EXPIRATION || Config.AWS_SIGNED_URL_EXPIRATION || '3600', 10);
      const signedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET || Config.AWS_S3_BUCKET,
          Key: fileName
        }),
        { expiresIn }
      );

      console.log(`✅ Arquivo salvo em: s3://${process.env.AWS_S3_BUCKET || Config.AWS_S3_BUCKET}/${fileName}`);
      console.log(`📎 URL temporária (${expiresIn}s): ${signedUrl}`);
      return signedUrl;

    } catch (error) {
      const friendly =
        error?.response?.data
          ? JSON.stringify(error.response.data)
          : (error?.message || String(error));
      console.error("❌ Erro ao baixar/salvar o anexo:", friendly);
      return null;
    }
  }
}

// Exporta a classe e o Config
module.exports = WhatsAppSender;
module.exports.Config = Config;
