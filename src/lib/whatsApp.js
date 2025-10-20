// src/lib/whatsApp.js
const WhatsAppSender = require('./whatsAppSender');
const _ = require('underscore');
const { MessageModel } = require('@oracle/bots-node-sdk/lib');
const log4js = require('log4js');
const axios = require('axios'); // usado no envio (upload opcional para media_id)
let logger = log4js.getLogger('WhatsApp');
const Config = require('../../config/Config');
logger.level = Config.LOG_LEVEL;

/**
 * Utility Class to send and receive messages from WhatsApp.
 */
class WhatsApp {
  constructor() {
    this.whatsAppSender = new WhatsAppSender();

    // ======= NOVO: controles em memória =======
    // evita processar o mesmo webhook mais de uma vez (retries do Meta)
    this._processedMessageIds = new Set();
    // trava múltiplas respostas para a MESMA mensagem interativa (lista/botão)
    this._consumedInteractiveContextIds = new Set();
  }

  /**
   * Receives a message from WhatsApp and convert to ODA payload
   * @param {object[]} payload - WhatsApp webhook "entry" array
   * @returns {object[]} array de mensagens no formato do ODA
   */
  async _receive(payload) {
    return this._getWhatsAppMessages(payload);
  }

  /**
   * Helper: channelExtensions usados pelo ODA para manter a mesma conversa
   */
  _channelExtensions(userId, contactName) {
    return {
      source: 'whatsapp',
      conversationKey: userId,     // <- chave estável da conversa
      externalUserId: userId,
      externalUserName: contactName || undefined
    };
  }

