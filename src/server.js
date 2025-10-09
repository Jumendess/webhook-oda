// src/server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const log4js = require('log4js');

const WhatsApp = require('./lib/whatsApp');
// ATENÇÃO: confira o caminho; se seu Config fica em 'src/config/Config.js',
// e este server.js está em 'src/server.js', o require correto é '../config/Config'
const Config = require('../config/Config');

const OracleBot = require('@oracle/bots-node-sdk');
const { WebhookClient } = OracleBot.Middleware;

const logger = log4js.getLogger('Server');
logger.level = Config.LOG_LEVEL || 'info';

const app = express();

// JSON parser
app.use(express.json({ limit: '10mb' }));

// CORS simples (se quiser, restrinja ao seu domínio)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
});

// Static (se você realmente serve algo de /public/uploads)
const staticPath = path.resolve('public', 'uploads');
app.use('/uploads', express.static(staticPath));

// Oracle Bot
OracleBot.init(app, { logger });

// Webhook ODA
const webhook = new WebhookClient({
  channel: {
    url: Config.ODA_WEBHOOK_URL,
    secret: Config.ODA_WEBHOOK_SECRET
  }
});

// WhatsApp connector
const whatsApp = new WhatsApp();

// Healthcheck
app.get('/health', (_req, res) => res.status(200).send('OK'));

// Home
app.get('/', (_req, res) =>
  res.send('Oracle Digital Assistant Webhook rodando.')
);

// Verificação do webhook do WhatsApp
app.get('/user/message', (req, res) => {
  try {
    logger.info('Verifying WhatsApp webhook…');
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === Config.VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } catch (err) {
    logger.error(err);
    res.sendStatus(500);
  }
});

// Recebe mensagens do WhatsApp -> envia para ODA
app.post('/user/message', async (req, res) => {
  try {
    logger.info('Received a message from WhatsApp, forwarding to ODA.');
    const response = await whatsApp._receive(req.body.entry);

    if (response && response.length) {
      for (const msg of response) {
        await webhook.send(msg);
        logger.info('Message sent to ODA.');
      }
      return res.sendStatus(200);
    }
    logger.error('Unsupported message type');
    return res.status(400).send('Unsupported message type');
  } catch (err) {
    logger.error(err);
    return res.sendStatus(500);
  }
});

// Recebe mensagens do ODA -> envia para WhatsApp
app.post('/bot/message', async (req, res) => {
  try {
    logger.info('Received a message from ODA, sending to WhatsApp.');
    await whatsApp._send(req.body);
    logger.info('Message sent to WhatsApp.');
    return res.sendStatus(200);
  } catch (err) {
    logger.error(err);
    return res.status(500).send(err?.message || 'Error');
  }
});

// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
// LISTEN CORRETO PARA O RENDER
// Sempre use process.env.PORT e host 0.0.0.0
// Se quiser fallback local, deixe um default (ex.: 3000).
const port = process.env.PORT || Config.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
  logger.info(`Server listening on 0.0.0.0:${port}`);
});
// <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
