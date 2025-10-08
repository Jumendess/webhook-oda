// src/lib/whatsAppSender.js
const Config = require('../../config/Config');
const Emitter = require('events').EventEmitter;
const log4js = require('log4js');
const axios = require('axios');
const mime = require('mime-types');
const path = require('path');

// ==== AWS S3 ====
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let logger = log4js.getLogger('WhatsAppSender');
logger.level = Config.LOG_LEVEL;

// cliente S3
const s3 = new S3Client({
  region: Config.AWS_REGION,
  // usa as credenciais do ambiente (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
});

class WhatsAppSender {
  constructor() {
    this.messagesQueue = [];
    this.eventsEmitter = new Emitter();

    this.whatsAppApiUrl = Config.API_URL;
    this.whatsAppEndpointApi = Config.ENDPOINT_API;
    this.whatsAppAccessToken = Config.ACCESS_TOKEN;
    this.whatsAppApiVersion = Config.API_VERSION;
    this.whatsAppPhoneNumberId = Config.PHONE_NUMBER_ID;

    this._setupEvents();
    logger.info('WhatsApp Sender initialized (S3)');
  }

  _setupEvents() {
    const self = this;

    self.eventsEmitter.on(Config.EVENT_QUEUE_MESSAGE_TO_WHATSAPP, async (payload) => {
      self.messagesQueue.unshift(payload);
      if (self.messagesQueue.length === 1) {
        try {
          await self._sendMessageToWhatsApp(payload);
        } catch (error) {
          logger.error('Erro ao enviar primeira mensagem da fila:', error?.message || error);
        }
      }
    });

    self.eventsEmitter.on(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, (messageId) => {
      logger.info(`Message with ID (${messageId}) delivered`);
      self.messagesQueue.pop();
      self.eventsEmitter.emit(Config.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE);
    });

    self.eventsEmitter.on(Config.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE, () => {
      if (self.messagesQueue.length > 0) {
        const nextMessage = self.messagesQueue[self.messagesQueue.length - 1];
        self._sendMessageToWhatsApp(nextMessage, self);
      }
    });
  }

  async _sendMessageToWhatsApp(message) {
    try {
      const url = `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${this.whatsAppPhoneNumberId}/${this.whatsAppEndpointApi}`;
      const response = await axios({
        method: 'post',
        url,
        headers: {
          Authorization: `Bearer ${this.whatsAppAccessToken}`,
          'Content-Type': 'application/json',
        },
        data: message,
      });

      const sentId = response?.data?.messages?.[0]?.id;
      if (sentId) {
        this.eventsEmitter.emit(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, sentId);
      } else {
        logger.warn('Mensagem enviada mas sem ID de retorno (verifique payload/WhatsApp API).');
      }
    } catch (error) {
      const friendly = error?.response?.data || error?.message || String(error);
      logger.error('Erro ao enviar mensagem para WhatsApp:', friendly);
      throw error;
    }
  }

  _queueMessage(message) {
    this.eventsEmitter.emit(Config.EVENT_QUEUE_MESSAGE_TO_WHATSAPP, message);
  }

  messageDelivered(messageId) {
    this.eventsEmitter.emit(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, messageId);
  }

  /**
   * Faz o download da mídia do WhatsApp e publica no S3.
   * Retorna uma URL ASSINADA (GET) para consumo seguro no ODA/RightNow.
   * Se Config.WHATSAPP_UPLOAD_MEDIA = false, retorna null.
   */
  async _downloadAndSaveWhatsAppAttachmentMessage(attachment) {
    if (!Config.WHATSAPP_UPLOAD_MEDIA) {
      logger.warn('Download/upload de mídia desativado por configuração (WHATSAPP_UPLOAD_MEDIA=false).');
      return null;
    }

    try {
      // 1) Metadados do WhatsApp para obter a URL real
      const metaUrl = `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${attachment.id}`;
      const metaResp = await axios.get(metaUrl, {
        headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` },
      });

      const mediaUrl = metaResp?.data?.url;
      if (!mediaUrl) {
        logger.error('URL do anexo não encontrada na resposta da Graph API:', metaResp?.data);
        return null;
      }

      // 2) Download binário
      const fileResp = await axios.get(mediaUrl, {
        headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` },
        responseType: 'arraybuffer',
      });

      const mimeType = attachment.mime_type || 'application/octet-stream';
      const fileExtension = mime.extension(mimeType) || 'bin';
      const fileName = `whatsapp_${Date.now()}.${fileExtension}`;
      const key = path.posix.join('uploads', fileName); // pasta opcional no bucket

      // 3) Upload para o S3
      await s3.send(
        new PutObjectCommand({
          Bucket: Config.AWS_S3_BUCKET,
          Key: key,
          Body: Buffer.from(fileResp.data),
          ContentType: mimeType,
          // ServerSideEncryption: 'aws:kms',             // se quiser forçar
          // SSEKMSKeyId: 'arn:aws:kms:....'              // se estiver usando KMS custom
        })
      );

      // 4) URL assinada (GET) para leitura segura
      const signedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: Config.AWS_S3_BUCKET,
          Key: key,
          ResponseContentType: mimeType,
        }),
        { expiresIn: Config.AWS_SIGNED_URL_EXPIRATION } // segundos
      );

      logger.info(`✅ S3 upload OK: s3://${Config.AWS_S3_BUCKET}/${key}`);
      logger.info(`🔐 URL assinada (expira em ${Config.AWS_SIGNED_URL_EXPIRATION}s): ${signedUrl}`);

      return signedUrl;
    } catch (error) {
      const friendly = error?.response?.data || error?.message || String(error);
      logger.error('❌ Erro ao baixar/salvar anexo no S3:', friendly);
      return null;
    }
  }
}

module.exports = WhatsAppSender;
