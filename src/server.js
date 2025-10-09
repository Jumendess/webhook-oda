// src/server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const log4js = require('log4js');
let logger = log4js.getLogger('Server');
const WhatsApp = require('./lib/whatsApp');            // <- dentro de src/
const Config = require('../config/Config');            // <- sobe 1 nível para /config
logger.level = Config.LOG_LEVEL;

const app = express();
app.use(bodyParser.json());

const OracleBot = require('@oracle/bots-node-sdk');
const { WebhookClient, WebhookEvent } = OracleBot.Middleware;
const { MessageModel } = require('@oracle/bots-node-sdk/lib');

const webhook = new WebhookClient({
    channel: {
        url: Config.ODA_WEBHOOK_URL,
        secret: Config.ODA_WEBHOOK_SECRET
    }
});

OracleBot.init(app, { logger });

// Init WhatsApp Connector (sem parâmetros — como no seu código atual)
const whatsApp = new WhatsApp();

// CORS simples p/ downloads
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// Static file serving (uploads)
const staticPath = path.resolve('public', 'uploads');
app.use('/uploads', express.static(staticPath));

app.get('/', (req, res) => res.send('Oracle Digital Assistant Webhook rodando.'));

// Endpoint para verificar o webhook (GET)
app.get('/user/message', (req, res) => {
    try {
        logger.info('verifying the webhook from WhatsApp.');
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === "subscribe" && token === Config.VERIFY_TOKEN) {
            console.log("Webhook verified");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } catch (error) {
        logger.error(error);
        res.sendStatus(500);
    }
});

// Entrada WhatsApp -> ODA
app.post('/user/message', async (req, res) => {
    try {
        logger.info('Received a message from WhatsApp, processing message before sending to ODA.');
        let response = await whatsApp._receive(req.body.entry);

        if (response) {
            if (response.length > 0) {
                response.forEach(async message => {
                    await webhook.send(message);
                    logger.info('Message Sent successfully to ODA.');
                })
            } else {
                logger.error('Unsupported message type');
                return res.status(400).send('Unsupported message type');
            }
        }
        res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
    }
});

// Saída ODA -> WhatsApp
app.post('/bot/message', async (req, res) => {
  try {
    logger.info('Received a message from ODA, processing message before sending to WhatsApp.');
    await whatsApp._send(req.body);
    logger.info('Message Sent successfully to WhatsApp.');
    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    return res.status(500).send(error);
  }
});

// Start
app.listen(Config.port, () => {
    logger.info(`Server listening at http://localhost:${Config.port}`);
});
