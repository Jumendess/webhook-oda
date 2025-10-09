require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const log4js = require('log4js');

const Config = require('../config/Config');
const WhatsApp = require('./lib/whatsApp');

let logger = log4js.getLogger('Server');
logger.level = Config.LOG_LEVEL;

// ----- Validação mínima das ENV obrigatórias -----
if (!Config.ODA_WEBHOOK_URL) {
  throw new Error('Faltando ODA_WEBHOOK_URL nas variáveis de ambiente.');
}
if (!Config.ODA_WEBHOOK_SECRET) {
  throw new Error('Faltando ODA_WEBHOOK_SECRET nas variáveis de ambiente.');
}

const app = express();

// Body parser (aumente se necessário para anexos grandes vindos do ODA)
app.use(bodyParser.json({ limit: '2mb' }));

// CORS simples para servir /uploads e testes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Static (seu projeto usa essa pasta para servir arquivos, quando aplicável)
const staticPath = path.resolve('public', 'uploads');
app.use('/uploads', express.static(staticPath));

// ---------- Oracle Digital Assistant Webhook ----------
const OracleBot = require('@oracle/bots-node-sdk');
const { WebhookClient } = OracleBot.Middleware;

// Inicializa SDK (habilita logs bonitos no console, etc.)
OracleBot.init(app, { logger });

// Cria o cliente do canal Webhook do ODA
const webhook = new WebhookClient({
  channel: {
    url: Config.ODA_WEBHOOK_URL,
    secret: Config.ODA_WEBHOOK_SECRET
  }
});

// ---------- WhatsApp Connector ----------
const whatsApp = new WhatsApp();

// ---------- Rotas ----------

// Healthcheck
app.get('/', (_req, res) => {
  res.status(200).send('Oracle Digital Assistant Webhook ativo.');
});

// Verificação do webhook do WhatsApp (GET)
app.get('/user/message', (req, res) => {
  try {
    logger.info('Verificando webhook do WhatsApp (GET /user/message).');
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === Config.VERIFY_TOKEN) {
      logger.info('Webhook do WhatsApp verificado com sucesso.');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch (err) {
    logger.error('Erro na verificação do webhook WhatsApp:', err);
    return res.sendStatus(500);
  }
});

// Recebe mensagens do WhatsApp (POST) e repassa ao ODA
app.post('/user/message', async (req, res) => {
  try {
    logger.info('Received a message from WhatsApp, forwarding to ODA.');
    const entries = req.body.entry;
    const odaMessages = await whatsApp._receive(entries);

    if (Array.isArray(odaMessages) && odaMessages.length > 0) {
      for (const message of odaMessages) {
        await webhook.send(message);
        logger.info('Message Sent successfully to ODA.');
      }
    } else {
      logger.error('Unsupported message type ou payload vazio.');
      // Não falhe o webhook do Meta; apenas 200 OK evita retries desnecessários
    }
    return res.sendStatus(200);
  } catch (err) {
    logger.error('Erro processando /user/message:', err);
    // Ainda respondemos 200 para evitar retries agressivos do Meta;
    // se quiser, mude para 500 durante diagnóstico:
    return res.sendStatus(200);
  }
});

// Recebe mensagens do ODA (POST) e envia ao WhatsApp
app.post('/bot/message', async (req, res) => {
  try {
    logger.info('Received a message from ODA, processing message before sending to WhatsApp.');
    await whatsApp._send(req.body);
    logger.info('Message Sent successfully to WhatsApp.');
    return res.sendStatus(200);
  } catch (err) {
    logger.error('Erro processando /bot/message:', err);
    return res.status(500).send(err?.message || 'Internal error');
  }
});

// Middleware final de erro (fallback)
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// Sobe o servidor
app.listen(Config.PORT, '0.0.0.0', () => {
  logger.info(`Server listening on 0.0.0.0:${Config.PORT}`);
});