  /**
   * Process WhatsApp messages and convert to ODA message format.
   * @param {object[]} payload - Whatsapp Messages array to be processed.
   * @returns {object[]} Array de mensagens do ODA
   */
  async _getWhatsAppMessages(payload) {
    const odaMessages = [];
    const entries = payload || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (!change.value || !change.value.messages) continue;

        logger.info('Message: ', JSON.stringify(change.value.messages));

        const messages = change.value.messages;
        const userId = (change.value.contacts && change.value.contacts[0]?.wa_id) || '';
        const contactName = (change.value.contacts && change.value.contacts[0]?.profile?.name) || '';

        for (const message of messages) {
          // ======= NOVO: idempotência por message.id =======
          const incomingId = message.id || message.key?.id;
          if (incomingId && this._processedMessageIds.has(incomingId)) {
            logger.info(`[DEDUP] Ignorando mensagem repetida ${incomingId}`);
            continue;
          }

          const odaMessage = await this._processMessage(message, userId, contactName);
          if (odaMessage) {
            odaMessages.push(odaMessage);
            if (incomingId) this._processedMessageIds.add(incomingId);
          }
        }
      }
    }
    return odaMessages;
  }

  /**
   * Converte cada mensagem de WhatsApp para o formato do ODA
   */
  async _processMessage(message, userId, contactName) {
    let odaMessage = null;

    switch (message.type) {
      case 'text':
        odaMessage = this._createTextMessage(userId, contactName, message.text.body);
        break;

      case 'interactive': {
        // ======= NOVO: trava um-clique-só para botão e lista (list_reply / button_reply)
        const contextId = message?.context?.id;
        if (contextId && this._consumedInteractiveContextIds.has(contextId)) {
          logger.info(`[LOCK] Resposta extra ignorada para o mesmo menu: ${contextId}`);
          return null;
        }
        if (contextId) this._consumedInteractiveContextIds.add(contextId);

        // feedback opcional de “desativado”
        const chosenTitle =
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title;

        if (chosenTitle) {
          this._sendToWhatsApp({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userId,
            type: 'text',
            text: { body: `✅ Você escolheu: *${chosenTitle}*\n🔒 Opções bloqueadas para seguir o fluxo.` }
          });
        }

        odaMessage = await this._createInteractiveMessage(userId, contactName, message.interactive);
        break;
      }

      case 'location':
        odaMessage = this._createLocationMessage(userId, contactName, message.location);
        break;

      case 'audio':
        odaMessage = await this._createAttachmentMessage(userId, contactName, message.audio, 'audio');
        break;

      case 'image':
        odaMessage = await this._createAttachmentMessage(userId, contactName, message.image, 'image');
        break;

      case 'video':
        odaMessage = await this._createAttachmentMessage(userId, contactName, message.video, 'video');
        break;

      case 'document':
        odaMessage = await this._createAttachmentMessage(userId, contactName, message.document, 'document');
        break;

      default:
        logger.warn('Unsupported message type:', message.type);
        break;
    }

    return odaMessage;
  }

  // ======= BUILDERS (WhatsApp -> ODA) =======
  _createTextMessage(userId, contactName, text) {
    return {
      userId,
      messagePayload: {
        type: 'text',
        text,
        channelExtensions: this._channelExtensions(userId, contactName)
      },
      profile: { whatsAppNumber: userId, contactName }
    };
  }

  async _createInteractiveMessage(userId, contactName, interactive) {
    // Converte o reply (botão/lista) em "postback" para o ODA
    const id =
      interactive?.button_reply?.id || interactive?.list_reply?.id || '';
    const title =
      interactive?.button_reply?.title || interactive?.list_reply?.title || '';

    const text = id || title || ''; // o ODA costuma tratar postback.action ou texto

    return {
      userId,
      messagePayload: {
        type: 'text',
        text,
        channelExtensions: this._channelExtensions(userId, contactName)
      },
      profile: { whatsAppNumber: userId, contactName }
    };
  }

  _createLocationMessage(userId, contactName, location) {
    return {
      userId,
      messagePayload: {
        type: 'text',
        text: `${location.latitude},${location.longitude}`, // ou mapeie para seu componente de localização no ODA
        channelExtensions: Object.assign(
          this._channelExtensions(userId, contactName),
          {
            special_field_type: 'location',
            location: JSON.stringify(location)
          }
        )
      },
      profile: { whatsAppNumber: userId, contactName }
    };
  }

  async _createAttachmentMessage(userId, contactName, attachment, type) {
    if (!attachment || (!attachment.id && !attachment.link)) {
      logger.warn('Attachment inválido recebido de WA:', attachment);
      return null;
    }

    // baixa do WA (Graph) e salva no S3, gerando uma URL assinada
    let fileUrl = null;
    try {
      fileUrl = await this.whatsAppSender._downloadAndSaveWhatsAppAttachmentMessage(attachment);
    } catch (e) {
      logger.error('Erro ao salvar anexo no S3:', e?.message || e);
    }
    if (!fileUrl) return null;

    let odaAttachmentType = 'file';
    switch (type) {
      case 'image':    odaAttachmentType = 'image'; break;
      case 'audio':    odaAttachmentType = 'audio'; break;
      case 'video':    odaAttachmentType = 'video'; break;
      case 'document': odaAttachmentType = 'file';  break;
      default:         odaAttachmentType = 'file';
    }

    // título (caption/filename)
    let title = attachment.caption || attachment.filename || undefined;
    if (!title && type === 'audio') title = 'audio.ogg';

    const odaMsg = {
      userId,
      messagePayload: {
        type: 'attachment',
        attachment: {
          type: odaAttachmentType, // image | audio | video | file
          url: fileUrl,
          title
        },
        channelExtensions: this._channelExtensions(userId, contactName)
      },
      profile: { whatsAppNumber: userId, contactName }
    };

    logger.info(`[ATTACHMENT->ODA] type=${odaAttachmentType} title=${title}`);
    return odaMsg;
  }

  /** --------------------------
   *      SAÍDA PARA WHATSAPP
   *  -------------------------- */
  async _send(payload) {
    const { userId, messagePayload } = payload;
    const { type, actions, globalActions, headerText, footerText, channelExtensions } = messagePayload;

    const data = {
      messaging_product: 'whatsapp',
      preview_url: false,
      recipient_type: 'individual',
      to: userId
    };

    if (this._isTextOrLocationMessageWithoutActions(type, actions, globalActions)) {
      await this._handleTextOrLocationMessageWithoutActions(channelExtensions, messagePayload, data);
    } else if (this._isTextMessageWithActions(type, actions, globalActions)) {
      await this._handleTextMessageWithActions(actions, globalActions, headerText, footerText, messagePayload, data);
    } else if (this._isCardMessage(type, messagePayload.cards)) {
      await this._handleCardMessage(messagePayload.cards, globalActions, headerText, footerText, data);
    } else if (this._isAttachmentMessage(type, messagePayload.attachment)) {
      await this._handleAttachmentMessage(messagePayload.attachment, data);
    } else {
      return;
    }

    this._sendToWhatsApp(data);
  }

  _isTextOrLocationMessageWithoutActions(type, actions, globalActions) {
    return type === 'text' && (!actions || actions.length === 0) && (!globalActions || globalActions.length === 0);
  }
  _isTextMessageWithActions(type, actions, globalActions) {
    return type === 'text' && (actions || globalActions);
  }
  _isCardMessage(type, cards) {
    return type === 'card' && cards;
  }
  _isAttachmentMessage(type, attachment) {
    return type === 'attachment' && attachment;
  }

  async _handleTextOrLocationMessageWithoutActions(channelExtensions, messagePayload, data) {
    logger.info('Handle text or location message without actions');
    if (channelExtensions && channelExtensions.special_field_type === 'location') {
      const loc = JSON.parse(channelExtensions.location);
      data.type = 'location';
      data.location = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: loc.name,
        address: loc.address
      };
    } else {
      data.type = 'text';
      data.text = { body: messagePayload.text };
    }
  }

  async _handleTextMessageWithActions(actions, globalActions, headerText, footerText, messagePayload, data) {
    logger.info('Handle text message with actions');

    const postback = await this._getPostbackActions(actions || [], globalActions || [], 'postback');
    const totalPostback = postback.postback ? postback.postback.length : 0;

    // com <= 3 vira "reply buttons"; com 4..10 vira "list"
    if (totalPostback > 0 && totalPostback <= 3) {
      await this._handlePostbackActionsButtonItems(postback.postback, headerText || messagePayload.text, footerText, headerText || messagePayload.text, null, data);
    } else if (totalPostback > 3 && totalPostback <= 10) {
      await this._handlePostbackActionsListItems(postback.postback, headerText || messagePayload.text, footerText, headerText || messagePayload.text, null, data);
    } else {
      const other = await this._getPostbackActions(actions || [], globalActions || [], 'other');
      await this._handlePostbackActionsTextItems(other, headerText || messagePayload.text, footerText, headerText || messagePayload.text, data);
    }
  }

  async _handleCardMessage(cards, globalActions, headerText, footerText, data) {
    logger.info('Handle card message with actions');

    const totalActions =
      cards.reduce((sum, card) => sum + (card.actions ? card.actions.length : 0), 0) +
      (globalActions ? globalActions.length : 0);

    const actions = cards.reduce((result, card) => (card.actions ? result.concat(card.actions) : result), []);
    const postbackActions = await this._getPostbackActions(actions, globalActions, 'postback');
    const totalPostbackActions = postbackActions.postback ? postbackActions.postback.length : 0;

    if (totalPostbackActions > 0) {
      const image = cards[0].imageUrl ? cards[0].imageUrl : null;
      const title = cards[0].title ? cards[0].title : headerText;

      if (totalPostbackActions < 4) {
        await this._handlePostbackActionsButtonItems(postbackActions.postback, headerText, footerText, title, image, data);
      } else if (totalPostbackActions <= 10) {
        await this._handlePostbackActionsListItems(postbackActions.postback, headerText, footerText, title, image, data);
      } else if (totalActions > 10) {
        await this._handlePostbackActionsTextItems(postbackActions, headerText, footerText, headerText, data);
      }
    } else {
      const otherActions = await this._getPostbackActions(actions, globalActions, 'other');
      await this._handlePostbackActionsTextItems(otherActions, headerText, footerText, headerText, data);
    }
  }

  async _getPostbackActions(actions, globalActions, filter = 'postback') {
    const all = [].concat(actions || [], globalActions || []);
    const res = { postback: [], other: [] };

    all.forEach(a => {
      if (a && a.type === 'postback' && a.postback && a.postback.action) {
        res.postback.push(a);
      } else {
        res.other.push(a);
      }
    });

    return filter === 'postback' ? { postback: res.postback } : res;
  }

  async _handlePostbackActionsButtonItems(actions, headerText, footerText, bodyText, image, data) {
    logger.info('Handle actions as a button items');
    data.type = 'interactive';
    data.interactive = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: [] }
    };

    actions && actions.forEach(action => {
      data.interactive.action.buttons.push({
        type: 'reply',
        reply: {
          id: action.postback.action,
          title: action.label.length < 21 ? action.label : action.label.substr(0, 16).concat('...')
        }
      });
    });

    if (image) {
      data.interactive.header = { type: 'image', image: { link: image } };
    } else if (headerText) {
      data.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) data.interactive.footer = { text: footerText };
  }

  async _handlePostbackActionsListItems(actions, headerText, footerText, titleText, image, data) {
    logger.info('Handle actions as a list items');
    data.type = 'interactive';
    data.interactive = {
      type: 'list',
      header: headerText ? { type: 'text', text: headerText } : undefined,
      body: { text: titleText || Config.LIST_TITLE_DEFAULT_LABEL },
      footer: footerText ? { text: footerText } : undefined,
      action: {
        button: 'Selecionar',
        sections: [
          {
            title: headerText || 'Opções',
            rows: actions.map((a, i) => ({
              id: a.postback.action,
              title: a.label.length < 25 ? a.label : a.label.substr(0, 22) + '...',
              description: a.postback?.variables?.description || undefined
            }))
          }
        ]
      }
    };
  }

  async _handlePostbackActionsTextItems(actionsObj, headerText, footerText, bodyText, data) {
    logger.info('Fallback: envia texto com opções numeradas');
    const items = (actionsObj.postback || []).map((a, i) => `${i + 1}. ${a.label}`).join('\n');
    data.type = 'text';
    data.text = { body: `${bodyText}\n\n${items}` };
  }

  /**
   * SAÍDA (ODA->WhatsApp): envia attachment.
   * - Por padrão usa LINK (compatível com seu código atual).
   * - Se WHATSAPP_UPLOAD_MEDIA=true e existir _uploadToWhatsAppMedia, faz upload pro WhatsApp e envia por media_id.
   */
  async _handleAttachmentMessage(attachment, data) {
    const { type, url, title } = attachment || {};
    if (!type || !url) {
      logger.warn('Attachment inválido recebido do ODA:', attachment);
      return;
    }

    // Upload opcional para media_id
    const wantUpload = String(process.env.WHATSAPP_UPLOAD_MEDIA || '').toLowerCase() === 'true';
    const canUpload = typeof this.whatsAppSender._uploadToWhatsAppMedia === 'function';

    if (wantUpload && canUpload) {
      try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        const mimeType = res.headers['content-type'] || 'application/octet-stream';

        const mediaId = await this.whatsAppSender._uploadToWhatsAppMedia(buffer, mimeType);
        logger.info(`[ODA->WA] Enviando ${type} por media_id`);

        switch (type) {
          case 'image':
            data.type = 'image';
            data.image = { id: mediaId };
            if (title) data.image.caption = title;
            return;
          case 'video':
            data.type = 'video';
            data.video = { id: mediaId };
            if (title) data.video.caption = title;
            return;
          case 'audio':
            data.type = 'audio';
            data.audio = { id: mediaId };
            return;
          default: // 'file' | 'document'
            data.type = 'document';
            data.document = { id: mediaId };
            if (title) data.document.caption = title;
            return;
        }
      } catch (e) {
        logger.error('Falha no upload para media_id, usando fallback por link:', e?.message || e);
        // segue para fallback por link
      }
    }

    // Fallback padrão por LINK
    logger.info(`[ODA->WA] Enviando ${type} por link`);
    switch (type) {
      case 'image':
        data.type = 'image';
        data.image = { link: url };
        if (title) data.image.caption = title;
        break;
      case 'video':
        data.type = 'video';
        data.video = { link: url };
        if (title) data.video.caption = title;
        break;
      case 'audio':
        data.type = 'audio';
        data.audio = { link: url };
        break;
      default: // 'file' | 'document'
        data.type = 'document';
        data.document = { link: url };
        if (title) data.document.caption = title;
        break;
    }
  }

  _sendToWhatsApp(message) {
    this.whatsAppSender._queueMessage(message);
  }
}

module.exports = WhatsApp;
