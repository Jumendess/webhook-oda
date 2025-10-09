// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const log4js = require('log4js');

const Config = require('../config/Config');
const WhatsApp = require('./src/lib/whatsApp');

// ODA SDK
const OracleBot = require('@oracle/bots-node-sdk');
const { WebhookClient } = OracleBot.Middleware;

const logger = log4js.getLogger('Server');
logger.level = Config.LOG_LEVEL;

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// Inicializa ODA
const webhook = new WebhookClient({
  channel: {
    url: Config.ODA_WEBHOOK_URL,
    secret: Config.ODA_WEBHOOK_SECRET,
  }
});

OracleBot.init(app, { logger });

// Instancia conector WhatsApp
const wa = new WhatsApp({
  accessToken: Config.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: Config.WHATSAPP_PHONE_NUMBER_ID,
  apiVersion: Config.WHATSAPP_API_VERSION,
  webhookClient: webhook
});

// Health
app.get('/', (req, res) => res.status(200).send({ ok: true, storage: Config.STORAGE_PROVIDER }));

// Rota de verificação (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === Config.VERIFY_TOKEN) {
    logger.info('[VERIFY] Token ok');
    return res.status(200).send(challenge);
  }
  logger.warn('[VERIFY] Token inválido');
  return res.sendStatus(403);
});

// Rota de recebimento (POST) – eventos do WhatsApp
app.post('/user/message', async (req, res) => {
  try {
    await wa.handleIncoming(req.body);
    res.sendStatus(200);
  } catch (e) {
    logger.error('Erro no /user/message', e?.response?.data || e.message || e);
    res.sendStatus(500);
  }
});

const port = Config.PORT;
app.listen(port, () => {
  logger.info(`Servidor up na porta ${port} | storage=${Config.STORAGE_PROVIDER}`);
});
