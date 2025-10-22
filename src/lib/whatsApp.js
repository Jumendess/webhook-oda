// src/lib/whatsApp.js
const WhatsAppSender = require('./whatsAppSender');
const _ = require('underscore');
const { MessageModel } = require('@oracle/bots-node-sdk/lib');
const log4js = require('log4js');
const axios = require('axios');
let logger = log4js.getLogger('WhatsApp');
const Config = require('../../config/Config');
logger.level = Config.LOG_LEVEL;

/* =========================================================================
 *  CONTEXTO / ESTADO (sem trava de 60s)
 *    - menuId: identifica cliques do MESMO menu (ids com prefixo "menuId|action")
 *    - __menus: guarda o payload do menuId (pra reenvio fiel)
 *    - __menuState: { firstActionId, firstTitle, consumedAt, noticeSent }
 *    - __lastMenuByUser: SEMPRE guarda o ÚLTIMO menu enviado ao usuário
 *    - __seenMsgs: dedupe de message.id (evita processar retries)
 * ========================================================================= */
const __menus = new Map();               // menuId -> { dataClonado }
const __menuState = new Map();           // menuId -> { firstActionId, firstTitle, consumedAt, noticeSent }
const __lastMenuByUser = new Map();      // userId -> dataClonado (último menu enviado)
const __seenMsgs = new Map();            // messageId -> Timeout (TTL 2min)

/** Janela para enviar 1 (um) aviso por menu após a 1ª escolha */
const NOTICE_WINDOW_MS = 60 * 1000;

