// src/server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const log4js = require('log4js');
let logger = log4js.getLogger('Server');
const WhatsApp = require('./lib/whatsApp');     // Conector WA <-> ODA (entrada/saída)
const Config = require('../config/Config');     // Configurações (tokens, níveis de log, etc.)
logger.level = Config.LOG_LEVEL;

const app = express();
app.use(bodyParser.json());

const OracleBot = require('@oracle/bots-node-sdk');
const { WebhookClient } = OracleBot.Middleware;

// Instancia o cliente de webhook do ODA (saída do servidor para o ODA)
const webhook = new WebhookClient({
  channel: { url: Config.ODA_WEBHOOK_URL, secret: Config.ODA_WEBHOOK_SECRET }
});

// Inicializa utilitários do OracleBot (apenas logging/middleware)
OracleBot.init(app, { logger });

// Instancia o conector de WhatsApp
const whatsApp = new WhatsApp();

// CORS simples para servir arquivos
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Servir arquivos estáticos (uploads S3 assinados, se aplicável)
app.use('/uploads', express.static(path.resolve('public', 'uploads')));

// Healthcheck simples
app.get('/', (_req, res) => res.send('Oracle Digital Assistant Webhook rodando.'));

// (GET) Verificação de webhook do WhatsApp (Meta)
app.get('/user/message', (req, res) => {
  try {
    logger.info('Verifying WhatsApp webhook.');
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === "subscribe" && token === Config.VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } catch (error) {
    logger.error(error);
    res.sendStatus(500);
  }
});

// (POST) Entrada: WhatsApp -> ODA
// Converte as mensagens do webhook do WhatsApp em payloads do ODA e envia.
app.post('/user/message', async (req, res) => {
  try {
    logger.info('Received a message from WhatsApp; processing before sending to ODA.');
    const payloads = await whatsApp._receive(req.body.entry);

    if (payloads) {
      if (payloads.length > 0) {
        for (const message of payloads) {
          await webhook.send(message);
          logger.info('Message sent to ODA.');
        }
      } else {
        // Aqui não houve payload “válido” (ex.: clique repetido bloqueado). Não é erro de sistema.
        logger.debug('No ODA message to send (ignored/duplicate/unsupported subtype).');
        return res.status(400).send('Unsupported message type');
      }
    }
    res.sendStatus(200);
  } catch (error) {
    logger.error(error);
    res.sendStatus(500);
  }
});

// (POST) Saída: ODA -> WhatsApp
// Recebe mensagens do ODA e monta o payload para a API do WhatsApp.
app.post('/bot/message', async (req, res) => {
  try {
    logger.info('Received a message from ODA; sending to WhatsApp.');
    await whatsApp._send(req.body);
    logger.info('Message sent to WhatsApp.');
    res.sendStatus(200);
  } catch (error) {
    logger.error(error);
    res.sendStatus(500);
  }
});

// Start do servidor HTTP
app.listen(Config.port, () => {
  logger.info(`Server listening at http://localhost:${Config.port}`);
});
