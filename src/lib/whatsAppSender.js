// WhatsAppSender.js
const Config = require('../../config/Config');
const Emitter = require('events').EventEmitter;
const log4js = require('log4js');
const axios = require('axios');
const mime = require('mime-types'); // detectar MIME automaticamente
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

let logger = log4js.getLogger('WhatsAppSender');
logger.level = Config.LOG_LEVEL;

/** Normaliza a private_key (\n -> quebra real) e retorna credenciais */
function buildGcpCredentials() {
  if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
    throw new Error('GCP_SERVICE_ACCOUNT_JSON não definido.');
  }
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const creds = JSON.parse(raw);
  if (creds.private_key && creds.private_key.includes('\\n')) {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  }
  return creds;
}

const creds = buildGcpCredentials();

// Inicializa o cliente do Google Cloud Storage com projectId explícito
const storage = new Storage({
  projectId: creds.project_id,
  credentials: creds,
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
      const metaResp = await axios.get(
        `${this.whatsAppApiUrl}/${this.whatsAppApiVersion}/${attachment.id}`,
        { headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` } }
      );

      if (!metaResp.data.url) {
        console.error("URL do anexo não encontrada! Resposta:", metaResp.data);
        return null;
      }

      // 2) Faz download da mídia
      const fileResponse = await axios.get(metaResp.data.url, {
        headers: { Authorization: `Bearer ${this.whatsAppAccessToken}` },
        responseType: "arraybuffer",
      });

      const mimeType = attachment.mime_type || 'application/octet-stream';
      const fileExtension = mime.extension(mimeType) || 'bin';
      const fileName = `whatsapp_${Date.now()}.${fileExtension}`;

      // 3) Salva em /tmp e faz upload para o bucket
      const tempFilePath = path.join('/tmp', fileName);
      fs.writeFileSync(tempFilePath, Buffer.from(fileResponse.data));

      const bucket = storage.bucket(Config.GCP_BUCKET_NAME);
      await bucket.upload(tempFilePath, {
        destination: fileName,
        resumable: false,
        validation: false,
        metadata: { contentType: mimeType }
      });

      fs.unlinkSync(tempFilePath);

      const file = bucket.file(fileName);

      // 4) Tenta gerar URL assinada (V4)
      try {
        const [signedUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000 // 1h
        });
        console.log(`✅ Arquivo salvo em: gs://${Config.GCP_BUCKET_NAME}/${fileName}`);
        console.log(`📎 URL temporária (1h): ${signedUrl}`);
        return signedUrl;
      } catch (signErr) {
        console.error('Falha ao assinar URL (getSignedUrl). Tentando fallback...', signErr?.message || signErr);

        // 5) Fallback opcional: tornar o objeto público se habilitado em env
        if (process.env.GCS_MAKE_PUBLIC_FALLBACK === 'true') {
          await file.makePublic();
          const publicUrl = `https://storage.googleapis.com/${Config.GCP_BUCKET_NAME}/${encodeURIComponent(fileName)}`;
          console.log(`🌐 Fallback público habilitado. URL: ${publicUrl}`);
          return publicUrl;
        }

        // Se não puder tornar público, propaga erro
        throw signErr;
      }
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

// Exporta a classe, storage e Config
module.exports = WhatsAppSender;
module.exports.storage = storage;
module.exports.Config = Config;