/* =============== helpers de ids/coleções =============== */
function __createMenuId() {
  return `menu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}
function __rememberMenu(menuId, data) {
  try {
    const cloned = JSON.parse(JSON.stringify(data));
    __menus.set(menuId, { data: cloned });
  } catch (e) {
    logger.warn('Falha ao armazenar menu para reenvio:', e?.message || e);
  }
}
function __getMenu(menuId) {
  const found = __menus.get(menuId);
  return found ? found.data : null;
}
function __splitMenuActionId(id) {
  const p = id.indexOf('|');
  if (p === -1) return { menuId: null, actionId: id }; // retrocompat: id puro
  return { menuId: id.slice(0, p), actionId: id.slice(p + 1) };
}
/* dedupe de eventos: processa cada message.id apenas 1x por 2min */
function __seenOnce(messageId, ttlMs = 120000) {
  if (!messageId) return true; // se por algum motivo não veio id, processa
  if (__seenMsgs.has(messageId)) return false;
  const t = setTimeout(() => __seenMsgs.delete(messageId), ttlMs);
  __seenMsgs.set(messageId, t);
  return true;
}

/**
 * Utility Class to send and receive messages from WhatsApp.
 */
class WhatsApp {
  constructor() {
    this.whatsAppSender = new WhatsAppSender();
  }

  /** Recebe a entrada do WhatsApp e converte pra payload do ODA */
  async _receive(payload) {
    return this._getWhatsAppMessages(payload);
  }

  /** channelExtensions usados pelo ODA p/ manter a conversa */
  _channelExtensions(userId, contactName) {
    return {
      source: 'whatsapp',
      conversationKey: userId,
      externalUserId: userId,
      externalUserName: contactName || undefined
    };
  }

  /** Processa a entrada do WhatsApp em mensagens do ODA */
  async _getWhatsAppMessages(payload) {
    const odaMessages = [];
    const entries = payload || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (!change.value || !change.value.messages) continue;

        logger.debug('Message: ', JSON.stringify(change.value.messages));

        const messages = change.value.messages;
        const userId = (change.value.contacts && change.value.contacts[0]?.wa_id) || '';
        const contactName = (change.value.contacts && change.value.contacts[0]?.profile?.name) || '';

        for (const message of messages) {
          // 1) DEDUPE: ignora retries do mesmo evento
          if (!__seenOnce(message.id)) {
            logger.debug('Duplicated message id (retry) ignored:', message.id);
            continue;
          }

          const odaMessage = await this._processMessage(message, userId, contactName);
          if (odaMessage) odaMessages.push(odaMessage);
        }
      }
    }
    return odaMessages;
  }

  /** Converte cada mensagem para o formato do ODA */
  async _processMessage(message, userId, contactName) {
    let odaMessage = null;

    switch (message.type) {
      case 'text':
        odaMessage = this._createTextMessage(userId, contactName, message.text.body);
        break;

      case 'interactive':
        odaMessage = await this._createInteractiveMessage(userId, contactName, message.interactive);
        break;

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

  /* ---------- builders ---------- */

  _createTextMessage(userId, contactName, body) {
    return {
      userId,
      messagePayload: {
        ...MessageModel.textConversationMessage(body),
        channelExtensions: this._channelExtensions(userId, contactName)
      },
      profile: { whatsAppNumber: userId, contactName }
    };
  }

  async _createInteractiveMessage(userId, contactName, interactive) {
    switch (interactive.type) {
      case 'button_reply': {
        const rawId = interactive.button_reply.id;
        const newTitle = interactive.button_reply.title;
        const { menuId, actionId } = __splitMenuActionId(rawId);

        if (menuId) {
          const st = __menuState.get(menuId);

          // PRIMEIRA escolha deste menu -> registra e segue para o ODA
          if (!st) {
            __menuState.set(menuId, {
              firstActionId: actionId,
              firstTitle: newTitle,
              consumedAt: Date.now(),
              noticeSent: false
            });
          } else {
            // Já houve 1ª escolha
            const withinWindow = (Date.now() - st.consumedAt) <= NOTICE_WINDOW_MS;

            // (a) Se repetiu a MESMA opção, ignora silenciosamente
            if (actionId === st.firstActionId) return null;

            // (b) Se mudou a opção, avisa 1x dentro da janela
            if (withinWindow && !st.noticeSent) {
              const previous = st.firstTitle || 'uma opção anterior';
              const msg = `Eu vi que você estava falando comigo referente a “${previous}”.\n` +
                          `Se quiser falar de “${newTitle}”, por favor selecione uma opção no menu abaixo.`;

              // envia o texto informativo
              this._sendToWhatsApp({
                messaging_product: 'whatsapp',
                preview_url: false,
                recipient_type: 'individual',
                to: userId,
                type: 'text',
                text: { body: msg }
              });

              // reenvia o ÚLTIMO MENU enviado a esse usuário (lista ou botões)
              const lastMenu = __lastMenuByUser.get(userId) || __getMenu(menuId);
              if (lastMenu) this._sendToWhatsApp(lastMenu);

              // marca que já avisou; próximas trocas no mesmo menu NÃO geram nada
              __menuState.set(menuId, { ...st, noticeSent: true });
              return null;
            }

            // (c) Fora da janela OU já avisou → não envia nada
            return null;
          }
        }

        // Primeiro clique desse menu → envia ação limpa ao ODA
        return {
          userId,
          messagePayload: {
            type: 'postback',
            postback: { action: actionId }, // id limpo pro ODA
            channelExtensions: this._channelExtensions(userId, contactName)
          },
          profile: { whatsAppNumber: userId, contactName }
        };
      }

      case 'list_reply': {
        const rawId = interactive.list_reply.id;
        const newTitle = interactive.list_reply.title;
        const { menuId, actionId } = __splitMenuActionId(rawId);

        if (menuId) {
          const st = __menuState.get(menuId);

          if (!st) {
            __menuState.set(menuId, {
              firstActionId: actionId,
              firstTitle: newTitle,
              consumedAt: Date.now(),
              noticeSent: false
            });
          } else {
            const withinWindow = (Date.now() - st.consumedAt) <= NOTICE_WINDOW_MS;

            if (actionId === st.firstActionId) return null;

            if (withinWindow && !st.noticeSent) {
              const previous = st.firstTitle || 'uma opção anterior';
              const msg = `Eu vi que você estava falando comigo referente a “${previous}”.\n` +
                          `Se quiser falar de “${newTitle}”, por favor selecione uma opção no menu abaixo.`;

              this._sendToWhatsApp({
                messaging_product: 'whatsapp',
                preview_url: false,
                recipient_type: 'individual',
                to: userId,
                type: 'text',
                text: { body: msg }
              });

              const lastMenu = __lastMenuByUser.get(userId) || __getMenu(menuId);
              if (lastMenu) this._sendToWhatsApp(lastMenu);

              __menuState.set(menuId, { ...st, noticeSent: true });
              return null;
            }

            return null;
          }
        }

        return {
          userId,
          messagePayload: {
            type: 'postback',
            postback: { action: actionId },
            channelExtensions: this._channelExtensions(userId, contactName)
          },
          profile: { whatsAppNumber: userId, contactName }
        };
      }

      default:
        logger.warn('Unsupported interactive type:', interactive.type);
        return null;
    }
  }

  _createLocationMessage(userId, contactName, location) {
    return {
      userId,
      messagePayload: {
        type: 'location',
        location: { latitude: location.latitude, longitude: location.longitude },
        channelExtensions: this._channelExtensions(userId, contactName)
      },
      profile: { whatsAppNumber: userId, contactName }
    };
  }

  /** Entrada de mídia: baixa da Meta e sobe p/ S3 (ou envia por link) */
  async _createAttachmentMessage(userId, contactName, attachment, type) {
    const fileUrl = await this.whatsAppSender._downloadAndSaveWhatsAppAttachmentMessage(attachment);
    if (!fileUrl) {
      logger.error('Falha ao obter URL do anexo (download/upload).');
      return null;
    }

    let odaAttachmentType = 'file';
    switch (type) {
      case 'image':    odaAttachmentType = 'image'; break;
      case 'audio':    odaAttachmentType = 'audio'; break;
      case 'video':    odaAttachmentType = 'video'; break;
      case 'document': odaAttachmentType = 'file';  break;
      default:         odaAttachmentType = 'file';
    }

    let title = attachment.caption || attachment.filename || undefined;
    if (!title && type === 'audio') title = 'audio.ogg';

    const odaMsg = {
      userId,
      messagePayload: {
        type: 'attachment',
        attachment: { type: odaAttachmentType, url: fileUrl, title },
        channelExtensions: this._channelExtensions(userId, contactName)
      },
      profile: { whatsAppNumber: userId, contactName }
    };

    logger.info(`[ATTACHMENT->ODA] type=${odaAttachmentType} title=${title}`);
    return odaMsg;
  }

  /* ---------- SAÍDA p/ WhatsApp ---------- */

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

  async _handlePostbackActionsButtonItems(actions, headerText, footerText, bodyText, image, data) {
    logger.info('Handle actions as a button items');
    data.type = 'interactive';
    data.interactive = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: [] }
    };

    const __menuId = __createMenuId();

    actions && actions.forEach(action => {
      data.interactive.action.buttons.push({
        type: 'reply',
        reply: {
          id: `${__menuId}|${action.postback.action}`,
          title: action.label.length < 21 ? action.label : action.label.substr(0, 16).concat('...')
        }
      });
    });

    __rememberMenu(__menuId, data); // menu para reenvio

    if (image) {
      data.interactive.header = { type: 'image', image: { link: image } };
    } else if (headerText) {
      data.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) data.interactive.footer = { text: footerText };
  }

  async _handlePostbackActionsListItems(actions, headerText, footerText, messagePayload, image, data) {
    logger.info('Handle actions as a list items');
    data.type = 'interactive';
    data.interactive = {
      type: 'list',
      body: { text: messagePayload.text },
      action: { button: 'Escolha uma opção', sections: [] }
    };

    const __menuId = __createMenuId();

    const rows = [];
    actions && actions.forEach(action => {
      rows.push({
        id: `${__menuId}|${action.postback.action}`,
        title: action.label.length < 24 ? action.label : action.label.substr(0, 20).concat('...')
      });
    });

    data.interactive.action.sections.push({ rows });

    __rememberMenu(__menuId, data); // menu para reenvio

    if (image) {
      data.interactive.header = { type: 'image', image: { link: image } };
    } else if (headerText) {
      data.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) data.interactive.footer = { text: footerText };
  }

  async _handlePostbackActionsTextItems(actions, headerText, footerText, bodyText, data) {
    logger.info('Handle other actions (url, phone, etc) and ten more items');
    let response = '';
    if (headerText) response = response.concat(headerText).concat('\n\n');
    response = response.concat(bodyText).concat('\n');

    for (const key in actions) {
      actions[key].forEach(action => {
        const t = this._createWhatsAppAction(action, data);
        if (t) response = response.concat('\n').concat(t);
      });
    }

    if (footerText) response = response.concat('\n\n').concat(footerText);
    data.type = 'text';
    data.text = { body: response };
  }

  _createWhatsAppAction(odaAction, data) {
    const { type, label, url, phoneNumber } = odaAction;
    if (type === 'share') return;

    let result = label ? label : '';
    switch (type) {
      case 'url':
        data.preview_url = true;
        result = result.concat(': ').concat(url);
        break;
      case 'call':
        result = result.concat(': ').concat(phoneNumber);
        break;
      case 'share':
        return null;
    }
    return result;
  }

  async _handleTextMessageWithActions(actions, globalActions, headerText, footerText, messagePayload, data) {
    logger.info('Handle text message with actions');
    const postbackActions = await this._getPostbackActions(actions, globalActions, 'postback');
    const totalPostbackActions = postbackActions.postback ? postbackActions.postback.length : 0;

    if (totalPostbackActions > 0) {
      if (totalPostbackActions < 4) {
        await this._handlePostbackActionsButtonItems(postbackActions.postback, headerText, footerText, messagePayload.text, null, data);
      } else if (totalPostbackActions <= 10) {
        await this._handlePostbackActionsListItems(postbackActions.postback, headerText, footerText, messagePayload, null, data);
      } else {
        await this._handlePostbackActionsTextItems(postbackActions, headerText, footerText, messagePayload.text, data);
      }
    } else {
      const otherActions = await this._getPostbackActions(actions, globalActions, 'other');
      await this._handlePostbackActionsTextItems(otherActions, headerText, footerText, messagePayload.text, data);
    }
  }

  async _getPostbackActions(actions, globalActions, type) {
    actions = actions ? actions : [];
    globalActions = globalActions ? globalActions : [];
    actions = actions.concat(globalActions);
    actions = _.groupBy(actions, 'type');
    return type === 'postback' ? _.pick(actions, ['postback']) : _.omit(actions, ['postback']);
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

  /**
   * SAÍDA (ODA->WhatsApp): envia attachment.
   * Usa link (padrão) ou upload nativo (media_id) se habilitado.
   */
  async _handleAttachmentMessage(attachment, data) {
    const { type, url, title } = attachment || {};
    if (!type || !url) {
      logger.warn('Attachment inválido recebido do ODA:', attachment);
      return;
    }

    const wantUpload = String(process.env.WHATSAPP_UPLOAD_MEDIA || '').toLowerCase() === 'true';
    theCanUpload = typeof this.whatsAppSender._uploadToWhatsAppMedia === 'function';

    if (wantUpload && theCanUpload) {
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
          default:
            data.type = 'document';
            data.document = { id: mediaId };
            if (title) data.document.caption = title;
            return;
        }
      } catch (e) {
        logger.error('Falha no upload para media_id, usando fallback por link:', e?.message || e);
      }
    }

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
      default:
        data.type = 'document';
        data.document = { link: url };
        if (title) data.document.caption = title;
        break;
    }
  }

  // Enfileira o envio; se for menu (interactive), guarda o ÚLTIMO por usuário
  _sendToWhatsApp(message) {
    try {
      if (message && message.type === 'interactive' && message.to) {
        const cloned = JSON.parse(JSON.stringify(message));
        __lastMenuByUser.set(message.to, cloned);
      }
    } catch (e) {
      logger.warn('Falha ao armazenar último menu por usuário:', e?.message || e);
    }
    this.whatsAppSender._queueMessage(message);
  }
}

module.exports = WhatsApp;
