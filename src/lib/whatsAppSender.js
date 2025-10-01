// WhatsAppSender.js
const Config = require('../../config/Config');
const Emitter = require('events').EventEmitter;
const log4js = require('log4js');
const axios = require('axios');
const mime = require('mime-types'); // para detectar MIME automaticamente
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

let logger = log4js.getLogger('WhatsAppSender');
logger.level = Config.LOG_LEVEL;

// Inicializa o cliente do Google Cloud Storage usando variáveis de ambiente
const storage = new Storage({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON)
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
    this.whatsAppPhoneNumberId = Config.PHONE_NUMBER_ID;

    this._setupEvents();
    logger.info('WhatsApp Sender initialized');
  }

  _setupEvents() {
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

    self.eventsEmitter.on(Config.EVENT_PROCESS_NEXT_WHATSAPP_MESSAGE, () => {
      if (self.messagesQueue.length > 0) {
        const nextMessage = self.messagesQueue[self.messagesQueue.length - 1];
        self._sendMessageToWhatsApp(nextMessage, self);
      }
    });
  }

  async _sendMessageToWhatsApp(message) {
    const self = this;
    try {
      const config = {
        method: 'post',
        url: `${self.whatsAppApiUrl}/${self.whatsAppApiVersion}/${self.whatsAppPhoneNumberId}/${self.whatsAppEndpointApi}`,
        headers: {
          Authorization: `Bearer ${self.whatsAppAccessToken}`,
          'Content-Type': 'application/json'
        },
        data: message
      };

      const response = await axios(config);
      if (response.data && response.data.messages && response.data.messages[0]) {
        self.eventsEmitter.emit(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, response.data.messages[0].id);
      }
    } catch (error) {
      throw error;
    }
  }

  _queueMessage(message) {
    this.eventsEmitter.emit(Config.EVENT_QUEUE_MESSAGE_TO_WHATSAPP, message);
  }

  messageDelivered(messageId) {
    this.eventsEmitter.emit(Config.EVENT_WHATSAPP_MESSAGE_DELIVERED, messageId);
  }

  async _downloadAndSaveWhatsAppAttachmentMessage(attachment) {
    try {
      // 1) Recupera URL da mídia no WhatsApp
      const config = {
        method: "get",
        url: `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${attachment.id}`,
        headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` },
      };

      const response = await axios.request(config);
      if (!response.data.url) {
        console.error("URL do anexo não encontrada!");
        return null;
      }

      // 2) Faz download da mídia
      const fileResponse = await axios({
        method: "get",
        url: response.data.url,
        headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` },
        responseType: "arraybuffer",
      });

      const fileExtension = mime.extension(attachment.mime_type) || 'bin';
      const fileName = `whatsapp_${Date.now()}.${fileExtension}`;

      // Caminho temporário em /tmp (Render permite)
      const tempFilePath = path.join("/tmp", fileName);
      fs.writeFileSync(tempFilePath, Buffer.from(fileResponse.data));

      // 3) Upload no Google Cloud Storage
      const bucket = storage.bucket(Config.GCP_BUCKET_NAME);
      await bucket.upload(tempFilePath, {
        destination: fileName,
        resumable: false,
        validation: false,
        metadata: { contentType: attachment.mime_type }
      });

      // Remove o arquivo temporário
      fs.unlinkSync(tempFilePath);

      // 4) Gera URL temporária de 1h
      const [signedUrl] = await bucket.file(fileName).getSignedUrl({
        action: 'read',
        expires: Date.now() + 1000 * 60 * 60
      });

      console.log(`✅ Arquivo salvo em: gs://${Config.GCP_BUCKET_NAME}/${fileName}`);
      console.log(`📎 URL temporária de acesso (1h): ${signedUrl}`);

      return signedUrl;
    } catch (error) {
      console.error("❌ Erro ao baixar/salvar o anexo:", error.response ? error.response.data : error.message);
      return null;
    }
  }
}

// Exporta a classe, storage e Config
module.exports = WhatsAppSender;
module.exports.storage = storage;
module.exports.Config = Config;
