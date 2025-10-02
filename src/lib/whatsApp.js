const WhatsAppSender = require('./whatsAppSender');
const _ = require('underscore');
const { MessageModel } = require('@oracle/bots-node-sdk/lib');
const log4js = require('log4js');
let logger = log4js.getLogger('WhatsApp');
const Config = require('../../config/Config');
logger.level = Config.LOG_LEVEL;

/**
 * Utility Class to send and receive messages from WhatsApp.
 */
class WhatsApp {
  constructor() {
    this.whatsAppSender = new WhatsAppSender();
  }

  /**
   * Receives a message from WhatsApp and convert to ODA payload
   * @returns {object []} array of messages in ODA format.
   * @param {object} payload - WhatsApp Message Object
   */
  async _receive(payload) {
    let self = this;
    let response = await self._getWhatsAppMessages(payload);
    return response;
  }

  /**
   * Process WhatsApp messages and convert to ODA message format.
   * @returns {object []} Array of ODA messages.
   * @param {object[]} payload - Whatsapp Messages array to be processed.
   */
  async _getWhatsAppMessages(payload) {
    let self = this;
    let odaMessages = [];
    const entries = payload;
    for (const entry of entries) {
      const changes = entry.changes;
      for (const change of changes) {
        if (!change.value.messages) {
          return;
        }
        logger.info('Message: ', JSON.stringify(change.value.messages));

        const messages = change.value.messages;
        const userId = change.value.contacts[0].wa_id || '';
        const contactName = change.value.contacts[0].profile.name || '';

        for (const message of messages) {
          let odaMessage = await self._processMessage(message, userId, contactName);
          if (odaMessage) {
            odaMessages.push(odaMessage);
          }
        }
      }
    }
    return odaMessages;
  }

  /**
   * Process WhatsApp message per type and convert to ODA message format.
   * @returns {object} ODA message.
   * @param {object} message - Whatsapp Message.
   * @param {String} userId - Phone number from user.
   * @param {String} contactName - Name (if exists) from user.
   */
  async _processMessage(message, userId, contactName) {
    let self = this;
    let odaMessage = {};

    switch (message.type) {
      case 'text':
        odaMessage = self._createTextMessage(userId, contactName, message.text.body);
        break;

      case 'interactive':
        odaMessage = await self._createInteractiveMessage(userId, contactName, message.interactive);
        break;

      case 'location':
        odaMessage = self._createLocationMessage(userId, contactName, message.location);
        break;

      case 'audio':
        odaMessage = await self._createAttachmentMessage(userId, contactName, message.audio, message.type);
        break;

      case 'image':
        odaMessage = await self._createAttachmentMessage(userId, contactName, message.image, message.type);
        break;

      case 'video':
        odaMessage = await self._createAttachmentMessage(userId, contactName, message.video, message.type);
        break;

      case 'document':
        odaMessage = await self._createAttachmentMessage(userId, contactName, message.document, message.type);
        break;

      default:
        // Unsupported message type
        return odaMessage;
    }
    return odaMessage;
  }

  /**
   * Process text message from WhatsApp and convert to ODA message format.
   * @returns {object} ODA message.
   * @param {String} userId - Phone number from user.
   * @param {String} contactName - Name (if exists) from user.
   * @param {string} body - Whatsapp text message body.
   */
  _createTextMessage(userId, contactName, body) {
    return {
      userId: userId,
      messagePayload: MessageModel.textConversationMessage(body),
      profile: {
        whatsAppNumber: userId,
        contactName: contactName
      }
    };
  }

  /**
   * Process interactive message from WhatsApp and convert to ODA message format.
   * @returns {object} ODA message.
   * @param {String} userId - Phone number from user.
   * @param {String} contactName - Name (if exists) from user.
   * @param {object} interactive - Whatsapp interactive message.
   */
  async _createInteractiveMessage(userId, contactName, interactive) {
    let odaMessage = {};

    switch (interactive.type) {
      case 'button_reply':
        odaMessage = {
          userId: userId,
          messagePayload: {
            'type': 'postback',
            'postback': {
              'action': interactive.button_reply.id
            }
          },
          profile: {
            'whatsAppNumber': userId,
            'contactName': contactName
          }
        };
        break;

      case 'list_reply':
        odaMessage = {
          userId: userId,
          messagePayload: {
            'type': 'postback',
            'postback': {
              'action': interactive.list_reply.id
            }
          },
          profile: {
            'whatsAppNumber': userId,
            'contactName': contactName
          }
        };
        break;

      default:
        // Unsupported interactive message type
        console.error('Unsupported interactive message type:', interactive.type);
        break;
    }
    return odaMessage;
  }

