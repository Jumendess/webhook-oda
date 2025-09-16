const WhatsAppSender = require('./whatsAppSender');
const _ = require('underscore');
const {
    MessageModel
} = require('@oracle/bots-node-sdk/lib');
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
    * @returns {object []} ODA message.
    * @param {object[]} payload - Whatsapp Message.
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
    * @returns {object []} ODA message.
    * @param {String} userId - Phone number from user.
    * @param {String} contactName - Name (if exists) from user.
    * @param {object[]} body - Whatsapp text message.
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
    * Process text message from WhatsApp and convert to ODA message format.
    * @returns {object []} ODA message.
    * @param {String} userId - Phone number from user.
    * @param {String} contactName - Name (if exists) from user.
    * @param {object[]} interactive - Whatsapp interactive message.
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
    * Process text message from WhatsApp and convert to ODA message format.
    * @returns {object []} ODA message.
    * @param {String} userId - Phone number from user.
    * @param {String} contactName - Name (if exists) from user.
    * @param {object[]} location - Whatsapp location message.
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
    * Process text message from WhatsApp and convert to ODA message format.
    * @returns {object []} ODA message.
    * @param {String} userId - Phone number from user.
    * @param {String} contactName - Name (if exists) from user.
    * @param {object[]} attachment - Whatsapp attachment message.
    * @param {String} type - Message type.
    */
    async _createAttachmentMessage(userId, contactName, attachment, type) {
        let self = this;
        let file = await self.whatsAppSender._downloadAndSaveWhatsAppAttachmentMessage(attachment);
        let fileUrl = file;
        let odaMessage = {};

        // Mensagem que será enviada ao agente ao vivo
        let messageText = `📎 O usuário enviou um ${type}. Você pode acessá-lo aqui: ${fileUrl}`;

        switch (type) {
            case 'audio':
                odaMessage = {
                    userId: userId,
                    messagePayload: {
                        'type': 'text',  // Alterado para texto para garantir que o agente receba
                        'text': messageText
                    },
                    profile: {
                        'whatsAppNumber': userId,
                        'contactName': contactName
                    }
                };
                break;

            case 'image':
                odaMessage = {
                    userId: userId,
                    messagePayload: {
                        'type': 'text',
                        'text': `📷 O usuário enviou uma imagem. Você pode acessá-la aqui: ${fileUrl}`
                    },
                    profile: {
                        'whatsAppNumber': userId,
                        'contactName': contactName
                    }
                };
                break;

            case 'video':
                odaMessage = {
                    userId: userId,
                    messagePayload: {
                        'type': 'text',
                        'text': `🎥 O usuário enviou um vídeo. Você pode acessá-lo aqui: ${fileUrl}`
                    },
                    profile: {
                        'whatsAppNumber': userId,
                        'contactName': contactName
                    }
                };
                break;

            case 'document':
                odaMessage = {
                    userId: userId,
                    messagePayload: {
                        'type': 'text',
                        'text': `📄 O usuário enviou um documento. Você pode acessá-lo aqui: ${fileUrl}`
                    },
                    profile: {
                        'whatsAppNumber': userId,
                        'contactName': contactName
                    }
                };
                break;

            default:
                console.error('Unsupported attachment message type:', attachment.type);
                return null;
        }

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
          return
        }
        self._sendToWhatsApp(data);
    }

    /**
    * Helper function to check if it's a text or location message without actions
    * @param {String} type - message type
    * @param {object} actions - ODA Message actions
    * @param {object} globalActions - ODA Message global actions
    */
    _isTextOrLocationMessageWithoutActions(type, actions, globalActions) {
        return type === 'text' && (!actions || actions.length === 0) && (!globalActions || globalActions.length === 0);
    }

    /**
    * Helper function to check if it's a text message with actions
    * @param {String} type - message type
    * @param {object} actions - ODA Message actions
    * @param {object} globalActions - ODA Message global actions
    */
    _isTextMessageWithActions(type, actions, globalActions) {
        return type === 'text' && (actions || globalActions);
    }

    /**
    * Helper function to check if it's a card message
    * @param {String} type - message type
    * @param {object} actions - ODA Message actions
    * @param {object} globalActions - ODA Message global actions
    */
    _isCardMessage(type, cards) {
        return type === 'card' && cards;
    }

    /**
    * Helper function to check if it's an attachment message
    * @param {String} type - message type
    * @param {object} attachment - ODA attachment object
    */
    _isAttachmentMessage(type, attachment) {
        return type === 'attachment' && attachment;
    }

    /**
    * Handle text or location message without actions
    * @param {object} channelExtensions - ODA channel extensions object
    * @param {object} messagePayload - ODA message payload
    * @param {object} data - WhatsApp message payload
    */
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

    /**
    * Handle actions as a button items
    * @param {object} actions - ODA actions object
    * @param {String} headerText - ODA header text
    * @param {String} footerText - ODA footer text
    * @param {String} bodyText - ODA body text
    * @param {String} image - ODA image
    * @param {object} data - WhatsApp message payload
    */
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

        //image and header
        if (image) {
            data.interactive.header = {
            type: 'image',
            image: { link: image }
            };
        } else if (headerText) {
            data.interactive.header = { 'type': 'text', text: headerText };
        }

        //footer
        if (footerText) {
            data.interactive.footer = { text: footerText };
        }
    }

    /**
    * Handle actions as a list items
    * @param {object} actions - ODA actions object
    * @param {String} headerText - ODA header text
    * @param {String} footerText - ODA footer text
    * @param {String} messagePayload - ODA body text
    * @param {String} image - ODA image
    * @param {object} data - WhatsApp message payload
    */
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

        //image and header
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

        //footer
        if (footerText) {
            data.interactive.footer = { text: footerText };
        }
    }

    /**
    * Handle other actions (url, phone, etc) and ten more items
    * @param {object} actions - ODA actions object
    * @param {String} headerText - ODA header text
    * @param {String} footerText - ODA footer text
    * @param {String} bodyText - ODA body text
    * @param {object} data - WhatsApp message payload
    */
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
        //footer
        if (footerText) {
            response = response.concat('\n\n').concat(footerText);
        }
        data.text = { body: response };
    }

    /**
    * Convert ODA Action to WhatsApp Action. 'Share' actions are not supported.
    * @param {object} odaAction - ODA action object
    * @param {object} data - WhatsApp message payload
    */
    _createWhatsAppAction(odaAction, data) {
        let { type, label, url, phoneNumber } = odaAction;

        if (type == 'share') {
            return;
        }
        let result = label ? label : '';
        switch (type) {
            case 'url':
                {
                    data.preview_url = true;

                    result = result.concat(": ").concat(url);
                    break;
                }
            case 'call':
                {
                    result = result.concat(": ").concat(phoneNumber);
                    break;
                }
                // Share buttons not supported
            case 'share':
                {
                    return null;
                }
        }
        return result;
    }

    /**
    * Handle text message with actions
    * @param {object} actions - ODA actions object
    * @param {String} headerText - ODA header text
    * @param {String} footerText - ODA footer text
    * @param {String} messagePayload - ODA body text
    * @param {String} image - ODA image
    * @param {object} data - WhatsApp message payload
    */
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

    /**
    * Get total of postback actions
    * @param {object} actions - ODA actions object
    * @param {object} globalActions - ODA global actions object
    * @param {String} type - ODA message type
    */
    async _getPostbackActions(actions, globalActions, type) {
        // Combine Actions and Global Actions
        actions = actions ? actions : [];
        globalActions = globalActions ? globalActions : [];
        actions = actions.concat(globalActions);
        // Group Actions by type;
        actions = _.groupBy(actions, 'type');
        if (type === 'postback') {
            return _.pick(actions, ['postback']);
        } else {
            return _.omit(actions, ['postback']);
        }
    }

    /**
    * Handle card message with actions
    * @param {object} cards - ODA cards object
    * @param {object} globalActions - ODA global actions object
    * @param {String} headerText - ODA header text
    * @param {String} footerText - ODA footer text
    * @param {object} data - WhatsApp message payload
    */
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

    /**
    * Handle attachment message
    * @param {object} attachment - ODA attachment object
    * @param {object} data - WhatsApp message payload
    */
    async _handleAttachmentMessage(attachment, data) {
        logger.info('Handle attachment message');
        const { type, url, title } = attachment;

        switch (type) {
            case 'image':
                data.type = 'image';
                data.image = { link: url };
                if (title) {
                    data.image.caption = title;
                }
                break;
            case 'video':
                data.type = 'video';
                data.video = { link: url };
                if (title) {
                data.video.caption = title;
                }
                break;
            case 'audio':
                data.type = 'audio';
                data.audio = { link: url };
                if (title) {
                data.audio.caption = title;
                }
                break;
            case 'file':
                data.type = 'document';
                data.document = { link: url };
                if (title) {
                    data.document.caption = title;
                }
                break;
            default:
                console.error('Unsupported attachment type:', type);
                break;
        }
    }

    /**
    * Send Message to WhatsApp
    * @param {object[]} message - WhatsApp message payload to be send
    */
    _sendToWhatsApp(message) {
        let self = this;
        self.whatsAppSender._queueMessage(message);
    }
};
module.exports = WhatsApp;
