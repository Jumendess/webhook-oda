// testUpload.js
require('dotenv').config(); // garante que variáveis do .env sejam carregadas

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mime = require('mime-types'); // para detectar MIME automaticamente
const WhatsAppSender = require('./src/lib/whatsAppSender');

async function main() {
  // Inicializa o sender
  const sender = new WhatsAppSender();

  // Confirma que o bucket está definido
  if (!WhatsAppSender.Config.GCP_BUCKET_NAME) {
    console.error('Erro: GCP_BUCKET_NAME não está definido no .env ou Config.js');
    process.exit(1);
  }

  console.log('Bucket definido:', WhatsAppSender.Config.GCP_BUCKET_NAME);

  // Pergunta o nome do arquivo de teste
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const filePath = await new Promise((resolve) => {
    rl.question('Digite o caminho do arquivo de teste (ex: foto-teste.jpg ou test/foto-teste.jpeg): ', (answer) => {
      rl.close();
      resolve(path.resolve(answer.trim()));
    });
  });

  // Verifica se o arquivo existe
  if (!fs.existsSync(filePath)) {
    console.error('Arquivo não encontrado:', filePath);
    process.exit(1);
  }

  // Lê o arquivo
  const fileBuffer = fs.readFileSync(filePath);

  // Detecta extensão e MIME
  const ext = path.extname(filePath).slice(1); // remove o ponto
  const mimeType = mime.lookup(ext) || 'application/octet-stream';

  // Nome do arquivo no bucket
  const fileName = `whatsapp_test_${Date.now()}.${ext}`;

  // Seleciona o bucket usando storage exportado
  const bucket = WhatsAppSender.storage.bucket(WhatsAppSender.Config.GCP_BUCKET_NAME);
  const file = bucket.file(fileName);

  // Salva no bucket
  await file.save(fileBuffer, {
    metadata: { contentType: mimeType },
    resumable: false
  });

  // Gera uma URL assinada temporária de 1 hora
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000 // 1 hora
  });

  console.log(`Arquivo enviado com sucesso! URL temporária de acesso (1h): ${url}`);
}

main().catch(console.error);