  /**
   * Process location message from WhatsApp and convert to ODA message format.
   * @returns {object} ODA message.
   * @param {String} userId - Phone number from user.
   * @param {String} contactName - Name (if exists) from user.
   * @param {object} location - Whatsapp location.
   */
  _createLocationMessage(userId, contactName, location) {
    return {
      userId: userId,
      messagePayload: {
        'type': 'location',
        'location': {
          'latitude': location.latitude,
          'longitude': location.longitude
        }
      },
      profile: {
        'whatsAppNumber': userId,
        'contactName': contactName
      }
    };
  }

  /**
   * Process attachment message from WhatsApp and convert to ODA ATTACHMENT format.
   * Anteriormente convertia para texto com URL; agora envia attachment real.
   * @returns {object|null} ODA message.
   * @param {String} userId - Phone number from user.
   * @param {String} contactName - Name (if exists) from user.
   * @param {object} attachment - Whatsapp attachment message (image|audio|video|document).
   * @param {String} type - Message type (image|audio|video|document).
   */
  async _createAttachmentMessage(userId, contactName, attachment, type) {
    let self = this;

    // 1) baixa a mídia do WhatsApp e salva no seu bucket (GCP)
    //    retornando URL assinada temporária (ou pública se fallback ativo)
    //    (usa implementação existente em whatsAppSender.js)
    const fileUrl = await self.whatsAppSender._downloadAndSaveWhatsAppAttachmentMessage(attachment);

    if (!fileUrl) {
      logger.error('Falha ao obter URL do anexo (download/upload).');
      return null;
    }

    // 2) mapeia tipo do WhatsApp para tipo do attachment do ODA
    //    (compatível com o que seu conector já trata no envio ODA -> WhatsApp)
    let odaAttachmentType = 'file';
    switch (type) {
      case 'image': odaAttachmentType = 'image'; break;
      case 'audio': odaAttachmentType = 'audio'; break;
      case 'video': odaAttachmentType = 'video'; break;
      case 'document': odaAttachmentType = 'file'; break;
      default: odaAttachmentType = 'file';
    }

    // 3) monta payload como ATTACHMENT (não texto)
    const odaMessage = {
      userId: userId,
      messagePayload: {
        type: 'attachment',
        attachment: {
          type: odaAttachmentType,
          url: fileUrl,
          // opcional: você pode repassar nome/caption se existirem no payload do WhatsApp
          title: attachment.caption || attachment.filename || undefined
        }
      },
      profile: {
        'whatsAppNumber': userId,
        'contactName': contactName
      }
    };

    return odaMessage;
  }

  /**
   * Send ODA message to WhatsApp. Converts message from ODA format to WhatsApp message format.
   * @param {object} payload - ODA Message Payload
   */
  async _send(payload) {
    let self = this;
    const { userId, messagePayload } = payload;
    const { type, actions, globalActions, headerText, footerText, channelExtensions } = messagePayload;

    let data = {
      messaging_product: 'whatsapp',
      preview_url: false,
      recipient_type: 'individual',
      to: userId
    };

    // Check the message type and handle accordingly
    if (self._isTextOrLocationMessageWithoutActions(type, actions, globalActions)) {
      // Handle text or location message without actions
      await self._handleTextOrLocationMessageWithoutActions(channelExtensions, messagePayload, data);
    } else if (self._isTextMessageWithActions(type, actions, globalActions)) {
      // Handle text message with actions
      await self._handleTextMessageWithActions(actions, globalActions, headerText, footerText, messagePayload, data);
    } else if (self._isCardMessage(type, messagePayload.cards)) {
      // Handle card message
      await self._handleCardMessage(messagePayload.cards, globalActions, headerText, footerText, data);
    } else if (self._isAttachmentMessage(type, messagePayload.attachment)) {
      // Handle attachment message
      await self._handleAttachmentMessage(messagePayload.attachment, data);
    } else {
      // Unsupported message type
      return;
    }
    self._sendToWhatsApp(data);
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
    if (channelExtensions && channelExtensions.special_field_type && channelExtensions.special_field_type === 'location') {
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
      action: {
        buttons: []
      }
    };

    actions && actions.forEach(action => {
      data.interactive.action.buttons.push({
        type: 'reply',
        reply: { id: action.postback.action, title: action.label.length < 21 ? action.label : action.label.substr(0, 16).concat('...') } // max 20 chars
      });
    });

    if (image) {
      data.interactive.header = {
        type: 'image',
        image: { link: image }
      };
    } else if (headerText) {
      data.interactive.header = { 'type': 'text', text: headerText };
    }

    if (footerText) {
      data.interactive.footer = { text: footerText };
    }
  }

  async _handlePostbackActionsListItems(actions, headerText, footerText, messagePayload, image, data) {
    logger.info('Handle actions as a list items');
    data.type = 'interactive';
    data.interactive = {
      type: 'list',
      body: { text: messagePayload.text },
      action: { button: "Escolha uma opção", sections: [] } //max 20 chars
    };

    let rows = [];
    actions && actions.forEach(action => {
      rows.push({ id: action.postback.action, title: action.label.length < 24 ? action.label : action.label.substr(0, 20).concat('...')}); // max 24 chars
    });

    let section = { rows: rows };
    data.interactive.action.sections.push(section);

    if (image) {
      data.interactive.header = {
        type: 'image',
        image: { link: image }
      };
    } else if (headerText) {
      data.interactive.header = {
        'type': 'text',
        text: headerText
      };
    }

    if (footerText) {
      data.interactive.footer = { text: footerText };
    }
  }

  async _handlePostbackActionsTextItems(actions, headerText, footerText, bodyText, data) {
    logger.info('Handle other actions (url, phone, etc) and ten more items');
    let self = this;
    let response = '';
    if (headerText) {
      response = response.concat(headerText).concat('\n\n');
    }
    response = response.concat(bodyText).concat('\n');
    for (var key in actions) {
      actions[key].forEach(action => {
        let actionAstext = self._createWhatsAppAction(action, data)
        if (actionAstext) {
          response = response.concat('\n').concat(actionAstext);
        }
      });
    }
    if (footerText) {
      response = response.concat('\n\n').concat(footerText);
    }
    data.text = { body: response };
  }

  _createWhatsAppAction(odaAction, data) {
    let { type, label, url, phoneNumber } = odaAction;

    if (type == 'share') {
      return;
    }
    let result = label ? label : '';
    switch (type) {
      case 'url': {
        data.preview_url = true;
        result = result.concat(": ").concat(url);
        break;
      }
      case 'call': {
        result = result.concat(": ").concat(phoneNumber);
        break;
      }
      case 'share': {
        return null;
      }
    }
    return result;
  }

  async _handleTextMessageWithActions(actions, globalActions, headerText, footerText, messagePayload, data) {
    logger.info('Handle text message with actions');
    let self = this;
    const postbackActions = await self._getPostbackActions(actions, globalActions, 'postback');
    const totalPostbackActions = postbackActions.postback ? postbackActions.postback.length : 0;

    if (totalPostbackActions > 0) {
      if (totalPostbackActions < 4) {
        await self._handlePostbackActionsButtonItems(postbackActions.postback, headerText, footerText, messagePayload.text, null, data);
      } else if (totalPostbackActions >= 4 && totalPostbackActions <= 10) {
        await self._handlePostbackActionsListItems(postbackActions.postback, headerText, footerText, messagePayload, null, data);
      } else if (totalPostbackActions > 10) {
        await self._handlePostbackActionsTextItems(postbackActions, headerText, footerText, messagePayload.text, data);
      }
    } else { // other types
      const otherActions = await self._getPostbackActions(actions, globalActions, 'other');
      await self._handlePostbackActionsTextItems(otherActions, headerText, footerText, messagePayload.text, data)
    }
  }

  async _getPostbackActions(actions, globalActions, type) {
    actions = actions ? actions : [];
    globalActions = globalActions ? globalActions : [];
    actions = actions.concat(globalActions);
    actions = _.groupBy(actions, 'type');
    if (type === 'postback') {
      return _.pick(actions, ['postback']);
    } else {
      return _.omit(actions, ['postback']);
    }
  }

  async _handleCardMessage(cards, globalActions, headerText, footerText, data) {
    logger.info('Handle card message with actions');
    let self = this;
    const totalActions = cards.reduce((sum, card) => {
      return sum + (card.actions ? card.actions.length : 0);
    }, 0) + (globalActions ? globalActions.length : 0);

    const actions = cards.reduce((result, card) => {
      return card.actions ? result.concat(card.actions) : result;
    }, []);

    const postbackActions = await self._getPostbackActions(actions, globalActions, 'postback');
    const totalPostbackActions = postbackActions.postback ? postbackActions.postback.length : 0;
    if (totalPostbackActions > 0) {
      const image = cards[0].imageUrl ? cards[0].imageUrl : null;
      const title = cards[0].title ? cards[0].title : headerText;

      if (totalPostbackActions < 4) {
        await self._handlePostbackActionsButtonItems(postbackActions.postback, headerText, footerText, title, image, data);
      } else if (totalPostbackActions >= 4 && totalPostbackActions <= 10) {
        await self._handlePostbackActionsListItems(postbackActions.postback, headerText, footerText, title, image, data);
      } else if (totalActions > 10) {
        await self._handlePostbackActionsTextItems(postbackActions, headerText, footerText, headerText, data);
      }
    } else { // other types
      const otherActions = await self._getPostbackActions(actions, globalActions, 'other');
      await self._handlePostbackActionsTextItems(otherActions, headerText, footerText, headerText, data)
    }
  }

  _sendToWhatsApp(message) {
    let self = this;
    self.whatsAppSender._queueMessage(message);
  }
};

module.exports = WhatsApp;
